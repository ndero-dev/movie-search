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
    <div className="mt-4">
      <div className="flex flex-wrap gap-3">
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
            <div className="mt-1 line-clamp-2 text-xs text-zinc-700">
              {item.provider_name}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function TvPage(props: {
  params: Promise<{ id: string }> | { id: string };
  searchParams: Promise<SP> | SP;
}) {
  const params = await Promise.resolve(props.params);
  const searchParams = await Promise.resolve(props.searchParams);

  const safeFrom = decodeFrom(searchParams);

  const t = await getCachedDetail("tv", params.id);

  if (!t.ok && t.status === 404) {
    const m = await getCachedDetail("movie", params.id);
    if (m.ok) redirect(`/movie/${params.id}?from=${encodeURIComponent(safeFrom)}`);
  }

  if (!t.ok) {
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <BackToSearchLink href={safeFrom} className="underline">
          ← Aramaya dön
        </BackToSearchLink>

        <h2 style={{ marginTop: 16 }}>Dizi bulunamadı (TMDB {t.status})</h2>
        <pre style={{ background: "#f6f6f6", padding: 12, borderRadius: 8, overflow: "auto" }}>
          {JSON.stringify(t.json, null, 2)}
        </pre>
      </div>
    );
  }

  const tv = t.json;
  const poster = tv?.poster_path
    ? `https://image.tmdb.org/t/p/w500${tv.poster_path}`
    : null;

  const extraRaw = await getCachedExtraRatings("tv", params.id, tv?.name ?? null);

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
              alt={tv?.name ?? "poster"}
              className="block w-full rounded-2xl"
            />
          ) : (
            <div className="w-full rounded-2xl bg-zinc-200" style={{ aspectRatio: "2/3" }} />
          )}

          <div className="mt-4 space-y-2 text-sm">
            {extra.turkceAltyaziUrl ? (
              <div>
                <a
                  className="underline"
                  href={extra.turkceAltyaziUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  TrAltOrg
                </a>
              </div>
            ) : null}

            {extra.mdblist?.url ? (
              <div>
                <a
                  className="underline"
                  href={extra.mdblist.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  MDBList
                </a>
              </div>
            ) : null}

            {tv?.homepage ? (
              <div>
                <a
                  className="underline break-all"
                  href={tv.homepage}
                  target="_blank"
                  rel="noreferrer"
                >
                  Resmi site
                </a>
              </div>
            ) : null}

            {extra.watchProviders?.results?.link ? (
              <div>
                <a
                  className="underline"
                  href={extra.watchProviders.results.link}
                  target="_blank"
                  rel="noreferrer"
                >
                  TMDB
                </a>
              </div>
            ) : null}
          </div>

          {providerIcons(extra.watchProviders?.results?.flatrate ?? [])}
        </div>

        <div>
          <h1 className="text-3xl font-semibold leading-tight md:text-4xl">
            {tv?.name}
          </h1>

          <div className="mt-3 space-y-2 text-zinc-600">
            <div>
              Başlangıç: {tv?.first_air_date || "-"} • Sezon: {tv?.number_of_seasons ?? "-"} •
              Bölüm: {tv?.number_of_episodes ?? "-"} • ~{tv?.episode_run_time?.[0] ?? "-"} dk
            </div>
            <div>
              Türler: {Array.isArray(tv?.genres) ? tv.genres.map((g: any) => g.name).join(", ") : "-"}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3">
            {ratingBox("IMDb", extra.imdbRating, extra.imdbVotes)}
            {ratingBox(
              "TMDB",
              tv?.vote_average?.toFixed?.(1) ?? tv?.vote_average ?? null,
              tv?.vote_count ?? null
            )}
            {ratingBox("Trakt", extra.sources?.trakt?.rating ?? null, extra.sources?.trakt?.votes ?? null)}
            {ratingBox("Tomatoes", extra.sources?.tomatoes?.rating ?? null, extra.sources?.tomatoes?.votes ?? null)}
            {ratingBox("Popcorn", extra.sources?.popcorn?.rating ?? null, extra.sources?.popcorn?.votes ?? null)}
            {ratingBox("Metacritic", extra.sources?.metacritic?.rating ?? null, extra.sources?.metacritic?.votes ?? null)}
          </div>

          {tv?.overview ? (
            <div className="mt-6">
              <h2 className="mb-2 text-lg font-semibold">Özet</h2>
              <p className="text-base leading-8 text-zinc-800">{tv.overview}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}