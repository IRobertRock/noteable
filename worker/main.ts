// Noteable desktop worker. Generates audio for jobs sent from the phone with
// "Send to desktop". Run: npm run worker   (or via the Startup shortcut)

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createMp3Writer } from '../src/audio/mp3';
import { DriveStorage } from '../src/storage/DriveStorage';
import { DesktopAuth, SignInNeeded } from './auth';
import { CHECKPOINT_DIR, HEARTBEAT_MS, LOCK_FILE, LOG_FILE, PENDING_DIR, POLL_MS, readConfig } from './config';
import { AutoEngine } from './gpuEngine';
import { log } from './log';
import { QueueWorker } from './queue';
import { answerLogRequest, writeStatus } from './status';
import { fileCheckpoints, filePending } from './stores';
import { Tray } from './tray';

const noTray = process.argv.includes('--no-tray');
const once = process.argv.includes('--once');

function singleInstance(): void {
  if (existsSync(LOCK_FILE)) {
    const pid = Number(readFileSync(LOCK_FILE, 'utf8'));
    try {
      process.kill(pid, 0); // throws if no such process
      log(`Another worker is already running (pid ${pid}); exiting.`);
      process.exit(0);
    } catch {
      // Stale lock from a crash.
    }
  }
  writeFileSync(LOCK_FILE, String(process.pid));
  const release = () => rmSync(LOCK_FILE, { force: true });
  process.on('exit', release);
}

async function main(): Promise<void> {
  singleInstance();
  const cfg = readConfig();
  log(`Noteable worker starting as "${cfg.workerName}" (root folder: ${cfg.rootName})`);

  const auth = new DesktopAuth(cfg);
  const storage = new DriveStorage({ getToken: auth.getToken, refreshToken: auth.refreshToken, rootName: cfg.rootName });
  const engine = new AutoEngine(log);
  const worker = new QueueWorker({
    storage,
    engine,
    createWriter: createMp3Writer,
    pending: filePending(PENDING_DIR),
    checkpoints: fileCheckpoints(CHECKPOINT_DIR),
    workerName: cfg.workerName,
    heartbeatMs: HEARTBEAT_MS,
    log,
  });

  let tray: Tray | null = null;
  const refreshTray = () => tray?.show(auth.signedIn ? worker.state : { kind: 'signed-out' }, worker.paused, worker.lastError);
  auth.onChange = refreshTray;

  const signIn = () =>
    auth.signIn().then(
      () => void tick(),
      (err) => log('Sign-in did not complete', err),
    );

  // Tell the app we're here: every minute on its own timer, so it stays fresh during long jobs.
  const beat = () => (auth.signedIn ? writeStatus(storage, cfg.workerName, worker, true).catch((err) => log('Could not write worker status', err)) : Promise.resolve());
  const statusTimer = setInterval(() => void beat(), POLL_MS);
  worker.onState = (s) => {
    refreshTray();
    if (s.kind !== 'working') void beat();
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    clearTimeout(timer);
    try {
      if (!auth.signedIn) {
        refreshTray();
      } else {
        await beat();
        if (await answerLogRequest(storage, cfg.workerName).catch(() => false)) log('Wrote the log to Noteable/Logs for the app.');
        // Keep going while there is work; otherwise wait a minute.
        while ((await worker.tick()) && !worker.paused) {
          /* next job straight away */
        }
      }
    } catch (err) {
      if (err instanceof SignInNeeded) {
        log(err.message);
        refreshTray();
      } else {
        log('Queue check failed (will retry)', err);
      }
    }
    if (!once) timer = setTimeout(() => void tick(), POLL_MS);
  };

  const quit = async () => {
    log('Quitting.');
    clearTimeout(timer);
    clearInterval(statusTimer);
    await engine.close().catch(() => {});
    await tray?.kill().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void quit());
  process.on('SIGTERM', () => void quit());

  if (!noTray) {
    tray = new Tray({
      togglePause: () => {
        worker.paused = !worker.paused;
        log(worker.paused ? 'Paused.' : 'Resumed.');
        refreshTray();
        if (!worker.paused) void tick();
      },
      signIn: () => void signIn(),
      openLog: () => spawn('notepad.exe', [LOG_FILE], { detached: true, stdio: 'ignore' }).unref(),
      checkNow: () => void tick(),
      quit: () => void quit(),
    });
    await tray.ready();
    refreshTray();
  }

  if (!auth.signedIn) {
    log('Not signed in yet; opening Google sign-in.');
    await signIn();
  }
  await tick();
  if (once) await quit();
}

main().catch((err) => {
  log('Worker crashed', err);
  process.exit(1);
});
