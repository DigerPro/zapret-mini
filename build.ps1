param(
  [switch]$Mock,
  [switch]$Shots,
  [switch]$Pack,
  [switch]$Install
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Ensure-Deps {
  if (-not (Test-Path (Join-Path $root 'node_modules\electron'))) {
    Write-Host 'Installing npm dependencies...'
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
  }
}

if ($Mock) {
  Ensure-Deps
  npm run mock
  exit $LASTEXITCODE
}

if ($Shots) {
  Ensure-Deps
  npm run shots
  exit $LASTEXITCODE
}

if ($Pack) {
  Ensure-Deps
  npx electron-builder --dir
  if ($LASTEXITCODE -ne 0) { throw 'electron-builder failed.' }
  Write-Host ''
  Write-Host 'Built: release\win-unpacked\ZapretMini.exe' -ForegroundColor Green
  exit 0
}

if ($Install) {
  $src = Join-Path $root 'release\win-unpacked'
  $dst = Join-Path $env:LOCALAPPDATA 'Programs\ZapretMini'
  if (-not (Test-Path (Join-Path $src 'ZapretMini.exe'))) {
    throw 'Build not found. Run .\build.ps1 -Pack first.'
  }

  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
  if (-not $isAdmin) {
    throw 'Run PowerShell as Administrator to install.'
  }

  $old = "$dst.old"
  Write-Host 'Stopping running Zapret Mini...'
  Get-Process ZapretMini -ErrorAction SilentlyContinue | Stop-Process -Force
  for ($i = 0; $i -lt 40; $i++) {
    if (-not (Get-Process ZapretMini -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
  }

  try {
    if (Test-Path $old) { Remove-Item $old -Recurse -Force }
    if (Test-Path $dst) { Rename-Item $dst $old }
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Copy-Item (Join-Path $src '*') $dst -Recurse -Force

    $exe = Join-Path $dst 'ZapretMini.exe'
    $item = Get-Item $exe -ErrorAction Stop
    if ($item.Length -lt 100000000) { throw 'Installed exe looks wrong.' }
    Write-Host "Installed: $exe ($($item.LastWriteTime))" -ForegroundColor Green
    Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue

    Write-Host 'Starting installed app...'
    Start-Process -FilePath $exe
    Write-Host 'Installed and started.' -ForegroundColor Green
  }
  catch {
    if (Test-Path $old) {
      if (Test-Path $dst) { Remove-Item $dst -Recurse -Force -ErrorAction SilentlyContinue }
      Rename-Item $old $dst
      Write-Host 'Restored previous installation.' -ForegroundColor Yellow
    }
    throw
  }
  exit 0
}

Write-Host @'
Zapret Mini (Electron)

  .\build.ps1 -Mock      Run the mock UI without administrator rights
  .\build.ps1 -Shots     Save mock screenshots to electron\screenshots
  .\build.ps1 -Pack      Build release\win-unpacked (electron-builder --dir)
  .\build.ps1 -Install   Install to %LOCALAPPDATA%\Programs\ZapretMini and start

For real winws/WinDivert work run the installed app as administrator.
'@
