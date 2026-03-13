"use client";

import Link from "next/link";

const RESTORE_FLAG_KEY = "movieapp:restoreNext:v1";

export default function BackToSearchLink({
  href,
  children,
  className,
}: {
  href: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        try {
          sessionStorage.setItem(RESTORE_FLAG_KEY, "1");
        } catch {}
      }}
    >
      {children ?? "← Aramaya dön"}
    </Link>
  );
}
