# Launches the Budget Planner: starts the local dev server if it isn't
# already running, then opens the app in the default browser.
# The address must stay http://localhost:5173 — saved data is tied to it.

$ErrorActionPreference = 'Stop'
$appUrl = 'http://localhost:5173'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeDir = 'C:\Program Files\nodejs'

function Test-PlannerRunning {
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $client.Connect('127.0.0.1', 5173)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-PlannerRunning)) {
  if (Test-Path $nodeDir) { $env:Path = "$nodeDir;$env:Path" }

  # Start Vite in a hidden window so it keeps running after this script exits.
  Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/c', 'npm run dev' `
    -WorkingDirectory $projectDir `
    -WindowStyle Hidden

  # Give the server up to ~20 seconds to come up before opening the browser.
  $waited = 0
  while (-not (Test-PlannerRunning) -and $waited -lt 40) {
    Start-Sleep -Milliseconds 500
    $waited++
  }

  if (-not (Test-PlannerRunning)) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      "The planner's local server did not start. Try running 'npm install' in $projectDir once, then launch again.",
      'Budget Planner'
    ) | Out-Null
    exit 1
  }
}

Start-Process $appUrl
