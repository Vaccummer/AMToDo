param(
  [switch]$SkipInstall,
  [switch]$NoStopProcess
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")
$FrontendRoot = Join-Path $RepoRoot "frontend"
$DesktopOut = Join-Path $RepoRoot "bin\desktop"
$DesktopExe = Join-Path $DesktopOut "win-unpacked\AMToDo.exe"

function Test-PeArch {
  param([Parameter(Mandatory = $true)][string]$Path)

  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
  $machine = [BitConverter]::ToUInt16($bytes, $peOffset + 4)
  switch ($machine) {
    0x014c { "x86" }
    0x8664 { "x64" }
    0xaa64 { "arm64" }
    default { "unknown-0x{0:x4}" -f $machine }
  }
}

function Remove-DirectoryWithRetry {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return
  }

  for ($i = 1; $i -le 8; $i++) {
    try {
      Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue |
        ForEach-Object { $_.Attributes = $_.Attributes -band (-bnot [System.IO.FileAttributes]::ReadOnly) }
      Remove-Item -LiteralPath $Path -Recurse -Force
      return
    }
    catch {
      if ($i -eq 8) {
        throw
      }
      Start-Sleep -Milliseconds (250 * $i)
    }
  }
}

Write-Host "AMToDo desktop build"
Write-Host "Repo: $RepoRoot"

if (-not $NoStopProcess) {
  $processes = Get-Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ProcessName -eq "AMToDo" -and
      $_.Path -and
      ($_.Path.StartsWith($DesktopOut) -or $_.Path.StartsWith($env:TEMP))
    }
  $processes | Stop-Process -Force
  $processes | ForEach-Object {
    try {
      Wait-Process -Id $_.Id -Timeout 5 -ErrorAction SilentlyContinue
    }
    catch {
    }
  }
}

if (Test-Path -LiteralPath $DesktopOut) {
  Remove-DirectoryWithRetry -Path $DesktopOut
}
New-Item -ItemType Directory -Path $DesktopOut -Force | Out-Null

Push-Location $FrontendRoot
try {
  if (-not $SkipInstall -and -not (Test-Path -LiteralPath "node_modules")) {
    npm install
  }

  npm run dist:desktop
}
finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $DesktopExe)) {
  throw "Desktop executable was not created: $DesktopExe"
}

$arch = Test-PeArch -Path $DesktopExe
if ($arch -ne "x64") {
  throw "Desktop executable architecture is $arch, expected x64: $DesktopExe"
}

Write-Host "Built x64 desktop UI:"
Write-Host "  $DesktopExe"
Get-ChildItem -LiteralPath $DesktopOut -Filter "*.zip" | ForEach-Object {
  Write-Host "  $($_.FullName)"
}
