param(
  [string]$Branch = "main",
  [int]$WebPort = 3001
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ApiDir = Join-Path $Root "apps/api"
$WebDir = Join-Path $Root "apps/web"
$ComposeFile = Join-Path $Root "infra/docker-compose.yml"

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $Name"
  }
}

Require-Command "git"
Require-Command "docker"
Require-Command "npm"

Write-Host "[1/7] Updating code on branch: $Branch"
Set-Location $Root
git fetch origin $Branch
git checkout $Branch
git pull --ff-only origin $Branch

Write-Host "[2/7] Starting/updating infrastructure containers"
docker compose -f $ComposeFile up -d

Write-Host "[3/7] Installing API dependencies"
Set-Location $ApiDir
npm ci

Write-Host "[4/7] Running Prisma generate + migrate deploy"
npm run prisma:generate
npm run prisma:deploy

Write-Host "[5/7] Building API"
npm run build

Write-Host "[6/7] Installing and building Web"
Set-Location $WebDir
npm ci
npm run build

Write-Host "[7/7] Restarting app services"
if (Get-Command pm2 -ErrorAction SilentlyContinue) {
  pm2 describe mindwall-api | Out-Null
  if ($LASTEXITCODE -ne 0) {
    pm2 start npm --name mindwall-api --cwd $ApiDir -- run start:prod | Out-Null
  }
  pm2 restart mindwall-api --update-env | Out-Null

  pm2 describe mindwall-web | Out-Null
  if ($LASTEXITCODE -ne 0) {
    pm2 start npm --name mindwall-web --cwd $WebDir -- start -- -p $WebPort | Out-Null
  }
  pm2 restart mindwall-web --update-env | Out-Null
  pm2 save | Out-Null
  Write-Host "Deploy complete. Services restarted by pm2."
} else {
  Write-Host "pm2 not found. Code, migration and build are complete."
  Write-Host "Please restart services manually:"
  Write-Host "API: cd $ApiDir; npm run start:prod"
  Write-Host "Web: cd $WebDir; npm start -- -p $WebPort"
}
