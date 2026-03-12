"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type MediaFilter = "all" | "movie" | "tv";
type SortKey = "popularity" | "rating" | "date";
type GenreKey = "" | `movie:${number}` | `tv:${number}` | `both:${number}`;

type SearchItem = {
  id: number;
  media_type: "movie" | "tv" | "person";
  name?: string;
  title?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;

  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
};

type DiscoverItem = Omit<SearchItem, "media_type"> & { media_type?: never };
type Genre = { id: number; name: string };

type ImdbInfo = {
  imdb_id: string | null;
  imdbRating: string | null;
  imdbVotes: number | null;
  mdblist: { id: string | null; type: "movie" | "show" } | null;
};

function yearFrom(date?: string) {
  if (!date) return undefined;
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) ? y : undefined;
}

function formatRating(v?: number) {
  if (typeof v !== "number") return "-";
  return v.toFixed(1);
}

function formatNumberTR(n: number) {
  return new Intl.NumberFormat("tr-TR").format(n);
}

function uniqBy<T>(arr: T[], keyFn: (x: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}

function parseGenreKey(k: GenreKey): { scope: "movie" | "tv" | "both" | null; id: number | null } {
  if (!k) return { scope: null, id: null };
  const [scope, idStr] = k.split(":");
  const id = Number(idStr);
  if (!Number.isFinite(id)) return { scope: null, id: null };
  if (scope === "movie" || scope === "tv" || scope === "both") return { scope, id };
  return { scope: null, id: null };
}

function toTimeMs(item: SearchItem) {
  const d = item.media_type === "movie" ? item.release_date : item.first_air_date;
  if (!d) return 0;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : 0;
}

function sortClient(list: SearchItem[], sortKey: SortKey) {
  const arr = list.slice();
  arr.sort((a, b) => {
    if (sortKey === "popularity") return (b.popularity ?? 0) - (a.popularity ?? 0);
    if (sortKey === "rating") {
      const diff = (b.vote_average ?? 0) - (a.vote_average ?? 0);
      if (diff !== 0) return diff;
      return (b.vote_count ?? 0) - (a.vote_count ?? 0);
    }
    return toTimeMs(b) - toTimeMs(a);
  });
  return arr;
}

function discoverSortBy(sortKey: SortKey, mediaType: "movie" | "tv") {
  if (sortKey === "popularity") return "popularity.desc";
  if (sortKey === "rating") return "vote_average.desc";
  return mediaType === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
}

function useInView<T extends Element>(rootMargin = "700px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first) return;
        if (first.isIntersecting) setInView(true);
      },
      { rootMargin }
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [rootMargin]);

  return { ref, inView } as const;
}

// TürkçeAltyazı: ttXXXXXXX -> https://turkcealtyazi.org/mov/XXXXXXX/
function turkceAltyaziUrlFromImdbId(imdbId: string | null) {
  if (!imdbId) return null;
  if (!/^tt\d+$/.test(imdbId)) return null;
  const num = imdbId.replace(/^tt/, "");
  return `https://turkcealtyazi.org/mov/${num}/`;
}

function formatImdbLine(imdb: ImdbInfo | "loading" | undefined) {
  if (imdb === "loading") return "IMDb: yükleniyor…";
  if (!imdb) return "IMDb: -";

  const r = imdb.imdbRating;
  const v = imdb.imdbVotes;

  if (r && typeof v === "number") return `IMDb: ${r} (${formatNumberTR(v)} oy)`;
  if (r) return `IMDb: ${r}`;
  if (typeof v === "number") return `IMDb: - (${formatNumberTR(v)} oy)`;
  return "IMDb: -";
}

// mdblist URL için title slug üret
function slugifyTitle(input: string) {
  // diacritics temizle
  const s = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  // harf/rakam dışını - yap
  const slug = s
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug;
}

/**
 * MDBList web URL:
 * https://mdblist.com/show/{id}-{slug}
 * https://mdblist.com/movie/{id}-{slug}
 * slug boş kalırsa fallback: /show/{id} veya /movie/{id}
 */
function mdblistWebUrl(mdblist: ImdbInfo["mdblist"], title: string) {
  const id = mdblist?.id;
  const type = mdblist?.type;
  if (!id || !type) return null;

  const slug = slugifyTitle(title);
  const base = type === "show" ? "https://mdblist.com/show" : "https://mdblist.com/movie";

  if (slug) return `${base}/${id}-${slug}`;
  return `${base}/${id}`;
}

export default function HomePage() {
  const [q, setQ] = useState("");

  const [media, setMedia] = useState<MediaFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("popularity");
  const [year, setYear] = useState<string>("");
  const [minRating, setMinRating] = useState<string>("");
  const [minVotes, setMinVotes] = useState<string>("500");
  const [genreKey, setGenreKey] = useState<GenreKey>("");

  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [totalResults, setTotalResults] = useState<number | null>(null);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeQueryKey, setActiveQueryKey] = useState<string | null>(null);

  const [imdbCache, setImdbCache] = useState<Record<string, ImdbInfo | "loading">>({});

  const [movieGenres, setMovieGenres] = useState<Genre[]>([]);
  const [tvGenres, setTvGenres] = useState<Genre[]>([]);

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadGenres() {
      try {
        const [movieRes, tvRes] = await Promise.all([
          fetch(`/api/tmdb?path=genre/movie/list&language=tr-TR`),
          fetch(`/api/tmdb?path=genre/tv/list&language=tr-TR`),
        ]);
        const movieData = await movieRes.json();
        const tvData = await tvRes.json();
        if (!cancelled) {
          setMovieGenres(movieData?.genres ?? []);
          setTvGenres(tvData?.genres ?? []);
        }
      } catch {}
    }
    loadGenres();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const { scope } = parseGenreKey(genreKey);
    if (!scope) return;
    if (media === "movie" && scope === "tv") setGenreKey("");
    if (media === "tv" && scope === "movie") setGenreKey("");
  }, [media, genreKey]);

  const genreMapMovie = useMemo(
    () => Object.fromEntries(movieGenres.map((g) => [g.id, g.name])),
    [movieGenres]
  );
  const genreMapTv = useMemo(
    () => Object.fromEntries(tvGenres.map((g) => [g.id, g.name])),
    [tvGenres]
  );

  const genreOptions = useMemo(() => {
    if (media === "movie") {
      return movieGenres
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "tr"))
        .map((g) => ({ value: `movie:${g.id}` as GenreKey, label: g.name }));
    }
    if (media === "tv") {
      return tvGenres
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, "tr"))
        .map((g) => ({ value: `tv:${g.id}` as GenreKey, label: g.name }));
    }

    const m = new Map<number, string>();
    const t = new Map<number, string>();
    for (const g of movieGenres) m.set(g.id, g.name);
    for (const g of tvGenres) t.set(g.id, g.name);

    const ids = Array.from(new Set([...m.keys(), ...t.keys()]));
    const options: { value: GenreKey; label: string }[] = [];

    for (const id of ids) {
      const nameM = m.get(id);
      const nameT = t.get(id);

      if (nameM && nameT) {
        if (nameM === nameT) options.push({ value: `both:${id}` as GenreKey, label: nameM });
        else {
          options.push({ value: `movie:${id}` as GenreKey, label: `${nameM} (Film)` });
          options.push({ value: `tv:${id}` as GenreKey, label: `${nameT} (Dizi)` });
        }
      } else if (nameM) options.push({ value: `movie:${id}` as GenreKey, label: `${nameM} (Film)` });
      else if (nameT) options.push({ value: `tv:${id}` as GenreKey, label: `${nameT} (Dizi)` });
    }

    return options.sort((a, b) => a.label.localeCompare(b.label, "tr"));
  }, [media, movieGenres, tvGenres]);

  function genreNamesFor(item: SearchItem) {
    const ids = item.genre_ids ?? [];
    const map = item.media_type === "movie" ? genreMapMovie : genreMapTv;
    return ids.map((id) => map[id]).filter(Boolean);
  }

  function applyClientFilters(list: SearchItem[]) {
    const y = year ? Number(year) : undefined;
    const r = minRating ? Number(minRating) : undefined;
    const mv = minVotes ? Number(minVotes) : undefined;
    const { scope: gScope, id: gId } = parseGenreKey(genreKey);

    return list
      .filter((x) => x.media_type === "movie" || x.media_type === "tv")
      .filter((x) => (media === "all" ? true : x.media_type === media))
      .filter((x) => {
        if (!y) return true;
        const itemYear = x.media_type === "movie" ? yearFrom(x.release_date) : yearFrom(x.first_air_date);
        return itemYear === y;
      })
      .filter((x) => {
        if (typeof r !== "number" || Number.isNaN(r)) return true;
        return (x.vote_average ?? 0) >= r;
      })
      .filter((x) => {
        if (typeof mv !== "number" || Number.isNaN(mv)) return true;
        return (x.vote_count ?? 0) >= mv;
      })
      .filter((x) => {
        if (!gScope || !gId) return true;
        const ids = x.genre_ids ?? [];
        if (gScope === "movie") return x.media_type === "movie" && ids.includes(gId);
        if (gScope === "tv") return x.media_type === "tv" && ids.includes(gId);
        return ids.includes(gId);
      });
  }

  function buildQueryKey() {
    return JSON.stringify({
      q: q.trim(),
      media,
      sortKey,
      year: year.trim(),
      minRating: minRating.trim(),
      minVotes: minVotes.trim(),
      genreKey,
    });
  }

  async function searchByName(p: number) {
    const query = q.trim();
    const res = await fetch(
      `/api/tmdb?path=search/multi&query=${encodeURIComponent(query)}&page=${p}&language=tr-TR&include_adult=false`
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.status_message ?? "Arama hatası");
    setTotalPages(data?.total_pages ?? null);
    setTotalResults(data?.total_results ?? null);
    return (data?.results ?? []) as SearchItem[];
  }

  async function discover(p: number) {
    const y = year ? Number(year) : undefined;
    const r = minRating ? Number(minRating) : undefined;
    const mv = minVotes ? Number(minVotes) : undefined;
    const { scope: gScope, id: gId } = parseGenreKey(genreKey);

    const commonMovie = new URLSearchParams({
      language: "tr-TR",
      include_adult: "false",
      sort_by: discoverSortBy(sortKey, "movie"),
      page: String(p),
    });

    const commonTv = new URLSearchParams({
      language: "tr-TR",
      include_adult: "false",
      sort_by: discoverSortBy(sortKey, "tv"),
      page: String(p),
    });

    if (typeof r === "number" && !Number.isNaN(r)) {
      commonMovie.set("vote_average.gte", String(r));
      commonTv.set("vote_average.gte", String(r));
    }
    if (typeof mv === "number" && !Number.isNaN(mv)) {
      commonMovie.set("vote_count.gte", String(mv));
      commonTv.set("vote_count.gte", String(mv));
    }
    if (typeof y === "number" && !Number.isNaN(y)) {
      commonMovie.set("primary_release_year", String(y));
      commonTv.set("first_air_date_year", String(y));
    }

    if (gScope && gId) {
      if (gScope === "both") {
        commonMovie.set("with_genres", String(gId));
        commonTv.set("with_genres", String(gId));
      } else if (gScope === "movie") {
        commonMovie.set("with_genres", String(gId));
      } else if (gScope === "tv") {
        commonTv.set("with_genres", String(gId));
      }
    }

    const tasks: Promise<{ items: SearchItem[]; total_pages: number; total_results: number }>[] = [];

    if ((media === "all" || media === "movie") && gScope !== "tv") {
      tasks.push(
        fetch(`/api/tmdb?path=discover/movie&${commonMovie.toString()}`)
          .then(async (r) => ({ ok: r.ok, d: await r.json() }))
          .then(({ ok, d }) => {
            if (!ok) throw new Error(d?.status_message ?? "Discover movie hatası");
            const results = (d?.results ?? []) as DiscoverItem[];
            return {
              items: results.map((x) => ({ ...x, media_type: "movie" as const })),
              total_pages: d?.total_pages ?? 1,
              total_results: d?.total_results ?? 0,
            };
          })
      );
    }

    if ((media === "all" || media === "tv") && gScope !== "movie") {
      tasks.push(
        fetch(`/api/tmdb?path=discover/tv&${commonTv.toString()}`)
          .then(async (r) => ({ ok: r.ok, d: await r.json() }))
          .then(({ ok, d }) => {
            if (!ok) throw new Error(d?.status_message ?? "Discover tv hatası");
            const results = (d?.results ?? []) as DiscoverItem[];
            return {
              items: results.map((x) => ({ ...x, media_type: "tv" as const })),
              total_pages: d?.total_pages ?? 1,
              total_results: d?.total_results ?? 0,
            };
          })
      );
    }

    const parts = await Promise.all(tasks);
    const mergedItems = uniqBy(parts.flatMap((p) => p.items), (x) => `${x.media_type}-${x.id}`);

    const combinedTotalResults = parts.reduce((s, p) => s + (p.total_results ?? 0), 0);
    const combinedTotalPages = Math.max(...parts.map((p) => p.total_pages ?? 1), 1);

    setTotalResults(combinedTotalResults);
    setTotalPages(combinedTotalPages);

    return mergedItems;
  }

  async function runSearch(nextPage = 1, append = false) {
    const key = buildQueryKey();
    if (append && activeQueryKey && key !== activeQueryKey) return;

    setLoading(true);
    setError(null);

    try {
      let results: SearchItem[] = [];

      if (!append) {
        setActiveQueryKey(key);
        setImdbCache({});
      }

      if (q.trim()) results = await searchByName(nextPage);
      else results = await discover(nextPage);

      results = applyClientFilters(results);

      setPage(nextPage);

      if (append) setItems((prev) => uniqBy([...prev, ...results], (x) => `${x.media_type}-${x.id}`));
      else setItems(results);
    } catch (e: any) {
      if (!append) setItems([]);
      setError(e?.message ?? "Hata");
    } finally {
      setLoading(false);
    }
  }

  const shown = useMemo(() => {
    const filtered = applyClientFilters(items);
    return sortClient(filtered, sortKey);
  }, [items, media, year, minRating, minVotes, genreKey, sortKey]);

  const hasMore = useMemo(() => {
    if (!activeQueryKey) return false;
    if (loading) return false;
    if (totalPages == null) return false;
    if (page <= 0) return false;
    return page < totalPages;
  }, [activeQueryKey, loading, totalPages, page]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        if (!hasMore) return;
        runSearch(page + 1, true);
      },
      { rootMargin: "900px" }
    );

    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, page, activeQueryKey]);

  async function ensureImdbLoaded(item: SearchItem) {
    const k = `${item.media_type}-${item.id}`;
    if (imdbCache[k]) return;

    setImdbCache((prev) => ({ ...prev, [k]: "loading" }));
    try {
      const res = await fetch(`/api/imdb?media_type=${item.media_type}&tmdb_id=${item.id}`);
      const data = (await res.json()) as ImdbInfo;
      setImdbCache((prev) => ({ ...prev, [k]: data }));
    } catch {
      setImdbCache((prev) => ({
        ...prev,
        [k]: { imdb_id: null, imdbRating: null, imdbVotes: null, mdblist: null },
      }));
    }
  }

  function Card({ x }: { x: SearchItem }) {
    const { ref, inView } = useInView<HTMLDivElement>("700px");

    useEffect(() => {
      if (!inView) return;
      ensureImdbLoaded(x);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inView, x.id, x.media_type]);

    const isMovie = x.media_type === "movie";
    const title = isMovie ? x.title ?? "" : x.name ?? "";
    const y = isMovie ? yearFrom(x.release_date) : yearFrom(x.first_air_date);
    const href = isMovie ? `/movie/${x.id}` : `/tv/${x.id}`;
    const poster = x.poster_path ? `https://image.tmdb.org/t/p/w342${x.poster_path}` : null;

    const genres = x.genre_ids?.length ? genreNamesFor(x) : [];
    const imdb = imdbCache[`${x.media_type}-${x.id}`];
    const imdbLine = formatImdbLine(imdb);

    const imdbId = imdb !== "loading" ? (imdb?.imdb_id ?? null) : null;
    const taUrl = turkceAltyaziUrlFromImdbId(imdbId);

    const mdblistUrl =
      imdb !== "loading" && imdb?.mdblist
        ? mdblistWebUrl(imdb.mdblist, title)
        : null;

    return (
      <div ref={ref} style={{ border: "1px solid #e5e5e5", borderRadius: 10, padding: 12 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ width: 90, flex: "0 0 90px" }}>
            <Link href={href} style={{ display: "block" }}>
              {poster ? (
                <img src={poster} alt={title} style={{ width: 90, borderRadius: 8, display: "block" }} />
              ) : (
                <div style={{ width: 90, height: 135, background: "#f2f2f2", borderRadius: 8 }} />
              )}
            </Link>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
              <div style={{ fontWeight: 700, lineHeight: 1.2 }}>
                {title} {y ? <span style={{ opacity: 0.7 }}>({y})</span> : null}
              </div>
            </Link>

            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.88 }}>
              {isMovie ? "Film" : "Dizi"} • TMDb: {formatRating(x.vote_average)}
              {typeof x.vote_count === "number" ? ` (${formatNumberTR(x.vote_count)})` : ""}
            </div>

            <div style={{ marginTop: 4, fontSize: 13, opacity: 0.88 }}>{imdbLine}</div>

            <div style={{ marginTop: 4, fontSize: 13, opacity: 0.88 }}>
              TürkçeAltyazı:{" "}
              {taUrl ? (
                <a href={taUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline", color: "inherit" }}>
                  link
                </a>
              ) : (
                <span style={{ opacity: 0.7 }}>-</span>
              )}
            </div>

            <div style={{ marginTop: 4, fontSize: 13, opacity: 0.88 }}>
              MDBList:{" "}
              {mdblistUrl ? (
                <a href={mdblistUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline", color: "inherit" }}>
                  link
                </a>
              ) : (
                <span style={{ opacity: 0.7 }}>-</span>
              )}
            </div>

            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
              Tür: {genres.length ? genres.slice(0, 3).join(", ") + (genres.length > 3 ? "…" : "") : "-"}
            </div>

            {x.overview ? (
              <div style={{ marginTop: 8, fontSize: 13, opacity: 0.9 }}>
                {x.overview.slice(0, 140)}
                {x.overview.length > 140 ? "..." : ""}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Aile Movie Search</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        MDBList linki: {`{mdblistId}-{titleSlug}`} formatıyla üretilir • Infinite scroll
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 16 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => (e.key === "Enter" ? runSearch(1, false) : null)}
          placeholder="İsimle ara (opsiyonel). Boş bırakıp filtreyle de arayabilirsin."
          style={{ padding: 12, fontSize: 16 }}
        />
        <button onClick={() => runSearch(1, false)} disabled={loading} style={{ padding: "12px 16px", fontSize: 16 }}>
          {loading ? "Aranıyor..." : "Ara"}
        </button>
      </div>

      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, alignItems: "end" }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Tür (Movie/TV)</span>
          <select value={media} onChange={(e) => setMedia(e.target.value as MediaFilter)} style={{ padding: 10 }}>
            <option value="all">Hepsi</option>
            <option value="movie">Film</option>
            <option value="tv">Dizi</option>
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Sırala</span>
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} style={{ padding: 10 }}>
            <option value="popularity">Popülerlik</option>
            <option value="rating">Puan (TMDb)</option>
            <option value="date">Çıkış tarihi</option>
          </select>
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Yıl</span>
          <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="örn. 2014" inputMode="numeric" style={{ padding: 10 }} />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Minimum puan (0-10)</span>
          <input value={minRating} onChange={(e) => setMinRating(e.target.value)} placeholder="örn. 7.5" inputMode="decimal" style={{ padding: 10 }} />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Minimum oy (opsiyonel)</span>
          <input value={minVotes} onChange={(e) => setMinVotes(e.target.value)} placeholder="örn. 500" inputMode="numeric" style={{ padding: 10 }} />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 12, opacity: 0.8 }}>Tür (Genre)</span>
          <select value={genreKey} onChange={(e) => setGenreKey(e.target.value as GenreKey)} style={{ padding: 10 }}>
            <option value="">(Hepsi)</option>
            {genreOptions.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div style={{ marginTop: 12, color: "crimson" }}>{error}</div>}

      <div style={{ marginTop: 10, fontSize: 13, opacity: 0.75 }}>
        Gösterilen: {shown.length}
        {typeof totalResults === "number" ? ` / ~${totalResults}` : ""}
        {typeof totalPages === "number" && page > 0 ? ` • Sayfa: ${page}/${totalPages}` : ""}
        {activeQueryKey ? "" : " • Arama yapmak için Ara'ya bas"}
      </div>

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {shown.map((x) => (
          <Card key={`${x.media_type}-${x.id}`} x={x} />
        ))}
      </div>

      <div ref={sentinelRef} style={{ height: 1 }} />
      <div style={{ marginTop: 14, fontSize: 13, opacity: 0.75 }}>
        {loading ? "Yükleniyor..." : hasMore ? "Aşağı kaydır: otomatik daha fazlası yüklenecek." : activeQueryKey ? "Bitti." : ""}
      </div>

      <footer style={{ marginTop: 40, fontSize: 12, opacity: 0.7 }}>
        This product uses the TMDb API but is not endorsed or certified by TMDb.
      </footer>
    </main>
  );
}
