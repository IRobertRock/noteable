# Installs the Noteable desktop worker: starts it with Windows (tray icon, no console) and starts it now.
# Run from the repo:  powershell -ExecutionPolicy Bypass -File worker\scripts\install-startup.ps1
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$vbs = Join-Path $PSScriptRoot 'start-hidden.vbs'
$envFile = Join-Path $repo 'worker\.env'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is not installed (need Node 24).' }
if (-not (Test-Path $envFile)) { throw "Missing $envFile with GOOGLE_DESKTOP_CLIENT_ID and GOOGLE_DESKTOP_CLIENT_SECRET." }
if (-not (Test-Path (Join-Path $repo 'node_modules\.bin\tsx.cmd'))) {
  Write-Host 'Installing dependencies (npm ci)...'
  Push-Location $repo; npm ci; Pop-Location
}

$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Noteable worker.lnk'
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
$sc.TargetPath = "$env:WINDIR\System32\wscript.exe"
$sc.Arguments = "`"$vbs`""
$sc.WorkingDirectory = $repo
$sc.IconLocation = (Join-Path $repo 'public\favicon.ico')
$sc.Description = 'Noteable desktop worker'
$sc.Save()
Write-Host "Startup shortcut created: $lnk"

Start-Process -FilePath "$env:WINDIR\System32\wscript.exe" -ArgumentList "`"$vbs`"" -WorkingDirectory $repo
Write-Host 'Worker started. Look for the Noteable icon in the system tray (you may need to click ^ to see it).'
Write-Host 'First run only: a browser window opens for Google sign-in.'
