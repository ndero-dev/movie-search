"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type MediaType = "movie" | "tv";
type SortKey = "popularity" | "rating" | "date";

type Item = {
  id: number;
  media_type: MediaType;
  title: string;
  year: string | null;
  poster_path: string | null;
  overview: string | null;
  vote_average: number | null;
  vote_count: number | null;
  genre_ids: number[];
};

const SNAPSHOT_KEY = "movieapp:searchSnapshot:v1";
const RESTORE_FLAG_KEY = "movieapp:restoreNext:v1";

function buildPoster(poster_path: string | null) {
  return poster_path ? `https://image.tmdb.org/t/p/w342${poster_path}` : null;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function formatYearFromDate(d?: string | null) {
  if (!d) return null;
  const y = d.slice(0, 4);
  return /^\d{4}$/.test(y) ? y : null;
}

function turkceTitle(x: Item) {
  return x.media_type === "tv" ? "Dizi" : "Film";
}

function ratingCell(label: string, value?: string | number | null, votes?: number | string | null) {
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

function useInView<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? false),
      { rootMargin: "400px" }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { ref, inView };
}

async function tmdb(path: string, params: Record<string, any>) {
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

async function imdbInfo(media_type: MediaType, tmdb_id: number) {
  const r = await fetch(`/api/imdb?media_type=${media_type}&tmdb_id=${tmdb_id}`);
  if (!r.ok) throw new Error(`imdb api failed: ${r.status}`);
  return r.json();
}

export default function HomePage() {
  // URL’den ilk state (refresh olursa bozulmasın)
  const initial = useMemo(() => {
    if (typeof window === "undefined") return null;
    const sp = new URLSearchParams(window.location.search);
    return {
      q: sp.get("q") ?? "",
      type: (sp.get("type") as any) ?? "all",
      year: sp.get("year") ?? "",
      minRating: sp.get("minRating") ?? "",
      minVotes: sp.get("minVotes") ?? "",
      genreMovie: sp.get("gM") ?? "",
      genreTv: sp.get("gT") ?? "",
      sort: (sp.get("sort") as SortKey) ?? "popularity",
    };
  }, []);

  const [q, setQ] = useState(initial?.q ?? "");
  const [type, setType] = useState<"all" | MediaType>((initial?.type as any) || "all");

  const [year, setYear] = useState(initial?.year ?? "");
  const [minRating, setMinRating] = useState(initial?.minRating ?? "");
  const [minVotes, setMinVotes] = useState(initial?.minVotes ?? "");

  const [genreMovie, setGenreMovie] = useState(initial?.genreMovie ?? "");
  const [genreTv, setGenreTv] = useState(initial?.genreTv ?? "");

  const [sort, setSort] = useState<SortKey>(initial?.sort ?? "popularity");

  const [movieGenres, setMovieGenres] = useState<{ id: number; name: string }[]>([]);
  const [tvGenres, setTvGenres] = useState<{ id: number; name: string }[]>([]);

  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Kullanıcı arama yaptı mı? (ilk açılışta otomatik sonuç gelmesin)
  const [hasSearched, setHasSearched] = useState(false);

  // imdb/mdblist cache
  const [imdbCache, setImdbCache] = useState<Record<string, any>>({});

  const restoringRef = useRef(false);

  // Snapshot restore (SADECE detaydan "Aramaya dön" ile gelince)
  useEffect(() => {
    try {
      const flag = sessionStorage.getItem(RESTORE_FLAG_KEY);
      if (flag !== "1") return;
      sessionStorage.removeItem(RESTORE_FLAG_KEY);

      const raw = sessionStorage.getItem(SNAPSHOT_KEY);
      if (!raw) return;

      const snap = JSON.parse(raw);
      restoringRef.current = true;

      if (Array.isArray(snap.items)) setItems(snap.items);
      if (typeof snap.page === "number") setPage(snap.page);
      if (typeof snap.hasMore === "boolean") setHasMore(snap.hasMore);

      setHasSearched(true);

      requestAnimationFrame(() => {
        window.scrollTo(0, snap.scrollY ?? 0);
        setTimeout(() => (restoringRef.current = false), 50);
      });
    } catch {}
  }, []);

  // URL sync (filtre değişince URL güncellensin)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (restoringRef.current) return;

    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    sp.set("type", type);
    if (year) sp.set("year", year);
    if (minRating) sp.set("minRating", minRating);
    if (minVotes) sp.set("minVotes", minVotes);
    if (genreMovie) sp.set("gM", genreMovie);
    if (genreTv) sp.set("gT", genreTv);
    sp.set("sort", sort);

    const nextUrl = `${window.location.pathname}?${sp.toString()}`;
    window.history.replaceState(null, "", nextUrl);
  }, [q, type, year, minRating, minVotes, genreMovie, genreTv, sort]);

  // Genre listelerini çek
  useEffect(() => {
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
  }, []);

  function saveSnapshot() {
    try {
      const url = `${window.location.pathname}${window.location.search}`;
      sessionStorage.setItem(
        SNAPSHOT_KEY,
        JSON.stringify({
          url,
          scrollY: window.scrollY,
          items,
          page,
          hasMore,
          ts: Date.now(),
        })
      );
    } catch {}
  }

  function sortByForDiscover(media: MediaType) {
    if (sort === "popularity") return "popularity.desc";
    if (sort === "rating") return "vote_average.desc";
    return media === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
  }

  function parseNum(s: string, fallback: number) {
    const n = Number(s);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeResults(arr: any[], forcedType?: MediaType): Item[] {
    return (arr ?? [])
      .filter((x) => (forcedType ? true : x?.media_type === "movie" || x?.media_type === "tv"))
      .map((x) => {
        const mt: MediaType = forcedType ?? x.media_type;
        const title = mt === "tv" ? (x?.name ?? x?.original_name ?? "") : (x?.title ?? x?.original_title ?? "");
        const date = mt === "tv" ? x?.first_air_date : x?.release_date;
        return {
          id: x?.id,
          media_type: mt,
          title,
          year: formatYearFromDate(date),
          poster_path: x?.poster_path ?? null,
          overview: x?.overview ?? null,
          vote_average: typeof x?.vote_average === "number" ? x.vote_average : null,
          vote_count: typeof x?.vote_count === "number" ? x.vote_count : null,
          genre_ids: Array.isArray(x?.genre_ids) ? x.genre_ids : [],
        } as Item;
      })
      .filter((x) => x.id && x.title);
  }

  function applyClientFilters(list: Item[]) {
    const y = year ? parseInt(year, 10) : null;
    const minR = minRating ? parseNum(minRating, 0) : null;
    const minV = minVotes ? parseNum(minVotes, 0) : null;

    const gm = genreMovie ? parseInt(genreMovie, 10) : null;
    const gt = genreTv ? parseInt(genreTv, 10) : null;

    return list.filter((x) => {
      if (type !== "all" && x.media_type !== type) return false;
      if (y && x.year && parseInt(x.year, 10) !== y) return false;
      if (minR != null && (x.vote_average ?? 0) < minR) return false;
      if (minV != null && (x.vote_count ?? 0) < minV) return false;

      if (x.media_type === "movie" && gm && !x.genre_ids.includes(gm)) return false;
      if (x.media_type === "tv" && gt && !x.genre_ids.includes(gt)) return false;

      return true;
    });
  }

  async function runSearch(nextPage: number, append: boolean) {
    setLoading(true);
    setErr(null);

    try {
      const query = q.trim();
      let merged: Item[] = [];
      let totalPages = 1;

      if (query) {
        const data = await tmdb("search/multi", {
          query,
          language: "tr-TR",
          include_adult: "false",
          page: nextPage,
        });

        const norm = normalizeResults(data?.results ?? []);
        merged = applyClientFilters(norm);
        totalPages = data?.total_pages ?? 1;
      } else {
        // discover (query boşsa filtreyle keşfet)
        const minR = minRating ? clamp(parseNum(minRating, 0), 0, 10) : null;
        const minV = minVotes ? Math.max(0, parseNum(minVotes, 0)) : null;

        const wantMovie = type === "all" || type === "movie";
        const wantTv = type === "all" || type === "tv";

        const common = { language: "tr-TR", include_adult: "false", page: nextPage };

        const calls: Promise<any>[] = [];
        if (wantMovie) {
          calls.push(
            tmdb("discover/movie", {
              ...common,
              sort_by: sortByForDiscover("movie"),
              "vote_average.gte": minR ?? undefined,
              "vote_count.gte": minV ?? undefined,
              primary_release_year: year || undefined,
              with_genres: genreMovie || undefined,
            })
          );
        } else calls.push(Promise.resolve(null));

        if (wantTv) {
          calls.push(
            tmdb("discover/tv", {
              ...common,
              sort_by: sortByForDiscover("tv"),
              "vote_average.gte": minR ?? undefined,
              "vote_count.gte": minV ?? undefined,
              first_air_date_year: year || undefined,
              with_genres: genreTv || undefined,
            })
          );
        } else calls.push(Promise.resolve(null));

        const [m, t] = await Promise.all(calls);

        const mItems = m ? normalizeResults(m?.results ?? [], "movie") : [];
        const tItems = t ? normalizeResults(t?.results ?? [], "tv") : [];

        merged = applyClientFilters([...mItems, ...tItems]);

        const mPages = m?.total_pages ?? 1;
        const tPages = t?.total_pages ?? 1;
        totalPages = Math.max(mPages, tPages);
      }

      // dedupe
      const seen = new Set<string>();
      const uniq: Item[] = [];
      for (const x of merged) {
        const k = `${x.media_type}:${x.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        uniq.push(x);
      }

      setItems((prev) => (append ? [...prev, ...uniq] : uniq));
      setPage(nextPage);
      setHasMore(nextPage < totalPages);
    } catch (e: any) {
      setErr(e?.message ?? "Hata");
    } finally {
      setLoading(false);
    }
  }

  // infinite scroll sentinel (sadece arama yaptıktan sonra)
  const { ref: sentinelRef, inView } = useInView<HTMLDivElement>();
  useEffect(() => {
    if (!hasSearched) return;
    if (restoringRef.current) return;
    if (!inView) return;
    if (loading) return;
    if (!hasMore) return;
    runSearch(page + 1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView]);

  function Card({ x }: { x: Item }) {
    const cacheKey = `${x.media_type}:${x.id}`;
    const cached = imdbCache[cacheKey];

    const { ref, inView: cardInView } = useInView<HTMLDivElement>();

    useEffect(() => {
      let cancelled = false;
      if (!cardInView) return;
      if (cached) return;

      (async () => {
        try {
          const data = await imdbInfo(x.media_type, x.id);
          if (cancelled) return;
          setImdbCache((prev) => ({ ...prev, [cacheKey]: data }));
        } catch {
          if (cancelled) return;
          setImdbCache((prev) => ({ ...prev, [cacheKey]: { error: true } }));
        }
      })();

      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cardInView, cacheKey]);

    const poster = buildPoster(x.poster_path);
    const detailFrom = `${window.location.pathname}${window.location.search}`;
    const detailHref = `/${x.media_type}/${x.id}?from=${encodeURIComponent(detailFrom)}`;

    const imdbRating = cached?.imdbRating ?? null;
    const imdbVotes = cached?.imdbVotes ?? null;

    const src = cached?.sources ?? {};
    const mdblist = cached?.mdblist ?? null;
    const taUrl = cached?.turkceAltyaziUrl ?? null;

    return (
      <div
        ref={ref}
        className="rounded-lg border border-zinc-200 p-3"
        style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12 }}
      >
        <div>
          <Link href={detailHref} onClick={saveSnapshot}>
            {poster ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={poster} alt={x.title} style={{ width: "120px", borderRadius: 10, display: "block" }} />
            ) : (
              <div style={{ width: 120, aspectRatio: "2/3", background: "#eee", borderRadius: 10 }} />
            )}
          </Link>

          {/* Linkler poster altı */}
          <div className="mt-2 space-y-1 text-xs">
            {taUrl ? (
              <div>
                TürkçeAltyazı:{" "}
                <a className="underline" href={taUrl} target="_blank" rel="noreferrer">
                  link
                </a>
              </div>
            ) : null}

            {mdblist?.url ? (
              <div>
                MDBList:{" "}
                <a className="underline" href={mdblist.url} target="_blank" rel="noreferrer">
                  link
                </a>
              </div>
            ) : null}
          </div>
        </div>

        <div>
          {/* Title + Film/Dizi yan yana */}
          <div className="flex items-start justify-between gap-2">
            <Link href={detailHref} onClick={saveSnapshot} className="no-underline">
              <h2 className="text-base font-semibold leading-snug" style={{ margin: 0 }}>
                {x.title}
              </h2>
            </Link>

            <span className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-xs text-white">
              {turkceTitle(x)}
            </span>
          </div>

          <div className="mt-1 text-xs text-zinc-600">
            {x.year ?? "-"} • TMDB: {x.vote_average != null ? x.vote_average.toFixed(1) : "-"}{" "}
            {x.vote_count != null ? `(${x.vote_count})` : ""}
          </div>

          {/* Rating layout */}
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {ratingCell("IMDb", imdbRating, imdbVotes)}
              {ratingCell("TMDB", x.vote_average != null ? x.vote_average.toFixed(1) : null, x.vote_count)}
            </div>

            <div className="grid grid-cols-2 gap-2">
              {ratingCell("Trakt", src?.trakt?.rating ?? null, src?.trakt?.votes ?? null)}
              {ratingCell("Tomatoes", src?.tomatoes?.rating ?? null, src?.tomatoes?.votes ?? null)}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {ratingCell("MDBList", src?.mdblist?.rating ?? null, src?.mdblist?.votes ?? null)}
              {ratingCell("Popcorn", src?.popcorn?.rating ?? null, src?.popcorn?.votes ?? null)}
              {ratingCell("Metacritic", src?.metacritic?.rating ?? null, src?.metacritic?.votes ?? null)}
            </div>
          </div>

          {x.overview ? (
            <p className="mt-2 text-sm text-zinc-700" style={{ marginBottom: 0 }}>
              {x.overview.length > 220 ? x.overview.slice(0, 220) + "…" : x.overview}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>Movie / TV Search</h1>

      {/* Filtreler */}
      <div
        className="rounded-lg border border-zinc-200 p-3"
        style={{ display: "grid", gridTemplateColumns: "1fr 160px 120px 140px 140px 1fr", gap: 10 }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="İsim (opsiyonel)"
          className="rounded border border-zinc-300 px-3 py-2"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (loading) return;
              setHasSearched(true);
              setItems([]);
              setPage(1);
              setHasMore(false);
              runSearch(1, false);
            }
          }}
        />

        <select value={type} onChange={(e) => setType(e.target.value as any)} className="rounded border border-zinc-300 px-3 py-2">
          <option value="all">Hepsi</option>
          <option value="movie">Film</option>
          <option value="tv">Dizi</option>
        </select>

        <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="Yıl" className="rounded border border-zinc-300 px-3 py-2" />
        <input value={minRating} onChange={(e) => setMinRating(e.target.value)} placeholder="Min puan" className="rounded border border-zinc-300 px-3 py-2" />
        <input value={minVotes} onChange={(e) => setMinVotes(e.target.value)} placeholder="Min oy" className="rounded border border-zinc-300 px-3 py-2" />

        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded border border-zinc-300 px-3 py-2">
          <option value="popularity">Sırala: Popülerlik</option>
          <option value="rating">Sırala: Puan</option>
          <option value="date">Sırala: Çıkış tarihi</option>
        </select>

        <select value={genreMovie} onChange={(e) => setGenreMovie(e.target.value)} className="rounded border border-zinc-300 px-3 py-2" style={{ gridColumn: "1 / span 3" }}>
          <option value="">Film türü (opsiyonel)</option>
          {movieGenres.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        <select value={genreTv} onChange={(e) => setGenreTv(e.target.value)} className="rounded border border-zinc-300 px-3 py-2" style={{ gridColumn: "4 / span 3" }}>
          <option value="">Dizi türü (opsiyonel)</option>
          {tvGenres.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        <button
          onClick={() => {
            if (loading) return;
            setHasSearched(true);
            setItems([]);
            setPage(1);
            setHasMore(false);
            runSearch(1, false);
          }}
          className="rounded bg-black px-3 py-2 text-white"
          style={{ gridColumn: "1 / span 6" }}
        >
          Ara
        </button>
      </div>

      {err ? <div style={{ color: "crimson", marginTop: 12 }}>{err}</div> : null}

      {/* İlk açılışta boş */}
      {!hasSearched && items.length === 0 ? (
        <div style={{ marginTop: 16, color: "#666" }}>Arama yapmak için yukarıdan filtreleri seçip “Ara”ya bas.</div>
      ) : null}

      {loading && items.length === 0 ? <div style={{ marginTop: 12 }}>Yükleniyor…</div> : null}

      <div className="mt-4" style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        {items.map((x) => (
          <Card key={`${x.media_type}:${x.id}`} x={x} />
        ))}
      </div>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} style={{ height: 1 }} />

      {loading && items.length > 0 ? <div style={{ marginTop: 12 }}>Devamı yükleniyor…</div> : null}
      {!hasMore && hasSearched && items.length > 0 ? <div style={{ marginTop: 12, color: "#666" }}>Sonuçlar bitti.</div> : null}

      <p style={{ marginTop: 28, fontSize: 12, color: "#777" }}>
        This product uses the TMDb API but is not endorsed or certified by TMDb.
      </p>
    </div>
  );
}
