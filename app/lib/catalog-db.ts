import { neon } from "@neondatabase/serverless";


const databaseUrl = process.env.DATABASE_URL;


if (!databaseUrl) {
  throw new Error("DATABASE_URL missing");
}

const sql = neon(databaseUrl);

export type CatalogMediaType = "movie" | "tv";

export type MdblistStatus =
  | "ok"
  | "not_found"
  | "rate_limited"
  | "quota_blocked"
  | "http_error"
  | "network_error";

export type CatalogItemRow = {
  media_type: CatalogMediaType;
  tmdb_id: number;
  imdb_id: string | null;
  title: string;
  original_title: string | null;
  year: number | null;
  poster_path: string | null;
  overview: string | null;
  genre_ids_json: string;
  provider_ids_json: string;
  imdb_rating: number | null;
  imdb_votes: number | null;
  tmdb_vote_average: number | null;
  tmdb_vote_count: number | null;
  mdblist_payload_json: string | null;
  is_enriched: boolean;
  mdblist_status: MdblistStatus;
};

export async function ensureCatalogSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS catalog_items (
      id BIGSERIAL PRIMARY KEY,
      media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
      tmdb_id BIGINT NOT NULL,
      imdb_id TEXT,
      title TEXT NOT NULL,
      original_title TEXT,
      year INTEGER,
      poster_path TEXT,
      overview TEXT,
      genre_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      provider_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      imdb_rating DOUBLE PRECISION,
      imdb_votes BIGINT,
      tmdb_vote_average DOUBLE PRECISION,
      tmdb_vote_count BIGINT,
      mdblist_payload_json JSONB,
      is_enriched BOOLEAN NOT NULL DEFAULT FALSE,
      mdblist_status TEXT NOT NULL DEFAULT 'network_error',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (media_type, tmdb_id)
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ingest_state (
      key TEXT PRIMARY KEY,
      value_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_catalog_items_imdb_rating_votes
    ON catalog_items (imdb_rating DESC, imdb_votes DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_catalog_items_year
    ON catalog_items (year DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_catalog_items_imdb_id
    ON catalog_items (imdb_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_catalog_items_is_enriched
    ON catalog_items (is_enriched)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_catalog_items_mdblist_status
    ON catalog_items (mdblist_status)
  `;
}

export async function getIngestState<T = unknown>(key: string): Promise<T | null> {
  const rows = (await sql`
    SELECT value_json
    FROM ingest_state
    WHERE key = ${key}
    LIMIT 1
  `) as Array<{ value_json: T }>;

  return rows[0]?.value_json ?? null;
}

export async function setIngestState(key: string, value: unknown) {
  const valueJson = JSON.stringify(value);

  await sql`
    INSERT INTO ingest_state (key, value_json, updated_at)
    VALUES (${key}, ${valueJson}::jsonb, NOW())
    ON CONFLICT (key)
    DO UPDATE SET
      value_json = EXCLUDED.value_json,
      updated_at = NOW()
  `;
}

export async function upsertCatalogItem(row: CatalogItemRow) {
  await sql`
    INSERT INTO catalog_items (
      media_type,
      tmdb_id,
      imdb_id,
      title,
      original_title,
      year,
      poster_path,
      overview,
      genre_ids_json,
      provider_ids_json,
      imdb_rating,
      imdb_votes,
      tmdb_vote_average,
      tmdb_vote_count,
      mdblist_payload_json,
      is_enriched,
      mdblist_status,
      updated_at
    )
    VALUES (
      ${row.media_type},
      ${row.tmdb_id},
      ${row.imdb_id},
      ${row.title},
      ${row.original_title},
      ${row.year},
      ${row.poster_path},
      ${row.overview},
      ${row.genre_ids_json}::jsonb,
      ${row.provider_ids_json}::jsonb,
      ${row.imdb_rating},
      ${row.imdb_votes},
      ${row.tmdb_vote_average},
      ${row.tmdb_vote_count},
      ${row.mdblist_payload_json ? `${row.mdblist_payload_json}` : null}::jsonb,
      ${row.is_enriched},
      ${row.mdblist_status},
      NOW()
    )
    ON CONFLICT (media_type, tmdb_id)
    DO UPDATE SET
      imdb_id = COALESCE(EXCLUDED.imdb_id, catalog_items.imdb_id),
      title = EXCLUDED.title,
      original_title = EXCLUDED.original_title,
      year = EXCLUDED.year,
      poster_path = EXCLUDED.poster_path,
      overview = EXCLUDED.overview,
      genre_ids_json = EXCLUDED.genre_ids_json,
      provider_ids_json = EXCLUDED.provider_ids_json,

      imdb_rating = CASE
        WHEN EXCLUDED.is_enriched THEN EXCLUDED.imdb_rating
        ELSE catalog_items.imdb_rating
      END,

      imdb_votes = CASE
        WHEN EXCLUDED.is_enriched THEN EXCLUDED.imdb_votes
        ELSE catalog_items.imdb_votes
      END,

      tmdb_vote_average = EXCLUDED.tmdb_vote_average,
      tmdb_vote_count = EXCLUDED.tmdb_vote_count,

      mdblist_payload_json = CASE
        WHEN EXCLUDED.is_enriched THEN EXCLUDED.mdblist_payload_json
        ELSE catalog_items.mdblist_payload_json
      END,

      is_enriched = CASE
        WHEN EXCLUDED.is_enriched THEN TRUE
        ELSE catalog_items.is_enriched
      END,

      mdblist_status = CASE
        WHEN EXCLUDED.is_enriched THEN EXCLUDED.mdblist_status
        WHEN catalog_items.is_enriched THEN catalog_items.mdblist_status
        ELSE EXCLUDED.mdblist_status
      END,

      updated_at = NOW()
  `;
}

export async function countCatalogItems() {
  const rows = (await sql`
    SELECT COUNT(*)::text AS count
    FROM catalog_items
  `) as Array<{ count: string }>;

  return Number(rows[0]?.count ?? "0");
}