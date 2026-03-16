param(
  [Parameter(Mandatory = $true)]
  [string]$Version
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

if ($Version -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$') {
  throw "版本号格式不正确，请使用 SemVer，例如：1.0.1"
}

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$versionFile = Join-Path $Root "VERSION"
$apiPackageJson = Join-Path $Root "apps/api/package.json"
$apiPackageLock = Join-Path $Root "apps/api/package-lock.json"
$webPackageJson = Join-Path $Root "apps/web/package.json"
$webPackageLock = Join-Path $Root "apps/web/package-lock.json"

function Require-Path {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    throw "缺少文件：$Path"
  }
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "缺少命令：$Name，请先安装后再执行。"
  }
}

function Update-JsonVersion {
  param(
    [string]$Path,
    [string]$TargetVersion,
    [bool]$IsLockFile
  )

  $tempScript = Join-Path ([System.IO.Path]::GetTempPath()) ("mindwall-set-version-" + [Guid]::NewGuid().ToString("N") + ".js")
  $lockFlag = if ($IsLockFile) { "1" } else { "0" }

  $scriptContent = @'
const fs = require("fs");
const filePath = process.argv[2];
const version = process.argv[3];
const isLockFile = process.argv[4] === "1";

const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
const parsed = JSON.parse(raw);

parsed.version = version;
if (isLockFile && parsed.packages && parsed.packages[""]) {
  parsed.packages[""].version = version;
}

fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
'@

  Set-Content -Path $tempScript -Value $scriptContent -Encoding ASCII

  try {
    node $tempScript $Path $TargetVersion $lockFlag | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "更新 JSON 失败：$Path"
    }
  } finally {
    if (Test-Path $tempScript) {
      Remove-Item -Path $tempScript -Force
    }
  }
}

Require-Path $apiPackageJson
Require-Path $apiPackageLock
Require-Path $webPackageJson
Require-Path $webPackageLock
Require-Command "node"

Set-Content -Path $versionFile -Value "$Version`r`n" -Encoding UTF8
Update-JsonVersion -Path $apiPackageJson -TargetVersion $Version -IsLockFile $false
Update-JsonVersion -Path $apiPackageLock -TargetVersion $Version -IsLockFile $true
Update-JsonVersion -Path $webPackageJson -TargetVersion $Version -IsLockFile $false
Update-JsonVersion -Path $webPackageLock -TargetVersion $Version -IsLockFile $true

Write-Host "版本号已更新为：$Version"
Write-Host "已同步：VERSION、API/Web package.json、package-lock.json"
