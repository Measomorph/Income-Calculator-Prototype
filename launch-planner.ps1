# Launches the Budget Planner: starts the local dev server if it isn't
# already running, then opens the app in the default browser.
# The address must stay http://localhost:5173 — saved data is tied to it.

$ErrorActionPreference = 'Stop'
# Open via "localhost" — saved planner data belongs to that origin. Probe via
# the literal IPv4 address the server binds to: resolving "localhost" tries the
# IPv6 loopback first and stalls for seconds before falling back.
$appUrl = 'http://localhost:5173'
$probeUrl = 'http://127.0.0.1:5173'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$nodeDir = 'C:\Program Files\nodejs'

# Trace to a log file so a silent failure can be diagnosed.
$logPath = Join-Path $projectDir 'launch-planner.log'
function Write-Log($message) {
  "$(Get-Date -Format 'HH:mm:ss')  $message" | Add-Content -Path $logPath -Encoding utf8
}
Write-Log "--- launch requested ---"

# Ask over HTTP rather than opening a raw socket: this follows whatever
# localhost resolves to (IPv4 or IPv6), which a fixed-family TcpClient does not.
function Test-PlannerRunning {
  try {
    $request = [System.Net.WebRequest]::Create($probeUrl)
    $request.Timeout = 1500
    $request.Method = 'HEAD'
    # Skip WPAD proxy auto-discovery, which adds seconds to every local probe.
    $request.Proxy = $null
    $response = $request.GetResponse()
    $response.Close()
    return $true
  } catch [System.Net.WebException] {
    # A protocol error still proves something is listening and answering.
    return ($_.Exception.Response -ne $null)
  } catch {
    return $false
  }
}

if (Test-PlannerRunning) {
  Write-Log 'server already running'
} else {
  Write-Log 'server not running - starting vite'
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
    Write-Log 'FAILED: server did not come up'
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
      "The planner's local server did not start. Try running 'npm install' in $projectDir once, then launch again.",
      'Budget Planner'
    ) | Out-Null
    exit 1
  }
  Write-Log 'server is up'
}

# explorer.exe hands the URL to the default browser reliably, even when this
# script runs with no console attached (Start-Process can fail silently there).
Write-Log "opening $appUrl"
try {
  Start-Process 'explorer.exe' -ArgumentList $appUrl
  Write-Log 'browser launch requested'
} catch {
  Write-Log "browser launch FAILED: $_"
  exit 1
}
