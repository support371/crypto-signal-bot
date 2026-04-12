param(
  [ValidateSet("binance", "bitget", "btcc")]
  [string]$Exchange = "binance",
  [switch]$DryRun,
  [switch]$Doctor,
  [switch]$Force,
  [switch]$InstallCcxt
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  throw "Missing .venv\Scripts\python.exe. Run .\scripts\bootstrap_backend_windows.ps1 first."
}

if ($InstallCcxt) {
  & $venvPython -m pip install ccxt
}

$argsList = @("scripts\testnet_smoke.py", "--exchange", $Exchange)
if ($DryRun) {
  $argsList += "--dry-run"
}
if ($Doctor) {
  $argsList += "--doctor"
}
if ($Force) {
  $argsList += "--force"
}

& $venvPython @argsList
exit $LASTEXITCODE
