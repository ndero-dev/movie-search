type MovieDetails = {
  id: number;
  title: string;
  overview: string;
  release_date?: string;
  runtime?: number;
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

export default async function MoviePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { ok, data } = await tmdb(`movie/${id}`);
  if (!ok) {
    return (
      <main style={{ maxWidth: 900, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
        <a href="/">← Geri</a>
        <h1>Hata</h1>
        <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(data, null, 2)}</pre>
      </main>
    );
  }

  const m = data as MovieDetails;
  const poster = m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null;

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <a href="/">← Aramaya dön</a>

      <div style={{ display: "flex", gap: 16, marginTop: 16 }}>
        <div style={{ width: 220 }}>
          {poster ? (
            <img src={poster} alt={m.title} style={{ width: 220, borderRadius: 12 }} />
          ) : (
            <div style={{ width: 220, height: 330, background: "#f2f2f2", borderRadius: 12 }} />
          )}
        </div>

        <div style={{ flex: 1 }}>
          <h1 style={{ marginTop: 0 }}>{m.title}</h1>
          <div style={{ opacity: 0.8 }}>
            {m.release_date ? `Yıl: ${m.release_date.slice(0, 4)}` : null}
            {m.runtime ? ` • Süre: ${m.runtime} dk` : null}
          </div>

          {m.genres?.length ? (
            <div style={{ marginTop: 10, fontSize: 14 }}>
              Türler: {m.genres.map((g) => g.name).join(", ")}
            </div>
          ) : null}

          <div style={{ marginTop: 10, fontSize: 14, opacity: 0.9 }}>
            Puan: {m.vote_average?.toFixed?.(1) ?? m.vote_average ?? "-"} ({m.vote_count ?? 0} oy)
          </div>

          {m.overview ? (
            <p style={{ marginTop: 14, lineHeight: 1.5 }}>{m.overview}</p>
          ) : (
            <p style={{ marginTop: 14, opacity: 0.7 }}>Özet bilgisi yok.</p>
          )}

          {m.homepage ? (
            <p>
              Resmi site: <a href={m.homepage} target="_blank" rel="noreferrer">{m.homepage}</a>
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