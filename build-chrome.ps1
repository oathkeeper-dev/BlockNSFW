# build-chrome.ps1
# Compatibility wrapper for the cross-platform Node build.
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\build-chrome.ps1
#   powershell -ExecutionPolicy Bypass -File .\build-chrome.ps1 -Zip

[CmdletBinding()]
param(
    [switch]$Zip
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeArgs = @((Join-Path $ScriptDir "scripts\build-extension.mjs"), "--target", "chrome")
if ($Zip) { $NodeArgs += "--zip" }

& node @NodeArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
