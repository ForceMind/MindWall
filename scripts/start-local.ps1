param(
  [switch]$SkipInstall,
  [switch]$SkipMigrate,
  [switch]$NoDocker
)

$ErrorActionPreference = "Stop"
try {
  $rawUi = $Host.UI.RawUI
  if ($rawUi) {
    $rawUi.WindowTitle = "MindWall Local Start"
  }
} catch {
}

trap {
  Write-Host $_.Exception.Message -ForegroundColor Red
  exit 1
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ApiDir = Join-Path $Root "apps/api"
$WebDir = Join-Path $Root "apps/web"
$ComposeFile = Join-Path $Root "infra/docker-compose.yml"
$ApiPort = 3100
$WebPort = 3001

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command: $Name. Please install it and add it to PATH."
  }
}

function Assert-LastExitCode {
  param([string]$Message)
  if ($LASTEXITCODE -ne 0) {
    throw $Message
  }
}

function Test-TcpPort {
  param(
    [string]$HostName = "localhost",
    [int]$Port
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $async.AsyncWaitHandle.WaitOne(1000, $false)) {
      return $false
    }
    $client.EndConnect($async) | Out-Null
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Wait-ForTcpPort {
  param(
    [string]$HostName = "localhost",
    [int]$Port,
    [int]$TimeoutSeconds = 90,
    [string]$DisplayName = ""
  )

  $name = if ($DisplayName) { $DisplayName } else { "$HostName`:$Port" }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    if (Test-TcpPort -HostName $HostName -Port $Port) {
      return
    }
    Start-Sleep -Seconds 2
  }

  throw "$name did not become reachable within $TimeoutSeconds seconds."
}

function Assert-PortAvailable {
  param(
    [int]$Port,
    [string]$DisplayName
  )

  $listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if ($listeners) {
    throw "$DisplayName port $Port is already in use. Stop the conflicting service or change the port."
  }
}

function Ensure-DockerEngine {
  try {
    docker version --format '{{.Server.Version}}' 1>$null 2>$null
  } catch {
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Docker engine is not running. Start Docker Desktop first, then rerun scripts/start-local.ps1."
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

Require-Command "npm"

if (-not $NoDocker) {
  Require-Command "docker"
  Ensure-DockerEngine
  Write-Host "[1/6] Starting PostgreSQL + Redis..."
  try {
    docker compose -f $ComposeFile up -d
  } catch {
  }
  Assert-LastExitCode "Failed to start Docker containers. Verify Docker Desktop is running and retry."
  Write-Host "[2/6] Waiting for PostgreSQL to become ready..."
  Wait-ForDockerHealth -ContainerName "mindwall-postgres"
  Wait-ForTcpPort -HostName "localhost" -Port 5432 -DisplayName "PostgreSQL on localhost:5432"
} else {
  Write-Host "[1/6] Skipping Docker startup."
  Write-Host "[2/6] Checking existing PostgreSQL on localhost:5432..."
  Wait-ForTcpPort -HostName "localhost" -Port 5432 -DisplayName "PostgreSQL on localhost:5432"
}

if (-not $SkipInstall) {
  Write-Host "[3/6] Installing API dependencies..."
  Push-Location $ApiDir
  npm install
  Assert-LastExitCode "API dependency installation failed."
  Pop-Location

  Write-Host "[4/6] Installing Web dependencies..."
  Push-Location $WebDir
  npm install
  Assert-LastExitCode "Web dependency installation failed."
  Pop-Location
} else {
  Write-Host "[3/6] Skipping API dependency install."
  Write-Host "[4/6] Skipping Web dependency install."
}

Write-Host "[5/6] Generating Prisma client and applying migrations..."
Push-Location $ApiDir
npm run prisma:generate
Assert-LastExitCode "Prisma client generation failed."
if (-not $SkipMigrate) {
  npm run prisma:deploy
  Assert-LastExitCode "Prisma migration deploy failed."
}
Pop-Location

Write-Host "[6/6] Starting dev servers..."
Assert-PortAvailable -Port $ApiPort -DisplayName "MindWall API"
Assert-PortAvailable -Port $WebPort -DisplayName "MindWall Web"
$ApiCommand = "Set-Location '$ApiDir'; `$env:PORT='$ApiPort'; npm run start:dev"
$WebCommand = "Set-Location '$WebDir'; `$env:NEXT_PUBLIC_API_BASE_URL='http://localhost:$ApiPort'; `$env:NEXT_PUBLIC_WS_BASE_URL='ws://localhost:$ApiPort'; npm run dev -- -p $WebPort"

Start-Process powershell -ArgumentList "-NoExit", "-Command", $ApiCommand | Out-Null
Start-Process powershell -ArgumentList "-NoExit", "-Command", $WebCommand | Out-Null

Write-Host "Done:"
Write-Host "- API: http://localhost:$ApiPort"
Write-Host "- Web: http://localhost:$WebPort"

