export function setBoundedTtlCacheEntry<Key, Entry extends { expiresAt: number }>(
  cache: Map<Key, Entry>,
  key: Key,
  entry: Entry,
  now: number,
  maximumEntries: number,
): void {
  for (const [cachedKey, cachedEntry] of cache) {
    if (cachedEntry.expiresAt <= now) cache.delete(cachedKey);
  }
  if (!cache.has(key) && cache.size >= maximumEntries) {
    const oldestKey = cache.keys().next().value as Key | undefined;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, entry);
}
