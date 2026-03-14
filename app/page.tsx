"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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
  sources?: Record<string, any>;
  turkceAltyaziUrl?: string | null;
  mdblist?: { id: string | number; type: "movie" | "show"; url: string | null } | null;
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

function buildPoster(poster_path: string | null) {
  return poster_path ? `https://image.tmdb.org/t/p/w342${poster_path}` : null;
}

function turkceTitle(x: Item) {
  return x.media_type === "tv" ? "Dizi" : "Film";
}

function ratingCell(
  label: string,
  value?: string | number | null,
  votes?: number | string | null
) {
  if (value == null || value === "" || value === "N/A") return null;

  return (
    <div className="rounded border border-zinc-200 px-2 py-1 text-xs">
      <div className="font-medium">{label}</div>
      <div>
        {value}
        {votes != null && votes !== "" ? ` (${votes})` : ""}
      </div>
    </div>
  );
}

function parseType(value: string | null): "all" | MediaType {
  return value === "movie" || value === "tv" ? value : "all";
}

async function tmdb(
  path: string,
  params: Record<string, string | number | undefined | null>
) {
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

async function searchApi(params: Record<string, string | number | undefined | null>) {
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
    } catch {}
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
  const [genreMovie, setGenreMovie] = useState("");
  const [genreTv, setGenreTv] = useState("");

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

    setQ(sp.get("q") ?? "");
    setType(parseType(sp.get("type")));
    setYear(sp.get("year") ?? "");
    setMinRating(sp.get("minRating") ?? "");
    setMinVotes(sp.get("minVotes") ?? "");
    setGenreMovie(sp.get("gM") ?? "");
    setGenreTv(sp.get("gT") ?? "");
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
    } catch {}
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    if (!paramsHydrated) return;
    if (restoringRef.current) return;

    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    sp.set("type", type);
    if (year) sp.set("year", year);
    if (minRating) sp.set("minRating", minRating);
    if (minVotes) sp.set("minVotes", minVotes);
    if (genreMovie) sp.set("gM", genreMovie);
    if (genreTv) sp.set("gT", genreTv);

    const nextUrl = `${window.location.pathname}?${sp.toString()}`;
    window.history.replaceState(null, "", nextUrl);
    setCurrentFromUrl(nextUrl);
  }, [
    mounted,
    paramsHydrated,
    q,
    type,
    year,
    minRating,
    minVotes,
    genreMovie,
    genreTv,
  ]);

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
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [mounted]);

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
    } catch {}
  }

  async function runSearch(requestPage: number, append: boolean) {
    if (loadLockRef.current) return;

    loadLockRef.current = true;
    setLoading(true);
    setErr(null);

    try {
      const data = await searchApi({
        q,
        type,
        year,
        minRating,
        minVotes,
        gM: genreMovie,
        gT: genreTv,
        page: requestPage,
      });

      const nextItems = Array.isArray(data?.results) ? data.results : [];
      const apiNextPage =
        typeof data?.next_page === "number" ? data.next_page : null;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, items.length, hasSearched, nextPage, loading]);

  function Card({ x }: { x: Item }) {
    const poster = buildPoster(x.poster_path);
    const detailHref = `/${x.media_type}/${x.id}?from=${encodeURIComponent(
      currentFromUrl || "/"
    )}`;

    const src = x.sources ?? {};
    const taUrl = x.turkceAltyaziUrl ?? null;
    const genres = getGenreNames(x);

    return (
      <div
        className="rounded-lg border border-zinc-200 p-3"
        style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12 }}
      >
        <div>
          <Link href={detailHref} onClick={saveSnapshot}>
            {poster ? (
              <img
                src={poster}
                alt={x.title}
                style={{ width: "120px", borderRadius: 10, display: "block" }}
              />
            ) : (
              <div
                style={{
                  width: 120,
                  aspectRatio: "2/3",
                  background: "#eee",
                  borderRadius: 10,
                }}
              />
            )}
          </Link>

          <div className="mt-2 space-y-1 text-xs">
            {taUrl ? (
              <div>
                TürkçeAltyazı:{" "}
                <a className="underline" href={taUrl} target="_blank" rel="noreferrer">
                  link
                </a>
              </div>
            ) : null}

            {x.mdblist?.url ? (
              <div>
                MDBList:{" "}
                <a
                  className="underline"
                  href={x.mdblist.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  link
                </a>
              </div>
            ) : null}
          </div>
        </div>

        <div>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link href={detailHref} onClick={saveSnapshot} className="no-underline">
                <h2 className="text-base font-semibold leading-snug" style={{ margin: 0 }}>
                  {x.title}
                  {x.year && (
                    <span className="ml-2 text-sm font-normal text-zinc-500">
                      ({x.year})
                    </span>
                  )}
                </h2>
              </Link>

              {genres && <div className="mt-1 text-xs text-zinc-500">{genres}</div>}
            </div>

            <span className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-xs text-white">
              {turkceTitle(x)}
            </span>
          </div>

          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {ratingCell("IMDb", x.imdbRating, x.imdbVotes)}
              {ratingCell(
                "TMDB",
                x.vote_average != null ? x.vote_average.toFixed(1) : null,
                x.vote_count
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {ratingCell("Trakt", src?.trakt?.rating ?? null, src?.trakt?.votes ?? null)}
              {ratingCell(
                "Tomatoes",
                src?.tomatoes?.rating ?? null,
                src?.tomatoes?.votes ?? null
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {ratingCell("Popcorn", src?.popcorn?.rating ?? null, src?.popcorn?.votes ?? null)}
              {ratingCell(
                "Metacritic",
                src?.metacritic?.rating ?? null,
                src?.metacritic?.votes ?? null
              )}
            </div>
          </div>

          {x.overview ? (
            <p className="mt-2 text-sm leading-7 text-zinc-700" style={{ marginBottom: 0 }}>
              {x.overview}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (!mounted) {
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
        <h1 style={{ marginTop: 0 }}>Movie / TV Search</h1>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <h1 style={{ marginTop: 0 }}>Movie / TV Search</h1>

      <div style={{ maxWidth: 520, margin: "0 auto" }}>
        <div className="rounded-2xl border border-zinc-200 p-4">
          <div className="flex flex-col gap-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="İsim (opsiyonel)"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="h-12 w-full rounded-2xl border border-zinc-300 px-4"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  startSearch();
                }
              }}
            />

            <select
              value={type}
              onChange={(e) => setType(parseType(e.target.value))}
              className="h-12 w-full rounded-2xl border border-zinc-300 px-4"
            >
              <option value="all">Hepsi</option>
              <option value="movie">Film</option>
              <option value="tv">Dizi</option>
            </select>

            <input
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="Yıl"
              autoComplete="off"
              inputMode="numeric"
              className="h-12 w-full rounded-2xl border border-zinc-300 px-4"
            />

            <input
              value={minRating}
              onChange={(e) => setMinRating(e.target.value)}
              placeholder="Min IMDb puanı"
              autoComplete="off"
              inputMode="decimal"
              className="h-12 w-full rounded-2xl border border-zinc-300 px-4"
            />

            <input
              value={minVotes}
              onChange={(e) => setMinVotes(e.target.value)}
              placeholder="Min IMDb oy"
              autoComplete="off"
              inputMode="numeric"
              className="h-12 w-full rounded-2xl border border-zinc-300 px-4"
            />

            <select
              value={genreMovie}
              onChange={(e) => setGenreMovie(e.target.value)}
              className="h-12 w-full rounded-2xl border border-zinc-300 px-4"
            >
              <option value="">Film türü (opsiyonel)</option>
              {movieGenres.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>

            <select
              value={genreTv}
              onChange={(e) => setGenreTv(e.target.value)}
              className="h-12 w-full rounded-2xl border border-zinc-300 px-4"
            >
              <option value="">Dizi türü (opsiyonel)</option>
              {tvGenres.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>

            <button
              onClick={startSearch}
              className="h-12 w-full rounded-2xl bg-black text-white"
            >
              Ara
            </button>
          </div>
        </div>
      </div>

      {err ? <div style={{ color: "crimson", marginTop: 12 }}>{err}</div> : null}

      {!hasSearched && items.length === 0 ? (
        <div style={{ marginTop: 16, color: "#666", textAlign: "center" }}>
          Arama yapmak için yukarıdan filtreleri seçip “Ara”ya bas.
        </div>
      ) : null}

      {hasSearched && items.length === 0 && !loading ? (
        <div style={{ marginTop: 16, color: "#666", textAlign: "center" }}>
          Sonuç bulunamadı.
        </div>
      ) : null}

      <div className="mt-4" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        {items.map((x) => (
          <Card key={`${x.media_type}:${x.id}`} x={x} />
        ))}
      </div>

      {loading && items.length > 0 ? (
        <div style={{ marginTop: 12, textAlign: "center" }}>Devamı yükleniyor…</div>
      ) : null}

      {hasSearched && nextPage === null && !loading && items.length > 0 ? (
        <div style={{ marginTop: 12, color: "#666", textAlign: "center" }}>
          Sonuçlar bitti.
        </div>
      ) : null}
    </div>
  );
}