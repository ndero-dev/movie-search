export type WatchedMediaType = "movie" | "tv";
export type WatchedKey = `${WatchedMediaType}:${number}`;

const STORAGE_KEY = "movie-search:watched";

function isBrowser() {
  return typeof window !== "undefined";
}

function isValidMediaType(value: unknown): value is WatchedMediaType {
  return value === "movie" || value === "tv";
}

function toKey(mediaType: WatchedMediaType, id: number): WatchedKey {
  return `${mediaType}:${id}`;
}

function parseKey(value: string): { mediaType: WatchedMediaType; id: number } | null {
  const [mediaType, rawId] = value.split(":");

  if (!isValidMediaType(mediaType)) return null;

  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return null;

  return { mediaType, id };
}

function normalizeList(list: unknown): WatchedKey[] {
  if (!Array.isArray(list)) return [];

  const unique = new Set<WatchedKey>();

  for (const item of list) {
    if (typeof item !== "string") continue;

    const parsed = parseKey(item);
    if (!parsed) continue;

    unique.add(toKey(parsed.mediaType, parsed.id));
  }

  return Array.from(unique);
}

function read(): WatchedKey[] {
  if (!isBrowser()) return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return normalizeList(parsed);
  } catch {
    return [];
  }
}

function write(list: WatchedKey[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeList(list)));
}

export function getWatched(): WatchedKey[] {
  return read();
}

export function clearWatched() {
  if (!isBrowser()) return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function isWatched(mediaType: WatchedMediaType, id: number) {
  return read().includes(toKey(mediaType, id));
}

export function addWatched(mediaType: WatchedMediaType, id: number): WatchedKey[] {
  const current = read();
  const key = toKey(mediaType, id);

  if (current.includes(key)) return current;

  const next = [...current, key];
  write(next);
  return next;
}

export function removeWatched(mediaType: WatchedMediaType, id: number): WatchedKey[] {
  const key = toKey(mediaType, id);
  const next = read().filter((x) => x !== key);
  write(next);
  return next;
}

export function toggleWatched(mediaType: WatchedMediaType, id: number) {
  const key = toKey(mediaType, id);
  const current = read();

  if (current.includes(key)) {
    const next = current.filter((x) => x !== key);
    write(next);
    return {
      isWatched: false,
      watched: next,
    };
  }

  const next = [...current, key];
  write(next);

  return {
    isWatched: true,
    watched: next,
  };
}

export function subscribeWatched(callback: () => void) {
  if (!isBrowser()) {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      callback();
    }
  };

  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener("storage", onStorage);
  };
}