param([string]$Destination = (Join-Path $env:LOCALAPPDATA 'Swarmcrews\0.1.0-alpha.2'))
# Download only; never builds the app, installs harnesses, or starts a process.
$ErrorActionPreference = 'Stop'
$Version = '0.1.0-alpha.2'
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') {
  throw 'This release supports Windows x64 only; use the source installation guide.'
}
$Destination = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $Destination) { throw 'Destination already exists; nothing was changed.' }
$Base = "swarmcrews-$Version-win32-x64"
$Archive = "$Base.zip"
$Url = "https://github.com/swarmcrews/swarmcrews/releases/download/v$Version"
$Stage = Join-Path ([IO.Path]::GetTempPath()) ('swarmcrews-install-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Stage | Out-Null
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri "$Url/$Archive" -OutFile (Join-Path $Stage $Archive) -TimeoutSec 300
  Invoke-WebRequest -UseBasicParsing -Uri "$Url/$Archive.sha256" -OutFile (Join-Path $Stage 'checksum') -TimeoutSec 60
  $Expected = (Get-Content -LiteralPath (Join-Path $Stage 'checksum') -Raw).TrimEnd("`r", "`n")
  # Use .NET directly: launching Windows PowerShell from pwsh can inherit a
  # PSModulePath without its Get-FileHash / Expand-Archive script modules.
  $Hash = [Security.Cryptography.SHA256]::Create()
  $Stream = [IO.File]::OpenRead((Join-Path $Stage $Archive))
  try { $Digest = [BitConverter]::ToString($Hash.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant() }
  finally { $Stream.Dispose(); $Hash.Dispose() }
  if ($Expected -cne "$Digest  $Archive") { throw 'Archive checksum mismatch; refusing installation.' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $Zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $Stage $Archive))
  try {
    foreach ($Entry in $Zip.Entries) {
      $Name = $Entry.FullName.Replace('\', '/')
      if (-not $Name.StartsWith("$Base/", [StringComparison]::Ordinal) -or $Name.Contains(':') -or ($Name.Split('/') -contains '..')) {
        throw 'Unsafe archive path.'
      }
      $Type = ($Entry.ExternalAttributes -shr 16) -band 0xF000
      if ($Type -ne 0 -and $Type -ne 0x8000 -and $Type -ne 0x4000) { throw 'Archive contains links or special files.' }
    }
  } finally { $Zip.Dispose() }
  [IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $Stage $Archive), $Stage)
  $Extracted = Join-Path $Stage $Base
  if (-not (Test-Path (Join-Path $Extracted 'swarmcrews.cmd')) -or -not (Test-Path (Join-Path $Extracted 'runtime\node.exe'))) { throw 'Incomplete archive.' }
  $Parent = Split-Path -Parent $Destination
  if (-not (Test-Path -LiteralPath $Parent)) { New-Item -ItemType Directory -Path $Parent -Force | Out-Null }
  New-Item -ItemType Directory -Path $Destination | Out-Null
  Get-ChildItem -LiteralPath $Extracted -Force | Copy-Item -Destination $Destination -Recurse
  Write-Host "Installed Swarmcrews to $Destination"
  Write-Host "Launch: $Destination\swarmcrews.cmd"
  Write-Host 'Harnesses are separate installs; see INSTALL.md.'
} finally {
  Remove-Item -LiteralPath $Stage -Recurse -Force
}
