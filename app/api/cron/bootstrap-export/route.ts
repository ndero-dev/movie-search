import { NextResponse } from "next/server";
import {
  ensureCatalogSchema,
  getIngestState,
  setIngestState,
  upsertCatalogItem,
  catalogItemExists,
} from "@/app/lib/catalog-db";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import readline from "node:readline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_KEY = "tmdb_export_bootstrap_v1";
const DEFAULT_BATCH_SIZE = 1000;
const WATCH_REGION = "TR";

function isAuthorized(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  return false;
}

async function loadState() {
  const saved = await getIngestState(STATE_KEY);
  if (saved) return saved;

  const initial = {
    exportDate: "03_19_2026",
    movieOffset: 0,
    initializedAt: new Date().toISOString(),
  };

  await setIngestState(STATE_KEY, initial);
  return initial;
}

async function readExportSlice(offset: number, limit: number) {
  const url = "https://files.tmdb.org/p/exports/movie_ids_03_19_2026.json.gz";
  const res = await fetch(url);

  if (!res.ok || !res.body) {
    throw new Error("export download failed");
  }

  const nodeReadable = Readable.fromWeb(res.body as any);
  const gunzip = createGunzip();

  const rl = readline.createInterface({
    input: nodeReadable.pipe(gunzip),
    crlfDelay: Infinity,
  });

  const rows: any[] = [];
  let index = 0;

  for await (const line of rl) {
    if (!line) continue;

    if (index < offset) {
      index++;
      continue;
    }

    const parsed = JSON.parse(line);

    if (parsed?.adult === true) {
      index++;
      continue;
    }

    rows.push(parsed);
    index++;

    if (rows.length >= limit) break;
  }

  rl.close();
  return rows;
}

/* ---------- TMDB ---------- */

async function tmdbFetch(path: string) {
  const res = await fetch(`https://api.themoviedb.org/3/${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.TMDB_BEARER_TOKEN}`,
    },
  });

  if (!res.ok) return null;
  return res.json();
}

async function fetchDetail(id: number) {
  return tmdbFetch(`movie/${id}?language=tr-TR`);
}

async function fetchExternalIds(id: number) {
  return tmdbFetch(`movie/${id}/external_ids`);
}

async function fetchProviders(id: number) {
  const data = await tmdbFetch(`movie/${id}/watch/providers`);
  if (!data?.results?.TR) return [];

  const p = data.results.TR;

  return [
    ...(p.flatrate || []),
    ...(p.ads || []),
    ...(p.free || []),
  ].map((x: any) => x.provider_id);
}

/* ---------- MDBLIST ---------- */

async function fetchMdblist(imdbId: string) {
  const url = `https://mdblist.com/api/?apikey=${process.env.MDBLIST_INGEST_API_KEY}&i=${imdbId}`;
  const res = await fetch(url);

  let json: any = null;

  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (json?.error === "API Limit Reached!" && json?.response === false) {
    return { status: "limit_reached" as const };
  }

  if (res.status === 404) {
    return { status: "not_found" as const };
  }

  if (!res.ok) {
    return { status: "error" as const };
  }

  return { status: "ok" as const, data: json };
}

function toNullableNumber(value: any): number | null {
  if (value == null || value === "" || value === "N/A") return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function toNullableInt(value: any): number | null {
  if (value == null || value === "" || value === "N/A") return null;

  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/[^\d]/g, "");
    if (!normalized) return null;

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function extractImdbMetrics(mdblist: any) {
  if (!mdblist) {
    return {
      imdbRating: null,
      imdbVotes: null,
    };
  }

  const ratings = Array.isArray(mdblist?.ratings) ? mdblist.ratings : [];

  const imdbNode =
    ratings.find(
      (r: any) => String(r?.source ?? r?.name ?? "").toLowerCase() === "imdb"
    ) ?? null;

  return {
    imdbRating:
      toNullableNumber(mdblist?.imdb_rating) ??
      toNullableNumber(mdblist?.imdbRating) ??
      toNullableNumber(imdbNode?.value) ??
      toNullableNumber(imdbNode?.rating) ??
      toNullableNumber(imdbNode?.score) ??
      null,

    imdbVotes:
      toNullableInt(mdblist?.imdb_votes) ??
      toNullableInt(mdblist?.imdbVotes) ??
      toNullableInt(imdbNode?.votes) ??
      null,
  };
}

/* ---------- MAIN ---------- */

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  try {
    await ensureCatalogSchema();

    const url = new URL(req.url);
    const batch = Number(url.searchParams.get("batch") ?? DEFAULT_BATCH_SIZE);

    const state = await loadState();
    const rows = await readExportSlice(state.movieOffset, batch);

    let processed = 0;
    let inserted = 0;
    let skipped = 0;
    let filtered = 0;
    let handledRows = 0;

    for (const r of rows) {
      const id = r.id;

      /* EXISTS CHECK -> catalog_items */
      const exists = await catalogItemExists(id, "movie");
      if (exists) {
        skipped++;
        handledRows++;
        continue;
      }

      /* TMDB DETAIL */
      const detail = await fetchDetail(id);
      if (!detail) {
        handledRows++;
        continue;
      }

      /* QUALITY FILTER */
      const voteAverage = Number(detail.vote_average ?? 0);
      const voteCount = Number(detail.vote_count ?? 0);

      if (!(voteAverage >= 5 && voteCount >= 25)) {
        filtered++;
        handledRows++;
        continue;
      }

      const ext = await fetchExternalIds(id);
      const imdbId = ext?.imdb_id;

      /* MDBLIST */
      let mdblist = null;
      if (imdbId) {
        const m = await fetchMdblist(imdbId);

        if (m.status === "limit_reached") {
          const nextState = {
            ...state,
            movieOffset: state.movieOffset + handledRows,
            stoppedAtTmdbId: id,
            stoppedReason: "mdblist_api_limit_reached",
            stoppedAt: new Date().toISOString(),
          };

          await setIngestState(STATE_KEY, nextState);

          return NextResponse.json({
            ok: false,
            halted: true,
            reason: "mdblist_api_limit_reached",
            processed,
            inserted,
            skipped,
            filtered,
            nextOffset: nextState.movieOffset,
            stoppedAtTmdbId: id,
          });
        }

        if (m.status === "ok") {
          mdblist = m.data;
        }
      }

      const providers = await fetchProviders(id);
      const { imdbRating, imdbVotes } = extractImdbMetrics(mdblist);

      /* UPSERT */
      await upsertCatalogItem({
        media_type: "movie",
        tmdb_id: id,
        imdb_id: imdbId,
        title: detail.title,
        original_title: detail.original_title,
        year: Number(detail.release_date?.slice(0, 4)),
        poster_path: detail.poster_path,
        overview: detail.overview,
        genre_ids_json: JSON.stringify(detail.genres?.map((g: any) => g.id) || []),
        provider_ids_json: JSON.stringify(providers),
        imdb_rating: imdbRating,
        imdb_votes: imdbVotes,
        tmdb_vote_average: detail.vote_average,
        tmdb_vote_count: detail.vote_count,
        mdblist_payload_json: mdblist ? JSON.stringify(mdblist) : null,
        is_enriched: !!mdblist,
        mdblist_status: mdblist ? "ok" : "not_found",
      });

      inserted++;
      processed++;
      handledRows++;
    }

    const nextState = {
      ...state,
      movieOffset: state.movieOffset + handledRows,
    };

    await setIngestState(STATE_KEY, nextState);

    return NextResponse.json({
      ok: true,
      processed,
      inserted,
      skipped,
      filtered,
      nextOffset: nextState.movieOffset,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ ok: false, error: e.message });
  }
}