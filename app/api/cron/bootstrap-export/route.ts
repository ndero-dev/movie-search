import { NextResponse } from "next/server";
import {
  ensureCatalogSchema,
  getIngestState,
  setIngestState,
  upsertCatalogItem,
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
  const saved = await getIngestState<any>(STATE_KEY);

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
  const url =
    "https://files.tmdb.org/p/exports/movie_ids_03_19_2026.json.gz";

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

  if (res.status === 404) return { status: "not_found" };
  if (!res.ok) return { status: "error" };

  const json = await res.json();

  return { status: "ok", data: json };
}

/* ---------- MAIN ---------- */

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
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

    for (const r of rows) {
      const id = r.id;

      /* DB CHECK */
      const existing = await getIngestState(`movie_${id}`);

      if (existing) {
        skipped++;
        continue;
      }

      /* TMDB */
      const detail = await fetchDetail(id);
      if (!detail) continue;

      const ext = await fetchExternalIds(id);
      const imdbId = ext?.imdb_id;

      /* MDBLIST */
      let mdblist = null;

      if (imdbId) {
        const m = await fetchMdblist(imdbId);
        if (m.status === "ok") mdblist = m.data;
      }

      const providers = await fetchProviders(id);

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
        imdb_rating: mdblist?.imdb_rating ?? null,
        imdb_votes: mdblist?.imdb_votes ?? null,
        tmdb_vote_average: detail.vote_average,
        tmdb_vote_count: detail.vote_count,
        mdblist_payload_json: mdblist ? JSON.stringify(mdblist) : null,
        is_enriched: !!mdblist,
        mdblist_status: mdblist ? "ok" : "not_found",
      });

      /* MARK */
      await setIngestState(`movie_${id}`, true);

      inserted++;
      processed++;
    }

    const nextState = {
      ...state,
      movieOffset: state.movieOffset + rows.length,
    };

    await setIngestState(STATE_KEY, nextState);

    return NextResponse.json({
      ok: true,
      processed,
      inserted,
      skipped,
      nextOffset: nextState.movieOffset,
    });
  } catch (e: any) {
    console.error(e);

    return NextResponse.json({ ok: false, error: e.message });
  }
}