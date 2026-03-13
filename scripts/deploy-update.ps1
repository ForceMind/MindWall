param(
  [string]$Branch = "main",
  [int]$WebPort = 3001
)

$ErrorActionPreference = "Stop"

trap {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}

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

function Assert-LastExitCode {
  param([string]$Message)
  if ($LASTEXITCODE -ne 0) {
    throw $Message
  }
}

function Ensure-DockerEngine {
  try {
    docker version --format '{{.Server.Version}}' 1>$null 2>$null
  } catch {
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Docker engine is not running. Start Docker first, then rerun scripts/deploy-update.ps1."
  }
}

function Wait-ForDockerHealth {
  param(
    [string]$ContainerName,
    [int]$TimeoutSeconds = 120
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $status = docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $ContainerName 2>$null
    } catch {
      $status = $null
    }
    if ($LASTEXITCODE -eq 0 -and ($status -eq "healthy" -or $status -eq "running")) {
      return
    }
    Start-Sleep -Seconds 2
  }

  throw "Container '$ContainerName' did not become ready within $TimeoutSeconds seconds."
}

Require-Command "git"
Require-Command "docker"
Require-Command "npm"
Ensure-DockerEngine

Write-Host "[1/7] Updating code on branch: $Branch"
Set-Location $Root
git fetch origin $Branch
Assert-LastExitCode "git fetch failed."
git checkout $Branch
Assert-LastExitCode "git checkout failed."
git pull --ff-only origin $Branch
Assert-LastExitCode "git pull failed."

Write-Host "[2/7] Starting/updating infrastructure containers"
try {
  docker compose -f $ComposeFile up -d
} catch {
}
Assert-LastExitCode "Failed to start Docker containers. Verify Docker is running and retry."
Wait-ForDockerHealth -ContainerName "mindwall-postgres"

Write-Host "[3/7] Installing API dependencies"
Set-Location $ApiDir
npm ci
Assert-LastExitCode "API dependency installation failed."

Write-Host "[4/7] Running Prisma generate + migrate deploy"
npm run prisma:generate
Assert-LastExitCode "Prisma client generation failed."
npm run prisma:deploy
Assert-LastExitCode "Prisma migration deploy failed."

Write-Host "[5/7] Building API"
npm run build
Assert-LastExitCode "API build failed."

Write-Host "[6/7] Installing and building Web"
Set-Location $WebDir
npm ci
Assert-LastExitCode "Web dependency installation failed."
npm run build
Assert-LastExitCode "Web build failed."

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
