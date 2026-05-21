param(
  [string]$Project = (Get-Location).Path,
  [string]$Prefix = "",
  [string]$Rulesync = "auto",
  [switch]$NoSetup,
  [switch]$NoUx,
  [switch]$NoOpenCode,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $false
$script:NodeCommand = $null
$script:NpmCommand = $null
$ProductName = if ($env:AGENTX_PRODUCT_NAME) { $env:AGENTX_PRODUCT_NAME } else { "agentX" }
$BinaryName = if ($env:AGENTX_BINARY) { $env:AGENTX_BINARY } else { "agentx" }
$LegacyBinaryName = if ($env:AGENTX_LEGACY_BINARY) { $env:AGENTX_LEGACY_BINARY } else { "ogb" }
$PackageName = if ($env:AGENTX_PACKAGE) { $env:AGENTX_PACKAGE } else { "agentx" }
$LegacyPackageName = if ($env:AGENTX_LEGACY_PACKAGE) { $env:AGENTX_LEGACY_PACKAGE } else { "opencode-gemini-bridge" }
$StableCliDirName = if ($env:AGENTX_STABLE_CLI_DIR) { $env:AGENTX_STABLE_CLI_DIR } else { "$PackageName-cli" }
$LegacyStableCliDirName = if ($env:AGENTX_LEGACY_STABLE_CLI_DIR) { $env:AGENTX_LEGACY_STABLE_CLI_DIR } else { "opencode-gemini-bridge-cli" }
$StateDirName = if ($env:AGENTX_STATE_DIR) { $env:AGENTX_STATE_DIR } else { "agentx" }
$SourcePackageDirName = if ($env:AGENTX_SOURCE_PACKAGE_DIR) { $env:AGENTX_SOURCE_PACKAGE_DIR } else { "agentx" }

function Require-Command($Name) {
  $Command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $Command) {
    throw "$Name is required before installing $ProductName."
  }
  return $Command.Source
}

function Require-Node22 {
  $NodePath = Require-Command "node"
  $NodeVersionOutput = @(& $NodePath -p "process.versions.node" 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $NodeVersionOutput) {
    throw "Node.js >=22 is required before installing $ProductName. Could not read the installed Node.js version."
  }
  $NodeVersion = ([string]($NodeVersionOutput | Select-Object -First 1)).Trim()
  $MajorText = ($NodeVersion -split "\.")[0]
  $Major = 0
  if ((-not [int]::TryParse($MajorText, [ref]$Major)) -or $Major -lt 22) {
    throw "Node.js >=22 is required before installing $ProductName. Found Node.js $NodeVersion at $NodePath."
  }
  return $NodePath
}

function Resolve-NpmCommand {
  foreach ($Name in @("npm.cmd", "npm.exe", "npm")) {
    $Command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($Command) {
      return $Command.Source
    }
  }
  throw "npm is required before installing $ProductName."
}

function Invoke-NativeCommand($Command, [string[]]$Arguments) {
  $Output = @()
  $ExitCode = 0
  $PreviousErrorActionPreference = $ErrorActionPreference
  $HadNativePreference = Test-Path variable:PSNativeCommandUseErrorActionPreference
  if ($HadNativePreference) {
    $PreviousNativePreference = $PSNativeCommandUseErrorActionPreference
    $PSNativeCommandUseErrorActionPreference = $false
  }
  try {
    $ErrorActionPreference = "Continue"
    $Output = @(& $Command @Arguments 2>&1)
    $ExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $PreviousErrorActionPreference
    if ($HadNativePreference) {
      $PSNativeCommandUseErrorActionPreference = $PreviousNativePreference
    }
  }

  foreach ($Line in $Output) {
    if ($Line -is [System.Management.Automation.ErrorRecord]) {
      Write-Host $Line.Exception.Message
    } else {
      Write-Host $Line
    }
  }

  if ($ExitCode -ne 0) {
    throw "$Command $($Arguments -join ' ') failed with exit code $ExitCode."
  }
}

function Test-WritableDir($Dir) {
  if (-not $Dir) {
    return $false
  }
  try {
    New-Item -ItemType Directory -Force $Dir | Out-Null
    $Probe = Join-Path $Dir (".$BinaryName-write-test-" + [System.Guid]::NewGuid().ToString("N"))
    "ok" | Set-Content -Path $Probe -Encoding ASCII
    Remove-Item -Force $Probe -ErrorAction SilentlyContinue
    return $true
  } catch {
    return $false
  }
}

function Resolve-AppDataNpmPrefix {
  if ($env:APPDATA) {
    return Join-Path $env:APPDATA "npm"
  }
  return Join-Path $HOME "AppData\Roaming\npm"
}

function Resolve-DefaultPrefix {
  $AppDataPrefix = Resolve-AppDataNpmPrefix
  if (Test-WritableDir $AppDataPrefix) {
    return $AppDataPrefix
  }

  $NpmPrefix = ""
  try {
    $NpmPrefix = (& $script:NpmCommand prefix -g 2>$null)
  } catch {
    $NpmPrefix = ""
  }
  if ($NpmPrefix -and (Test-WritableDir $NpmPrefix.Trim())) {
    return $NpmPrefix.Trim()
  }

  throw "Could not find a writable install prefix. Tried $AppDataPrefix and npm prefix -g."
}

function Normalize-PathForCompare($PathValue) {
  try {
    return [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($PathValue))
  } catch {
    return $PathValue
  }
}

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

function Add-UserPath($Dir) {
  if (-not $Dir) {
    return
  }
  $FullDir = Normalize-PathForCompare $Dir
  $CurrentParts = @($env:Path -split ";" | Where-Object { $_ })
  if (($CurrentParts | ForEach-Object { Normalize-PathForCompare $_ }) -notcontains $FullDir) {
    $env:Path = "$FullDir;$env:Path"
  }

  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $UserParts = @($UserPath -split ";" | Where-Object { $_ })
  if (($UserParts | ForEach-Object { Normalize-PathForCompare $_ }) -notcontains $FullDir) {
    $NextUserPath = if ($UserPath) { "$FullDir;$UserPath" } else { $FullDir }
    [Environment]::SetEnvironmentVariable("Path", $NextUserPath, "User")
    Write-Host "Added $FullDir to your user PATH. Open a new terminal to use $BinaryName directly."
  }
}

function Ensure-OpenCodeExaEnvironment {
  $CurrentValue = [Environment]::GetEnvironmentVariable("OPENCODE_ENABLE_EXA", "User")
  if ($CurrentValue -eq "1") {
    Write-Host "OpenCode Exa websearch env already configured for your user."
  } else {
    [Environment]::SetEnvironmentVariable("OPENCODE_ENABLE_EXA", "1", "User")
    Write-Host "Set OPENCODE_ENABLE_EXA=1 for your user. Open a new terminal before launching OpenCode."
  }
  $env:OPENCODE_ENABLE_EXA = "1"
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

function Remove-UserPath($Dir) {
  if (-not $Dir) {
    return
  }
  $FullDir = Normalize-PathForCompare $Dir
  $env:Path = (@($env:Path -split ";" | Where-Object {
    $_ -and ((Normalize-PathForCompare $_) -ne $FullDir)
  }) -join ";")

  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $NextUserPath = (@($UserPath -split ";" | Where-Object {
    $_ -and ((Normalize-PathForCompare $_) -ne $FullDir)
  }) -join ";")
  if ($NextUserPath -ne $UserPath) {
    [Environment]::SetEnvironmentVariable("Path", $NextUserPath, "User")
    Write-Host "Removed broken PATH entry: $FullDir"
  }
}

function Repair-BrokenForceInstall {
  $BrokenPrefix = Join-Path $HOME "-Force"
  $BrokenShim = Join-Path $BrokenPrefix "$LegacyBinaryName.cmd"
  $BrokenPackage = Join-Path $BrokenPrefix "node_modules\$LegacyPackageName"
  if ((Test-Path $BrokenShim) -or (Test-Path $BrokenPackage)) {
    Remove-UserPath $BrokenPrefix
    Remove-Item -Recurse -Force $BrokenPrefix -ErrorAction SilentlyContinue
  }
}

function Remove-BrokenCommandShim($Dir) {
  if (-not $Dir) {
    return
  }
  foreach ($Name in @($BinaryName, "$BinaryName.cmd", "$BinaryName.ps1", $LegacyBinaryName, "$LegacyBinaryName.cmd", "$LegacyBinaryName.ps1") | Select-Object -Unique) {
    $Shim = Join-Path $Dir $Name
    if (-not (Test-Path $Shim)) {
      continue
    }
    $Content = ""
    try {
      $Content = Get-Content -Raw -Path $Shim -ErrorAction Stop
    } catch {
      $Content = ""
    }
    if ($Content -match [regex]::Escape($LegacyStableCliDirName) -or $Content -match "\.ai\\opencode-pack" -or $Content -match "added \d+ packages") {
      if ($Name -eq "$BinaryName.cmd" -or $Name -eq "$LegacyBinaryName.cmd") {
        Write-Host "Found old $Name shim; it will be repaired after the new CLI is built: $Shim"
        continue
      }
      Remove-Item -Force $Shim -ErrorAction SilentlyContinue
      Write-Host "Removed broken $Name shim: $Shim"
    }
  }
}

function Repair-BrokenCommandShims($Prefix) {
  $Dirs = @()
  $HomePath = Normalize-PathForCompare $HOME
  if ($Prefix -and ((Normalize-PathForCompare $Prefix) -ne $HomePath)) {
    $Dirs += $Prefix
  }
  $Dirs += (Resolve-AppDataNpmPrefix)
  try {
    $NpmPrefix = (& $script:NpmCommand prefix -g 2>$null)
    if ($NpmPrefix -and ((Normalize-PathForCompare $NpmPrefix.Trim()) -ne $HomePath)) {
      $Dirs += $NpmPrefix.Trim()
    }
  } catch {
    # ignore npm prefix lookup failures; the installer will use its resolved prefix.
  }
  foreach ($Dir in ($Dirs | Where-Object { $_ } | Select-Object -Unique)) {
    Remove-BrokenCommandShim $Dir
  }
}

function Runtime-CliTarget {
  return "%USERPROFILE%\.ai\opencode-pack\$StableCliDirName\dist\cli.js"
}

function Write-CmdShim($ShimPath, $CliTarget) {
  $RuntimeCliTarget = Runtime-CliTarget
  "@ECHO off`r`nnode `"$RuntimeCliTarget`" %*`r`n" | Set-Content -Path $ShimPath -Encoding ASCII
}

function Repair-HomeCommandShim($CliTarget) {
  foreach ($Name in @($BinaryName, "$BinaryName.cmd", "$BinaryName.ps1", $LegacyBinaryName, "$LegacyBinaryName.cmd", "$LegacyBinaryName.ps1") | Select-Object -Unique) {
    $Shim = Join-Path $HOME $Name
    if (-not (Test-Path $Shim)) {
      continue
    }
    $Content = ""
    try {
      $Content = Get-Content -Raw -Path $Shim -ErrorAction Stop
    } catch {
      $Content = ""
    }
    if ($Content -match [regex]::Escape($LegacyStableCliDirName) -or $Content -match "\.ai\\opencode-pack" -or $Content -match "added \d+ packages") {
      if ($Name -eq "$BinaryName.cmd" -or $Name -eq "$LegacyBinaryName.cmd") {
        Write-CmdShim $Shim $CliTarget
        Write-Host "Repaired old home $Name shim: $Shim"
      } else {
        Remove-Item -Force $Shim -ErrorAction SilentlyContinue
        Write-Host "Removed broken home $Name shim: $Shim"
      }
    }
  }
}

function Install-StableCli($SourceDir, $InstallDir) {
  Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $InstallDir | Out-Null

  Copy-Item -Path (Join-Path $SourceDir "package.json") -Destination $InstallDir -Force
  Copy-Item -Path (Join-Path $SourceDir "package-lock.json") -Destination $InstallDir -Force
  if (Test-Path (Join-Path $SourceDir "LICENSE")) {
    Copy-Item -Path (Join-Path $SourceDir "LICENSE") -Destination $InstallDir -Force
  }
  foreach ($TelemetryDefaults in @("telemetry.defaults.json", "telemetry.defaults.example.json")) {
    $TelemetryDefaultsPath = Join-Path $SourceDir $TelemetryDefaults
    if (Test-Path $TelemetryDefaultsPath) {
      Copy-Item -Path $TelemetryDefaultsPath -Destination $InstallDir -Force
    }
  }
  if (Test-Path (Join-Path $SourceDir "telemetry-email-worker")) {
    Copy-Item -Path (Join-Path $SourceDir "telemetry-email-worker") -Destination (Join-Path $InstallDir "telemetry-email-worker") -Recurse -Force
  }
  if (Test-Path (Join-Path $SourceDir "scripts")) {
    Copy-Item -Path (Join-Path $SourceDir "scripts") -Destination (Join-Path $InstallDir "scripts") -Recurse -Force
  }
  Copy-Item -Path (Join-Path $SourceDir "dist") -Destination (Join-Path $InstallDir "dist") -Recurse -Force

  Invoke-NativeCommand $script:NpmCommand @("--prefix", $InstallDir, "install", "--omit=dev")
  $ExpectedCliTarget = Join-Path $InstallDir "dist\cli.js"
  if (-not (Test-Path $ExpectedCliTarget)) {
    throw "Expected built CLI at $ExpectedCliTarget, but it was not found."
  }
}

function Test-CleanCliPath($PathValue, $Label) {
  if (-not $PathValue) {
    throw "$Label is empty."
  }
  if ($PathValue -match "\r|\n|added \d+ packages|audited \d+ packages|npm fund|npm audit") {
    throw "$Label was contaminated by command output: $PathValue"
  }
  if (-not (Test-Path $PathValue)) {
    throw "$Label does not exist: $PathValue"
  }
}

function Test-CleanCommandShim($ShimPath, $CliTarget) {
  if (-not (Test-Path $ShimPath)) {
    throw "Expected command shim under $ShimPath, but it was not found."
  }
  $Content = Get-Content -Raw -Path $ShimPath
  if ($Content -match "added \d+ packages|audited \d+ packages|npm fund|npm audit") {
    throw "Generated command shim contains npm output: $ShimPath"
  }
  $RuntimeCliTarget = Runtime-CliTarget
  if ($Content -notmatch [regex]::Escape($RuntimeCliTarget)) {
    throw "Generated command shim does not point at runtime CLI target: $RuntimeCliTarget"
  }
  $NonEmptyLines = @($Content -split "\r?\n" | Where-Object { $_.Trim() })
  if ($NonEmptyLines.Count -ne 2) {
    throw "Generated command shim should contain exactly 2 non-empty lines, found $($NonEmptyLines.Count): $ShimPath"
  }
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$CliDir = Join-Path (Join-Path $RepoRoot "packages") $SourcePackageDirName

$script:NodeCommand = Require-Node22
Require-Command "npm" | Out-Null
$script:NpmCommand = Resolve-NpmCommand

$Project = Normalize-PathArgument $Project
$Prefix = Normalize-PathArgument $Prefix
$Project = [System.IO.Path]::GetFullPath($Project)
$HomePath = [System.IO.Path]::GetFullPath($HOME)
$RunHomeSync = $false
$TrimChars = [char[]]@("\", "/")
if ($Project.TrimEnd($TrimChars) -eq $HomePath.TrimEnd($TrimChars) -and (-not $NoSetup)) {
  Write-Host "Home directory detected; installing global $ProductName/OpenCode profile and skipping project setup files."
  $RunHomeSync = $true
  $NoSetup = $true
}

if ((-not $Prefix) -or $Prefix.Trim().StartsWith("-")) {
  $Prefix = Resolve-DefaultPrefix
} elseif (-not (Test-WritableDir $Prefix)) {
  throw "Install prefix is not writable: $Prefix"
}

Repair-BrokenForceInstall
Repair-BrokenCommandShims $Prefix
Repair-DirectoryBlocker (Join-Path $HOME ".config\opencode") "windows-installer"
Repair-ReadOnlyDirectory (Join-Path $HOME ".config\opencode") "windows-installer"

New-Item -ItemType Directory -Force (Join-Path $HOME ".config\opencode") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $HOME ".agents\skills") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $HOME ".ai\opencode-pack") | Out-Null
New-Item -ItemType Directory -Force $Prefix | Out-Null

Write-Host "Building $ProductName CLI..."
Invoke-NativeCommand $script:NpmCommand @("--prefix", $CliDir, "install")
Invoke-NativeCommand $script:NpmCommand @("--prefix", $CliDir, "run", "build")

Write-Host "Installing $BinaryName into a stable local folder..."
$CliInstallDir = Join-Path (Join-Path $HOME ".ai\opencode-pack") $StableCliDirName
Install-StableCli $CliDir $CliInstallDir
$CliTarget = Join-Path $CliInstallDir "dist\cli.js"
Test-CleanCliPath $CliTarget "CLI target"
Write-Host "Prefix: $Prefix"
Write-Host "CliInstallDir: $CliInstallDir"
Write-Host "CliTarget: $CliTarget"

Write-Host "Registering $BinaryName command in $Prefix..."
foreach ($Name in @($BinaryName, "$BinaryName.ps1", $LegacyBinaryName, "$LegacyBinaryName.ps1") | Select-Object -Unique) {
  Remove-Item -Force (Join-Path $Prefix $Name) -ErrorAction SilentlyContinue
}
Remove-Item -Recurse -Force (Join-Path $Prefix "node_modules\$PackageName") -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force (Join-Path $Prefix "node_modules\$LegacyPackageName") -ErrorAction SilentlyContinue

$PrimaryBin = Join-Path $Prefix "$BinaryName.cmd"
$LegacyBin = Join-Path $Prefix "$LegacyBinaryName.cmd"
Write-CmdShim $PrimaryBin $CliTarget
if ($LegacyBinaryName -ne $BinaryName) {
  Write-CmdShim $LegacyBin $CliTarget
}

Test-CleanCommandShim $PrimaryBin $CliTarget
if ($LegacyBinaryName -ne $BinaryName) {
  Test-CleanCommandShim $LegacyBin $CliTarget
}
Repair-HomeCommandShim $CliTarget
Write-Host "Primary command: $PrimaryBin"
if ($LegacyBinaryName -ne $BinaryName) {
  Write-Host "Legacy alias: $LegacyBin"
}

$InstalledVersionOutput = & $PrimaryBin --version 2>&1
$InstalledVersionExit = $LASTEXITCODE
if ($InstalledVersionExit -ne 0) {
  $Message = if ($InstalledVersionOutput) { ($InstalledVersionOutput | Out-String).Trim() } else { "no output" }
  throw "Installed $BinaryName verification failed with exit code ${InstalledVersionExit}: $Message"
}
$InstalledVersion = if ($InstalledVersionOutput) { ($InstalledVersionOutput | Out-String).Trim() } else { "" }
if (-not $InstalledVersion) {
  throw "Installed $BinaryName verification returned no version output."
}
Write-Host "Verified $BinaryName $InstalledVersion at $PrimaryBin"

$PrimaryBinDir = Split-Path -Parent $PrimaryBin
Add-UserPath $PrimaryBinDir
Ensure-OpenCodeExaEnvironment

$InstallArgs = @("--project", $Project, "install", "--rulesync", $Rulesync, "--windows")
if ($NoUx) {
  $InstallArgs += "--no-ux"
}
if ($NoOpenCode) {
  $InstallArgs += "--no-install-opencode"
}
if ($Force) {
  $InstallArgs += "--force"
  if ($RunHomeSync) {
    $InstallArgs += "--reset-global"
  }
}
if ($NoSetup -and (-not $RunHomeSync)) {
  $InstallArgs += "--no-check"
}

Write-Host "Running $ProductName install ritual for $Project..."
& $script:NodeCommand $CliTarget @InstallArgs
$InstallStatus = $LASTEXITCODE
if ($InstallStatus -eq 1) {
  Write-Host "$ProductName install completed with warnings; continuing bootstrap."
} elseif ($InstallStatus -ne 0) {
  exit $InstallStatus
}

Write-Host "Done."
Write-Host "$BinaryName command: $PrimaryBin"
Write-Host "Try: & `"$PrimaryBin`" --project `"$Project`" check --windows"
