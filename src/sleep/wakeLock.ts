// Keeps the screen on while a job runs, so the page stays in the foreground
// and Android doesn't throttle it. The browser drops the lock whenever the
// page is hidden (power button, app switch), so it is re-taken on return.

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

export async function holdWakeLock(): Promise<boolean> {
  wanted = true;
  return acquire();
}

export async function releaseWakeLock(): Promise<void> {
  wanted = false;
  const s = sentinel;
  sentinel = null;
  await s?.release().catch(() => {});
}

export function wakeLockHeld(): boolean {
  return !!sentinel && !sentinel.released;
}

async function acquire(): Promise<boolean> {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return false;
  if (wakeLockHeld()) return true;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
    return true;
  } catch {
    return false;
  }
}

document.addEventListener('visibilitychange', () => {
  if (wanted && document.visibilityState === 'visible') void acquire();
});
