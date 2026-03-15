import BackToSearchLink from "@/app/components/BackToSearchLink";
import {
  getCachedDetail,
  getCachedExtraRatings,
  type WatchProviderItem,
} from "@/app/lib/detail-cache";
import { redirect } from "next/navigation";

type SP = { from?: string | string[] };

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

function ratingBox(
  label: string,
  value?: string | number | null,
  votes?: string | number | null
) {
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

function providerIcons(items: WatchProviderItem[] = []) {
  if (!items.length) return null;

  return (
    <div className="mt-6 flex justify-center">
      <div className="flex flex-wrap justify-center gap-6">
        {items.map((item) => (
          <div
            key={item.provider_id}
            className="flex w-[92px] flex-col items-center text-center"
            title={item.provider_name}
          >
            {item.logo_path ? (
              <img
                src={item.logo_path}
                alt={item.provider_name}
                className="h-[46px] w-[46px] rounded-xl border border-zinc-200 object-cover"
                loading="lazy"
              />
            ) : (
              <div className="flex h-[46px] w-[46px] items-center justify-center rounded-xl border border-zinc-200 bg-zinc-100 text-[10px] text-zinc-500">
                N/A
              </div>
            )}

            <div className="mt-1 text-xs text-zinc-700 text-center">
              {item.provider_name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function MoviePage(props: {
  params: Promise<{ id: string }> | { id: string };
  searchParams: Promise<SP> | SP;
}) {
  const params = await Promise.resolve(props.params);
  const searchParams = await Promise.resolve(props.searchParams);

  const safeFrom = decodeFrom(searchParams);

  const m = await getCachedDetail("movie", params.id);

  if (!m.ok && m.status === 404) {
    const t = await getCachedDetail("tv", params.id);
    if (t.ok) redirect(`/tv/${params.id}?from=${encodeURIComponent(safeFrom)}`);
  }

  if (!m.ok) {
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <BackToSearchLink href={safeFrom} className="underline">
          ← Aramaya dön
        </BackToSearchLink>

        <h2 style={{ marginTop: 16 }}>Film bulunamadı (TMDB {m.status})</h2>

        <pre style={{ background: "#f6f6f6", padding: 12, borderRadius: 8, overflow: "auto" }}>
          {JSON.stringify(m.json, null, 2)}
        </pre>
      </div>
    );
  }

  const movie = m.json;

  const poster = movie?.poster_path
    ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
    : null;

  const extraRaw = await getCachedExtraRatings("movie", params.id, movie?.title ?? null);

  const extra = {
    ...extraRaw,
    watchProviders: extraRaw?.watchProviders ?? {
      region: "TR",
      results: null,
    },
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <BackToSearchLink href={safeFrom} className="underline">
        ← Aramaya dön
      </BackToSearchLink>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[320px_1fr]">
        <div>
          {poster ? (
            <img
              src={poster}
              alt={movie?.title ?? "poster"}
              className="block w-full rounded-2xl"
            />
          ) : (
            <div className="w-full rounded-2xl bg-zinc-200" style={{ aspectRatio: "2/3" }} />
          )}

          {providerIcons(extra.watchProviders?.results?.flatrate ?? [])}
        </div>

        <div>
          <h1 className="text-3xl font-semibold leading-tight md:text-4xl">
            {movie?.title}
          </h1>

          <div className="mt-3 space-y-2 text-zinc-600">
            <div>
              Çıkış: {movie?.release_date || "-"} • Süre: {movie?.runtime ?? "-"} dk
            </div>

            <div>
              Türler: {Array.isArray(movie?.genres) ? movie.genres.map((g: any) => g.name).join(", ") : "-"}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
            {ratingBox("IMDb", extra.imdbRating, extra.imdbVotes)}
            {ratingBox(
              "TMDB",
              movie?.vote_average?.toFixed?.(1) ?? movie?.vote_average ?? null,
              movie?.vote_count ?? null
            )}
            {ratingBox("Trakt", extra.sources?.trakt?.rating ?? null, extra.sources?.trakt?.votes ?? null)}
            {ratingBox("Tomatoes", extra.sources?.tomatoes?.rating ?? null, extra.sources?.tomatoes?.votes ?? null)}
            {ratingBox("Popcorn", extra.sources?.popcorn?.rating ?? null, extra.sources?.popcorn?.votes ?? null)}
            {ratingBox("Metacritic", extra.sources?.metacritic?.rating ?? null, extra.sources?.metacritic?.votes ?? null)}
          </div>

          {movie?.overview ? (
            <div className="mt-6">
              <h2 className="mb-2 text-lg font-semibold">Özet</h2>
              <p className="text-base leading-8 text-zinc-800">{movie.overview}</p>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-4 text-sm text-blue-600">
            {extra.turkceAltyaziUrl ? (
              <a
                href={extra.turkceAltyaziUrl}
                className="hover:text-blue-800"
              >
                TrOrg
              </a>
            ) : null}

            {extra.imdb_id ? (
              <a
                href={`https://www.imdb.com/title/${extra.imdb_id}/`}
                className="hover:text-blue-800"
              >
                IMDb
              </a>
            ) : null}

            {extra.mdblist?.url ? (
              <a
                href={extra.mdblist.url}
                className="hover:text-blue-800"
              >
                MDBList
              </a>
            ) : null}

            {movie?.homepage ? (
              <a
                href={movie.homepage}
                className="hover:text-blue-800"
              >
                Official
              </a>
            ) : null}

            <a
              href={`https://www.themoviedb.org/movie/${params.id}`}
              className="hover:text-blue-800"
            >
              TMDB
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}