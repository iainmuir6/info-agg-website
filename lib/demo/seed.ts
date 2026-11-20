// Shared by any demo mode: fake values are a pure function of a stable id, so the same record renders the same way
// on every page and every load, and nothing is written back. (Same helper as pathway-hub's lib/demo/seed.ts.)

/** 32-bit FNV-1a hash of a string: stable across renders and runtimes. */
export function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function pick<T>(list: readonly T[], seed: string, salt: string): T {
  return list[hash(`${salt}:${seed}`) % list.length] as T;
}
