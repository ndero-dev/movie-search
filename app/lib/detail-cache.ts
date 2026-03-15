import { unstable_cache } from "next/cache";

type AnyObj = Record<string, any>;
type MediaType = "movie" | "tv";

export type RatingSource = {
  rating: number | string;
  votes?: number | null;
};

export type ExtraSources = {
  imdb?: RatingSource | null;
  mdblist?: RatingSource | null;
  tomatoes?: RatingSource | null;
  popcorn?: RatingSource | null;
  metacritic?: RatingSource | null;
  metacriticuser?: RatingSource | null;
  trakt?: RatingSource | null;
  letterboxd?: RatingSource | null;
  rogerebert?: RatingSource | null;
  myanimelist?: RatingSource | null;
};

export type WatchProviderItem = {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
};

export type WatchProviderBlock = {
  link: string | null;
  flatrate: WatchProviderItem[];
  rent: WatchProviderItem[];
  buy: WatchProviderItem[];
};

export type ExtraRatingsResult = {
  imdb_id: string | null;
  imdbRating: number | null;
  imdbVotes: number | null;
  turkceAltyaziUrl: string | null;
  mdblist: {
    id: string | number;
    type: "movie" | "show";
    url: string | null;
  } | null;
  sources: ExtraSources;
  watchProviders: {
    region: string;
    results: WatchProviderBlock | null;
  };
};

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const WATCH_PROVIDER_REGION = "TR";
const PROVIDER_LOGO_SIZE = "w92";

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

function normalizeRatingEntry(entry: any): RatingSource | null {
  if (!entry) return null;

  if (typeof entry === "number" || typeof entry === "string") {
    return { rating: entry };
  }

  const rating =
    entry.rating ??
    entry.value ??
    entry.score ??
    entry.percent ??
    entry.meter ??
    entry.average ??
    null;

  if (rating == null || rating === "") return null;

  const votes = toIntVotes(
    entry.votes ?? entry.vote_count ?? entry.count ?? entry.total ?? null
  );

  return { rating, votes: votes ?? undefined };
}

function extractSource(md: AnyObj, key: string): RatingSource | null {
  const a = normalizeRatingEntry(md?.ratings?.[key]);
  if (a) return a;

  const b = normalizeRatingEntry(md?.scores?.[key]);
  if (b) return b;

  const c = normalizeRatingEntry(md?.[key]);
  if (c) return c;

  const arr = md?.ratings;
  if (Array.isArray(arr)) {
    const found = arr.find(
      (x) => String(x?.source ?? x?.name ?? "").toLowerCase() === key.toLowerCase()
    );
    const d = normalizeRatingEntry(found);
    if (d) return d;
  }

  const arr2 = md?.sources;
  if (Array.isArray(arr2)) {
    const found = arr2.find(
      (x) => String(x?.source ?? x?.name ?? "").toLowerCase() === key.toLowerCase()
    );
    const e = normalizeRatingEntry(found);
    if (e) return e;
  }

  return null;
}

function turkceAltyaziUrlFromImdb(imdbId: string) {
  const num = imdbId.replace(/^tt/i, "");
  if (!num) return null;
  return `https://turkcealtyazi.org/mov/${num}/`;
}

function slugifyTitle(input: string) {
  return input
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function mdblistWebUrl(
  type: "movie" | "show",
  mdblistId: string | number,
  title?: string | null
) {
  const idStr = String(mdblistId);
  const looksSlug = /[a-zA-Z\-]/.test(idStr);

  if (looksSlug) return `https://mdblist.com/${type}/${idStr}`;

  if (title) {
    const s = slugifyTitle(title);
    if (s) return `https://mdblist.com/${type}/${idStr}-${s}`;
  }

  return `https://mdblist.com/title/${idStr}`;
}

function providerLogoUrl(path: string | null) {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${PROVIDER_LOGO_SIZE}${path}`;
}

function normalizeProviderList(arr: any): WatchProviderItem[] {
  if (!Array.isArray(arr)) return [];

  return arr
    .map((x) => ({
      provider_id: x?.provider_id,
      provider_name: x?.provider_name ?? "",
      logo_path: providerLogoUrl(x?.logo_path ?? null),
    }))
    .filter((x) => x.provider_id && x.provider_name);
}

async function tmdbFetchDirect(path: string) {
  const token = process.env.TMDB_BEARER_TOKEN;
  if (!token) throw new Error("TMDB_BEARER_TOKEN missing");

  const url = `${TMDB_BASE}${path}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    next: {
      revalidate: 86400,
    },
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

async function getDetailCore(mediaType: MediaType, id: string) {
  return tmdbFetchDirect(`/${mediaType}/${id}?language=tr-TR`);
}

async function getWatchProvidersCore(mediaType: MediaType, id: string) {
  const res = await tmdbFetchDirect(`/${mediaType}/${id}/watch/providers`);

  if (!res.ok) {
    return {
      region: WATCH_PROVIDER_REGION,
      results: null,
    };
  }

  const regionData = res.json?.results?.[WATCH_PROVIDER_REGION] ?? null;

  if (!regionData) {
    return {
      region: WATCH_PROVIDER_REGION,
      results: null,
    };
  }

  return {
    region: WATCH_PROVIDER_REGION,
    results: {
      link: regionData?.link ?? null,
      flatrate: normalizeProviderList(regionData?.flatrate),
      rent: normalizeProviderList(regionData?.rent),
      buy: normalizeProviderList(regionData?.buy),
    },
  };
}

async function getExtraRatingsCore(
  mediaType: MediaType,
  tmdbId: string,
  title?: string | null
): Promise<ExtraRatingsResult> {
  const TMDB_TOKEN = process.env.TMDB_BEARER_TOKEN;
  if (!TMDB_TOKEN) {
    return {
      imdb_id: null,
      imdbRating: null,
      imdbVotes: null,
      turkceAltyaziUrl: null,
      mdblist: null,
      sources: {} as ExtraSources,
      watchProviders: {
        region: WATCH_PROVIDER_REGION,
        results: null,
      },
    };
  }

  const [watchProviders, extRes] = await Promise.all([
    getWatchProvidersCore(mediaType, tmdbId),
    fetch(`${TMDB_BASE}/${mediaType}/${tmdbId}/external_ids`, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
      next: { revalidate: 86400 },
    }),
  ]);

  if (!extRes.ok) {
    return {
      imdb_id: null,
      imdbRating: null,
      imdbVotes: null,
      turkceAltyaziUrl: null,
      mdblist: null,
      sources: {} as ExtraSources,
      watchProviders,
    };
  }

  const ext = (await extRes.json()) as AnyObj;
  const imdb_id = (ext?.imdb_id as string | null) ?? null;

  if (!imdb_id) {
    return {
      imdb_id: null,
      imdbRating: null,
      imdbVotes: null,
      turkceAltyaziUrl: null,
      mdblist: null,
      sources: {} as ExtraSources,
      watchProviders,
    };
  }

  let md: AnyObj | null = null;
  const MDB_KEY = process.env.MDBLIST_API_KEY;

  if (MDB_KEY) {
    try {
      const mdType: "movie" | "show" = mediaType === "movie" ? "movie" : "show";
      const mdUrl = `https://api.mdblist.com/imdb/${mdType}/${encodeURIComponent(
        imdb_id
      )}?apikey=${encodeURIComponent(MDB_KEY)}`;

      const mdRes = await fetch(mdUrl, {
        next: { revalidate: 86400 },
      });

      if (mdRes.ok) {
        md = (await mdRes.json()) as AnyObj;
      }
    } catch {
      // ignore
    }
  }

  const sources: ExtraSources = {
    imdb: extractSource(md ?? {}, "imdb"),
    mdblist: extractSource(md ?? {}, "mdblist"),
    tomatoes: extractSource(md ?? {}, "tomatoes"),
    popcorn: extractSource(md ?? {}, "popcorn"),
    metacritic: extractSource(md ?? {}, "metacritic"),
    metacriticuser: extractSource(md ?? {}, "metacriticuser"),
    trakt: extractSource(md ?? {}, "trakt"),
    letterboxd: extractSource(md ?? {}, "letterboxd"),
    rogerebert: extractSource(md ?? {}, "rogerebert"),
    myanimelist: extractSource(md ?? {}, "myanimelist"),
  };

  const imdbRating =
    sources.imdb?.rating != null ? toNumberRating(sources.imdb.rating) : null;
  const imdbVotes =
    sources.imdb?.votes != null ? toIntVotes(sources.imdb.votes) : null;

  const mdblistId = (md?.ids?.mdblist ?? md?.id ?? null) as string | number | null;
  const mdblistType: "movie" | "show" = mediaType === "movie" ? "movie" : "show";
  const mdblistUrl = mdblistId ? mdblistWebUrl(mdblistType, mdblistId, title) : null;

  return {
    imdb_id,
    imdbRating,
    imdbVotes,
    turkceAltyaziUrl: turkceAltyaziUrlFromImdb(imdb_id),
    mdblist: mdblistId
      ? {
          id: mdblistId,
          type: mdblistType,
          url: mdblistUrl,
        }
      : null,
    sources,
    watchProviders,
  };
}

export async function getCachedDetail(mediaType: MediaType, id: string) {
  const fn = unstable_cache(
    async () => getDetailCore(mediaType, id),
    [`detail:${mediaType}:${id}`],
    {
      revalidate: 86400,
      tags: [`detail:${mediaType}:${id}`],
    }
  );

  return fn();
}

export async function getCachedExtraRatings(
  mediaType: MediaType,
  id: string,
  title?: string | null
) {
  const safeTitle = title ?? "";
  const fn = unstable_cache(
    async () => getExtraRatingsCore(mediaType, id, safeTitle),
    [`detail-extra:${mediaType}:${id}:${safeTitle}`],
    {
      revalidate: 86400,
      tags: [`detail-extra:${mediaType}:${id}`],
    }
  );

  return fn();
}