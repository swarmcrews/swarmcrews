# Standalone Windows entrypoint. No installer modules or execution-policy changes.
# Downloads source (main by default), not a prebuilt release. Review before running.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$InstallerArgs)
$ErrorActionPreference = 'Stop'
$NodeVersion = '22.22.0'
$Repository = 'https://github.com/hipsterusername/minions.git'
$SourceRef = if ($env:SWARMCREWS_REF) { $env:SWARMCREWS_REF } else { 'main' }
$UseColor = -not [Console]::IsOutputRedirected -and -not (Test-Path Env:NO_COLOR) -and $env:TERM -ne 'dumb'
function Say([string]$Text) {
    if ($UseColor) { Write-Host $Text -ForegroundColor Yellow } else { Write-Host $Text }
}
function Confirm([string]$Question) {
    if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) {
        throw 'A prerequisite is missing. Run in an interactive terminal; unattended setup never installs system tools.'
    }
    $answer = Read-Host "  $Question [y/N]"
    return $answer -match '^(y|yes)$'
}
function Checked([string]$Command, [string[]]$CommandArgs) {
    & $Command @CommandArgs
    if ($LASTEXITCODE -ne 0) { throw "$Command failed (exit $LASTEXITCODE)." }
}
Say "`n  \  ^  /`n   \___/   SWARMCREWS`n"
Write-Host "  Windows / bootstrap`n  Your workspace. Your agents.`n"
if ($InstallerArgs -contains '--help') {
    Write-Host '  Usage: .\install\windows.ps1 --dir PATH --agent NAME [--yes]'
    Write-Host '  Options: --check, --preview, --skip-start, --port N, --backend-port N'
    Write-Host '  SWARMCREWS_REF selects source; SWARMCREWS_MANAGED_NODE=1 selects private Node.'
    exit 0
}
if ($env:OS -ne 'Windows_NT') { throw 'Use the Linux or macOS entrypoint on this operating system.' }
# Read-only modes never download or provision anything.
if (($InstallerArgs -contains '--check') -or ($InstallerArgs -contains '--preview')) {
    $localWizard = Join-Path (Split-Path $PSScriptRoot) 'scripts\install\wizard.mjs'
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue) -or -not (Test-Path -LiteralPath $localWizard)) {
        throw 'Read-only mode needs Node and a local checkout; no tools were installed.'
    }
    & node.exe $localWizard @InstallerArgs
    exit $LASTEXITCODE
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run setup in a normal terminal, not as Administrator. Approved package installers can request elevation themselves.'
}
$archName = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$Arch = switch ($archName) { 'AMD64' { 'x64' }; 'ARM64' { 'arm64' }; default { throw 'Supported Windows architectures: x64 and arm64.' } }
$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ('swarmcrews-setup-' + [Guid]::NewGuid().ToString('N'))
$exitCode = 1
try {
    $null = New-Item -ItemType Directory -Path $tempRoot
    $existing = Get-Command node.exe -ErrorAction SilentlyContinue
    $Node = if ($existing) { $existing.Source } else { $null }
    $supported = $false
    if ($Node) {
        # No embedded quote characters: Windows PowerShell 5.1 strips them in native argv.
        & $Node -e 'const [a,b]=process.versions.node.split(String.fromCharCode(46)).map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'
        $supported = $LASTEXITCODE -eq 0
    }
    if (-not $supported -or $env:SWARMCREWS_MANAGED_NODE -eq '1') {
        if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required for a user-owned runtime.' }
        $runtime = Join-Path $env:LOCALAPPDATA "Swarmcrews\runtime\node-v$NodeVersion-win-$Arch"
        $Node = Join-Path $runtime 'node.exe'
        if (-not (Test-Path -LiteralPath $Node)) {
            Write-Host "  [WAIT] Node >=22.12.0 is required.`n  Managed runtime: $runtime"
            Write-Host "  Download: https://nodejs.org/dist/v$NodeVersion/`n  Your global Node and user PATH will not change."
            if (-not (Confirm 'Download and install this private Node runtime?')) { exit 130 }
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $archive = "node-v$NodeVersion-win-$Arch.zip"
            $base = "https://nodejs.org/dist/v$NodeVersion"
            $archivePath = Join-Path $tempRoot $archive
            Invoke-WebRequest -UseBasicParsing -Uri "$base/$archive" -OutFile $archivePath
            $checksums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt").Content
            if ($checksums -is [byte[]]) { $checksums = [Text.Encoding]::UTF8.GetString($checksums) }
            $line = @($checksums -split "`n" | Where-Object { $_ -match ('^[a-f0-9]{64}\s+' + [regex]::Escape($archive) + '\s*$') })
            if ($line.Count -ne 1) { throw 'Official Node checksum was not found.' }
            $expected = ($line[0] -split '\s+')[0]
            $actual = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
            if ($actual -ne $expected) { throw 'Node checksum mismatch. Nothing was installed.' }
            Expand-Archive -LiteralPath $archivePath -DestinationPath $tempRoot
            $null = New-Item -ItemType Directory -Force -Path (Split-Path $runtime)
            if (Test-Path -LiteralPath $runtime) { throw 'Runtime destination exists but is incomplete. Inspect it before retrying.' }
            Move-Item -LiteralPath (Join-Path $tempRoot "node-v$NodeVersion-win-$Arch") -Destination $runtime
        }
    }
    Checked $Node @('--version')
    $env:PATH = (Split-Path $Node) + [IO.Path]::PathSeparator + $env:PATH
    if (-not (Get-Command git.exe -ErrorAction SilentlyContinue)) {
        if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw 'Install Git from https://git-scm.com/downloads, reopen your terminal, then rerun setup.' }
        Write-Host '  [WAIT] Git is required for source and agent workspaces.'
        if (-not (Confirm 'Run winget install --id Git.Git --exact --source winget?')) { exit 130 }
        Checked 'winget.exe' @('install', '--id', 'Git.Git', '--exact', '--source', 'winget')
        # Read the newly installed PATH without writing the user or machine PATH.
        $env:PATH = (Split-Path $Node) + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    }
    Checked 'git.exe' @('--version')
    $localRoot = Split-Path $PSScriptRoot
    if (Test-Path -LiteralPath (Join-Path $localRoot 'scripts\install\wizard.mjs')) {
        $sourceRoot = $localRoot
    } else {
        if ($SourceRef -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._/-]*$') { throw 'Invalid SWARMCREWS_REF.' }
        Write-Host "`n  Source: $Repository`n  Ref: $SourceRef (source install, not a signed prebuilt release)"
        if (-not (Confirm 'Download this source to a temporary folder?')) { exit 130 }
        $sourceRoot = Join-Path $tempRoot 'source'
        Checked 'git.exe' @('init', '-q', $sourceRoot)
        Checked 'git.exe' @('-C', $sourceRoot, 'remote', 'add', 'origin', $Repository)
        Checked 'git.exe' @('-C', $sourceRoot, 'fetch', '--depth', '1', 'origin', $SourceRef)
        Checked 'git.exe' @('-C', $sourceRoot, 'checkout', '--detach', 'FETCH_HEAD')
    }
    & $Node (Join-Path $sourceRoot 'scripts\install\wizard.mjs') @InstallerArgs
    $exitCode = $LASTEXITCODE
} catch {
    Write-Host "`n  [FIX] $($_.Exception.Message)"
    $exitCode = 1
} finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}
exit $exitCode
