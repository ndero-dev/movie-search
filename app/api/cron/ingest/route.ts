import { NextResponse } from "next/server";
import {
  countCatalogItems,
  ensureCatalogSchema,
  getIngestState,
  setIngestState,
  upsertCatalogItem,
  type CatalogItemRow,
  type CatalogMediaType,
  type MdblistStatus,
} from "@/app/lib/catalog-db";

const TMDB_BASE = "https://api.themoviedb.org/3";
const WATCH_REGION = "TR";

const MDBLIST_DAILY_LIMIT = 25000;
const TARGET_ITEMS_PER_RUN = 1000;
const TARGET_MOVIE_ITEMS_PER_RUN = 500;
const TARGET_TV_ITEMS_PER_RUN = 500;

const CURSOR_STATE_KEY = "daily_ingest_cursor_v2";
const QUOTA_STATE_KEY = "mdblist_daily_quota_v2";

type TmdbListItem = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  overview?: string | null;
  vote_average?: number | null;
  vote_count?: number | null;
  genre_ids?: number[];
};

type TmdbFetchResult = {
  ok: boolean;
  status: number;
  json: any;
};

type MdblistResult =
  | { status: "ok"; data: any }
  | { status: "not_found" }
  | { status: "rate_limited" }
  | { status: "quota_blocked" }
  | { status: "http_error"; code: number }
  | { status: "network_error" };

type QuotaState = {
  dayKey: string;
  usedToday: number;
  providerRemaining: number | null;
  retryAfterSeconds: number | null;
  providerLimit: number | null;
  resetAtUnix: number | null;
};

type IngestRunStats = {
  insertedOrUpdated: number;
  mdblistAttemptCount: number;
  mdblistSuccessCount: number;
  mdblistNotFoundCount: number;
  mdblistRateLimitedCount: number;
  mdblistQuotaBlockedCount: number;
  mdblistHttpErrorCount: number;
  mdblistNetworkErrorCount: number;
  missingImdbIdCount: number;
};

type IngestRunResult = {
  nextPage: number;
  stoppedDueToQuota: boolean;
  stats: IngestRunStats;
};

function emptyStats(): IngestRunStats {
  return {
    insertedOrUpdated: 0,
    mdblistAttemptCount: 0,
    mdblistSuccessCount: 0,
    mdblistNotFoundCount: 0,
    mdblistRateLimitedCount: 0,
    mdblistQuotaBlockedCount: 0,
    mdblistHttpErrorCount: 0,
    mdblistNetworkErrorCount: 0,
    missingImdbIdCount: 0,
  };
}

function mergeStats(...statsList: IngestRunStats[]): IngestRunStats {
  const out = emptyStats();

  for (const stats of statsList) {
    out.insertedOrUpdated += stats.insertedOrUpdated;
    out.mdblistAttemptCount += stats.mdblistAttemptCount;
    out.mdblistSuccessCount += stats.mdblistSuccessCount;
    out.mdblistNotFoundCount += stats.mdblistNotFoundCount;
    out.mdblistRateLimitedCount += stats.mdblistRateLimitedCount;
    out.mdblistQuotaBlockedCount += stats.mdblistQuotaBlockedCount;
    out.mdblistHttpErrorCount += stats.mdblistHttpErrorCount;
    out.mdblistNetworkErrorCount += stats.mdblistNetworkErrorCount;
    out.missingImdbIdCount += stats.missingImdbIdCount;
  }

  return out;
}

function getTmdbToken() {
  const token = process.env.TMDB_BEARER_TOKEN;
  if (!token) throw new Error("TMDB_BEARER_TOKEN missing");
  return token;
}

function getMdblistApiKey() {
  const key = process.env.MDBLIST_INGEST_API_KEY;
  if (!key) throw new Error("MDBLIST_INGEST_API_KEY missing");
  return key;
}

function getUtcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeQuotaState(raw: QuotaState | null): QuotaState {
  const today = getUtcDayKey();

  if (!raw || raw.dayKey !== today) {
    return {
      dayKey: today,
      usedToday: 0,
      providerRemaining: null,
      retryAfterSeconds: null,
      providerLimit: null,
      resetAtUnix: null,
    };
  }

  return {
    dayKey: today,
    usedToday: Math.max(0, Number(raw.usedToday ?? 0)),
    providerRemaining:
      raw.providerRemaining == null ? null : Math.max(0, Number(raw.providerRemaining)),
    retryAfterSeconds:
      raw.retryAfterSeconds == null ? null : Math.max(0, Number(raw.retryAfterSeconds)),
    providerLimit:
      raw.providerLimit == null ? null : Math.max(0, Number(raw.providerLimit)),
    resetAtUnix:
      raw.resetAtUnix == null ? null : Math.max(0, Number(raw.resetAtUnix)),
  };
}

function getTrackedRemaining(quotaState: QuotaState) {
  return Math.max(0, MDBLIST_DAILY_LIMIT - quotaState.usedToday);
}

function getEffectiveRemaining(quotaState: QuotaState) {
  if (quotaState.providerRemaining != null) {
    return Math.max(0, quotaState.providerRemaining);
  }

  return getTrackedRemaining(quotaState);
}

function consumeMdblistAttempt(quotaState: QuotaState) {
  quotaState.usedToday += 1;

  if (quotaState.providerRemaining != null) {
    quotaState.providerRemaining = Math.max(0, quotaState.providerRemaining - 1);
  }
}

function parseProviderRemainingFromHeaders(headers: Headers) {
  const map: Record<string, string> = {};

  headers.forEach((value, key) => {
    map[key.toLowerCase()] = value;
  });

  const value = map["x-ratelimit-remaining"] ?? null;
  if (!value) return null;

  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  return Math.max(0, n);
}

function parseProviderLimitFromHeaders(headers: Headers) {
  const map: Record<string, string> = {};

  headers.forEach((value, key) => {
    map[key.toLowerCase()] = value;
  });

  const value = map["x-ratelimit-limit"] ?? null;
  if (!value) return null;

  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  return Math.max(0, n);
}

function parseResetAtFromHeaders(headers: Headers) {
  const value = headers.get("x-ratelimit-reset");
  if (!value) return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseRetryAfter(headers: Headers): number | null {
  const value = headers.get("retry-after");
  if (!value) return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeYear(date?: string | null) {
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function toIntVotes(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = parseInt(v.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toNumberRating(v: any): number | null {
  if (v == null || v === "" || v === "N/A") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractImdbMetrics(md: any) {
  if (!md) {
    return { imdbRating: null, imdbVotes: null };
  }

  const imdbSource = md?.ratings?.find?.((r: any) => r?.source === "imdb") ?? null;

  const imdbRating =
    toNumberRating(imdbSource?.value) ??
    toNumberRating(md?.scores?.imdb) ??
    toNumberRating(md?.imdb_rating) ??
    toNumberRating(md?.imdbRating) ??
    null;

  const imdbVotes =
    toIntVotes(imdbSource?.votes) ??
    toIntVotes(md?.score_average_votes?.imdb) ??
    toIntVotes(md?.imdb_votes) ??
    toIntVotes(md?.imdbVotes) ??
    null;

  return { imdbRating, imdbVotes };
}

function isAuthorized(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  const ua = req.headers.get("user-agent") ?? "";
  return ua.includes("vercel-cron/1.0");
}

async function tmdbFetch(
  path: string,
  params?: Record<string, string | number | null | undefined>
): Promise<TmdbFetchResult> {
  const token = getTmdbToken();
  const qs = new URLSearchParams();

  for (const [k, v] of Object.entries(params ?? {})) {
    if (v == null || v === "") continue;
    qs.set(k, String(v));
  }

  const url = `${TMDB_BASE}/${path}${qs.toString() ? `?${qs.toString()}` : ""}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  const text = await res.text().catch(() => "");
  let json: any = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return { ok: res.ok, status: res.status, json };
}

async function fetchDiscoverPage(mediaType: CatalogMediaType, page: number) {
  const path = mediaType === "movie" ? "discover/movie" : "discover/tv";

  const result = await tmdbFetch(path, {
    language: "tr-TR",
    include_adult: "false",
    sort_by: "vote_count.desc",
    page,
  });

  if (!result.ok) {
    throw new Error(`TMDB discover failed for ${mediaType} page ${page}: ${result.status}`);
  }

  return result.json;
}

async function fetchExternalIds(mediaType: CatalogMediaType, tmdbId: number) {
  const result = await tmdbFetch(`${mediaType}/${tmdbId}/external_ids`);

  if (!result.ok) return null;
  return result.json;
}

async function fetchProviders(mediaType: CatalogMediaType, tmdbId: number) {
  const result = await tmdbFetch(`${mediaType}/${tmdbId}/watch/providers`);

  if (!result.ok) return [];

  const regionData = result.json?.results?.[WATCH_REGION] ?? null;
  const providers = [
    ...(Array.isArray(regionData?.flatrate) ? regionData.flatrate : []),
    ...(Array.isArray(regionData?.ads) ? regionData.ads : []),
    ...(Array.isArray(regionData?.free) ? regionData.free : []),
    ...(Array.isArray(regionData?.rent) ? regionData.rent : []),
    ...(Array.isArray(regionData?.buy) ? regionData.buy : []),
  ];

  return Array.from(
    new Set(
      providers
        .map((provider: any) => Number(provider?.provider_id))
        .filter((providerId: number) => Number.isFinite(providerId) && providerId > 0)
    )
  );
}

async function fetchMdblistByImdbId(
  imdbId: string,
  quotaState: QuotaState
): Promise<MdblistResult> {
  if (getEffectiveRemaining(quotaState) <= 0) {
    return { status: "quota_blocked" };
  }

  const apiKey = getMdblistApiKey();
  const url = `https://mdblist.com/api/?apikey=${encodeURIComponent(apiKey)}&i=${encodeURIComponent(imdbId)}`;

  consumeMdblistAttempt(quotaState);

  try {
    const res = await fetch(url, { cache: "no-store" });

    const providerRemaining = parseProviderRemainingFromHeaders(res.headers);
    if (providerRemaining != null) {
      quotaState.providerRemaining = providerRemaining;
    }

    const providerLimit = parseProviderLimitFromHeaders(res.headers);
    if (providerLimit != null) {
      quotaState.providerLimit = providerLimit;
    }

    const resetAtUnix = parseResetAtFromHeaders(res.headers);
    if (resetAtUnix != null) {
      quotaState.resetAtUnix = resetAtUnix;
    }

    const retryAfter = parseRetryAfter(res.headers);
    if (retryAfter != null) {
      quotaState.retryAfterSeconds = retryAfter;
    }

    if (res.status === 429) {
      return { status: "rate_limited" };
    }

    if (res.status === 401 || res.status === 403) {
      return { status: "quota_blocked" };
    }

    if (res.status === 404) {
      return { status: "not_found" };
    }

    if (!res.ok) {
      return { status: "http_error", code: res.status };
    }

    const json = await res.json().catch(() => null);

    if (!json || Object.keys(json).length === 0) {
      return { status: "not_found" };
    }

    return { status: "ok", data: json };
  } catch {
    return { status: "network_error" };
  }
}

function mapMdblistResultToStatus(result: MdblistResult): MdblistStatus {
  switch (result.status) {
    case "ok":
      return "ok";
    case "not_found":
      return "not_found";
    case "rate_limited":
      return "rate_limited";
    case "quota_blocked":
      return "quota_blocked";
    case "http_error":
      return "http_error";
    case "network_error":
      return "network_error";
    default:
      return "network_error";
  }
}

function mapCandidateToCatalogRow(
  candidate: TmdbListItem,
  mediaType: CatalogMediaType,
  imdbId: string | null,
  mdblistPayload: any,
  providerIds: number[],
  mdblistStatus: MdblistStatus
): CatalogItemRow {
  const title = mediaType === "movie" ? candidate.title ?? "" : candidate.name ?? "";
  const originalTitle =
    mediaType === "movie"
      ? candidate.original_title ?? null
      : candidate.original_name ?? null;

  const year = normalizeYear(
    mediaType === "movie" ? candidate.release_date : candidate.first_air_date
  );

  const { imdbRating, imdbVotes } = extractImdbMetrics(mdblistPayload);
  const isEnriched = mdblistStatus === "ok";

  return {
    media_type: mediaType,
    tmdb_id: candidate.id,
    imdb_id: imdbId,
    title,
    original_title: originalTitle,
    year,
    poster_path: candidate.poster_path ?? null,
    overview: candidate.overview ?? null,
    genre_ids_json: JSON.stringify(Array.isArray(candidate.genre_ids) ? candidate.genre_ids : []),
    provider_ids_json: JSON.stringify(providerIds),
    imdb_rating: imdbRating,
    imdb_votes: imdbVotes,
    tmdb_vote_average:
      typeof candidate.vote_average === "number" ? candidate.vote_average : null,
    tmdb_vote_count:
      typeof candidate.vote_count === "number" ? candidate.vote_count : null,
    mdblist_payload_json: mdblistPayload ? JSON.stringify(mdblistPayload) : null,
    is_enriched: isEnriched,
    mdblist_status: mdblistStatus,
  };
}

async function getNextCursor() {
  const state = (await getIngestState<{ moviePage?: number; tvPage?: number }>(
    CURSOR_STATE_KEY
  )) ?? { moviePage: 1, tvPage: 1 };

  return {
    moviePage: Math.max(1, Number(state.moviePage ?? 1)),
    tvPage: Math.max(1, Number(state.tvPage ?? 1)),
  };
}

async function getQuotaState() {
  const raw = await getIngestState<QuotaState>(QUOTA_STATE_KEY);
  return normalizeQuotaState(raw);
}

async function ingestMediaType(
  mediaType: CatalogMediaType,
  startPage: number,
  targetItems: number,
  quotaState: QuotaState
): Promise<IngestRunResult> {
  let currentPage = startPage;
  let lastCompletedPage = startPage;
  const collected: CatalogItemRow[] = [];
  const stats = emptyStats();
  let stoppedDueToQuota = false;

  while (collected.length < targetItems) {
    const pageBeingProcessed = currentPage;

    const json = await fetchDiscoverPage(mediaType, pageBeingProcessed);
    const results = Array.isArray(json?.results) ? (json.results as TmdbListItem[]) : [];
    const totalPages = Number(json?.total_pages ?? 1);

    let pageCompleted = true;

    for (const candidate of results) {
      if (collected.length >= targetItems) {
        break;
      }

      const externalIds = await fetchExternalIds(mediaType, candidate.id);
      const imdbId = typeof externalIds?.imdb_id === "string" ? externalIds.imdb_id : null;

      if (!imdbId) {
        stats.missingImdbIdCount += 1;
        continue;
      }

      stats.mdblistAttemptCount += 1;
      const mdblistResult = await fetchMdblistByImdbId(imdbId, quotaState);

      if (mdblistResult.status === "rate_limited") {
        stats.mdblistRateLimitedCount += 1;
        stoppedDueToQuota = true;
        pageCompleted = false;
        break;
      }

      if (mdblistResult.status === "quota_blocked") {
        stats.mdblistQuotaBlockedCount += 1;
        stoppedDueToQuota = true;
        pageCompleted = false;
        break;
      }

      let mdblistPayload: any = null;

      if (mdblistResult.status === "ok") {
        mdblistPayload = mdblistResult.data;
        stats.mdblistSuccessCount += 1;
      } else if (mdblistResult.status === "not_found") {
        stats.mdblistNotFoundCount += 1;
      } else if (mdblistResult.status === "http_error") {
        stats.mdblistHttpErrorCount += 1;
      } else if (mdblistResult.status === "network_error") {
        stats.mdblistNetworkErrorCount += 1;
      }

      const providerIds = await fetchProviders(mediaType, candidate.id);

      const row = mapCandidateToCatalogRow(
        candidate,
        mediaType,
        imdbId,
        mdblistPayload,
        providerIds,
        mapMdblistResultToStatus(mdblistResult)
      );

      collected.push(row);
    }

    if (pageCompleted) {
      lastCompletedPage = pageBeingProcessed;

      currentPage = pageBeingProcessed + 1;
      if (currentPage > totalPages) {
        currentPage = 1;
      }
    } else {
      currentPage = pageBeingProcessed;
    }

    if (stoppedDueToQuota) {
      break;
    }
  }

  collected.sort((a, b) => {
    const aRating = a.imdb_rating ?? -1;
    const bRating = b.imdb_rating ?? -1;
    if (bRating !== aRating) return bRating - aRating;

    const aVotes = a.imdb_votes ?? -1;
    const bVotes = b.imdb_votes ?? -1;
    return bVotes - aVotes;
  });

  for (const row of collected) {
    await upsertCatalogItem(row);
  }

  stats.insertedOrUpdated = collected.length;

  return {
    nextPage: currentPage,
    stoppedDueToQuota,
    stats,
  };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await ensureCatalogSchema();

    const cursor = await getNextCursor();
    const quotaState = await getQuotaState();
    const remainingAtStart = getEffectiveRemaining(quotaState);

    const movieRun = await ingestMediaType(
      "movie",
      cursor.moviePage,
      TARGET_MOVIE_ITEMS_PER_RUN,
      quotaState
    );

    let tvRun: IngestRunResult = {
      nextPage: cursor.tvPage,
      stoppedDueToQuota: false,
      stats: emptyStats(),
    };

    if (!movieRun.stoppedDueToQuota) {
      tvRun = await ingestMediaType(
        "tv",
        cursor.tvPage,
        TARGET_TV_ITEMS_PER_RUN,
        quotaState
      );
    }

    await setIngestState(CURSOR_STATE_KEY, {
      moviePage: movieRun.nextPage,
      tvPage: tvRun.nextPage,
    });

    await setIngestState(QUOTA_STATE_KEY, quotaState);

    const totalCount = await countCatalogItems();
    const totalStats = mergeStats(movieRun.stats, tvRun.stats);
    const remainingAtEnd = getEffectiveRemaining(quotaState);

    return NextResponse.json({
      ok: true,
      targetItemsPerRun: TARGET_ITEMS_PER_RUN,
      targetMovieItemsPerRun: TARGET_MOVIE_ITEMS_PER_RUN,
      targetTvItemsPerRun: TARGET_TV_ITEMS_PER_RUN,
      dailyMdblistLimit: MDBLIST_DAILY_LIMIT,
      moviePagesStartedFrom: cursor.moviePage,
      tvPagesStartedFrom: cursor.tvPage,
      nextMoviePage: movieRun.nextPage,
      nextTvPage: tvRun.nextPage,
      stoppedDueToQuota: movieRun.stoppedDueToQuota || tvRun.stoppedDueToQuota,
      totalCatalogItems: totalCount,
      remainingMdblistCallsAtStart: remainingAtStart,
      remainingMdblistCallsAtEnd: remainingAtEnd,
      providerReportedLimit: quotaState.providerLimit,
      providerReportedRemaining: quotaState.providerRemaining,
      providerReportedResetAtUnix: quotaState.resetAtUnix,
      retryAfterSeconds: quotaState.retryAfterSeconds,
      stats: totalStats,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 }
    );
  }
}