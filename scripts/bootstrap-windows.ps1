param(
  [string]$Repo,
  [string]$Version,
  [string]$Project,
  [string]$Prefix,
  [string]$Rulesync,
  [switch]$NoSetup,
  [switch]$NoUx,
  [switch]$NoOpenCode,
  [switch]$Force,
  [switch]$KeepLegacy,
  [switch]$SkipInstallCheck,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$InstallerArgs
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false

$ProductName = if ($env:AGENTX_PRODUCT_NAME) { $env:AGENTX_PRODUCT_NAME } else { "agentX" }
$DefaultRepo = if ($env:AGENTX_GITHUB_REPO) { $env:AGENTX_GITHUB_REPO } else { "augustocaruso/agentx" }
$ReleaseAsset = if ($env:AGENTX_RELEASE_ASSET) { $env:AGENTX_RELEASE_ASSET } else { "agentx-pack.zip" }
$StateDirName = if ($env:AGENTX_STATE_DIR) { $env:AGENTX_STATE_DIR } else { "agentx" }
$TempPrefix = if ($env:AGENTX_TEMP_PREFIX) { $env:AGENTX_TEMP_PREFIX } else { "agentx-bootstrap" }
$ZipName = if ($env:AGENTX_RELEASE_ZIP_NAME) { $env:AGENTX_RELEASE_ZIP_NAME } else { "agentx.zip" }
$LegacyBinaryName = if ($env:AGENTX_LEGACY_BINARY) { $env:AGENTX_LEGACY_BINARY } else { "ogb" }
$LegacyPackageName = if ($env:AGENTX_LEGACY_PACKAGE) { $env:AGENTX_LEGACY_PACKAGE } else { "opencode-gemini-bridge" }
$LegacyStableCliDirName = if ($env:AGENTX_LEGACY_STABLE_CLI_DIR) { $env:AGENTX_LEGACY_STABLE_CLI_DIR } else { "opencode-gemini-bridge-cli" }
$Repo = if ($Repo) { $Repo } elseif ($env:OGB_GITHUB_REPO) { $env:OGB_GITHUB_REPO } else { $DefaultRepo }
$Version = if ($Version) { $Version } elseif ($env:OGB_RELEASE_VERSION) { $env:OGB_RELEASE_VERSION } else { "latest" }

function Normalize-PathArgument($Value) {
  if ($null -eq $Value) {
    return $Value
  }
  $Text = ([string]$Value).Trim()
  $Changed = $true
  while ($Changed -and $Text.Length -ge 2) {
    $Changed = $false
    $First = $Text.Substring(0, 1)
    $Last = $Text.Substring($Text.Length - 1, 1)
    if ((($First -eq '"') -and ($Last -eq '"')) -or (($First -eq "'") -and ($Last -eq "'"))) {
      $Text = $Text.Substring(1, $Text.Length - 2).Trim()
      $Changed = $true
    }
  }
  return $Text
}

function Repair-DirectoryBlocker($Dir, $Operation) {
  if (-not (Test-Path -LiteralPath $Dir)) {
    return
  }
  $Item = Get-Item -LiteralPath $Dir -Force
  if ($Item.PSIsContainer) {
    return
  }

  $Stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ss.fffZ") + "-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8)
  $BackupRoot = Join-Path $HOME ".config\$StateDirName\backups\$Operation\$Stamp\home"
  $Relative = $Dir
  if ($Relative.StartsWith($HOME, [System.StringComparison]::OrdinalIgnoreCase)) {
    $Relative = $Relative.Substring($HOME.Length).TrimStart([char[]]@("\", "/"))
  }
  $BackupPath = Join-Path $BackupRoot $Relative
  New-Item -ItemType Directory -Force (Split-Path -Parent $BackupPath) | Out-Null
  Move-Item -LiteralPath $Dir -Destination $BackupPath -Force
  New-Item -ItemType Directory -Force $Dir | Out-Null
  Write-Host "Repaired file blocking OpenCode config directory: $Dir (backup: $BackupPath)"
}

function Repair-ReadOnlyDirectory($Dir, $Operation) {
  if (-not (Test-Path -LiteralPath $Dir -PathType Container)) {
    return
  }
  $Item = Get-Item -LiteralPath $Dir -Force
  if (($Item.Attributes -band [System.IO.FileAttributes]::ReadOnly) -ne 0) {
    attrib -R $Dir
    Write-Host "Cleared read-only attribute from OpenCode config directory during ${Operation}: $Dir"
  }
}

function Remove-LegacyInstall {
  if ($KeepLegacy) {
    return
  }

  $LegacyCommand = Get-Command $LegacyBinaryName -ErrorAction SilentlyContinue | Select-Object -First 1
  $LegacyDir = Join-Path (Join-Path $HOME ".ai\opencode-pack") $LegacyStableCliDirName
  if ($LegacyCommand -or (Test-Path -LiteralPath $LegacyDir)) {
    Write-Host "Detected legacy $LegacyBinaryName install - removing before installing $ProductName."
  }

  if ($LegacyCommand -and $LegacyCommand.Source) {
    $LegacyBinDir = Split-Path -Parent $LegacyCommand.Source
    foreach ($Name in @($LegacyBinaryName, "$LegacyBinaryName.cmd", "$LegacyBinaryName.ps1") | Select-Object -Unique) {
      Remove-Item -Force (Join-Path $LegacyBinDir $Name) -ErrorAction SilentlyContinue
    }
  }
  Remove-Item -Recurse -Force $LegacyDir -ErrorAction SilentlyContinue

  $NpmCommand = Get-Command "npm.cmd" -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $NpmCommand) {
    $NpmCommand = Get-Command "npm.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
  }
  if (-not $NpmCommand) {
    $NpmCommand = Get-Command "npm" -ErrorAction SilentlyContinue | Select-Object -First 1
  }
  if ($NpmCommand) {
    & $NpmCommand.Source uninstall -g $LegacyPackageName *> $null
  }
}

$Project = Normalize-PathArgument $Project
$Prefix = Normalize-PathArgument $Prefix
Repair-DirectoryBlocker (Join-Path $HOME ".config\opencode") "bootstrap"
Repair-ReadOnlyDirectory (Join-Path $HOME ".config\opencode") "bootstrap"

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ($TempPrefix + "-" + [System.Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force $TempDir | Out-Null

try {
  if ($Version -eq "latest") {
    $ReleaseUrl = "https://github.com/$Repo/releases/latest/download/$ReleaseAsset"
  } else {
    $ReleaseUrl = "https://github.com/$Repo/releases/download/$Version/$ReleaseAsset"
  }

  $ZipPath = Join-Path $TempDir $ZipName
  $UnpackDir = Join-Path $TempDir "unpacked"

  Write-Host "Downloading $ProductName from $ReleaseUrl..."
  Invoke-WebRequest -Uri $ReleaseUrl -OutFile $ZipPath
  Expand-Archive -Path $ZipPath -DestinationPath $UnpackDir -Force

  $Installer = Get-ChildItem -Path $UnpackDir -Recurse -Filter install-windows.ps1 |
    Where-Object { $_.FullName -match "\\scripts\\install-windows\.ps1$" } |
    Select-Object -First 1

  if (-not $Installer) {
    throw "Release pack did not contain scripts/install-windows.ps1."
  }

  $InstallerParams = @{}
  if ($Project) { $InstallerParams["Project"] = $Project }
  if ($Prefix) { $InstallerParams["Prefix"] = $Prefix }
  if ($Rulesync) { $InstallerParams["Rulesync"] = $Rulesync }
  if ($NoSetup) { $InstallerParams["NoSetup"] = $true }
  if ($NoUx) { $InstallerParams["NoUx"] = $true }
  if ($NoOpenCode) { $InstallerParams["NoOpenCode"] = $true }
  if ($Force) { $InstallerParams["Force"] = $true }
  if ($KeepLegacy) { $InstallerParams["KeepLegacy"] = $true }
  if ($SkipInstallCheck) { $InstallerParams["SkipInstallCheck"] = $true }

  Remove-LegacyInstall
  if ($InstallerArgs -and $InstallerArgs.Count -gt 0) {
    & $Installer.FullName @InstallerParams @InstallerArgs
  } else {
    & $Installer.FullName @InstallerParams
  }
} finally {
  Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}
