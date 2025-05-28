export function addToKeyedSet<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  if (!map.has(key)) {
    map.set(key, new Set());
  }
  map.get(key)!.add(value);
}

export function addToKeyedMap<K, KItem, VItem>(
  map: Map<K, Map<KItem, VItem>>,
  key: K,
  kv: [KItem, VItem],
) {
  if (!map.has(key)) {
    map.set(key, new Map());
  }
  map.get(key)!.set(...kv);
}
