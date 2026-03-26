"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { getFavorites } from "@/app/lib/favorites";
import { getWatched } from "@/app/lib/watched";

type MediaType = "movie" | "tv";

type Item = {
  id: number;
  media_type: MediaType;
  title: string;
  original_title?: string | null;
  original_name?: string | null;
  year: string | null;
  sort_date: string | null;
  poster_path: string | null;
  overview: string | null;
  vote_average: number | null;
  vote_count: number | null;
  genre_ids: number[];
  imdbRating: number | null;
  imdbVotes: number | null;
  provider_ids?: number[];
  sources?: {
    trakt?: { rating?: number | string | null; votes?: number | string | null };
    tomatoes?: { rating?: number | string | null; votes?: number | string | null };
    popcorn?: { rating?: number | string | null; votes?: number | string | null };
    metacritic?: { rating?: number | string | null; votes?: number | string | null };
  };
  turkceAltyaziUrl?: string | null;
  mdblist?: {
    id: string | number;
    type: "movie" | "show";
    url: string | null;
  } | null;
};

type SearchResponse = {
  results: Item[];
  next_page: number | null;
  has_more?: boolean;
  scanned_until_page?: number;
  total_pages?: number;
};

type ProviderOption = {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
};

const SNAPSHOT_KEY = "movieapp:searchSnapshot:v4";
const RESTORE_FLAG_KEY = "movieapp:restoreNext:v1";

function buildPoster(posterPath: string | null) {
  return posterPath ? `https://image.tmdb.org/t/p/w342${posterPath}` : null;
}

function turkceTitle(x: Item) {
  return x.media_type === "tv" ? "Dizi" : "Film";
}

function parseType(value: string | null): "all" | MediaType {
  return value === "movie" || value === "tv" ? value : "all";
}

function cleanParam(value: string | null | undefined) {
  if (value == null) return "";
  const v = value.trim();
  if (!v) return "";
  const lower = v.toLowerCase();
  if (lower === "null" || lower === "undefined" || lower === "n/a") return "";
  return v;
}

function safeInputValue(value: unknown) {
  if (value == null) return "";

  const v = String(value);
  const lower = v.toLowerCase();

  if (lower === "null" || lower === "undefined" || lower === "n/a") return "";
  return v;
}

function ratingCell(
  label: string,
  value?: string | number | null,
  votes?: number | string | null
) {
  if (value == null || value === "" || value === "N/A") return null;

  return (
    <div className="rounded-xl border border-zinc-200 px-3 py-2 text-sm">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="font-medium text-zinc-900">
        {value}
        {votes != null && votes !== "" ? ` (${votes})` : ""}
      </div>
    </div>
  );
}

async function tmdb(path: string, params: Record<string, string | number | null | undefined>) {
  const qs = new URLSearchParams();
  qs.set("path", path);

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }

  const r = await fetch(`/api/tmdb?${qs.toString()}`);
  if (!r.ok) throw new Error(`TMDB proxy failed: ${r.status}`);
  return r.json();
}

async function searchApi(params: Record<string, string | number | null | undefined>) {
  const qs = new URLSearchParams();

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }

  const r = await fetch(`/api/search?${qs.toString()}`);
  if (!r.ok) {
    let detail = "";
    try {
      const j = await r.json();
      detail = j?.detail ? ` - ${j.detail}` : "";
    } catch {
      // ignore
    }
    throw new Error(`search api failed: ${r.status}${detail}`);
  }

  return (await r.json()) as SearchResponse;
}

function dedupeItems(list: Item[]) {
  const seen = new Set<string>();
  const out: Item[] = [];

  for (const x of list) {
    const k = `${x.media_type}:${x.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }

  return out;
}

function dedupeProviders(list: ProviderOption[]) {
  const map = new Map<number, ProviderOption>();

  for (const provider of list) {
    if (!provider?.provider_id || !provider?.provider_name) continue;
    if (!map.has(provider.provider_id)) {
      map.set(provider.provider_id, provider);
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.provider_name.localeCompare(b.provider_name, "tr-TR")
  );
}

function parseYearFromDate(date?: string | null) {
  if (!date) return null;
  const year = date.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export default function HomePage() {
  const [mounted, setMounted] = useState(false);

  const [q, setQ] = useState("");
  const [favoriteChecked, setFavoriteChecked] = useState(false);
  const [watchedChecked, setWatchedChecked] = useState(false);
  const [type, setType] = useState<"all" | MediaType>("all");
  const [year, setYear] = useState("");
  const [minRating, setMinRating] = useState("");
  const [minVotes, setMinVotes] = useState("");
  const [platform, setPlatform] = useState("");
  const [genre, setGenre] = useState("");

  const [paramsHydrated, setParamsHydrated] = useState(false);
  const [currentFromUrl, setCurrentFromUrl] = useState("/");

  const [movieGenres, setMovieGenres] = useState<{ id: number; name: string }[]>([]);
  const [tvGenres, setTvGenres] = useState<{ id: number; name: string }[]>([]);
  const [platformOptions, setPlatformOptions] = useState<ProviderOption[]>([]);

  const [items, setItems] = useState<Item[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const restoringRef = useRef(false);
  const loadLockRef = useRef(false);
  const lastRequestedPageRef = useRef<number | null>(null);

  const loading = searchLoading || loadMoreLoading;

  useEffect(() => {
    setMounted(true);
  }, []);

  function getGenreNames(x: Item) {
    const list = x.media_type === "movie" ? movieGenres : tvGenres;

    return x.genre_ids
      .map((id) => list.find((g) => g.id === id)?.name)
      .filter(Boolean)
      .join(" • ");
  }

  useEffect(() => {
    if (!mounted) return;

    const sp = new URLSearchParams(window.location.search);

    setQ(cleanParam(sp.get("q")));
    setFavoriteChecked(sp.get("fav") === "1");
    setWatchedChecked(sp.get("watched") === "1");
    setType(parseType(cleanParam(sp.get("type")) || "all"));
    setYear(cleanParam(sp.get("year")));
    setMinRating(cleanParam(sp.get("minRating")));
    setMinVotes(cleanParam(sp.get("minVotes")));
    setPlatform(cleanParam(sp.get("platform")));
    setGenre(cleanParam(sp.get("g")));

    setCurrentFromUrl(`${window.location.pathname}${window.location.search || ""}`);
    setParamsHydrated(true);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;

    try {
      const raw = sessionStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return;

      const snap = JSON.parse(raw) as {
        url?: string;
        scrollY?: number;
        items?: Item[];
        nextPage?: number | null;
        ts?: number;
      };

      const currentUrl = `${window.location.pathname}${window.location.search || ""}`;
      const flag = sessionStorage.getItem(RESTORE_FLAG_KEY);
      const hasRestoreFlag = flag === "1";
      const sameUrl = snap?.url === currentUrl;
      const isFresh =
        typeof snap?.ts === "number"
          ? Date.now() - snap.ts < 1000 * 60 * 30
          : true;

      if (!isFresh) return;
      if (!hasRestoreFlag && !sameUrl) return;

      if (hasRestoreFlag) {
        sessionStorage.removeItem(RESTORE_FLAG_KEY);
      }

      restoringRef.current = true;

      if (Array.isArray(snap.items)) {
        setItems(snap.items);
      }

      if (typeof snap.nextPage === "number" || snap.nextPage === null) {
        setNextPage(snap.nextPage);
      }

      setHasSearched(true);

      requestAnimationFrame(() => {
        window.scrollTo(0, snap.scrollY ?? 0);

        setTimeout(() => {
          restoringRef.current = false;
        }, 50);
      });
    } catch {
      // ignore
    }
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !paramsHydrated || restoringRef.current) return;

    const nextQ = cleanParam(q);
    const nextYear = cleanParam(year);
    const nextMinRating = cleanParam(minRating);
    const nextMinVotes = cleanParam(minVotes);
    const nextPlatform = cleanParam(platform);
    const nextGenre = cleanParam(genre);

    const sp = new URLSearchParams();

    if (nextQ) sp.set("q", nextQ);
    if (favoriteChecked) sp.set("fav", "1");
    if (watchedChecked) sp.set("watched", "1");
    sp.set("type", type);
    if (nextYear) sp.set("year", nextYear);
    if (nextMinRating) sp.set("minRating", nextMinRating);
    if (nextMinVotes) sp.set("minVotes", nextMinVotes);
    if (nextPlatform) sp.set("platform", nextPlatform);
    if (nextGenre) sp.set("g", nextGenre);

    const qs = sp.toString();
    const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;

    window.history.replaceState(null, "", nextUrl);
    setCurrentFromUrl(nextUrl);
  }, [
    mounted,
    paramsHydrated,
    q,
    favoriteChecked,
    watchedChecked,
    type,
    year,
    minRating,
    minVotes,
    platform,
    genre,
  ]);

  useEffect(() => {
    if (!mounted) return;

    let cancelled = false;

    (async () => {
      const [mGenres, tGenres, mProviders, tProviders] = await Promise.allSettled([
        tmdb("genre/movie/list", { language: "tr-TR" }),
        tmdb("genre/tv/list", { language: "tr-TR" }),
        tmdb("watch/providers/movie", { language: "tr-TR", watch_region: "TR" }),
        tmdb("watch/providers/tv", { language: "tr-TR", watch_region: "TR" }),
      ]);

      if (cancelled) return;

      if (mGenres.status === "fulfilled") {
        setMovieGenres(mGenres.value?.genres ?? []);
      }

      if (tGenres.status === "fulfilled") {
        setTvGenres(tGenres.value?.genres ?? []);
      }

      const movieProviders =
        mProviders.status === "fulfilled" ? mProviders.value?.results ?? [] : [];
      const tvProviders =
        tProviders.status === "fulfilled" ? tProviders.value?.results ?? [] : [];

      setPlatformOptions(dedupeProviders([...(movieProviders ?? []), ...(tvProviders ?? [])]));
    })();

    return () => {
      cancelled = true;
    };
  }, [mounted]);

  const mergedGenres = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();

    for (const g of movieGenres) {
      const key = g.name.trim().toLocaleLowerCase("tr-TR");
      if (!map.has(key)) {
        map.set(key, { id: String(g.id), name: g.name });
      }
    }

    for (const g of tvGenres) {
      const key = g.name.trim().toLocaleLowerCase("tr-TR");
      if (!map.has(key)) {
        map.set(key, { id: String(g.id), name: g.name });
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "tr-TR")
    );
  }, [movieGenres, tvGenres]);

  function saveSnapshot() {
    try {
      const url = `${window.location.pathname}${window.location.search}`;
      sessionStorage.setItem(
        SNAPSHOT_KEY,
        JSON.stringify({
          url,
          scrollY: window.scrollY,
          items,
          nextPage,
          ts: Date.now(),
        })
      );
    } catch {
      // ignore
    }
  }

  function passesLocalFilters(item: Item) {
    const cleanQ = normalizeSearchText(q);
    const cleanYear = cleanParam(year);
    const cleanMinRating = cleanParam(minRating);
    const cleanMinVotes = cleanParam(minVotes);
    const cleanGenre = cleanParam(genre);
    const cleanPlatform = cleanParam(platform);

    if (cleanQ) {
      const searchPool = normalizeSearchText(
        [item.title ?? "", item.original_title ?? "", item.original_name ?? ""].join(" ")
      );

      if (!searchPool.includes(cleanQ)) return false;
    }

    if (type !== "all" && item.media_type !== type) return false;

    if (cleanYear) {
      const y = Number(cleanYear);
      const itemYear = Number(item.year ?? "");
      if (!Number.isFinite(itemYear) || itemYear < y) return false;
    }

    if (cleanMinRating) {
      const r = Number(cleanMinRating);
      const itemRating = item.imdbRating ?? item.vote_average ?? null;
      if (itemRating == null || itemRating < r) return false;
    }

    if (cleanMinVotes) {
      const v = Number(cleanMinVotes);
      const itemVotes = item.imdbVotes ?? item.vote_count ?? null;
      if (itemVotes == null || itemVotes < v) return false;
    }

    if (cleanGenre) {
      const genreId = Number(cleanGenre);
      if (!item.genre_ids.includes(genreId)) return false;
    }

    if (cleanPlatform) {
      const providerId = Number(cleanPlatform);
      const providerIds = item.provider_ids ?? [];
      if (!providerIds.includes(providerId)) return false;
    }

    return true;
  }

  async function fetchSavedExtraData(
    mediaType: MediaType,
    id: number,
    title: string,
    originalTitle?: string | null,
    originalName?: string | null
  ) {
    const queries = Array.from(
      new Set(
        [title, originalTitle, originalName]
          .map((value) => safeInputValue(value).trim())
          .filter(Boolean)
      )
    );

    for (const q of queries) {
      try {
        const json = (await searchApi({
          q,
          type: mediaType,
          page: 1,
        })) as SearchResponse;

        const found = (json?.results ?? []).find(
          (result) => result.id === id && result.media_type === mediaType
        );

        if (found) {
          return {
            imdbRating: found.imdbRating ?? null,
            imdbVotes: found.imdbVotes ?? null,
            sources: found.sources,
            turkceAltyaziUrl: found.turkceAltyaziUrl ?? null,
            mdblist: found.mdblist ?? null,
          };
        }
      } catch {
        // ignore and try next candidate query
      }
    }

    return {
      imdbRating: null,
      imdbVotes: null,
      sources: undefined,
      turkceAltyaziUrl: null,
      mdblist: null,
    };
  }

  async function buildSavedItem(mediaType: MediaType, id: number, selectedPlatform: string) {
    async function fetchDetailWithType(typeToTry: MediaType) {
      try {
        const detail = await tmdb(`${typeToTry}/${id}`, { language: "tr-TR" });
        if (!detail?.id) return null;
        return { detail, mediaType: typeToTry };
      } catch {
        return null;
      }
    }

    const primary = await fetchDetailWithType(mediaType);
    const fallback =
      primary ?? (await fetchDetailWithType(mediaType === "movie" ? "tv" : "movie"));

    if (!fallback) return null;

    const { detail, mediaType: resolvedMediaType } = fallback;

    let providerIds: number[] = [];

    try {
      const providerJson = await tmdb(`${resolvedMediaType}/${id}/watch/providers`, {});
      const regionData = providerJson?.results?.TR ?? null;
      const providers = [
        ...(Array.isArray(regionData?.flatrate) ? regionData.flatrate : []),
        ...(Array.isArray(regionData?.ads) ? regionData.ads : []),
        ...(Array.isArray(regionData?.free) ? regionData.free : []),
        ...(Array.isArray(regionData?.rent) ? regionData.rent : []),
        ...(Array.isArray(regionData?.buy) ? regionData.buy : []),
      ];

      providerIds = Array.from(
        new Set(
          providers
            .map((provider: any) => Number(provider?.provider_id))
            .filter((providerId: number) => Number.isFinite(providerId) && providerId > 0)
        )
      );
    } catch {
      providerIds = [];
    }

    const extra = await fetchSavedExtraData(
      resolvedMediaType,
      detail.id,
      detail.title ?? detail.name ?? "",
      detail.original_title ?? null,
      detail.original_name ?? null
    );

    const item: Item = {
      id: detail.id,
      media_type: resolvedMediaType,
      title: detail.title ?? detail.name ?? "",
      original_title: detail.original_title ?? null,
      original_name: detail.original_name ?? null,
      year: parseYearFromDate(detail.release_date ?? detail.first_air_date),
      sort_date: detail.release_date ?? detail.first_air_date ?? null,
      poster_path: detail.poster_path ?? null,
      overview: detail.overview ?? null,
      vote_average: typeof detail.vote_average === "number" ? detail.vote_average : null,
      vote_count: typeof detail.vote_count === "number" ? detail.vote_count : null,
      genre_ids: Array.isArray(detail.genres) ? detail.genres.map((g: any) => g.id) : [],
      imdbRating: extra.imdbRating,
      imdbVotes: extra.imdbVotes,
      provider_ids: providerIds,
      sources: extra.sources,
      turkceAltyaziUrl: extra.turkceAltyaziUrl,
      mdblist: extra.mdblist,
    };

    if (selectedPlatform) {
      const selectedProviderId = Number(selectedPlatform);
      if (!item.provider_ids?.includes(selectedProviderId)) {
        return null;
      }
    }

    return item.title ? item : null;
  }

  async function loadSavedItems() {
    if (loadLockRef.current) return;

    loadLockRef.current = true;
    setSearchLoading(true);
    setErr(null);

    try {
      const favoriteKeys = favoriteChecked ? getFavorites() : [];
      const watchedKeys = watchedChecked ? getWatched() : [];

      const mergedKeys = Array.from(new Set([...favoriteKeys, ...watchedKeys]));
      const selectedPlatform = cleanParam(platform);

      const pairs = mergedKeys
        .map((key) => {
          const [mediaType, rawId] = key.split(":");
          const id = Number(rawId);

          if ((mediaType !== "movie" && mediaType !== "tv") || !Number.isInteger(id) || id <= 0) {
            return null;
          }

          return { mediaType: mediaType as MediaType, id };
        })
        .filter(Boolean) as { mediaType: MediaType; id: number }[];

      const savedItems = await Promise.all(
        pairs.map((pair) => buildSavedItem(pair.mediaType, pair.id, selectedPlatform))
      );

      const nextItems = dedupeItems(
        savedItems.filter((item): item is Item => Boolean(item)).filter((item) => passesLocalFilters(item))
      ).sort((a, b) => {
        const aVotes = a.vote_count ?? -1;
        const bVotes = b.vote_count ?? -1;
        return bVotes - aVotes;
      });

      setItems(nextItems);
      setNextPage(null);
    } catch (e: any) {
      setErr(e?.message ?? "Hata");
      setItems([]);
      setNextPage(null);
    } finally {
      setSearchLoading(false);
      loadLockRef.current = false;
    }
  }

  async function runSearch(requestPage: number, append: boolean) {
    if (loadLockRef.current) return;

    loadLockRef.current = true;

    if (append) {
      setLoadMoreLoading(true);
    } else {
      setSearchLoading(true);
    }

    setErr(null);

    try {
      const cleanGenre = cleanParam(genre);
      const cleanPlatform = cleanParam(platform);

      const gM = cleanGenre ? cleanGenre : null;
      const gT = cleanGenre ? cleanGenre : null;

      const data = await searchApi({
        q: cleanParam(q),
        type,
        year: cleanParam(year),
        minRating: cleanParam(minRating),
        minVotes: cleanParam(minVotes),
        platform: cleanPlatform,
        gM: type === "tv" ? null : gM,
        gT: type === "movie" ? null : gT,
        page: requestPage,
      });

      const nextItems = Array.isArray(data?.results) ? data.results : [];
      const apiNextPage = typeof data?.next_page === "number" ? data.next_page : null;

      setItems((prev) => (append ? dedupeItems([...prev, ...nextItems]) : nextItems));
      setNextPage(apiNextPage);

      if (!append) {
        requestAnimationFrame(() => {
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
      }
    } catch (e: any) {
      setErr(e?.message ?? "Hata");
    } finally {
      if (append) {
        setLoadMoreLoading(false);
      } else {
        setSearchLoading(false);
      }

      loadLockRef.current = false;
    }
  }

  async function startSearch() {
    if (loading) return;

    setHasSearched(true);
    setItems([]);
    setNextPage(null);
    lastRequestedPageRef.current = null;

    if (favoriteChecked || watchedChecked) {
      await loadSavedItems();
      return;
    }

    void runSearch(1, false);
  }

  async function loadMore() {
    if (favoriteChecked || watchedChecked) return;
    if (nextPage == null) return;
    if (loading) return;
    if (loadLockRef.current) return;
    if (lastRequestedPageRef.current === nextPage) return;

    lastRequestedPageRef.current = nextPage;
    await runSearch(nextPage, true);
  }

  function clearFilters() {
    setQ("");
    setFavoriteChecked(false);
    setWatchedChecked(false);
    setType("all");
    setYear("");
    setMinRating("");
    setMinVotes("");
    setPlatform("");
    setGenre("");
    setItems([]);
    setNextPage(null);
    setErr(null);
    setHasSearched(false);
    lastRequestedPageRef.current = null;
    window.history.replaceState(null, "", window.location.pathname);
    setCurrentFromUrl(window.location.pathname);
  }

  function checkShouldLoadMore() {
    if (favoriteChecked || watchedChecked) return;
    if (!mounted) return;
    if (!hasSearched) return;
    if (restoringRef.current) return;
    if (nextPage == null) return;
    if (loading) return;
    if (loadLockRef.current) return;

    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop;
    const viewportHeight = window.innerHeight;
    const fullHeight = doc.scrollHeight;
    const nearBottom = scrollTop + viewportHeight >= fullHeight - 800;

    if (!nearBottom) return;

    void loadMore();
  }

  useEffect(() => {
    if (!mounted) return;

    function onScroll() {
      checkShouldLoadMore();
    }

    function onResize() {
      checkShouldLoadMore();
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);

    const t = window.setTimeout(() => {
      checkShouldLoadMore();
    }, 50);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.clearTimeout(t);
    };
  }, [mounted, hasSearched, nextPage, loading, favoriteChecked, watchedChecked]);

  useEffect(() => {
    if (!mounted) return;
    if (!hasSearched) return;
    if (favoriteChecked || watchedChecked) return;

    const t = window.setTimeout(() => {
      checkShouldLoadMore();
    }, 50);

    return () => {
      window.clearTimeout(t);
    };
  }, [mounted, items.length, hasSearched, nextPage, loading, favoriteChecked, watchedChecked]);

  const activeFilters = useMemo(() => {
    const out: string[] = [];

    if (favoriteChecked) out.push("Favori");
    if (watchedChecked) out.push("İzledim");

    if (cleanParam(q)) out.push(`Arama: ${cleanParam(q)}`);
    if (type !== "all") out.push(type === "movie" ? "Tür: Film" : "Tür: Dizi");
    if (cleanParam(year)) out.push(`Min Yıl: ${cleanParam(year)}`);
    if (cleanParam(minRating)) out.push(`IMDb ≥ ${cleanParam(minRating)}`);
    if (cleanParam(minVotes)) out.push(`Oy ≥ ${cleanParam(minVotes)}`);

    if (cleanParam(platform)) {
      const platformName = platformOptions.find(
        (p) => String(p.provider_id) === cleanParam(platform)
      )?.provider_name;
      out.push(`Platform: ${platformName ?? cleanParam(platform)}`);
    }

    if (cleanParam(genre)) {
      const genreName = mergedGenres.find((g) => g.id === cleanParam(genre))?.name;
      out.push(`Kategori: ${genreName ?? cleanParam(genre)}`);
    }

    return out;
  }, [
    favoriteChecked,
    watchedChecked,
    q,
    type,
    year,
    minRating,
    minVotes,
    platform,
    genre,
    mergedGenres,
    platformOptions,
  ]);

  function Card({ x }: { x: Item }) {
    const poster = buildPoster(x.poster_path);
    const detailHref = `/${x.media_type}/${x.id}?from=${encodeURIComponent(currentFromUrl || "/")}`;
    const src = x.sources ?? {};
    const genres = getGenreNames(x);

    return (
      <article className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
        <Link
          href={detailHref}
          onClick={saveSnapshot}
          className="block transition hover:opacity-95"
        >
          {poster ? (
            <img
              src={poster}
              alt={x.title}
              className="aspect-[2/3] w-full bg-zinc-100 object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex aspect-[2/3] w-full items-center justify-center bg-zinc-100 text-sm text-zinc-500">
              Poster yok
            </div>
          )}
        </Link>

        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="rounded-full bg-zinc-100 px-2.5 py-1">{turkceTitle(x)}</span>
              {x.year ? (
                <span className="rounded-full bg-zinc-100 px-2.5 py-1">{x.year}</span>
              ) : null}
            </div>
<Link
  href={detailHref}
  onClick={saveSnapshot}
  className="block hover:underline"
>
  <div className="space-y-1">
    <div className="line-clamp-2 text-lg font-semibold text-zinc-900">
      {x.title}
    </div>

    {((x.media_type === "movie" && x.original_title && x.original_title !== x.title) ||
      (x.media_type === "tv" && x.original_name && x.original_name !== x.title)) ? (
      <div className="line-clamp-1 text-sm text-zinc-500">
        {x.media_type === "movie" ? x.original_title : x.original_name}
      </div>
    ) : null}
  </div>
</Link>

            {genres ? <div className="text-sm text-zinc-600">{genres}</div> : null}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {ratingCell("IMDb", x.imdbRating, x.imdbVotes)}
            {ratingCell(
              "TMDB",
              x.vote_average != null ? x.vote_average.toFixed(1) : null,
              x.vote_count
            )}
            {ratingCell("Trakt", src?.trakt?.rating ?? null, src?.trakt?.votes ?? null)}
            {ratingCell("Tomatoes", src?.tomatoes?.rating ?? null, src?.tomatoes?.votes ?? null)}
            {ratingCell("Popcorn", src?.popcorn?.rating ?? null, src?.popcorn?.votes ?? null)}
            {ratingCell(
              "Metacritic",
              src?.metacritic?.rating ?? null,
              src?.metacritic?.votes ?? null
            )}
          </div>

          {x.overview ? (
            <p className="line-clamp-4 text-sm leading-6 text-zinc-700">{x.overview}</p>
          ) : null}
        </div>
      </article>
    );
  }

  if (!mounted) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">Movie / TV Search</h1>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900">🎬 Movie / TV Search</h1>
      </div>

      <section className="mb-6 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="İsim (opsiyonel)"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="h-12 w-full rounded-2xl border border-zinc-300 px-4 outline-none ring-0 transition focus:border-zinc-500"
            onKeyDown={(e) => {
              if (e.key === "Enter") void startSearch();
            }}
          />

          <select
            value={safeInputValue(type) || "all"}
            onChange={(e) => setType(parseType(e.target.value))}
            className="h-12 w-full rounded-2xl border border-zinc-300 px-4 outline-none transition focus:border-zinc-500"
          >
            <option value="all">Film/Dizi</option>
            <option value="movie">Film</option>
            <option value="tv">Dizi</option>
          </select>

          <select
            value={safeInputValue(genre)}
            onChange={(e) => setGenre(e.target.value)}
            className="h-12 w-full rounded-2xl border border-zinc-300 px-4 outline-none transition focus:border-zinc-500"
          >
            <option value="">Tür</option>
            {mergedGenres.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          <input
            value={safeInputValue(year)}
            onChange={(e) => setYear(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
            placeholder="Min Yıl"
            autoComplete="off"
            inputMode="numeric"
            className="h-12 w-full rounded-2xl border border-zinc-300 px-4 outline-none transition focus:border-zinc-500"
            onKeyDown={(e) => {
              if (e.key === "Enter") void startSearch();
            }}
          />

          <input
            value={safeInputValue(minRating)}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, "");
              setMinRating(v);
            }}
            placeholder="Min IMDb puanı"
            autoComplete="off"
            inputMode="decimal"
            className="h-12 w-full rounded-2xl border border-zinc-300 px-4 outline-none transition focus:border-zinc-500"
            onKeyDown={(e) => {
              if (e.key === "Enter") void startSearch();
            }}
          />

          <input
            value={safeInputValue(minVotes)}
            onChange={(e) => setMinVotes(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="Min IMDb oy"
            autoComplete="off"
            inputMode="numeric"
            className="h-12 w-full rounded-2xl border border-zinc-300 px-4 outline-none transition focus:border-zinc-500"
            onKeyDown={(e) => {
              if (e.key === "Enter") void startSearch();
            }}
          />

          <select
            value={safeInputValue(platform)}
            onChange={(e) => setPlatform(e.target.value)}
            className="h-12 w-full rounded-2xl border border-zinc-300 px-4 outline-none transition focus:border-zinc-500"
          >
            <option value="">Platform (opsiyonel)</option>
            {platformOptions.map((provider) => (
              <option key={provider.provider_id} value={provider.provider_id}>
                {provider.provider_name}
              </option>
            ))}
          </select>

          <div className="flex h-12 items-center gap-5 rounded-2xl border border-zinc-300 px-4">
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={favoriteChecked}
                onChange={(e) => setFavoriteChecked(e.target.checked)}
                className="h-4 w-4"
              />
              Favori
            </label>

            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={watchedChecked}
                onChange={(e) => setWatchedChecked(e.target.checked)}
                className="h-4 w-4"
              />
              İzledim
            </label>
          </div>

          <div className="flex h-12 items-center gap-2">
            <button
              type="button"
              onClick={() => void startSearch()}
              disabled={searchLoading}
              className="h-12 flex-1 rounded-2xl bg-black px-5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {searchLoading ? "Aranıyor..." : "Ara"}
            </button>

            <button
              type="button"
              onClick={clearFilters}
              disabled={searchLoading}
              className="h-12 rounded-2xl border border-zinc-300 px-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Temizle
            </button>
          </div>
        </div>
      </section>

      {activeFilters.length > 0 ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {activeFilters.map((filter) => (
            <span
              key={filter}
              className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700"
            >
              {filter}
            </span>
          ))}
        </div>
      ) : null}

      {err ? (
        <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      {!hasSearched && items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-10 text-center text-zinc-600">
          Arama yapmak için yukarıdan filtreleri seçip “Ara”ya bas.
        </div>
      ) : null}

      {searchLoading && items.length === 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="mb-4 aspect-[2/3] animate-pulse rounded-2xl bg-zinc-200" />
              <div className="mb-2 h-5 animate-pulse rounded bg-zinc-200" />
              <div className="mb-4 h-4 w-2/3 animate-pulse rounded bg-zinc-200" />
              <div className="grid grid-cols-2 gap-2">
                <div className="h-12 animate-pulse rounded-xl bg-zinc-200" />
                <div className="h-12 animate-pulse rounded-xl bg-zinc-200" />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {hasSearched && items.length === 0 && !searchLoading ? (
        <div className="rounded-3xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-10 text-center text-zinc-600">
          Sonuç bulunamadı.
        </div>
      ) : null}

      {items.length > 0 ? (
        <>
          <div className="mb-4 text-sm text-zinc-600">
            Toplam gösterilen sonuç: <span className="font-semibold text-zinc-900">{items.length}</span>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((x) => (
              <Card key={`${x.media_type}:${x.id}`} x={x} />
            ))}
          </div>
        </>
      ) : null}

      {loadMoreLoading && items.length > 0 ? (
        <div className="mt-6 text-center text-sm text-zinc-500">Devamı yükleniyor…</div>
      ) : null}

      {!favoriteChecked && !watchedChecked && nextPage !== null && !loadMoreLoading && items.length > 0 ? (
        <div className="mt-8 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            className="h-12 rounded-2xl border border-zinc-300 px-5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            Daha fazla yükle
          </button>
        </div>
      ) : null}

      {!favoriteChecked && !watchedChecked && hasSearched && nextPage === null && !loadMoreLoading && items.length > 0 ? (
        <div className="mt-6 text-center text-sm text-zinc-500">Sonuçlar bitti.</div>
      ) : null}
    </main>
  );
}