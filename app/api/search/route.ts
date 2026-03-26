import { NextResponse } from "next/server";

type MediaType = "movie" | "tv";
type AnyObj = Record<string, any>;

type Item = {
  id: number;
  media_type: MediaType;
  title: string;
  original_title?: string | null;
  original_name?: string | null;
  year: string | null;
  sort_date: string | null;
  poster_path: string | null;
  overview: string | null;
  vote_average: number | null;
  vote_count: number | null;
  genre_ids: number[];
};

type RatingMetric = {
  rating: number | null;
  votes: number | null;
};

type EnrichedSources = {
  trakt?: RatingMetric;
  tomatoes?: RatingMetric;
  popcorn?: RatingMetric;
  metacritic?: RatingMetric;
};

type EnrichedItem = Item & {
  imdbRating: number | null;
  imdbVotes: number | null;
  sources?: EnrichedSources;
  turkceAltyaziUrl?: string | null;
  mdblist?: null;
  ratingSource?: "imdb" | "tmdb" | null;
};

const TMDB_BASE = "https://api.themoviedb.org/3";
const TARGET_BATCH_SIZE = 20;
const MAX_SOURCE_PAGES_PER_REQUEST = 20;
const WATCH_REGION = "TR";

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function parseNumber(value: string | null, fallback: number | null = null) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseType(value: string | null): "all" | MediaType {
  return value === "movie" || value === "tv" ? value : "all";
}

function formatYearFromDate(d?: string | null) {
  if (!d) return null;
  const y = d.slice(0, 4);
  return /^\d{4}$/.test(y) ? y : null;
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

function turkceAltyaziUrlFromImdb(imdbId: string) {
  const num = imdbId.replace(/^tt/i, "");
  if (!num) return null;
  return `https://turkcealtyazi.org/mov/${num}/`;
}

async function tmdbFetch(path: string, qs?: Record<string, any>) {
  const token = process.env.TMDB_BEARER_TOKEN;
  if (!token) throw new Error("TMDB_BEARER_TOKEN missing");

  const search = new URLSearchParams();
  if (qs) {
    for (const [k, v] of Object.entries(qs)) {
      if (v === undefined || v === null || v === "") continue;
      search.set(k, String(v));
    }
  }

  const url = `${TMDB_BASE}/${path}${search.toString() ? `?${search.toString()}` : ""}`;

  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 3600 },
  });

  const text = await r.text().catch(() => "");
  let json: any = null;

  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return { ok: r.ok, status: r.status, json };
}

async function safeDiscover(
  mediaType: MediaType,
  qs: Record<string, any>,
  providerSelected: boolean
) {
  const result = await tmdbFetch(`discover/${mediaType}`, qs);

  if (result.ok) return result;

  // Provider seçiliyse bazı provider ID'leri movie veya tv tarafının birinde 400 dönebiliyor.
  // Bu durumda ilgili tarafı boş sonuç kabul edip diğer tarafla devam ediyoruz.
  if (providerSelected && result.status === 400) {
    return {
      ok: true,
      status: 200,
      json: {
        page: qs.page ?? 1,
        results: [],
        total_pages: 0,
        total_results: 0,
      },
    };
  }

  return result;
}

function normalizeResults(arr: any[], forcedType?: MediaType): Item[] {
  return (arr ?? [])
    .filter((x) =>
      forcedType ? true : x?.media_type === "movie" || x?.media_type === "tv"
    )
    .map((x) => {
      const mt: MediaType = forcedType ?? x.media_type;

      const title =
        mt === "tv"
          ? (x?.name ?? x?.original_name ?? "")
          : (x?.title ?? x?.original_title ?? "");

      const date = mt === "tv" ? x?.first_air_date : x?.release_date;

      return {
        id: x?.id,
        media_type: mt,
        title,
        original_title: mt === "movie" ? (x?.original_title ?? null) : null,
        original_name: mt === "tv" ? (x?.original_name ?? null) : null,
        year: formatYearFromDate(date),
        sort_date: typeof date === "string" && date ? date : null,
        poster_path: x?.poster_path ?? null,
        overview: x?.overview ?? null,
        vote_average: typeof x?.vote_average === "number" ? x.vote_average : null,
        vote_count: typeof x?.vote_count === "number" ? x.vote_count : null,
        genre_ids: Array.isArray(x?.genre_ids) ? x.genre_ids : [],
      } as Item;
    })
    .filter((x) => x.id && x.title)
    .sort((a, b) => (b.vote_count ?? -1) - (a.vote_count ?? -1));
}
function applyBaseFilters(
  list: Item[],
  type: "all" | MediaType,
  year: string,
  genreMovie: string,
  genreTv: string
) {
  const y = year ? parseInt(year, 10) : null;
  const gm = genreMovie ? parseInt(genreMovie, 10) : null;
  const gt = genreTv ? parseInt(genreTv, 10) : null;

  return list.filter((x) => {
    if (type !== "all" && x.media_type !== type) return false;

    if (y) {
      const itemYear = parseInt(x.year ?? "", 10);
      if (!Number.isFinite(itemYear)) return false;
      if (itemYear < y) return false;
    }

    if (x.media_type === "movie" && gm && !x.genre_ids.includes(gm)) return false;
    if (x.media_type === "tv" && gt && !x.genre_ids.includes(gt)) return false;

    return true;
  });
}

function dedupeItems<T extends { media_type: MediaType; id: number }>(list: T[]) {
  const seen = new Set<string>();
  const out: T[] = [];

  for (const x of list) {
    const k = `${x.media_type}:${x.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }

  return out;
}

function extractImdbMetrics(md: AnyObj | null) {
  if (!md) {
    return {
      imdbRating: null,
      imdbVotes: null,
    };
  }

  const imdbSource = md?.ratings?.find?.((r: AnyObj) => r?.source === "imdb") ?? null;

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

function extractSources(md: AnyObj | null): EnrichedSources {
  const out: EnrichedSources = {};
  const ratings = Array.isArray(md?.ratings) ? md.ratings : [];

  for (const r of ratings) {
    const source = String(r?.source ?? "").toLowerCase();
    const metric: RatingMetric = {
      rating: toNumberRating(r?.value),
      votes: toIntVotes(r?.votes),
    };

    if (source === "trakt") {
      out.trakt = metric;
      continue;
    }

    if (source === "tomatoes") {
      out.tomatoes = metric;
      continue;
    }

    if (source === "tomatoesaudience") {
      out.popcorn = metric;
      continue;
    }

    if (source === "metacritic") {
      out.metacritic = metric;
      continue;
    }
  }

  return out;
}

function isMdblistQuotaPayload(md: AnyObj | null) {
  if (!md) return false;
  const text = JSON.stringify(md).toLowerCase();

  return (
    text.includes("daily limit") ||
    text.includes("quota") ||
    text.includes("rate limit") ||
    text.includes("limit exceeded")
  );
}

function getEffectiveRating(item: EnrichedItem) {
  return item.imdbRating ?? item.vote_average ?? null;
}

function getEffectiveVotes(item: EnrichedItem) {
  return item.imdbVotes ?? item.vote_count ?? null;
}

function getRatingSource(item: EnrichedItem): "imdb" | "tmdb" | null {
  if (item.imdbRating != null || item.imdbVotes != null) return "imdb";
  if (item.vote_average != null || item.vote_count != null) return "tmdb";
  return null;
}

const g = globalThis as any;
const ENRICH_CACHE: Map<
  string,
  {
    exp: number;
    value: Omit<EnrichedItem, keyof Item>;
  }
> = g.__SEARCH_ENRICH_CACHE__ ?? (g.__SEARCH_ENRICH_CACHE__ = new Map());

const PROVIDER_CACHE: Map<
  string,
  {
    exp: number;
    providerIds: number[];
  }
> = g.__SEARCH_PROVIDER_CACHE__ ?? (g.__SEARCH_PROVIDER_CACHE__ = new Map());

async function getProviderIds(item: Item): Promise<number[]> {
  const cacheKey = `${item.media_type}:${item.id}:${WATCH_REGION}`;
  const now = Date.now();
  const cached = PROVIDER_CACHE.get(cacheKey);

  if (cached && cached.exp > now) {
    return cached.providerIds;
  }

  const TMDB_TOKEN = process.env.TMDB_BEARER_TOKEN;
  if (!TMDB_TOKEN) return [];

  try {
    const url = `${TMDB_BASE}/${item.media_type}/${item.id}/watch/providers`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
      next: { revalidate: 86400 },
    });

    if (!res.ok) return [];

    const json = (await res.json()) as AnyObj;
    const regionData = json?.results?.[WATCH_REGION] ?? null;
    const providers = [
      ...(Array.isArray(regionData?.flatrate) ? regionData.flatrate : []),
      ...(Array.isArray(regionData?.ads) ? regionData.ads : []),
      ...(Array.isArray(regionData?.free) ? regionData.free : []),
      ...(Array.isArray(regionData?.rent) ? regionData.rent : []),
      ...(Array.isArray(regionData?.buy) ? regionData.buy : []),
    ];

    const providerIds = Array.from(
      new Set(
        providers
          .map((provider: AnyObj) => Number(provider?.provider_id))
          .filter((providerId: number) => Number.isFinite(providerId) && providerId > 0)
      )
    );

    PROVIDER_CACHE.set(cacheKey, {
      exp: now + 24 * 3600_000,
      providerIds,
    });

    return providerIds;
  } catch {
    return [];
  }
}

async function enrichOne(item: Item): Promise<EnrichedItem> {
  const cacheKey = `${item.media_type}:${item.id}`;
  const now = Date.now();
  const cached = ENRICH_CACHE.get(cacheKey);

  if (cached && cached.exp > now) {
    return { ...item, ...cached.value };
  }

  const TMDB_TOKEN = process.env.TMDB_BEARER_TOKEN;

  if (!TMDB_TOKEN) {
    return {
      ...item,
      imdbRating: null,
      imdbVotes: null,
      sources: {},
      turkceAltyaziUrl: null,
      mdblist: null,
      ratingSource: getRatingSource({
        ...item,
        imdbRating: null,
        imdbVotes: null,
      } as EnrichedItem),
    };
  }

  let imdb_id: string | null = null;

  try {
    const extUrl = `${TMDB_BASE}/${item.media_type}/${item.id}/external_ids`;
    const extRes = await fetch(extUrl, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
      next: { revalidate: 86400 },
    });

    if (extRes.ok) {
      const ext = (await extRes.json()) as AnyObj;
      imdb_id = (ext?.imdb_id as string | null) ?? null;
    }
  } catch {
    // ignore
  }

  if (!imdb_id) {
    const payload = {
      imdbRating: null,
      imdbVotes: null,
      sources: {},
      turkceAltyaziUrl: null,
      mdblist: null,
      ratingSource: "tmdb" as const,
    };

    ENRICH_CACHE.set(cacheKey, {
      exp: now + 24 * 3600_000,
      value: payload,
    });

    return { ...item, ...payload };
  }

  let md: AnyObj | null = null;
  const MDB_KEY = process.env.MDBLIST_API_KEY;

  if (MDB_KEY) {
    try {
      const mdUrl = `https://mdblist.com/api/?apikey=${encodeURIComponent(MDB_KEY)}&i=${encodeURIComponent(imdb_id)}`;
      const mdRes = await fetch(mdUrl, {
        next: { revalidate: 86400 },
      });

      if (mdRes.ok) {
        md = (await mdRes.json()) as AnyObj;
        if (isMdblistQuotaPayload(md)) {
          md = null;
        }
      }
    } catch {
      // ignore
    }
  }

  const { imdbRating, imdbVotes } = extractImdbMetrics(md);
  const sources = extractSources(md);

  const payload = {
    imdbRating,
    imdbVotes,
    sources,
    turkceAltyaziUrl: turkceAltyaziUrlFromImdb(imdb_id),
    mdblist: null,
    ratingSource:
      imdbRating != null || imdbVotes != null ? ("imdb" as const) : ("tmdb" as const),
  };

  ENRICH_CACHE.set(cacheKey, {
    exp: now + 24 * 3600_000,
    value: payload,
  });

  return { ...item, ...payload };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const q = (url.searchParams.get("q") ?? "").trim();
    const type = parseType(url.searchParams.get("type"));
    const year = url.searchParams.get("year") ?? "";
    const minRating = url.searchParams.get("minRating") ?? "";
    const minVotes = url.searchParams.get("minVotes") ?? "";
    const platform = url.searchParams.get("platform") ?? "";
    const genreMovie = url.searchParams.get("gM") ?? "";
    const genreTv = url.searchParams.get("gT") ?? "";
    const startPage = Math.max(1, Number(url.searchParams.get("page") ?? "1"));

    const minRRaw = parseNumber(minRating, null);
    const minVRaw = parseNumber(minVotes, null);
    const selectedProviderId = parseNumber(platform, null);
    const minR = minRRaw != null ? clamp(minRRaw, 0, 10) : null;
    const minV = minVRaw != null ? Math.max(0, minVRaw) : null;
    const providerSelected = selectedProviderId != null;

    let sourcePage = startPage;
    let totalPages = Number.POSITIVE_INFINITY;
    let collected: EnrichedItem[] = [];
    let scannedCount = 0;

    while (
      collected.length < TARGET_BATCH_SIZE &&
      sourcePage <= totalPages &&
      scannedCount < MAX_SOURCE_PAGES_PER_REQUEST
    ) {
      let merged: Item[] = [];

      if (q) {
        const data = await tmdbFetch("search/multi", {
          query: q,
          language: "tr-TR",
          include_adult: "false",
          page: sourcePage,
        });

        if (!data.ok) {
          return NextResponse.json(
            { error: "tmdb search failed", status: data.status, body: data.json },
            { status: 502 }
          );
        }

        merged = applyBaseFilters(
          normalizeResults(data.json?.results ?? []),
          type,
          year,
          genreMovie,
          genreTv
        );

        totalPages = data.json?.total_pages ?? 1;
      } else {
        let wantMovie = type === "all" || type === "movie";
        let wantTv = type === "all" || type === "tv";

        if (type === "all") {
          if (genreMovie && !genreTv) {
            wantMovie = true;
            wantTv = false;
          } else if (!genreMovie && genreTv) {
            wantMovie = false;
            wantTv = true;
          }
        }

        const common = {
          language: "tr-TR",
          include_adult: "false",
          page: sourcePage,
          watch_region: providerSelected ? WATCH_REGION : undefined,
          with_watch_providers: providerSelected ? selectedProviderId : undefined,
        };

       const minDate = year ? `${year}-01-01` : undefined;

const [m, t] = await Promise.all([
  wantMovie
    ? safeDiscover(
        "movie",
        {
          ...common,
          sort_by: "vote_count.desc",
          "primary_release_date.gte": minDate,
          with_genres: genreMovie || undefined,
        },
        providerSelected
      )
    : Promise.resolve({
        ok: true,
        status: 200,
        json: { results: [], total_pages: 0, total_results: 0 },
      }),
  wantTv
    ? safeDiscover(
        "tv",
        {
          ...common,
          sort_by: "vote_count.desc",
          "first_air_date.gte": minDate,
          with_genres: genreTv || undefined,
        },
        providerSelected
      )
    : Promise.resolve({
        ok: true,
        status: 200,
        json: { results: [], total_pages: 0, total_results: 0 },
      }),
]);

        if (!m.ok || !t.ok) {
          return NextResponse.json(
            { error: "tmdb discover failed", movie: m, tv: t },
            { status: 502 }
          );
        }

        const mItems = m.json ? normalizeResults(m.json?.results ?? [], "movie") : [];
        const tItems = t.json ? normalizeResults(t.json?.results ?? [], "tv") : [];

        merged = applyBaseFilters([...mItems, ...tItems], type, year, genreMovie, genreTv).sort(
          (a, b) => (b.vote_count ?? -1) - (a.vote_count ?? -1)
        );

        totalPages = Math.max(m.json?.total_pages ?? 0, t.json?.total_pages ?? 0, 1);
      }

      scannedCount += 1;

      const deduped = dedupeItems(merged);

      const providerFiltered =
        providerSelected && q
          ? (
              await Promise.all(
                deduped.map(async (item) => {
                  const providerIds = await getProviderIds(item);
                  return providerIds.includes(selectedProviderId!) ? item : null;
                })
              )
            ).filter(Boolean) as Item[]
          : deduped;

      const enriched = await Promise.all(providerFiltered.map((item) => enrichOne(item)));

      const filtered = enriched.filter((x) => {
        const effectiveRating = getEffectiveRating(x);
        const effectiveVotes = getEffectiveVotes(x);

        if (minR != null) {
          if (effectiveRating == null) return false;
          if (effectiveRating < minR) return false;
        }

        if (minV != null) {
          if (effectiveVotes == null) return false;
          if (effectiveVotes < minV) return false;
        }

        return true;
      });

      const sortedFiltered = filtered.sort((a, b) => {
        const aVotes = getEffectiveVotes(a) ?? -1;
        const bVotes = getEffectiveVotes(b) ?? -1;
        return bVotes - aVotes;
      });

      collected = dedupeItems([...collected, ...sortedFiltered]).slice(0, TARGET_BATCH_SIZE);
      sourcePage += 1;
    }

    const hasMore = sourcePage <= totalPages;
    const nextPage = hasMore ? sourcePage : null;

    return NextResponse.json({
      results: collected.map((item) => ({
        ...item,
        ratingSource: getRatingSource(item),
      })),
      next_page: nextPage,
      has_more: hasMore,
      scanned_until_page: sourcePage - 1,
      total_pages: Number.isFinite(totalPages) ? totalPages : 1,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "search api failed",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 }
    );
  }
}