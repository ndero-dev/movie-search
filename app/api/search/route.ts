import { NextResponse } from "next/server";

type MediaType = "movie" | "tv";
type AnyObj = Record<string, any>;

type Item = {
  id: number;
  media_type: MediaType;
  title: string;
  year: string | null;
  sort_date: string | null;
  poster_path: string | null;
  overview: string | null;
  vote_average: number | null;
  vote_count: number | null;
  genre_ids: number[];
};

type EnrichedItem = Item & {
  imdbRating: number | null;
  imdbVotes: number | null;
  sources?: Record<string, any>;
  turkceAltyaziUrl?: string | null;
  mdblist?: null;
};

const TMDB_BASE = "https://api.themoviedb.org/3";
const TARGET_BATCH_SIZE = 20;
const MAX_SOURCE_PAGES_PER_REQUEST = 20;

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

async function tmdbFetch(path: string, qs?: Record<string, string | number | undefined>) {
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

function normalizeResults(arr: any[], forcedType?: MediaType): Item[] {
  return (arr ?? [])
    .filter((x) => (forcedType ? true : x?.media_type === "movie" || x?.media_type === "tv"))
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
    if (y && parseInt(x.year ?? "", 10) !== y) return false;
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

const g = globalThis as any;
const ENRICH_CACHE: Map<string, { exp: number; value: any }> =
  g.__SEARCH_ENRICH_CACHE__ ?? (g.__SEARCH_ENRICH_CACHE__ = new Map());

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
  } catch {}

  if (!imdb_id) {
    const payload = {
      imdbRating: null,
      imdbVotes: null,
      sources: {},
      turkceAltyaziUrl: null,
      mdblist: null,
    };
    ENRICH_CACHE.set(cacheKey, { exp: now + 24 * 3600_000, value: payload });
    return { ...item, ...payload };
  }

  let imdbRating: number | null = null;
  let imdbVotes: number | null = null;

  const OMDB_KEY = process.env.OMDB_API_KEY;

  if (OMDB_KEY) {
    try {
      const omdbUrl = `https://www.omdbapi.com/?i=${encodeURIComponent(imdb_id)}&apikey=${encodeURIComponent(
        OMDB_KEY
      )}`;
      const omdbRes = await fetch(omdbUrl, { next: { revalidate: 86400 } });

      if (omdbRes.ok) {
        const om = (await omdbRes.json()) as AnyObj;
        if (om?.imdbRating && om.imdbRating !== "N/A") {
          imdbRating = toNumberRating(om.imdbRating);
        }
        if (om?.imdbVotes && om.imdbVotes !== "N/A") {
          imdbVotes = toIntVotes(om.imdbVotes);
        }
      }
    } catch {}
  }

  const payload = {
    imdbRating,
    imdbVotes,
    sources: {},
    turkceAltyaziUrl: turkceAltyaziUrlFromImdb(imdb_id),
    mdblist: null,
  };

  ENRICH_CACHE.set(cacheKey, { exp: now + 24 * 3600_000, value: payload });
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
    const genreMovie = url.searchParams.get("gM") ?? "";
    const genreTv = url.searchParams.get("gT") ?? "";
    const startPage = Math.max(1, Number(url.searchParams.get("page") ?? "1"));

    const minRRaw = parseNumber(minRating, null);
    const minVRaw = parseNumber(minVotes, null);
    const minR = minRRaw != null ? clamp(minRRaw, 0, 10) : null;
    const minV = minVRaw != null ? Math.max(0, minVRaw) : null;

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
        };

        const [m, t] = await Promise.all([
          wantMovie
            ? tmdbFetch("discover/movie", {
                ...common,
                sort_by: "vote_count.desc",
                primary_release_year: year || undefined,
                with_genres: genreMovie || undefined,
              })
            : Promise.resolve({ ok: true, status: 200, json: null }),
          wantTv
            ? tmdbFetch("discover/tv", {
                ...common,
                sort_by: "vote_count.desc",
                first_air_date_year: year || undefined,
                with_genres: genreTv || undefined,
              })
            : Promise.resolve({ ok: true, status: 200, json: null }),
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

        totalPages = Math.max(m.json?.total_pages ?? 1, t.json?.total_pages ?? 1);
      }

      scannedCount += 1;

      const deduped = dedupeItems(merged);
      const enriched = await Promise.all(deduped.map((item) => enrichOne(item)));

      const filtered = enriched.filter((x) => {
        if (minR != null) {
          if (x.imdbRating == null) return false;
          if (x.imdbRating < minR) return false;
        }
        if (minV != null) {
          if (x.imdbVotes == null) return false;
          if (x.imdbVotes < minV) return false;
        }
        return true;
      });

      const sortedFiltered = filtered.sort(
        (a, b) => (b.vote_count ?? -1) - (a.vote_count ?? -1)
      );

      collected = dedupeItems([...collected, ...sortedFiltered]).slice(0, TARGET_BATCH_SIZE);

      sourcePage += 1;
    }

    const hasMore = sourcePage <= totalPages;
    const nextPage = hasMore ? sourcePage : null;

    return NextResponse.json({
      results: collected,
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