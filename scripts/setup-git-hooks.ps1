$ErrorActionPreference = "Stop"

if (-not (Test-Path ".git")) {
  Write-Error "Run this script from a git repository root."
  exit 1
}

git config core.hooksPath .githooks
Write-Host "Configured git hooks path to .githooks"
