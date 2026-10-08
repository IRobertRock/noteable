// A small rolling log on this device (last 300 lines), for "Report a problem".

import { kvGet, kvSet } from './db';

const KEY = 'log.lines';
const MAX = 300;
let lines: string[] = [];
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function logLine(message: string, err?: unknown): void {
  const detail = err ? ` — ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}` : '';
  lines.push(`${new Date().toISOString()} ${message}${detail}`);
  if (lines.length > MAX) lines = lines.slice(-MAX);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void kvSet(KEY, lines).catch(() => {}), 1000);
}

export async function logTail(): Promise<string[]> {
  if (!loaded) {
    const saved = (await kvGet<string[]>(KEY).catch(() => undefined)) ?? [];
    lines = [...saved, ...lines].slice(-MAX);
    loaded = true;
  }
  return [...lines];
}

/** Captures uncaught errors into the log. */
export function installErrorLogging(): void {
  window.addEventListener('error', (e) => logLine(`Error: ${e.message} at ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => logLine('Unhandled promise rejection', e.reason));
}
