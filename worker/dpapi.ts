// Encrypts the refresh token with Windows DPAPI (current user), through
// PowerShell, so no native module is needed. Only this Windows account on
// this PC can decrypt token.bin.

import { execFileSync } from 'node:child_process';

function ps(script: string, input: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

const LOAD = 'Add-Type -AssemblyName System.Security;';

export function protect(plain: string): string {
  return ps(
    `${LOAD} $in = [Console]::In.ReadToEnd(); $b = [Text.Encoding]::UTF8.GetBytes($in); ` +
      `[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b, $null, 'CurrentUser'))`,
    plain,
  );
}

export function unprotect(base64: string): string {
  return ps(
    `${LOAD} $in = [Console]::In.ReadToEnd().Trim(); $b = [Convert]::FromBase64String($in); ` +
      `[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser'))`,
    base64,
  );
}
