// Keeps Windows from sleeping while a job runs (the display may still turn off).
// A small PowerShell process holds ES_CONTINUOUS | ES_SYSTEM_REQUIRED via
// SetThreadExecutionState; Windows drops the request when that process exits,
// and the helper exits by itself if the worker goes away.

import { spawn, type ChildProcess } from 'node:child_process';

const SCRIPT = (parentPid: number) => `
$sig = '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$k = Add-Type -MemberDefinition $sig -Name Power -Namespace NoteableAwake -PassThru
while ($true) {
  $null = $k::SetThreadExecutionState([uint32]2147483649)
  if (-not (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue)) { exit }
  Start-Sleep -Seconds 30
}
`;

export type Spawner = () => Pick<ChildProcess, 'kill' | 'on'>;

const defaultSpawner: Spawner = () =>
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', SCRIPT(process.pid)], { stdio: 'ignore', windowsHide: true });

export class KeepAwake {
  private child: Pick<ChildProcess, 'kill' | 'on'> | null = null;

  constructor(
    private readonly spawner: Spawner = defaultSpawner,
    private readonly log: (msg: string, err?: unknown) => void = () => {},
  ) {}

  get active(): boolean {
    return this.child !== null;
  }

  /** Idempotent: one helper at a time. */
  start(): void {
    if (this.child || process.platform !== 'win32' && this.spawner === defaultSpawner) return;
    try {
      const child = this.spawner();
      child.on('exit', () => {
        if (this.child === child) this.child = null;
      });
      child.on('error', (err) => {
        this.log('Could not keep the PC awake', err);
        if (this.child === child) this.child = null;
      });
      this.child = child;
      this.log('Keeping the PC awake while the job runs.');
    } catch (err) {
      this.log('Could not keep the PC awake', err);
    }
  }

  stop(): void {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    child.kill();
    this.log('PC may sleep again.');
  }
}
