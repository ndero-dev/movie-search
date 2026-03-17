"use client";

import { useEffect, useState } from "react";
import {
  isWatched,
  toggleWatched,
  type WatchedMediaType,
} from "@/app/lib/watched";

type Props = {
  mediaType: WatchedMediaType;
  id: number | string;
};

export default function WatchedButton({ mediaType, id }: Props) {
  const numericId = Number(id);
  const [watched, setWatched] = useState(false);

  useEffect(() => {
    setWatched(isWatched(mediaType, numericId));
  }, [mediaType, numericId]);

  function handleClick() {
    const result = toggleWatched(mediaType, numericId);
    setWatched(result);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`mt-3 h-10 rounded-xl px-4 text-sm font-medium transition ${
        watched
          ? "bg-green-600 text-white"
          : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
      }`}
    >
      İzledim
    </button>
  );
}