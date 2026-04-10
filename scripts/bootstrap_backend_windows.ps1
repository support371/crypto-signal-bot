param(
  [switch]$InstallCcxt
)

$ErrorActionPreference = "Stop"

function Get-PythonCommand {
  $candidates = @()

  $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
  if ($pythonCmd -and $pythonCmd.Source -notlike "*WindowsApps*") {
    $candidates += $pythonCmd.Source
  }

  $localPrograms = Join-Path $env:LOCALAPPDATA "Programs\Python"
  if (Test-Path $localPrograms) {
    $candidates += Get-ChildItem -Path $localPrograms -Recurse -Filter python.exe -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending |
      ForEach-Object { $_.FullName }
  }

  $wingetPackages = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
  if (Test-Path $wingetPackages) {
    $candidates += Get-ChildItem -Path $wingetPackages -Recurse -Filter python.exe -ErrorAction SilentlyContinue |
      Sort-Object FullName -Descending |
      ForEach-Object { $_.FullName }
  }

  $programFilesPython = Join-Path ${env:ProgramFiles} "Python*"
  $candidates += Get-ChildItem -Path $programFilesPython -Recurse -Filter python.exe -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    ForEach-Object { $_.FullName }

  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    try {
      & $candidate --version *> $null
      return $candidate
    } catch {
      continue
    }
  }

  throw "Python 3 was not found. Install Python 3.11+ and rerun this script."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$python = Get-PythonCommand
Write-Host "Using Python: $python"

& $python -m venv .venv

$venvPython = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  throw "Virtual environment creation failed. Expected $venvPython"
}

& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r backend\requirements.txt

if ($InstallCcxt) {
  & $venvPython -m pip install ccxt
}

$envFile = Join-Path $repoRoot "backend\env\.env"
$envExample = Join-Path $repoRoot "backend\env\.env.example"
if (-not (Test-Path $envFile)) {
  Copy-Item $envExample $envFile
  Write-Host "Created backend\env\.env from template."
}

Write-Host ""
Write-Host "Backend bootstrap complete."
Write-Host "Start backend with:"
Write-Host "  .\.venv\Scripts\python.exe -m uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000"
