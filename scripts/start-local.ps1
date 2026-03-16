param(
  [switch]$SkipInstall,
  [switch]$SkipMigrate,
  [switch]$NoDocker
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
  $rawUi = $Host.UI.RawUI
  if ($rawUi) {
    $rawUi.WindowTitle = "MindWall 本地启动"
  }
} catch {
}

trap {
  Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ApiDir = Join-Path $Root "apps/api"
$WebDir = Join-Path $Root "apps/web"
$ComposeFile = Join-Path $Root "infra/docker-compose.yml"
$VersionFile = Join-Path $Root "VERSION"
$ApiPort = 3100
$WebPort = 3001

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "缺少命令：$Name，请先安装并加入 PATH。"
  }
}

function Assert-LastExitCode {
  param([string]$Message)
  if ($LASTEXITCODE -ne 0) {
    throw $Message
  }
}

function Get-ProjectVersion {
  if (Test-Path $VersionFile) {
    $versionText = (Get-Content -Raw $VersionFile).Trim()
    if ($versionText -match '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') {
      return $versionText
    }
  }
  return "1.0.0"
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

  throw "$name 在 $TimeoutSeconds 秒内未就绪。"
}

function Assert-PortAvailable {
  param(
    [int]$Port,
    [string]$DisplayName
  )

  $listeners = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if ($listeners) {
    throw "$DisplayName 端口 $Port 已被占用，请先释放端口。"
  }
}

function Ensure-DockerEngine {
  try {
    docker version --format '{{.Server.Version}}' 1>$null 2>$null
  } catch {
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Docker 引擎未运行，请先启动 Docker Desktop。"
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

  throw "容器 '$ContainerName' 在 $TimeoutSeconds 秒内未就绪。"
}

Require-Command "npm"
$version = Get-ProjectVersion
Write-Host "MindWall 本地启动脚本 v$version"
Write-Host "工作目录：$Root"
Write-Host ""

if (-not $NoDocker) {
  Require-Command "docker"
  Ensure-DockerEngine
  Write-Host "[1/6] 启动 PostgreSQL + Redis"
  try {
    docker compose -f $ComposeFile up -d
  } catch {
  }
  Assert-LastExitCode "Docker 基础设施启动失败。"
  Write-Host "[2/6] 等待 PostgreSQL 就绪"
  Wait-ForDockerHealth -ContainerName "mindwall-postgres"
  Wait-ForTcpPort -HostName "localhost" -Port 5432 -DisplayName "PostgreSQL (localhost:5432)"
} else {
  Write-Host "[1/6] 已跳过 Docker 启动"
  Write-Host "[2/6] 检查 PostgreSQL 连接"
  Wait-ForTcpPort -HostName "localhost" -Port 5432 -DisplayName "PostgreSQL (localhost:5432)"
}

if (-not $SkipInstall) {
  Write-Host "[3/6] 安装 API 依赖"
  Push-Location $ApiDir
  npm install
  Assert-LastExitCode "API 依赖安装失败。"
  Pop-Location

  Write-Host "[4/6] 安装 Web 依赖"
  Push-Location $WebDir
  npm install
  Assert-LastExitCode "Web 依赖安装失败。"
  Pop-Location
} else {
  Write-Host "[3/6] 已跳过 API 依赖安装"
  Write-Host "[4/6] 已跳过 Web 依赖安装"
}

Write-Host "[5/6] 生成 Prisma Client 并执行迁移"
Push-Location $ApiDir
npm run prisma:generate
Assert-LastExitCode "Prisma Client 生成失败。"
if (-not $SkipMigrate) {
  npm run prisma:deploy
  Assert-LastExitCode "Prisma 迁移执行失败。"
}
Pop-Location

Write-Host "[6/6] 启动开发服务"
Assert-PortAvailable -Port $ApiPort -DisplayName "MindWall API"
Assert-PortAvailable -Port $WebPort -DisplayName "MindWall Web"

$ApiCommand = "Set-Location '$ApiDir'; `$env:PORT='$ApiPort'; npm run start:dev"
$WebCommand = "Set-Location '$WebDir'; `$env:VITE_API_BASE_URL='http://localhost:$ApiPort'; `$env:VITE_WS_BASE_URL='ws://localhost:$ApiPort'; npm run dev -- --port $WebPort"

Start-Process powershell -ArgumentList "-NoExit", "-Command", $ApiCommand | Out-Null
Start-Process powershell -ArgumentList "-NoExit", "-Command", $WebCommand | Out-Null

Write-Host "启动完成："
Write-Host "API：http://localhost:$ApiPort"
Write-Host "Web：http://localhost:$WebPort"
