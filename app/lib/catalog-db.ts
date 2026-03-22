import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export type CatalogItemInput = {
  media_type: "movie" | "tv";
  tmdb_id: number;
  imdb_id?: string | null;
  title?: string | null;
  original_title?: string | null;
  year?: number | null;
  poster_path?: string | null;
  overview?: string | null;
  genre_ids_json?: string | null;
  provider_ids_json?: string | null;
  imdb_rating?: number | null;
  imdb_votes?: number | null;
  metacritic_rating?: number | null;
  metacritic_votes?: number | null;
  metacriticuser_rating?: number | null;
  metacriticuser_votes?: number | null;
  trakt_rating?: number | null;
  trakt_votes?: number | null;
  tomatoesaudience_rating?: number | null;
  tomatoesaudience_votes?: number | null;
  letterboxd_rating?: number | null;
  letterboxd_votes?: number | null;
  tmdb_vote_average?: number | null;
  tmdb_vote_count?: number | null;
  is_enriched?: boolean | null;
  mdblist_status?: string | null;
};

export async function ensureCatalogSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS catalog_items (
      id BIGSERIAL PRIMARY KEY,
      media_type TEXT NOT NULL,
      tmdb_id BIGINT NOT NULL,
      imdb_id TEXT,
      title TEXT,
      original_title TEXT,
      year INTEGER,
      poster_path TEXT,
      overview TEXT,
      genre_ids_json JSONB,
      provider_ids_json JSONB,
      imdb_rating DOUBLE PRECISION,
      imdb_votes BIGINT,
      metacritic_rating DOUBLE PRECISION,
      metacritic_votes BIGINT,
      metacriticuser_rating DOUBLE PRECISION,
      metacriticuser_votes BIGINT,
      trakt_rating DOUBLE PRECISION,
      trakt_votes BIGINT,
      tomatoesaudience_rating DOUBLE PRECISION,
      tomatoesaudience_votes BIGINT,
      letterboxd_rating DOUBLE PRECISION,
      letterboxd_votes BIGINT,
      tmdb_vote_average DOUBLE PRECISION,
      tmdb_vote_count BIGINT,
      is_enriched BOOLEAN DEFAULT FALSE,
      mdblist_status TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT catalog_items_media_type_tmdb_id_key UNIQUE (media_type, tmdb_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_catalog_items_media_type
    ON catalog_items (media_type)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_catalog_items_tmdb_id
    ON catalog_items (tmdb_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_catalog_items_imdb_id
    ON catalog_items (imdb_id)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_catalog_items_year
    ON catalog_items (year)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_catalog_items_imdb_rating
    ON catalog_items (imdb_rating DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_catalog_items_tmdb_vote_average
    ON catalog_items (tmdb_vote_average DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_catalog_items_is_enriched
    ON catalog_items (is_enriched)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ingest_state (
      key TEXT PRIMARY KEY,
      value_json JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await sql`
    ALTER TABLE ingest_state
    ADD COLUMN IF NOT EXISTS value_json JSONB
  `;

  await sql`
    ALTER TABLE ingest_state
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `;
}

export async function getIngestState(key: string) {
  const rows = await sql`
    SELECT value_json
    FROM ingest_state
    WHERE key = ${key}
    LIMIT 1
  `;

  return rows[0]?.value_json ?? null;
}

export async function setIngestState(key: string, value: unknown) {
  await sql`
    INSERT INTO ingest_state (key, value_json, updated_at)
    VALUES (${key}, ${JSON.stringify(value)}::jsonb, NOW())
    ON CONFLICT (key)
    DO UPDATE SET
      value_json = ${JSON.stringify(value)}::jsonb,
      updated_at = NOW()
  `;
}

export async function catalogItemExists(
  tmdbId: number,
  mediaType: "movie" | "tv" = "movie"
) {
  const rows = await sql`
    SELECT 1
    FROM catalog_items
    WHERE tmdb_id = ${tmdbId}
      AND media_type = ${mediaType}
    LIMIT 1
  `;

  return rows.length > 0;
}

export async function upsertCatalogItem(input: CatalogItemInput) {
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
      metacritic_rating,
      metacritic_votes,
      metacriticuser_rating,
      metacriticuser_votes,
      trakt_rating,
      trakt_votes,
      tomatoesaudience_rating,
      tomatoesaudience_votes,
      letterboxd_rating,
      letterboxd_votes,
      tmdb_vote_average,
      tmdb_vote_count,
      is_enriched,
      mdblist_status,
      updated_at
    )
    VALUES (
      ${input.media_type},
      ${input.tmdb_id},
      ${input.imdb_id ?? null},
      ${input.title ?? null},
      ${input.original_title ?? null},
      ${input.year ?? null},
      ${input.poster_path ?? null},
      ${input.overview ?? null},
      ${input.genre_ids_json ?? null}::jsonb,
      ${input.provider_ids_json ?? null}::jsonb,
      ${input.imdb_rating ?? null},
      ${input.imdb_votes ?? null},
      ${input.metacritic_rating ?? null},
      ${input.metacritic_votes ?? null},
      ${input.metacriticuser_rating ?? null},
      ${input.metacriticuser_votes ?? null},
      ${input.trakt_rating ?? null},
      ${input.trakt_votes ?? null},
      ${input.tomatoesaudience_rating ?? null},
      ${input.tomatoesaudience_votes ?? null},
      ${input.letterboxd_rating ?? null},
      ${input.letterboxd_votes ?? null},
      ${input.tmdb_vote_average ?? null},
      ${input.tmdb_vote_count ?? null},
      ${input.is_enriched ?? null},
      ${input.mdblist_status ?? null},
      NOW()
    )
    ON CONFLICT (media_type, tmdb_id)
    DO UPDATE SET
      imdb_id = EXCLUDED.imdb_id,
      title = EXCLUDED.title,
      original_title = EXCLUDED.original_title,
      year = EXCLUDED.year,
      poster_path = EXCLUDED.poster_path,
      overview = EXCLUDED.overview,
      genre_ids_json = EXCLUDED.genre_ids_json,
      provider_ids_json = EXCLUDED.provider_ids_json,
      imdb_rating = EXCLUDED.imdb_rating,
      imdb_votes = EXCLUDED.imdb_votes,
      metacritic_rating = EXCLUDED.metacritic_rating,
      metacritic_votes = EXCLUDED.metacritic_votes,
      metacriticuser_rating = EXCLUDED.metacriticuser_rating,
      metacriticuser_votes = EXCLUDED.metacriticuser_votes,
      trakt_rating = EXCLUDED.trakt_rating,
      trakt_votes = EXCLUDED.trakt_votes,
      tomatoesaudience_rating = EXCLUDED.tomatoesaudience_rating,
      tomatoesaudience_votes = EXCLUDED.tomatoesaudience_votes,
      letterboxd_rating = EXCLUDED.letterboxd_rating,
      letterboxd_votes = EXCLUDED.letterboxd_votes,
      tmdb_vote_average = EXCLUDED.tmdb_vote_average,
      tmdb_vote_count = EXCLUDED.tmdb_vote_count,
      is_enriched = EXCLUDED.is_enriched,
      mdblist_status = EXCLUDED.mdblist_status,
      updated_at = NOW()
  `;
}