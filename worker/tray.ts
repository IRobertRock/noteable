// System tray icon: status, Pause/Resume, Sign in again, Open log, Quit.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import SysTrayModule from 'systray2';
import { WORKER_DIR } from './config';
import type { WorkerState } from './queue';

// systray2 is CommonJS; its default export arrives wrapped under ESM.
const SysTray = ((SysTrayModule as unknown as { default?: typeof SysTrayModule }).default ?? SysTrayModule) as typeof SysTrayModule;

type IconName = 'idle' | 'working' | 'paused' | 'error';
const icon = (name: IconName) => readFileSync(join(WORKER_DIR, 'icons', `${name}.ico`)).toString('base64');

export interface TrayActions {
  togglePause(): void;
  signIn(): void;
  openLog(): void;
  checkNow(): void;
  quit(): void;
}

export class Tray {
  private tray: InstanceType<typeof SysTray>;
  private readonly items = {
    status: { title: 'Starting…', tooltip: 'What the worker is doing', enabled: false },
    lastError: { title: 'No problems', tooltip: 'Last problem', enabled: false },
    checkNow: { title: 'Check the queue now', tooltip: 'Look for new jobs without waiting a minute', enabled: true },
    pause: { title: 'Pause', tooltip: 'Stop taking new jobs', enabled: true },
    signIn: { title: 'Sign in to Google again…', tooltip: 'Needed about once a week while the app is in Testing mode', enabled: true },
    openLog: { title: 'Open log', tooltip: 'Open worker.log', enabled: true },
    quit: { title: 'Quit', tooltip: 'Stop the worker (queued jobs wait)', enabled: true },
  };

  constructor(actions: TrayActions) {
    const order = [this.items.status, this.items.lastError, this.items.checkNow, this.items.pause, this.items.signIn, this.items.openLog, this.items.quit];
    this.tray = new SysTray({
      menu: { icon: icon('idle'), title: '', tooltip: 'Noteable worker', items: order },
      debug: false,
      copyDir: true,
    });
    void this.tray.onClick((e) => {
      if (e.item === this.items.pause) actions.togglePause();
      else if (e.item === this.items.signIn) actions.signIn();
      else if (e.item === this.items.openLog) actions.openLog();
      else if (e.item === this.items.checkNow) actions.checkNow();
      else if (e.item === this.items.quit) actions.quit();
    });
  }

  ready(): Promise<void> {
    return this.tray.ready();
  }

  show(state: WorkerState, paused: boolean, lastError?: string): void {
    const [name, status, tip]: [IconName, string, string] =
      state.kind === 'working'
        ? ['working', `Working: ${state.detail}`, `Noteable worker: ${state.job.itemPath.split('/').pop()} — ${state.detail}`]
        : state.kind === 'signed-out'
          ? ['error', 'Needs Google sign-in', 'Noteable worker: sign in to Google again (tray menu)']
          : paused
            ? ['paused', 'Paused', 'Noteable worker: paused']
            : state.kind === 'error'
              ? ['error', 'Idle (last job failed)', `Noteable worker: last job failed — ${state.message}`]
              : ['idle', 'Idle: waiting for jobs', 'Noteable worker: idle'];
    this.items.status.title = status;
    this.items.pause.title = paused ? 'Resume' : 'Pause';
    this.items.lastError.title = lastError ? `Last problem: ${lastError.slice(0, 80)}` : 'No problems';
    void this.tray.sendAction({ type: 'update-menu', menu: { icon: icon(name), title: '', tooltip: tip.slice(0, 120), items: Object.values(this.items) } });
  }

  async kill(): Promise<void> {
    await this.tray.kill(false);
  }
}
