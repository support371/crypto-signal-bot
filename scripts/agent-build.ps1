[CmdletBinding()]
param(
    [ValidateSet('diagnose', 'frontend', 'backend', 'worker', 'full')]
    [string]$Scope = 'diagnose',

    [string]$Task = '',

    [switch]$UseCodex,

    [switch]$SkipInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$RunningOnWindows = $env:OS -eq 'Windows_NT'
Set-Location $RepoRoot

$env:TRADING_MODE = 'paper'
$env:EXCHANGE_MODE = 'paper'
$env:NETWORK = 'testnet'
$env:ALLOW_MAINNET = 'false'
$env:CI = 'true'

$script:RootDependenciesReady = $false
$script:WorkerDependenciesReady = $false

function Write-Section {
    param([Parameter(Mandatory)][string]$Title)

    Write-Host ''
    Write-Host "=== $Title ===" -ForegroundColor Cyan
}

function Require-Command {
    param([Parameter(Mandatory)][string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) {
        throw "Required command '$Name' was not found in PATH."
    }

    return $command
}

function Invoke-External {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string]$FilePath,
        [string[]]$Arguments = @()
    )

    Write-Host "--> $Label" -ForegroundColor Yellow
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

function Resolve-Python {
    $py = Get-Command 'py' -ErrorAction SilentlyContinue
    if ($py) {
        return @{
            FilePath = $py.Source
            Prefix = @('-3.11')
        }
    }

    $python = Require-Command 'python'
    return @{
        FilePath = $python.Source
        Prefix = @()
    }
}

function Invoke-Python {
    param(
        [Parameter(Mandatory)][string]$Label,
        [Parameter(Mandatory)][string[]]$Arguments
    )

    $resolved = Resolve-Python
    Invoke-External -Label $Label -FilePath $resolved.FilePath -Arguments @($resolved.Prefix + $Arguments)
}

function Assert-NodeEnvironment {
    $node = Require-Command 'node'
    $npm = Require-Command 'npm'

    Invoke-External -Label 'Node version' -FilePath $node.Source -Arguments @('--version')
    Invoke-External -Label 'npm version' -FilePath $npm.Source -Arguments @('--version')

    $nodeText = (& $node.Source --version).Trim().TrimStart('v')
    $nodeVersion = [version]$nodeText
    if ($nodeVersion -lt [version]'22.12.0') {
        throw "Node.js 22.12.0 or later is required. Found $nodeText."
    }
    if ($nodeVersion.Major -ne 22) {
        Write-Warning "Node.js 22.x is the verified project line. Found $nodeText."
    }
}

function Assert-PythonEnvironment {
    $resolved = Resolve-Python
    $pythonArguments = @($resolved.Prefix + @('--version'))
    $pythonText = (& $resolved.FilePath @pythonArguments 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "Python 3.11 could not be started. Install Python 3.11 and ensure it is available in PATH."
    }

    Write-Host "--> Python version" -ForegroundColor Yellow
    Write-Host $pythonText

    if ($pythonText -notmatch 'Python\s+(\d+)\.(\d+)\.(\d+)') {
        throw "Unable to parse the Python runtime version from '$pythonText'."
    }

    $pythonVersion = [version]::new(
        [int]$Matches[1],
        [int]$Matches[2],
        [int]$Matches[3]
    )
    if ($pythonVersion.Major -ne 3 -or $pythonVersion.Minor -ne 11) {
        throw "Python 3.11.x is required for the verified backend validation path. Found $pythonVersion."
    }
}

function Assert-Environment {
    Write-Section 'Environment checks'

    $git = Require-Command 'git'
    Invoke-External -Label 'Git version' -FilePath $git.Source -Arguments @('--version')

    switch ($Scope) {
        'diagnose' {
            Assert-NodeEnvironment
        }
        'frontend' {
            Assert-NodeEnvironment
        }
        'backend' {
            Assert-PythonEnvironment
        }
        'worker' {
            Assert-NodeEnvironment
        }
        'full' {
            Assert-NodeEnvironment
            Assert-PythonEnvironment
        }
    }

    if ($env:TRADING_MODE -ne 'paper' -or
        $env:EXCHANGE_MODE -ne 'paper' -or
        $env:NETWORK -ne 'testnet' -or
        $env:ALLOW_MAINNET -ne 'false') {
        throw 'Paper/testnet safety environment could not be established.'
    }

    Invoke-External -Label 'Repository status' -FilePath $git.Source -Arguments @('status', '--short', '--branch')
}

function Ensure-RootDependencies {
    if ($script:RootDependenciesReady) {
        return
    }

    if (-not $SkipInstall) {
        Invoke-External -Label 'Install root dependencies' -FilePath 'npm' -Arguments @('ci')
    }

    $script:RootDependenciesReady = $true
}

function Ensure-WorkerDependencies {
    if ($script:WorkerDependenciesReady) {
        return
    }

    if (-not $SkipInstall) {
        Invoke-External -Label 'Install Worker dependencies' -FilePath 'npm' -Arguments @('--prefix', 'worker', 'ci')
    }

    $script:WorkerDependenciesReady = $true
}

function Prepare-CodexWorkspace {
    Write-Section 'Codex workspace isolation'

    $git = Require-Command 'git'
    $insideWorkTree = (& $git.Source rev-parse --is-inside-work-tree 2>$null).Trim()
    if ($LASTEXITCODE -ne 0 -or $insideWorkTree -ne 'true') {
        throw 'Codex mode requires a valid Git working tree.'
    }

    $status = (& $git.Source status --porcelain=v1 --untracked-files=all)
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to inspect the Git working tree before Codex execution.'
    }
    if ($status) {
        throw "Codex mode refuses to run over existing changes. Commit, stash, or remove them first.`n$status"
    }

    $currentBranch = (& $git.Source symbolic-ref --quiet --short HEAD 2>$null).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($currentBranch)) {
        throw 'Codex mode refuses to run from a detached HEAD. Check out a named branch first.'
    }

    if ($currentBranch -notlike 'agent/*') {
        $branchName = 'agent/local-codex-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
        Invoke-External -Label "Create isolated agent branch $branchName" -FilePath $git.Source -Arguments @('switch', '-c', $branchName)
        $currentBranch = $branchName
    }

    Write-Host "Codex changes will remain isolated on branch '$currentBranch'." -ForegroundColor Green
}

function Run-CodexAgent {
    Write-Section 'Codex workspace agent'

    Prepare-CodexWorkspace

    $codex = Require-Command 'codex'
    $requestedTask = $Task
    if ([string]::IsNullOrWhiteSpace($requestedTask)) {
        $requestedTask = "Inspect the $Scope scope, locate the highest-priority reproducible build or test failure, fix it without broadening product scope, and verify the correction."
    }

    $prompt = @"
Read AGENTS.md and the authoritative SAFE_FAST_PATH documents before editing.

Requested scope: $Scope
Requested task:
$requestedTask

Mandatory constraints:
- Keep TRADING_MODE=paper, EXCHANGE_MODE=paper, NETWORK=testnet, and ALLOW_MAINNET=false.
- Do not deploy, merge, publish, promote, migrate a remote database, alter billing, expose secrets, connect exchange write credentials, place orders, transfer funds, or enable withdrawals.
- Work only inside this repository workspace.
- Inspect existing implementation before changing it.
- Make the smallest safe change that addresses a reproduced defect.
- Run the relevant validation commands before finishing.
- Leave changes uncommitted for human review and report exact files, tests, and remaining blockers.
"@

    $codexArguments = @(
        '-C', $RepoRoot,
        '--sandbox', 'workspace-write',
        '--ask-for-approval', 'on-request',
        '--ignore-user-config',
        '--disable', 'plugins',
        'exec', '--ephemeral', $prompt
    )

    Invoke-External -Label 'Run Codex in isolated workspace-write sandbox' -FilePath $codex.Source -Arguments $codexArguments
}

function Run-Diagnostics {
    Write-Section 'Repository diagnostics'
    Invoke-External -Label 'Verify CI independence and release lock' -FilePath 'npm' -Arguments @('run', 'verify:ci-independence')
    Invoke-External -Label 'Show recent commit' -FilePath 'git' -Arguments @('log', '-1', '--oneline', '--decorate')
}

function Run-FrontendValidation {
    Write-Section 'Frontend validation'
    Ensure-RootDependencies
    Invoke-External -Label 'Frontend lint' -FilePath 'npm' -Arguments @('run', 'lint')
    Invoke-External -Label 'Frontend typecheck' -FilePath 'npm' -Arguments @('run', 'typecheck')
    Invoke-External -Label 'Frontend tests' -FilePath 'npm' -Arguments @('run', 'test:run')
    Invoke-External -Label 'Frontend production build' -FilePath 'npm' -Arguments @('run', 'build')
}

function Run-WorkerValidation {
    Write-Section 'Worker validation'
    Ensure-RootDependencies
    Ensure-WorkerDependencies
    Invoke-External -Label 'Worker TypeScript build' -FilePath 'npm' -Arguments @('--prefix', 'worker', 'run', 'build')
    Invoke-External -Label 'Worker paper-safety verification' -FilePath 'npm' -Arguments @('--prefix', 'worker', 'run', 'verify:paper-safety')
    Invoke-External -Label 'Worker tests' -FilePath 'npm' -Arguments @('run', 'test:worker')
}

function Run-BackendValidation {
    Write-Section 'Backend validation'

    $venvPath = Join-Path $RepoRoot '.venv-agent'
    $venvPython = if ($RunningOnWindows) {
        Join-Path $venvPath 'Scripts/python.exe'
    }
    else {
        Join-Path $venvPath 'bin/python'
    }

    if (-not (Test-Path $venvPython)) {
        Invoke-Python -Label 'Create isolated Python environment' -Arguments @('-m', 'venv', $venvPath)
    }

    if (-not $SkipInstall) {
        Invoke-External -Label 'Upgrade isolated pip' -FilePath $venvPython -Arguments @('-m', 'pip', 'install', '--upgrade', 'pip')
        Invoke-External -Label 'Install backend dependencies' -FilePath $venvPython -Arguments @('-m', 'pip', 'install', '-r', 'backend/requirements.txt')
    }

    Invoke-External -Label 'Compile backend entrypoints' -FilePath $venvPython -Arguments @('-m', 'py_compile', 'backend/app.py', 'backend/public_app.py')
    Invoke-External -Label 'Run backend tests' -FilePath $venvPython -Arguments @('-m', 'pytest', 'backend/tests/', '-x', '-q')
    Invoke-External -Label 'Run repository audit' -FilePath $venvPython -Arguments @('scripts/repo_audit.py')
}

Assert-Environment

if ($UseCodex) {
    Run-CodexAgent
}

switch ($Scope) {
    'diagnose' {
        Run-Diagnostics
    }
    'frontend' {
        Run-FrontendValidation
    }
    'backend' {
        Run-BackendValidation
    }
    'worker' {
        Run-WorkerValidation
    }
    'full' {
        Run-Diagnostics
        Run-FrontendValidation
        Run-WorkerValidation
        Run-BackendValidation
    }
}

Write-Section 'Completed'
Write-Host "Scope '$Scope' completed under paper/testnet safety constraints." -ForegroundColor Green
Write-Host 'No deployment, merge, remote migration, live trade, transfer, or withdrawal action was performed.' -ForegroundColor Green
