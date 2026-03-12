import { NextResponse } from "next/server";

const TMDB_BASE = "https://api.themoviedb.org/3";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const path = searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "missing path" }, { status: 400 });
  }

  const allowedPrefixes = ["search/", "movie/", "tv/", "genre/", "discover/"];
  if (!allowedPrefixes.some((p) => path.startsWith(p))) {
    return NextResponse.json({ error: "path not allowed" }, { status: 400 });
  }

  searchParams.delete("path");
  const qs = searchParams.toString();
  const url = `${TMDB_BASE}/${path}${qs ? `?${qs}` : ""}`;

  const token = process.env.TMDB_BEARER_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "TMDB_BEARER_TOKEN missing" }, { status: 500 });
  }

  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    next: { revalidate: 3600 },
  });

  const data = await r.json();
  return NextResponse.json(data, { status: r.status });
}
