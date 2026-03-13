import { redirect } from "next/navigation";
import BackToSearchLink from "@/app/components/BackToSearchLink";

type SP = { from?: string | string[] };

async function tmdbFetch(path: string) {
  const token = process.env.TMDB_BEARER_TOKEN;
  if (!token) throw new Error("TMDB_BEARER_TOKEN missing");

  const url = `https://api.themoviedb.org/3${path}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    next: { revalidate: 3600 },
  });

  const text = await r.text().catch(() => "");
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return { ok: r.ok, status: r.status, json };
}

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

export default async function TvPage(props: {
  params: Promise<{ id: string }> | { id: string };
  searchParams: Promise<SP> | SP;
}) {
  const params = await Promise.resolve(props.params);
  const searchParams = await Promise.resolve(props.searchParams);

  const safeFrom = decodeFrom(searchParams);

  const t = await tmdbFetch(`/tv/${params.id}?language=tr-TR`);

  if (!t.ok && t.status === 404) {
    const m = await tmdbFetch(`/movie/${params.id}?language=tr-TR`);
    if (m.ok) redirect(`/movie/${params.id}?from=${encodeURIComponent(safeFrom)}`);
  }

  if (!t.ok) {
    return (
      <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
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
  const poster = tv?.poster_path ? `https://image.tmdb.org/t/p/w500${tv.poster_path}` : null;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <BackToSearchLink href={safeFrom} className="underline">
        ← Aramaya dön
      </BackToSearchLink>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 24, alignItems: "start", marginTop: 16 }}>
        <div>
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt={tv?.name ?? "poster"} style={{ width: "100%", borderRadius: 12 }} />
          ) : (
            <div style={{ width: "100%", aspectRatio: "2/3", background: "#eee", borderRadius: 12 }} />
          )}
        </div>

        <div>
          <h1 style={{ fontSize: 28, margin: 0 }}>{tv?.name}</h1>
          <div style={{ marginTop: 8, color: "#555" }}>
            Başlangıç: {tv?.first_air_date || "-"} • Sezon: {tv?.number_of_seasons ?? "-"} • Bölüm:{" "}
            {tv?.number_of_episodes ?? "-"} • ~{tv?.episode_run_time?.[0] ?? "-"} dk
          </div>
          <div style={{ marginTop: 8, color: "#555" }}>
            Türler: {Array.isArray(tv?.genres) ? tv.genres.map((g: any) => g.name).join(", ") : "-"}
          </div>
          <div style={{ marginTop: 8, color: "#555" }}>
            Puan: {tv?.vote_average?.toFixed?.(1) ?? tv?.vote_average ?? "-"} ({tv?.vote_count ?? "-"} oy)
          </div>

          {tv?.overview ? <p style={{ marginTop: 16, lineHeight: 1.6 }}>{tv.overview}</p> : null}
        </div>
      </div>

      <p style={{ marginTop: 32, fontSize: 12, color: "#777" }}>
        This product uses the TMDb API but is not endorsed or certified by TMDb.
      </p>
    </div>
  );
}
