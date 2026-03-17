"use client";

import { useEffect, useState } from "react";
import {
  isFavorite,
  subscribeFavorites,
  toggleFavorite,
  type FavoriteMediaType,
} from "@/app/lib/favorites";

type FavoriteButtonProps = {
  mediaType: FavoriteMediaType;
  id: number | string;
};

export default function FavoriteButton({ mediaType, id }: FavoriteButtonProps) {
  const numericId = Number(id);
  const [fav, setFav] = useState(false);

  useEffect(() => {
    if (!Number.isInteger(numericId) || numericId <= 0) return;
    setFav(isFavorite(mediaType, numericId));

    const unsubscribe = subscribeFavorites(() => {
      setFav(isFavorite(mediaType, numericId));
    });

    return unsubscribe;
  }, [mediaType, numericId]);

  function handleClick() {
    if (!Number.isInteger(numericId) || numericId <= 0) return;
    const result = toggleFavorite(mediaType, numericId);
    setFav(result.isFavorite);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`mt-3 h-10 rounded-xl px-4 text-sm font-medium transition ${
        fav
          ? "bg-green-600 text-white hover:bg-green-700"
          : "bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
      }`}
    >
      Favori
    </button>
  );
}