# Stops the Noteable desktop worker and removes it from Windows startup. Your sign-in and Drive files are untouched.
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Noteable worker.lnk'
if (Test-Path $lnk) { Remove-Item $lnk; Write-Host 'Removed the startup shortcut.' } else { Write-Host 'No startup shortcut found.' }
$lock = Join-Path $env:APPDATA 'Noteable\worker.lock'
if (Test-Path $lock) {
  $workerPid = [int](Get-Content $lock)
  Get-Process -Id $workerPid -ErrorAction SilentlyContinue | Stop-Process -Force
  Get-Process -Name 'tray_windows_release' -ErrorAction SilentlyContinue | Stop-Process -Force
  Remove-Item $lock -ErrorAction SilentlyContinue
  Write-Host 'Stopped the running worker.'
}
Write-Host "To also forget the Google sign-in, delete $env:APPDATA\Noteable\token.bin"
