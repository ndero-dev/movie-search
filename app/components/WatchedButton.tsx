"use client";

import { useEffect, useState } from "react";
import {
  isWatched,
  subscribeWatched,
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
    if (!Number.isInteger(numericId) || numericId <= 0) return;

    setWatched(isWatched(mediaType, numericId));

    const unsubscribe = subscribeWatched(() => {
      setWatched(isWatched(mediaType, numericId));
    });

    return unsubscribe;
  }, [mediaType, numericId]);

  function handleClick() {
    if (!Number.isInteger(numericId) || numericId <= 0) return;

    const result = toggleWatched(mediaType, numericId);
    setWatched(result.isWatched);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`mt-3 h-10 rounded-xl px-4 text-sm font-medium transition ${
        watched
          ? "bg-green-600 text-white hover:bg-green-700"
          : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
      }`}
    >
      İzledim
    </button>
  );
}