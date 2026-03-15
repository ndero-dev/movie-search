"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type MediaType = "movie" | "tv";

type Item = {
  id: number;
  media_type: MediaType;
  title: string;
  year: string | null;
  sort_date: string | null;
  poster_path: string | null;
  overview: string | null;
  vote_average: number | null;
  vote_count: number | null;
  genre_ids: number[];
  imdbRating: number | null;
  imdbVotes: number | null;
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

export default function HomePage() {
  const [mounted, setMounted] = useState(false);

  const [q, setQ] = useState("");
  const [type, setType] = useState<"all" | MediaType>("all");
  const [year, setYear] = useState("");
  const [minRating, setMinRating] = useState("");
  const [minVotes, setMinVotes] = useState("");
  const [genre, setGenre] = useState("");

  const [paramsHydrated, setParamsHydrated] = useState(false);
  const [currentFromUrl, setCurrentFromUrl] = useState("/");

  const [movieGenres, setMovieGenres] = useState<{ id: number; name: string }[]>([]);
  const [tvGenres, setTvGenres] = useState<{ id: number; name: string }[]>([]);

  const [items, setItems] = useState<Item[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const restoringRef = useRef(false);
  const loadLockRef = useRef(false);
  const lastRequestedPageRef = useRef<number | null>(null);

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
    setType(parseType(cleanParam(sp.get("type")) || "all"));
    setYear(cleanParam(sp.get("year")));
    setMinRating(cleanParam(sp.get("minRating")));
    setMinVotes(cleanParam(sp.get("minVotes")));
    setGenre(cleanParam(sp.get("g")));

    setCurrentFromUrl(`${window.location.pathname}${window.location.search || ""}`);
    setParamsHydrated(true);
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;

    try {
      const flag = sessionStorage.getItem(RESTORE_FLAG_KEY);
      if (flag !== "1") return;

      sessionStorage.removeItem(RESTORE_FLAG_KEY);

      const raw = sessionStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return;

      const snap = JSON.parse(raw);

      restoringRef.current = true;

      if (Array.isArray(snap.items)) setItems(snap.items);
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
    const nextGenre = cleanParam(genre);

    const sp = new URLSearchParams();

    if (nextQ) sp.set("q", nextQ);
    sp.set("type", type);
    if (nextYear) sp.set("year", nextYear);
    if (nextMinRating) sp.set("minRating", nextMinRating);
    if (nextMinVotes) sp.set("minVotes", nextMinVotes);
    if (nextGenre) sp.set("g", nextGenre);

    const qs = sp.toString();
    const nextUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;

    window.history.replaceState(null, "", nextUrl);
    setCurrentFromUrl(nextUrl);
  }, [mounted, paramsHydrated, q, type, year, minRating, minVotes, genre]);

  useEffect(() => {
    if (!mounted) return;

    let cancelled = false;

    (async () => {
      try {
        const [m, t] = await Promise.all([
          tmdb("genre/movie/list", { language: "tr-TR" }),
          tmdb("genre/tv/list", { language: "tr-TR" }),
        ]);

        if (cancelled) return;

        setMovieGenres(m?.genres ?? []);
        setTvGenres(t?.genres ?? []);
      } catch {
        // ignore
      }
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

  async function runSearch(requestPage: number, append: boolean) {
    if (loadLockRef.current) return;

    loadLockRef.current = true;
    setLoading(true);
    setErr(null);

    try {
      const cleanGenre = cleanParam(genre);

      const gM = cleanGenre ? cleanGenre : null;
      const gT = cleanGenre ? cleanGenre : null;

      const data = await searchApi({
        q: cleanParam(q),
        type,
        year: cleanParam(year),
        minRating: cleanParam(minRating),
        minVotes: cleanParam(minVotes),
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
      setErr(e?.message ?? 'Hata');
    } finally {
      setLoading(false);
      loadLockRef.current = false;
    }
  }

  function startSearch() {
    if (loading) return;

    setHasSearched(true);
    setItems([]);
    setNextPage(null);
    lastRequestedPageRef.current = null;

    void runSearch(1, false);
  }

  async function loadMore() {
    if (nextPage == null) return;
    if (loading) return;
    if (loadLockRef.current) return;
    if (lastRequestedPageRef.current === nextPage) return;

    lastRequestedPageRef.current = nextPage;
    await runSearch(nextPage, true);
  }

  function clearFilters() {
    setQ("");
    setType("all");
    setYear("");
    setMinRating("");
    setMinVotes("");
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
  }, [mounted, hasSearched, nextPage, loading]);

  useEffect(() => {
    if (!mounted) return;
    if (!hasSearched) return;

    const t = window.setTimeout(() => {
      checkShouldLoadMore();
    }, 50);

    return () => {
      window.clearTimeout(t);
    };
  }, [mounted, items.length, hasSearched, nextPage, loading]);

  const activeFilters = useMemo(() => {
    const out: string[] = [];

    if (cleanParam(q)) out.push(`Arama: ${cleanParam(q)}`);
    if (type !== "all") out.push(type === "movie" ? "Tür: Film" : "Tür: Dizi");
    if (cleanParam(year)) out.push(`Yıl: ${cleanParam(year)}`);
    if (cleanParam(minRating)) out.push(`IMDb ≥ ${cleanParam(minRating)}`);
    if (cleanParam(minVotes)) out.push(`Oy ≥ ${cleanParam(minVotes)}`);

    if (cleanParam(genre)) {
      const genreName = mergedGenres.find((g) => g.id === cleanParam(genre))?.name;
      out.push(`Kategori: ${genreName ?? cleanParam(genre)}`);
    }

    return out;
  }, [q, type, year, minRating, minVotes, genre, mergedGenres]);

  function Card({ x }: { x: Item }) {
    const poster = buildPoster(x.poster_path);
    const detailHref = `/${x.media_type}/${x.id}?from=${encodeURIComponent(currentFromUrl || "/")}`;
    const src = x.sources ?? {};
    const taUrl = x.turkceAltyaziUrl ?? null;
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
              className="line-clamp-2 block text-lg font-semibold text-zinc-900 hover:underline"
            >
              {x.title}
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

          {(taUrl || x.mdblist?.url) && (
            <div className="flex flex-wrap gap-3 text-sm">
              {taUrl ? (
                <a
                  href={taUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-blue-600 hover:underline"
                >
                  TürkçeAltyazı
                </a>
              ) : null}

              {x.mdblist?.url ? (
                <a
                  href={x.mdblist.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-blue-600 hover:underline"
                >
                  MDBList
                </a>
              ) : null}
            </div>
          )}
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
              if (e.key === "Enter") startSearch();
            }}
          />

          <select
            value={safeInputValue(type) || "all"}
            onChange={(e) => setType(parseType(e.target.value))}
            className="h-12 w-full rounded-2xl border border-zinc-300 px-4 outline-none transition focus:border-zinc-500"
          >
            <option value="all">Hepsi</option>
            <option value="movie">Film</option>
            <option value="tv">Dizi</option>
          </select>

          <select
            value={safeInputValue(genre)}
            onChange={(e) => setGenre(e.target.value)}
            className="h-12 w-full rounded-2xl border border-zinc-300 px-4 outline-none transition focus:border-zinc-500"
          >
            <option value="">Tür (opsiyonel)</option>
            {mergedGenres.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>

          <input
            value={safeInputValue(year)}
            onChange={(e) => setYear(e.target.value.replace(/[^\d]/g, "").slice(0, 4))}
            placeholder="Yıl"
            autoComplete="off"
            inputMode="numeric"
            className="h-12 w-full rounded-2xl border border-zinc-300 px-4 outline-none transition focus:border-zinc-500"
            onKeyDown={(e) => {
              if (e.key === "Enter") startSearch();
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
              if (e.key === "Enter") startSearch();
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
              if (e.key === "Enter") startSearch();
            }}
          />

          <div className="flex gap-3 sm:col-span-2 lg:col-span-2">
            <button
              type="button"
              onClick={startSearch}
              disabled={loading}
              className="h-12 flex-1 rounded-2xl bg-black px-5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Aranıyor..." : "Ara"}
            </button>

            <button
              type="button"
              onClick={clearFilters}
              disabled={loading}
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

      {loading && items.length === 0 ? (
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

      {hasSearched && items.length === 0 && !loading ? (
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

      {loading && items.length > 0 ? (
        <div className="mt-6 text-center text-sm text-zinc-500">Devamı yükleniyor…</div>
      ) : null}

      {nextPage !== null && !loading && items.length > 0 ? (
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

      {hasSearched && nextPage === null && !loading && items.length > 0 ? (
        <div className="mt-6 text-center text-sm text-zinc-500">Sonuçlar bitti.</div>
      ) : null}
    </main>
  );
}