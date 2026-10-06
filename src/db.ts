// Small key-value store in IndexedDB for things that belong to this device only
// (the current Google session). Library data arrives in phase 3.

import { openDB, type IDBPDatabase } from 'idb';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB('noteable', 1, {
    upgrade(d) {
      d.createObjectStore('kv');
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
