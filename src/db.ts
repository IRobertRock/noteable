// IndexedDB for things that belong to this device only:
//   kv        the Google session and local copies of playback/bookmark state
//   pending   finished MP3s waiting to upload to Drive
//   items     the library index (item.json + its Drive path), for offline browsing
//   texts     chapter text of downloaded items

import { openDB, type IDBPDatabase } from 'idb';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB('noteable', 3, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) d.createObjectStore('kv');
      if (oldVersion < 2) d.createObjectStore('pending');
      if (oldVersion < 3) {
        d.createObjectStore('items');
        d.createObjectStore('texts');
      }
    },
  });
  return dbPromise;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db()).get('kv', key) as Promise<T | undefined>;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', value, key);
}

export async function kvDelete(key: string): Promise<void> {
  await (await db()).delete('kv', key);
}

export async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return (await db()).get(store, key) as Promise<T | undefined>;
}

export async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  await (await db()).put(store, value, key);
}

export async function idbDelete(store: string, key: string): Promise<void> {
  await (await db()).delete(store, key);
}

export async function idbAll<T>(store: string): Promise<T[]> {
  return (await (await db()).getAll(store)) as T[];
}

export async function idbClear(store: string): Promise<void> {
  await (await db()).clear(store);
}

export async function idbKeys(store: string): Promise<string[]> {
  return (await (await db()).getAllKeys(store)) as string[];
}
