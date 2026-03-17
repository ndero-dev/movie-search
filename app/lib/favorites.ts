export type FavoriteMediaType = "movie" | "tv";

export type FavoriteKey = `${FavoriteMediaType}:${number}`;

const FAVORITES_STORAGE_KEY = "movie-search:favorites";

function isBrowser() {
  return typeof window !== "undefined";
}

function isValidMediaType(value: unknown): value is FavoriteMediaType {
  return value === "movie" || value === "tv";
}

function toFavoriteKey(mediaType: FavoriteMediaType, id: number): FavoriteKey {
  return `${mediaType}:${id}`;
}

function parseFavoriteKey(value: string): { mediaType: FavoriteMediaType; id: number } | null {
  const [mediaType, rawId] = value.split(":");

  if (!isValidMediaType(mediaType)) return null;

  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return null;

  return { mediaType, id };
}

function normalizeFavoriteList(list: unknown): FavoriteKey[] {
  if (!Array.isArray(list)) return [];

  const unique = new Set<FavoriteKey>();

  for (const item of list) {
    if (typeof item !== "string") continue;

    const parsed = parseFavoriteKey(item);
    if (!parsed) continue;

    unique.add(toFavoriteKey(parsed.mediaType, parsed.id));
  }

  return Array.from(unique);
}

function readFavorites(): FavoriteKey[] {
  if (!isBrowser()) return [];

  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return normalizeFavoriteList(parsed);
  } catch {
    return [];
  }
}

function writeFavorites(list: FavoriteKey[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(normalizeFavoriteList(list)));
}

export function getFavorites(): FavoriteKey[] {
  return readFavorites();
}

export function getFavoriteCount(): number {
  return readFavorites().length;
}

export function clearFavorites() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(FAVORITES_STORAGE_KEY);
}

export function isFavorite(mediaType: FavoriteMediaType, id: number): boolean {
  const key = toFavoriteKey(mediaType, id);
  return readFavorites().includes(key);
}

export function addFavorite(mediaType: FavoriteMediaType, id: number): FavoriteKey[] {
  const current = readFavorites();
  const key = toFavoriteKey(mediaType, id);

  if (current.includes(key)) return current;

  const next = [...current, key];
  writeFavorites(next);
  return next;
}

export function removeFavorite(mediaType: FavoriteMediaType, id: number): FavoriteKey[] {
  const key = toFavoriteKey(mediaType, id);
  const next = readFavorites().filter((item) => item !== key);
  writeFavorites(next);
  return next;
}

export function toggleFavorite(mediaType: FavoriteMediaType, id: number): {
  isFavorite: boolean;
  favorites: FavoriteKey[];
} {
  const key = toFavoriteKey(mediaType, id);
  const current = readFavorites();

  if (current.includes(key)) {
    const next = current.filter((item) => item !== key);
    writeFavorites(next);
    return {
      isFavorite: false,
      favorites: next,
    };
  }

  const next = [...current, key];
  writeFavorites(next);

  return {
    isFavorite: true,
    favorites: next,
  };
}

export function subscribeFavorites(callback: () => void) {
  if (!isBrowser()) {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === FAVORITES_STORAGE_KEY) {
      callback();
    }
  };

  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener("storage", onStorage);
  };
}