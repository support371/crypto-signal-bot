param(
  [int]$Port = 8000,
  [switch]$NoReload
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  throw "Missing .venv\Scripts\python.exe. Run scripts\bootstrap_backend_windows.ps1 first."
}

$args = @("-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "$Port")
if (-not $NoReload) {
  $args += "--reload"
}

& $venvPython @args
