import { NextResponse } from "next/server";

const TMDB_BASE = "https://api.themoviedb.org/3";

// memory cache (instance yaşadığı sürece)
const mem = new Map<string, { ts: number; data: any }>();
const TTL_MS = 1000 * 60 * 60 * 24; // 24 saat

function getCached(key: string) {
  const v = mem.get(key);
  if (!v) return null;
  if (Date.now() - v.ts > TTL_MS) {
    mem.delete(key);
    return null;
  }
  return v.data;
}

function setCached(key: string, data: any) {
  mem.set(key, { ts: Date.now(), data });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const media_type = searchParams.get("media_type"); // movie | tv
  const tmdb_id = searchParams.get("tmdb_id");

  if (!media_type || (media_type !== "movie" && media_type !== "tv")) {
    return NextResponse.json({ error: "media_type must be movie|tv" }, { status: 400 });
  }
  if (!tmdb_id || !/^\d+$/.test(tmdb_id)) {
    return NextResponse.json({ error: "tmdb_id must be numeric" }, { status: 400 });
  }

  const cacheKey = `${media_type}:${tmdb_id}`;
  const cached = getCached(cacheKey);
  if (cached) return NextResponse.json(cached);

  const tmdbToken = process.env.TMDB_BEARER_TOKEN;
  if (!tmdbToken) return NextResponse.json({ error: "TMDB_BEARER_TOKEN missing" }, { status: 500 });

  // 1) TMDb external ids -> imdb_id
  const extUrl = `${TMDB_BASE}/${media_type}/${tmdb_id}/external_ids`;
  const extRes = await fetch(extUrl, {
    headers: { Authorization: `Bearer ${tmdbToken}` },
    next: { revalidate: 86400 },
  });
  const extData = await extRes.json();

  if (!extRes.ok) {
    return NextResponse.json({ error: "tmdb external_ids failed", details: extData }, { status: extRes.status });
  }

  const imdb_id = (extData?.imdb_id as string | null) ?? null;

  if (!imdb_id) {
    const out = {
      imdb_id: null,
      imdbRating: null,
      imdbVotes: null,
      mdblist: null,
    };
    setCached(cacheKey, out);
    return NextResponse.json(out);
  }

  // 2) MDBList (öncelik)
  let imdbRating: string | null = null;
  let imdbVotes: number | null = null;
  let mdblistId: string | null = null;

  const mdblistKey = process.env.MDBLIST_API_KEY;
  const mdblistType: "movie" | "show" = media_type === "movie" ? "movie" : "show";

  if (mdblistKey) {
    const url = `https://api.mdblist.com/imdb/${mdblistType}/${encodeURIComponent(imdb_id)}?apikey=${encodeURIComponent(mdblistKey)}`;
    const r = await fetch(url, { next: { revalidate: 86400 } });
    const d = await r.json();

    if (r.ok) {
      mdblistId = (d?.ids?.mdblist as string | null) ?? null;

      const imdbRatingObj = Array.isArray(d?.ratings)
        ? d.ratings.find((x: any) => x?.source === "imdb")
        : null;

      if (imdbRatingObj) {
        const val = imdbRatingObj?.value;
        const votes = imdbRatingObj?.votes;

        if (typeof val === "number") imdbRating = val.toFixed(1);
        else if (typeof val === "string" && val.trim()) imdbRating = val.trim();

        if (typeof votes === "number") imdbVotes = votes;
        else if (typeof votes === "string" && /^\d+$/.test(votes)) imdbVotes = Number(votes);
      }
    }
  }

  // 3) OMDb fallback (opsiyonel)
  const omdbKey = process.env.OMDB_API_KEY;
  if ((!imdbRating || imdbVotes == null) && omdbKey) {
    const omdbUrl = `https://www.omdbapi.com/?i=${encodeURIComponent(imdb_id)}&apikey=${encodeURIComponent(omdbKey)}`;
    const omdbRes = await fetch(omdbUrl, { next: { revalidate: 86400 } });
    const omdbData = await omdbRes.json();

    if (omdbRes.ok && omdbData?.Response === "True") {
      if (!imdbRating && typeof omdbData?.imdbRating === "string" && omdbData.imdbRating !== "N/A") {
        imdbRating = omdbData.imdbRating;
      }
      if (imdbVotes == null && typeof omdbData?.imdbVotes === "string" && omdbData.imdbVotes !== "N/A") {
        const n = Number(String(omdbData.imdbVotes).replace(/,/g, ""));
        if (Number.isFinite(n)) imdbVotes = n;
      }
    }
  }

  const out = {
    imdb_id,
    imdbRating,
    imdbVotes,
    mdblist: mdblistKey
      ? {
          id: mdblistId,        // ör: "583" veya "c5cd"
          type: mdblistType,    // "movie" | "show"
        }
      : null,
  };

  setCached(cacheKey, out);
  return NextResponse.json(out);
}
