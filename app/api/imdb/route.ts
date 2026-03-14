import { NextResponse } from "next/server";

type AnyObj = Record<string, any>;

function toIntVotes(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = parseInt(v.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeRatingEntry(entry: any): { rating: number | string; votes?: number | null } | null {
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

  const votes = toIntVotes(entry.votes ?? entry.vote_count ?? entry.count ?? entry.total ?? null);
  return { rating, votes: votes ?? undefined };
}

function extractSource(md: AnyObj, key: string) {
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

function mdblistWebUrl(type: "movie" | "show", mdblistId: string | number, title?: string | null) {
  const idStr = String(mdblistId);

  const looksSlug = /[a-zA-Z\-]/.test(idStr);
  if (looksSlug) return `https://mdblist.com/${type}/${idStr}`;

  if (title) {
    const s = slugifyTitle(title);
    if (s) return `https://mdblist.com/${type}/${idStr}-${s}`;
  }

  return `https://mdblist.com/title/${idStr}`;
}

// basit memory cache
const g = globalThis as any;
const CACHE: Map<string, { exp: number; value: any }> =
  g.__IMDB_ROUTE_CACHE__ ?? (g.__IMDB_ROUTE_CACHE__ = new Map());

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tmdb_id = url.searchParams.get("tmdb_id");
  const media_type = url.searchParams.get("media_type"); // movie | tv

  if (!tmdb_id || !media_type || !["movie", "tv"].includes(media_type)) {
    return NextResponse.json(
      { error: "tmdb_id and media_type(movie|tv) required" },
      { status: 400 }
    );
  }

  const cacheKey = `${media_type}:${tmdb_id}`;
  const now = Date.now();
  const cached = CACHE.get(cacheKey);
  if (cached && cached.exp > now) {
    return NextResponse.json(cached.value);
  }

  const TMDB_TOKEN = process.env.TMDB_BEARER_TOKEN;
  if (!TMDB_TOKEN) {
    return NextResponse.json({ error: "TMDB_BEARER_TOKEN missing" }, { status: 500 });
  }

  // 1) TMDB external_ids -> imdb_id
  const extUrl = `https://api.themoviedb.org/3/${media_type}/${tmdb_id}/external_ids`;

  let imdb_id: string | null = null;

  try {
    const extRes = await fetch(extUrl, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
      next: { revalidate: 86400 },
    });

    if (!extRes.ok) {
      const t = await extRes.text().catch(() => "");
      return NextResponse.json(
        { error: "tmdb external_ids failed", status: extRes.status, body: t },
        { status: 502 }
      );
    }

    const ext = (await extRes.json()) as AnyObj;
    imdb_id = (ext?.imdb_id as string | null) ?? null;
  } catch (e: any) {
    return NextResponse.json(
      { error: "tmdb external_ids fetch failed", detail: e?.message ?? "unknown error" },
      { status: 502 }
    );
  }

  if (!imdb_id) {
    const payload = {
      imdb_id: null,
      imdbRating: null,
      imdbVotes: null,
      sources: {},
      turkceAltyaziUrl: null,
      mdblist: null,
    };
    CACHE.set(cacheKey, { exp: now + 24 * 3600_000, value: payload });
    return NextResponse.json(payload);
  }

  // 2) TMDb title'ı server’da çek (slug için)
  let resolvedTitle: string | null = null;
  try {
    const dUrl = `https://api.themoviedb.org/3/${media_type}/${tmdb_id}?language=en-US`;
    const dRes = await fetch(dUrl, {
      headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
      next: { revalidate: 86400 },
    });

    if (dRes.ok) {
      const d = (await dRes.json()) as AnyObj;
      resolvedTitle =
        (media_type === "tv"
          ? (d?.name ?? d?.original_name)
          : (d?.title ?? d?.original_title)) ?? null;
    }
  } catch {
    resolvedTitle = null;
  }

  // 3) OMDb IMDb rating/votes
  let imdbRating: string | null = null;
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
        if (om?.imdbRating && om.imdbRating !== "N/A") imdbRating = String(om.imdbRating);
        if (om?.imdbVotes && om.imdbVotes !== "N/A") imdbVotes = toIntVotes(om.imdbVotes);
      }
    } catch {
      // OMDb fail olursa sessizce devam
    }
  }

  // 4) MDBList
  const MDB_KEY = process.env.MDBLIST_API_KEY;
  const mdType = media_type === "tv" ? "show" : "movie";
  let md: AnyObj | null = null;

  if (MDB_KEY) {
    try {
      const mdUrl = `https://api.mdblist.com/imdb/${mdType}/${encodeURIComponent(
        imdb_id
      )}?apikey=${encodeURIComponent(MDB_KEY)}`;
      const mdRes = await fetch(mdUrl, { next: { revalidate: 86400 } });

      if (mdRes.ok) {
        md = (await mdRes.json()) as AnyObj;
      }
    } catch {
      md = null;
    }
  }

  const mdblistId = (md?.ids?.mdblist ?? md?.id ?? null) as string | number | null;
  const mdblistUrl = mdblistId
    ? mdblistWebUrl(mdType as "movie" | "show", mdblistId, resolvedTitle)
    : null;

  const sources = {
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

  // OMDb boş dönerse MDBList içindeki imdb verisini fallback olarak kullan
  if (!imdbRating && sources.imdb?.rating != null) {
    imdbRating = String(sources.imdb.rating);
  }
  if (!imdbVotes && sources.imdb?.votes != null) {
    imdbVotes = sources.imdb.votes;
  }

  const payload = {
    imdb_id,
    imdbRating,
    imdbVotes,
    turkceAltyaziUrl: turkceAltyaziUrlFromImdb(imdb_id),
    mdblist: mdblistId ? { id: mdblistId, type: mdType, url: mdblistUrl } : null,
    sources,
  };

  CACHE.set(cacheKey, { exp: now + 24 * 3600_000, value: payload });
  return NextResponse.json(payload);
}
