param(
  [string]$OutputDir = "release",
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

trap {
  Write-Host "发布包生成失败：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$VersionFile = Join-Path $Root "VERSION"

function Resolve-Version {
  param([string]$InputVersion)

  if ($InputVersion -and $InputVersion.Trim()) {
    $trimmed = $InputVersion.Trim()
    if ($trimmed -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') {
      throw "参数 Version 格式不正确：$trimmed"
    }
    return $trimmed
  }

  if (-not (Test-Path $VersionFile)) {
    throw "找不到 VERSION 文件：$VersionFile"
  }

  $fileVersion = (Get-Content -Raw $VersionFile).Trim()
  if ($fileVersion -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') {
    throw "VERSION 文件格式不正确：$fileVersion"
  }

  return $fileVersion
}

function Copy-RelativePath {
  param(
    [string]$BasePath,
    [string]$TargetPath,
    [string]$RelativePath
  )

  $source = Join-Path $BasePath $RelativePath
  if (-not (Test-Path $source)) {
    throw "缺少必要文件：$RelativePath"
  }

  $destination = Join-Path $TargetPath $RelativePath
  if (Test-Path $source -PathType Container) {
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    Copy-Item -Path (Join-Path $source "*") -Destination $destination -Recurse -Force
    return
  }

  $parent = Split-Path -Parent $destination
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  Copy-Item -Path $source -Destination $destination -Force
}

$projectVersion = Resolve-Version -InputVersion $Version
$releaseRoot = Join-Path $Root $OutputDir
$stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("mindwall-release-" + [Guid]::NewGuid().ToString("N"))
$stageDirName = "mindwall-v$projectVersion"
$stageDir = Join-Path $stageRoot $stageDirName
$zipName = "mindwall-v$projectVersion-minimal.zip"
$zipPath = Join-Path $releaseRoot $zipName
$shaPath = "$zipPath.sha256"

$includeList = @(
  "VERSION",
  "README.md",
  "LICENSE",
  ".env.example",
  "docs",
  "infra",
  "scripts",
  "apps/api/.env.example",
  "apps/api/package.json",
  "apps/api/package-lock.json",
  "apps/api/tsconfig.json",
  "apps/api/tsconfig.build.json",
  "apps/api/nest-cli.json",
  "apps/api/prisma.config.ts",
  "apps/api/src",
  "apps/api/prisma",
  "apps/api/scripts",
  "apps/api/config/runtime-config.example.json",
  "apps/web/.env.local.example",
  "apps/web/package.json",
  "apps/web/package-lock.json",
  "apps/web/index.html",
  "apps/web/vite.config.ts",
  "apps/web/tsconfig.json",
  "apps/web/tsconfig.app.json",
  "apps/web/tsconfig.node.json",
  "apps/web/src",
  "apps/web/public"
)

$forbiddenList = @(
  ".git",
  "apps/api/config/runtime-config.json",
  "apps/api/logs",
  "apps/api/node_modules",
  "apps/api/dist",
  "apps/web/node_modules",
  "apps/web/dist",
  "release"
)

Write-Host "开始生成 有间 最小发布包 v$projectVersion"
New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

foreach ($item in $includeList) {
  Copy-RelativePath -BasePath $Root -TargetPath $stageDir -RelativePath $item
}

foreach ($item in $forbiddenList) {
  $candidate = Join-Path $stageDir $item
  if (Test-Path $candidate) {
    Remove-Item -Path $candidate -Recurse -Force
  }
}

if (Test-Path $zipPath) {
  Remove-Item -Path $zipPath -Force
}
if (Test-Path $shaPath) {
  Remove-Item -Path $shaPath -Force
}

Compress-Archive -Path $stageDir -DestinationPath $zipPath -CompressionLevel Optimal
$hash = (Get-FileHash -Algorithm SHA256 -Path $zipPath).Hash.ToLower()
"$hash *$zipName" | Set-Content -Path $shaPath -Encoding UTF8

Write-Host "发布包已生成：$zipPath"
Write-Host "校验文件已生成：$shaPath"
Write-Host "说明：该发布包不包含本地运行时数据（API Key、日志、node_modules、dist）。"

Remove-Item -Path $stageRoot -Recurse -Force
