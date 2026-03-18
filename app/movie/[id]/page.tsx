import BackToSearchLink from "@/app/components/BackToSearchLink";
import FavoriteButton from "@/app/components/FavoriteButton";
import WatchedButton from "@/app/components/WatchedButton";
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
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="font-medium text-zinc-900">
        {value} {votes != null && votes !== "" ? ` (${votes})` : ""}
      </div>
    </div>
  );
}

function providerIcons(items: WatchProviderItem[] = []) {
  if (!items.length) return null;

  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
      {items.map((item) => (
        <div
          key={item.provider_id}
          className="flex flex-col items-center gap-1 text-center text-xs text-zinc-600"
        >
          {item.logo_path ? (
            <img
              src={`https://image.tmdb.org/t/p/w92${item.logo_path}`}
              alt={item.provider_name}
              className="h-10 w-10 rounded-xl border border-zinc-200 bg-white object-contain p-1"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-100 text-[10px]">
              N/A
            </div>
          )}
          <span className="max-w-[72px] leading-tight">{item.provider_name}</span>
        </div>
      ))}
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
      <main className="mx-auto max-w-5xl px-4 py-8">
        <BackToSearchLink fallbackHref={safeFrom} />
        <h2 className="mt-6 text-2xl font-semibold text-zinc-900">
          Film bulunamadı (TMDB {m.status})
        </h2>
        <pre className="mt-4 overflow-auto rounded-2xl bg-zinc-100 p-4 text-sm">
          {JSON.stringify(m.json, null, 2)}
        </pre>
      </main>
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
    <main className="mx-auto max-w-5xl px-4 py-8">
      <BackToSearchLink fallbackHref={safeFrom} />

      <div className="mt-6 grid gap-8 md:grid-cols-[300px_1fr]">
        <div>
          {poster ? (
            <img
              src={poster}
              alt={movie?.title ?? "Poster"}
              className="w-full rounded-3xl border border-zinc-200 bg-zinc-100 object-cover shadow-sm"
            />
          ) : (
            <div className="flex aspect-[2/3] w-full items-center justify-center rounded-3xl border border-zinc-200 bg-zinc-100 text-sm text-zinc-500">
              Poster yok
            </div>
          )}

          {providerIcons(extra.watchProviders?.results?.flatrate ?? [])}
        </div>

        <div>
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900">
            {movie?.title}
          </h1>

          <div className="flex items-center gap-2">
            <FavoriteButton mediaType="movie" id={params.id} />
            <WatchedButton mediaType="movie" id={params.id} />
          </div>

          <div className="mt-3 text-sm text-zinc-600">
            Çıkış: {movie?.release_date || "-"} • Süre:{" "}
            {movie?.runtime ? `${movie.runtime} dk` : "-"}
          </div>

          <div className="mt-2 text-sm text-zinc-600">
            Türler:{" "}
            {Array.isArray(movie?.genres)
              ? movie.genres.map((g: any) => g.name).join(", ")
              : "-"}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {ratingBox("IMDb", extra.imdbRating, extra.imdbVotes)}
            {ratingBox(
              "TMDB",
              movie?.vote_average?.toFixed?.(1) ?? movie?.vote_average ?? null,
              movie?.vote_count ?? null
            )}
            {ratingBox("Trakt", extra.sources?.trakt?.rating ?? null, extra.sources?.trakt?.votes ?? null)}
            {ratingBox(
              "Tomatoes",
              extra.sources?.tomatoes?.rating ?? null,
              extra.sources?.tomatoes?.votes ?? null
            )}
            {ratingBox("Popcorn", extra.sources?.popcorn?.rating ?? null, extra.sources?.popcorn?.votes ?? null)}
            {ratingBox(
              "Metacritic",
              extra.sources?.metacritic?.rating ?? null,
              extra.sources?.metacritic?.votes ?? null
            )}
          </div>

          {movie?.overview ? (
            <section className="mt-8">
              <h2 className="text-xl font-semibold text-zinc-900">Özet</h2>
              <p className="mt-3 leading-7 text-zinc-700">{movie.overview}</p>
            </section>
          ) : null}

          <div className="mt-8 flex flex-wrap gap-4 text-sm">
            {extra.turkceAltyaziUrl ? (
              <a
                href={extra.turkceAltyaziUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-blue-600 hover:underline"
              >
                TrOrg
              </a>
            ) : null}

            {extra.mdblist?.url ? (
              <a
                href={extra.mdblist.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-blue-600 hover:underline"
              >
                MDBList
              </a>
            ) : null}

            {movie?.homepage ? (
              <a
                href={movie.homepage}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-blue-600 hover:underline"
              >
                Official
              </a>
            ) : null}

            {extra.watchProviders?.results?.link ? (
              <a
                href={extra.watchProviders.results.link}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-blue-600 hover:underline"
              >
                TMDB
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}