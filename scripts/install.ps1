# Install ephemeralOS on Windows, from PowerShell:
#   irm https://raw.githubusercontent.com/tongesy/ephemeralos/main/scripts/install.ps1 | iex
# Re-run it to update. If Node 22.12+ isn't installed, a private copy is downloaded. Your keys,
# persona and memory in ~\.ephemeralos are untouched.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Repo = if ($env:EOS_REPO) { $env:EOS_REPO } else { 'tongesy/ephemeralos' }
$Ref = if ($env:EOS_REF) { $env:EOS_REF } else { 'main' }
$Dir = if ($env:EOS_INSTALL_DIR) { $env:EOS_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'ephemeralos' }
$Bin = Join-Path $Dir 'bin'
New-Item -ItemType Directory -Force -Path $Dir, $Bin | Out-Null

function Say($text) { Write-Host $text -ForegroundColor Cyan }

function Test-Node($exe) {
  try {
    & $exe -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' 2>$null
    return $LASTEXITCODE -eq 0
  } catch { return $false }
}

# --- Node ------------------------------------------------------------------------
$Node = $null
$private = Join-Path $Dir 'node\node.exe'
$system = Get-Command node -ErrorAction SilentlyContinue
if ((Test-Path $private) -and (Test-Node $private)) {
  $Node = $private
} elseif ($system -and (Test-Node $system.Source) -and (Get-Command corepack -ErrorAction SilentlyContinue)) {
  $Node = $system.Source
} else {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  Say "Downloading Node 22 for win-$arch"
  $dist = 'https://nodejs.org/dist/latest-v22.x'
  $sums = (Invoke-WebRequest "$dist/SHASUMS256.txt" -UseBasicParsing).Content -split "`n"
  $line = $sums | Where-Object { $_ -match "node-v[\d.]+-win-$arch\.zip$" } | Select-Object -First 1
  if (-not $line) { throw "No Node build for win-$arch." }
  $hash, $file = $line.Trim() -split '\s+'
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  Invoke-WebRequest "$dist/$file" -OutFile "$tmp\$file" -UseBasicParsing
  if ((Get-FileHash "$tmp\$file" -Algorithm SHA256).Hash -ne $hash) { throw "The Node download didn't match its checksum." }
  Expand-Archive "$tmp\$file" -DestinationPath $tmp
  Remove-Item -Recurse -Force (Join-Path $Dir 'node') -ErrorAction SilentlyContinue
  Move-Item (Join-Path $tmp ($file -replace '\.zip$', '')) (Join-Path $Dir 'node')
  Remove-Item -Recurse -Force $tmp
  $Node = $private
}
$env:Path = "$(Split-Path $Node);$env:Path"

# --- ephemeralOS -------------------------------------------------------------------
Say "Downloading ephemeralOS ($Ref)"
$tmp = Join-Path ([IO.Path]::GetTempPath()) ([Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
Invoke-WebRequest "https://codeload.github.com/$Repo/zip/$Ref" -OutFile "$tmp\app.zip" -UseBasicParsing
Expand-Archive "$tmp\app.zip" -DestinationPath "$tmp\x"
$App = Join-Path $Dir 'app'
Remove-Item -Recurse -Force $App -ErrorAction SilentlyContinue
Move-Item (Get-ChildItem "$tmp\x" -Directory | Select-Object -First 1).FullName $App
Remove-Item -Recurse -Force $tmp

Say 'Installing dependencies and building'
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
# A pnpm of the version the repo pins, for this script only: nothing global changes.
$shims = Join-Path $Dir 'shims'
New-Item -ItemType Directory -Force -Path $shims | Out-Null
& corepack enable --install-directory $shims pnpm
$env:Path = "$shims;$env:Path"
Push-Location $App
try {
  & pnpm install --frozen-lockfile
  if ($LASTEXITCODE) { throw 'pnpm install failed.' }
  & pnpm build
  if ($LASTEXITCODE) { throw 'The build failed.' }
} finally { Pop-Location }

Set-Content -Encoding ASCII (Join-Path $Bin 'ephemeralos.cmd') "@`"$Node`" `"$App\packages\cli\bin\ephemeralos.mjs`" %*"

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (($userPath -split ';') -notcontains $Bin) {
  [Environment]::SetEnvironmentVariable('Path', "$Bin;$userPath", 'User')
}
$env:Path = "$Bin;$env:Path"

# --- Setup -------------------------------------------------------------------------
$home_ = if ($env:EOS_HOME) { $env:EOS_HOME } else { Join-Path $HOME '.ephemeralos' }
if (-not (Test-Path (Join-Path $home_ '.env'))) { & (Join-Path $Bin 'ephemeralos.cmd') init }

Write-Host ''
Say 'ephemeralOS is installed.'
Write-Host 'Open a new terminal, start it with `ephemeralos start`, then open http://localhost:4317 in Chrome.'
