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

type BootstrapState = {
  exportDate: string;
  movieOffset: number;
  initializedAt: string;
  stoppedAtTmdbId?: number;
  stoppedReason?: string;
  stoppedAt?: string;
};

function isAuthorized(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  return false;
}

async function loadState(): Promise<BootstrapState> {
  const saved = (await getIngestState(STATE_KEY)) as BootstrapState | null;
  if (saved && typeof saved.movieOffset === "number") return saved;

  const initial: BootstrapState = {
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

function findRatingNode(mdblist: any, aliases: string[]) {
  if (!mdblist) return null;

  const ratings = Array.isArray(mdblist?.ratings) ? mdblist.ratings : [];
  const loweredAliases = aliases.map((x) => x.toLowerCase());

  return (
    ratings.find((r: any) =>
      loweredAliases.includes(
        String(r?.source ?? r?.name ?? "").toLowerCase()
      )
    ) ?? null
  );
}

function extractRatingFromNode(node: any) {
  return {
    rating:
      toNullableNumber(node?.value) ??
      toNullableNumber(node?.rating) ??
      toNullableNumber(node?.score) ??
      null,
    votes: toNullableInt(node?.votes) ?? null,
  };
}

function extractImdbMetrics(mdblist: any) {
  const imdbNode = findRatingNode(mdblist, ["imdb"]);

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

function extractMdblistRatings(mdblist: any) {
  const metacritic = extractRatingFromNode(findRatingNode(mdblist, ["metacritic"]));
  const metacriticuser = extractRatingFromNode(
    findRatingNode(mdblist, ["metacriticuser", "metacritic_user"])
  );
  const trakt = extractRatingFromNode(findRatingNode(mdblist, ["trakt"]));
  const tomatoesaudience = extractRatingFromNode(
    findRatingNode(mdblist, [
      "tomatoesaudience",
      "tomatoes_audience",
      "rottentomatoesaudience",
      "rottentomatoes_audience",
    ])
  );
  const letterboxd = extractRatingFromNode(findRatingNode(mdblist, ["letterboxd"]));

  return {
    metacriticRating: metacritic.rating,
    metacriticVotes: metacritic.votes,
    metacriticuserRating: metacriticuser.rating,
    metacriticuserVotes: metacriticuser.votes,
    traktRating: trakt.rating,
    traktVotes: trakt.votes,
    tomatoesaudienceRating: tomatoesaudience.rating,
    tomatoesaudienceVotes: tomatoesaudience.votes,
    letterboxdRating: letterboxd.rating,
    letterboxdVotes: letterboxd.votes,
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
    let mdblistCalls = 0;

    for (const r of rows) {
      const id = r.id;

      const exists = await catalogItemExists(id, "movie");
      if (exists) {
        skipped++;
        handledRows++;
        continue;
      }

      const detail = await fetchDetail(id);
      if (!detail) {
        handledRows++;
        continue;
      }

      const voteAverage = Number(detail.vote_average ?? 0);
      const voteCount = Number(detail.vote_count ?? 0);

      if (!(voteAverage >= 5 && voteCount >= 100)) {
        filtered++;
        handledRows++;
        continue;
      }

      const [ext, providers] = await Promise.all([
        fetchExternalIds(id),
        fetchProviders(id),
      ]);

      const imdbId = ext?.imdb_id;

      let mdblist = null;
      if (imdbId) {
        mdblistCalls++;
        const m = await fetchMdblist(imdbId);

        if (m.status === "limit_reached") {
          const nextState: BootstrapState = {
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
            mdblistCalls,
            nextOffset: nextState.movieOffset,
            stoppedAtTmdbId: id,
          });
        }

        if (m.status === "ok") {
          mdblist = m.data;
        }
      }

      const { imdbRating, imdbVotes } = extractImdbMetrics(mdblist);
      const {
        metacriticRating,
        metacriticVotes,
        metacriticuserRating,
        metacriticuserVotes,
        traktRating,
        traktVotes,
        tomatoesaudienceRating,
        tomatoesaudienceVotes,
        letterboxdRating,
        letterboxdVotes,
      } = extractMdblistRatings(mdblist);

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
        metacritic_rating: metacriticRating,
        metacritic_votes: metacriticVotes,
        metacriticuser_rating: metacriticuserRating,
        metacriticuser_votes: metacriticuserVotes,
        trakt_rating: traktRating,
        trakt_votes: traktVotes,
        tomatoesaudience_rating: tomatoesaudienceRating,
        tomatoesaudience_votes: tomatoesaudienceVotes,
        letterboxd_rating: letterboxdRating,
        letterboxd_votes: letterboxdVotes,
        tmdb_vote_average: detail.vote_average,
        tmdb_vote_count: detail.vote_count,
        is_enriched: !!mdblist,
        mdblist_status: mdblist ? "ok" : "not_found",
      });

      inserted++;
      processed++;
      handledRows++;
    }

    const nextState: BootstrapState = {
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
      mdblistCalls,
      nextOffset: nextState.movieOffset,
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ ok: false, error: e.message });
  }
}