type TvDetails = {
  id: number;
  name: string;
  overview: string;
  first_air_date?: string;
  episode_run_time?: number[];
  number_of_seasons?: number;
  genres?: { id: number; name: string }[];
  poster_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  homepage?: string | null;
};

async function tmdb(path: string) {
  const base = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
  const res = await fetch(`${base}/api/tmdb?path=${encodeURIComponent(path)}&language=tr-TR`, { cache: "no-store" });
  return { ok: res.ok, data: await res.json() };
}

export default async function TvPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { ok, data } = await tmdb(`tv/${id}`);
  if (!ok) {
    return (
      <main style={{ maxWidth: 900, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
        <a href="/">← Geri</a>
        <h1>Hata</h1>
        <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(data, null, 2)}</pre>
      </main>
    );
  }

  const t = data as TvDetails;
  const poster = t.poster_path ? `https://image.tmdb.org/t/p/w500${t.poster_path}` : null;
  const runtime = t.episode_run_time?.[0];

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <a href="/">← Aramaya dön</a>

      <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
        <div style={{ width: 220 }}>
          {poster ? (
            <img src={poster} alt={t.name} style={{ width: 220, borderRadius: 12 }} />
          ) : (
            <div style={{ width: 220, height: 330, background: "#f2f2f2", borderRadius: 12 }} />
          )}
        </div>

        <div style={{ flex: 1 }}>
          <h1 style={{ marginTop: 0 }}>{t.name}</h1>
          <div style={{ opacity: 0.8 }}>
            {t.first_air_date ? `Başlangıç: ${t.first_air_date.slice(0, 4)}` : null}
            {t.number_of_seasons ? ` • Sezon: ${t.number_of_seasons}` : null}
            {runtime ? ` • Bölüm: ~${runtime} dk` : null}
          </div>

          {t.genres?.length ? (
            <div style={{ marginTop: 10, fontSize: 14 }}>
              Türler: {t.genres.map((g) => g.name).join(", ")}
            </div>
          ) : null}

          <div style={{ marginTop: 10, fontSize: 14, opacity: 0.9 }}>
            Puan: {t.vote_average?.toFixed?.(1) ?? t.vote_average ?? "-"} ({t.vote_count ?? 0} oy)
          </div>

          {t.overview ? (
            <p style={{ marginTop: 14, lineHeight: 1.5 }}>{t.overview}</p>
          ) : (
            <p style={{ marginTop: 14, opacity: 0.7 }}>Özet bilgisi yok.</p>
          )}

          {t.homepage ? (
            <p>
              Resmi site: <a href={t.homepage} target="_blank" rel="noreferrer">{t.homepage}</a>
            </p>
          ) : null}
        </div>
      </div>

      <footer style={{ marginTop: 40, fontSize: 12, opacity: 0.7 }}>
        This product uses the TMDb API but is not endorsed or certified by TMDb.
      </footer>
    </main>
  );
}