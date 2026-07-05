# Rebuild and restart 9Router CLI so source changes go live.
# Self-contained and resilient: stops the running server, rebuilds, restarts
# detached, and logs everything to a file so the result survives even if the
# chat connection (which routes through the server) drops mid-rebuild.
$ErrorActionPreference = "Continue"
$root = "C:\Users\Aldrey\Desktop\9router-fix-OpenCode"
$log  = Join-Path $env:TEMP "9router-rebuild.log"
Set-Location $root
"=== rebuild start $(Get-Date -Format o) ===" | Out-File $log

# 1. Stop the running server (parent cli.js + child custom-server.js)
"--- stopping node servers ---" | Out-File $log -Append
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match "cli\\cli\.js|cli\\app\\custom-server\.js" } |
  ForEach-Object {
    "killing PID $($_.ProcessId): $($_.CommandLine)" | Out-File $log -Append
    try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch { "  kill failed: $($_.Exception.Message)" | Out-File $log -Append }
  }
Start-Sleep -Seconds 2

# 2. Rebuild CLI (compiles src/ + open-sse/ into cli/app/)
"--- npm --prefix cli run build ---" | Out-File $log -Append
& npm --prefix cli run build *>> $log
$buildExit = $LASTEXITCODE
"build exit code: $buildExit" | Out-File $log -Append

if ($buildExit -ne 0) {
  "BUILD FAILED - not restarting. Inspect log above (likely EPERM if a process still holds cli/app)." | Out-File $log -Append
  exit $buildExit
}

# 3. Restart server detached so it outlives this script
"--- restarting server ---" | Out-File $log -Append
$serverLog = Join-Path $env:TEMP "9router-server.log"
$serverErr = Join-Path $env:TEMP "9router-server.err.log"
Start-Process -FilePath "node" -ArgumentList "cli\cli.js" -WorkingDirectory $root `
  -RedirectStandardOutput $serverLog -RedirectStandardError $serverErr `
  -WindowStyle Hidden
"server launched, stdout to $serverLog" | Out-File $log -Append
"=== rebuild done $(Get-Date -Format o) ===" | Out-File $log -Append
