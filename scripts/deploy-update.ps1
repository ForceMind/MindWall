param(
  [string]$Branch = "main",
  [int]$WebPort = 3001,
  [switch]$SkipGit,
  [switch]$SkipInstall,
  [switch]$SkipMigrate,
  [switch]$NoDocker
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
  $rawUi = $Host.UI.RawUI
  if ($rawUi) {
    $rawUi.WindowTitle = "MindWall 服务器部署更新"
  }
} catch {
}

trap {
  Write-Host "部署失败：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ApiDir = Join-Path $Root "apps/api"
$WebDir = Join-Path $Root "apps/web"
$ComposeFile = Join-Path $Root "infra/docker-compose.yml"
$VersionFile = Join-Path $Root "VERSION"

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

function Ensure-DockerEngine {
  try {
    docker version --format '{{.Server.Version}}' 1>$null 2>$null
  } catch {
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Docker 引擎未运行，请先启动 Docker 后重试。"
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

function Ensure-RuntimeDataDirectories {
  $apiConfigDir = Join-Path $ApiDir "config"
  $runtimeConfigFile = Join-Path $apiConfigDir "runtime-config.json"
  $runtimeConfigExample = Join-Path $apiConfigDir "runtime-config.example.json"
  $apiLogDir = Join-Path $ApiDir "logs"

  New-Item -ItemType Directory -Path $apiConfigDir -Force | Out-Null
  New-Item -ItemType Directory -Path $apiLogDir -Force | Out-Null

  if (-not (Test-Path $runtimeConfigFile)) {
    if (Test-Path $runtimeConfigExample) {
      Copy-Item -Path $runtimeConfigExample -Destination $runtimeConfigFile -Force
    } else {
      Set-Content -Path $runtimeConfigFile -Value "{`n}`n" -Encoding UTF8
    }
    Write-Host "已创建运行时配置文件：$runtimeConfigFile"
  } else {
    Write-Host "保留现有运行时配置：$runtimeConfigFile"
  }
}

$version = Get-ProjectVersion

Require-Command "npm"
if (-not $SkipGit) {
  Require-Command "git"
}
if (-not $NoDocker) {
  Require-Command "docker"
  Ensure-DockerEngine
}

Write-Host "MindWall 商业版部署脚本 v$version"
Write-Host "工作目录：$Root"
Write-Host ""

Write-Host "[1/8] 更新代码"
Set-Location $Root
if (-not $SkipGit) {
  git fetch origin $Branch
  Assert-LastExitCode "git fetch 失败。"
  git checkout $Branch
  Assert-LastExitCode "git checkout 失败。"
  git pull --ff-only origin $Branch
  Assert-LastExitCode "git pull 失败。"
} else {
  Write-Host "已跳过 Git 拉取（使用当前代码目录）。"
}

Write-Host "[2/8] 启动基础设施"
if (-not $NoDocker) {
  try {
    docker compose -f $ComposeFile up -d
  } catch {
  }
  Assert-LastExitCode "Docker 基础设施启动失败。"
  Wait-ForDockerHealth -ContainerName "mindwall-postgres"
  Write-Host "PostgreSQL 容器已就绪。"
} else {
  Write-Host "已跳过 Docker 步骤。"
}

Write-Host "[3/8] 校验运行时数据目录（不会同步本地数据）"
Ensure-RuntimeDataDirectories

if (-not $SkipInstall) {
  Write-Host "[4/8] 安装 API 依赖"
  Set-Location $ApiDir
  npm ci
  Assert-LastExitCode "API 依赖安装失败。"

  Write-Host "[5/8] 安装 Web 依赖"
  Set-Location $WebDir
  npm ci
  Assert-LastExitCode "Web 依赖安装失败。"
} else {
  Write-Host "[4/8] 已跳过 API 依赖安装"
  Write-Host "[5/8] 已跳过 Web 依赖安装"
}

Write-Host "[6/8] 生成 Prisma Client 并执行迁移"
Set-Location $ApiDir
npm run prisma:generate
Assert-LastExitCode "Prisma Client 生成失败。"
if (-not $SkipMigrate) {
  npm run prisma:deploy
  Assert-LastExitCode "Prisma 迁移执行失败。"
} else {
  Write-Host "已跳过数据库迁移。"
}

Write-Host "[7/8] 构建 API + Web"
npm run build
Assert-LastExitCode "API 构建失败。"
Set-Location $WebDir
npm run build
Assert-LastExitCode "Web 构建失败。"

Write-Host "[8/8] 重启线上进程"
if (Get-Command pm2 -ErrorAction SilentlyContinue) {
  pm2 describe mindwall-api | Out-Null
  if ($LASTEXITCODE -ne 0) {
    pm2 start npm --name mindwall-api --cwd $ApiDir -- run start:prod | Out-Null
  }
  pm2 restart mindwall-api --update-env | Out-Null

  pm2 describe mindwall-web | Out-Null
  if ($LASTEXITCODE -ne 0) {
    pm2 start npm --name mindwall-web --cwd $WebDir -- start -- --host 0.0.0.0 --port $WebPort | Out-Null
  }
  pm2 restart mindwall-web --update-env | Out-Null
  pm2 save | Out-Null

  Write-Host "部署完成：pm2 已重启服务。"
  Write-Host "Web 访问地址：http://服务器IP:$WebPort"
} else {
  Write-Host "未检测到 pm2，已完成代码更新、迁移和构建。"
  Write-Host "请手动启动："
  Write-Host "API：cd $ApiDir; npm run start:prod"
  Write-Host "Web：cd $WebDir; npm start -- --host 0.0.0.0 --port $WebPort"
}
