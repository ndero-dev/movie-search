export type WatchedMediaType = "movie" | "tv";
export type WatchedKey = `${WatchedMediaType}:${number}`;

const STORAGE_KEY = "movie-search:watched";

function isBrowser() {
  return typeof window !== "undefined";
}

function toKey(mediaType: WatchedMediaType, id: number): WatchedKey {
  return `${mediaType}:${id}`;
}

function read(): WatchedKey[] {
  if (!isBrowser()) return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function write(list: WatchedKey[]) {
  if (!isBrowser()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function isWatched(mediaType: WatchedMediaType, id: number) {
  return read().includes(toKey(mediaType, id));
}

export function toggleWatched(mediaType: WatchedMediaType, id: number) {
  const key = toKey(mediaType, id);
  const current = read();

  if (current.includes(key)) {
    const next = current.filter((x) => x !== key);
    write(next);
    return false;
  }

  const next = [...current, key];
  write(next);
  return true;
}