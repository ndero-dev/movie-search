"use client";

import Link from "next/link";
import { useMemo } from "react";

type BackToSearchLinkProps = {
  fallbackHref?: string;
};

export default function BackToSearchLink({
  fallbackHref = "/",
}: BackToSearchLinkProps) {
  const href = useMemo(() => {
    if (typeof window === "undefined") {
      return fallbackHref || "/";
    }

    try {
      const params = new URLSearchParams(window.location.search);
      const from = params.get("from");

      if (!from) return fallbackHref || "/";

      const decoded = decodeURIComponent(from);
      if (!decoded || !decoded.startsWith("/")) {
        return fallbackHref || "/";
      }

      return decoded;
    } catch {
      return fallbackHref || "/";
    }
  }, [fallbackHref]);

  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-2xl border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
    >
      ← Aramaya dön
    </Link>
  );
}