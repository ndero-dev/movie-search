import { NextResponse } from "next/server";

const TMDB_BASE = "https://api.themoviedb.org/3";

function getRevalidateSeconds(path: string) {
  if (
    path === "genre/movie/list" ||
    path === "genre/tv/list" ||
    path === "watch/providers/movie" ||
    path === "watch/providers/tv"
  ) {
    return 7 * 24 * 60 * 60; // 7 gün
  }

  if (
    path.startsWith("movie/") ||
    path.startsWith("tv/") ||
    path.includes("/external_ids") ||
    path.includes("/watch/providers")
  ) {
    return 24 * 60 * 60; // 1 gün
  }

  if (path.startsWith("search/") || path.startsWith("discover/")) {
    return 10 * 60; // 10 dk
  }

  return 60 * 60; // varsayılan 1 saat
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path");

  if (!path) {
    return NextResponse.json({ error: "missing path" }, { status: 400 });
  }

  const allowedPrefixes = [
    "search/",
    "movie/",
    "tv/",
    "genre/",
    "discover/",
    "watch/providers/",
  ];

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

  try {
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      next: {
        revalidate: getRevalidateSeconds(path),
      },
    });

    const data = await r.json();
    return NextResponse.json(data, { status: r.status });
  } catch (error) {
    return NextResponse.json(
      {
        error: "tmdb proxy failed",
        detail: error instanceof Error ? error.message : "unknown error",
      },
      { status: 500 }
    );
  }
}