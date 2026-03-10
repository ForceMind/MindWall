param(
  [switch]$SkipInstall,
  [switch]$SkipMigrate,
  [switch]$NoDocker
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ApiDir = Join-Path $Root "apps/api"
$WebDir = Join-Path $Root "apps/web"
$ComposeFile = Join-Path $Root "infra/docker-compose.yml"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $Name. Please install it and add it to PATH."
  }
}

Require-Command "npm"

if (-not $NoDocker) {
  Require-Command "docker"
  Write-Host "[1/5] Starting PostgreSQL + Redis..."
  docker compose -f $ComposeFile up -d
}

if (-not $SkipInstall) {
  Write-Host "[2/5] Installing API dependencies..."
  Push-Location $ApiDir
  npm install
  Pop-Location

  Write-Host "[3/5] Installing Web dependencies..."
  Push-Location $WebDir
  npm install
  Pop-Location
}

Write-Host "[4/5] Generating Prisma client and applying migrations..."
Push-Location $ApiDir
npm run prisma:generate
if (-not $SkipMigrate) {
  npm run prisma:deploy
}
Pop-Location

Write-Host "[5/5] Starting dev servers..."
$ApiCommand = "Set-Location '$ApiDir'; npm run start:dev"
$WebCommand = "Set-Location '$WebDir'; npm run dev -- -p 3001"

Start-Process powershell -ArgumentList "-NoExit", "-Command", $ApiCommand | Out-Null
Start-Process powershell -ArgumentList "-NoExit", "-Command", $WebCommand | Out-Null

Write-Host "Done:"
Write-Host "- API: http://localhost:3000"
Write-Host "- Web: http://localhost:3001"
