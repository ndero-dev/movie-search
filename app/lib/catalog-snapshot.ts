import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL missing");
}

const sql = neon(databaseUrl);

export type CatalogSnapshot = {
  media_type: "movie" | "tv";
  tmdb_id: number;
  imdb_id: string | null;
  provider_ids_json: unknown;
  mdblist_payload_json: unknown | null;
  is_enriched: boolean;
  mdblist_status: string;
};

export async function getCatalogSnapshotByTmdbId(
  mediaType: "movie" | "tv",
  tmdbId: number
): Promise<CatalogSnapshot | null> {
  const rows = await sql`
    SELECT
      media_type,
      tmdb_id,
      imdb_id,
      provider_ids_json,
      mdblist_payload_json,
      is_enriched,
      mdblist_status
    FROM catalog_items
    WHERE media_type = ${mediaType}
      AND tmdb_id = ${tmdbId}
    LIMIT 1
  `;

  return (rows as CatalogSnapshot[])[0] ?? null;
}