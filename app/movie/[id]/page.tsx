import BackToSearchLink from "@/app/components/BackToSearchLink";
import { redirect } from "next/navigation";

type SP = { from?: string | string[] };
type AnyObj = Record<string, any>;

async function tmdbFetch(path: string) {
  const token = process.env.TMDB_BEARER_TOKEN;
  if (!token) throw new Error("TMDB_BEARER_TOKEN missing");

  const url = `https://api.themoviedb.org/3${path}`;
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

function decodeFrom(sp: SP | undefined) {
  const fromRaw = Array.isArray(sp?.from) ? sp?.from?.[0] : sp?.from;
  let from = "/";
  if (typeof fromRaw === "string" && fromRaw.length > 0) {
    try {
      from = decodeURIComponent(fromRaw);
    } catch {
      from = fromRaw;
    }
  }
  return from.startsWith("/") ? from : "/";
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

function normalizeRatingEntry(entry: any): { rating: number | string; votes?: number | null } | null {
  if (!entry) return null;

  if (typeof entry === "number" || typeof entry === "string") return { rating: entry };

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

async function getExtraRatings(mediaType: "movie" | "tv", tmdbId: string, title?: string | null) {
  const TMDB_TOKEN = process.env.TMDB_BEARER_TOKEN;

  const extUrl = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/external_ids`;
  const extRes = await fetch(extUrl, {
    headers: { Authorization: `Bearer ${TMDB_TOKEN}` },
    next: { revalidate: 86400 },
  });

  if (!extRes.ok) {
    return {
      imdb_id: null,
      imdbRating: null,
      imdbVotes: null,
      turkceAltyaziUrl: null,
      mdblist: null,
      sources: {},
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
      sources: {},
    };
  }

  let md: AnyObj | null = null;
  const MDB_KEY = process.env.MDBLIST_API_KEY;

  if (MDB_KEY) {
    try {
      const mdUrl = `https://api.mdblist.com/imdb/movie/${encodeURIComponent(imdb_id)}?apikey=${encodeURIComponent(MDB_KEY)}`;
      const mdRes = await fetch(mdUrl, { next: { revalidate: 86400 } });
      if (mdRes.ok) {
        md = (await mdRes.json()) as AnyObj;
      }
    } catch {}
  }

  const sources = {
    imdb: extractSource(md ?? {}, "imdb"),
    mdblist: extractSource(md ?? {}, "mdblist"),
    tomatoes: extractSource(md ?? {}, "tomatoes"),
    popcorn: extractSource(md ?? {}, "popcorn"),
    metacritic: extractSource(md ?? {}, "metacritic"),
    trakt: extractSource(md ?? {}, "trakt"),
  };

  const imdbRating = sources.imdb?.rating ? toNumberRating(sources.imdb.rating) : null;
  const imdbVotes = sources.imdb?.votes ? toIntVotes(sources.imdb.votes) : null;

  const mdblistId = (md?.ids?.mdblist ?? md?.id ?? null) as string | number | null;
  const mdblistUrl = mdblistId ? mdblistWebUrl("movie", mdblistId, title) : null;

  return {
    imdb_id,
    imdbRating,
    imdbVotes,
    turkceAltyaziUrl: turkceAltyaziUrlFromImdb(imdb_id),
    mdblist: mdblistId ? { id: mdblistId, type: "movie", url: mdblistUrl } : null,
    sources,
  };
}

function ratingBox(label: string, value?: string | number | null, votes?: string | number | null) {
  if (value == null || value === "" || value === "N/A") return null;

  return (
    <div className="rounded-xl border border-zinc-200 px-3 py-2 text-sm">
      <div className="font-medium text-zinc-800">{label}</div>
      <div className="text-zinc-700">
        {value}
        {votes != null && votes !== "" ? ` (${votes})` : ""}
      </div>
    </div>
  );
}