# Restarts the nipo server so changes to server.js take effect.
# Must be run elevated: the task runs as SYSTEM, so its node process cannot be
# stopped from a normal session.
#
# Stop-ScheduledTask on its own is not enough. The task action is
# cmd.exe -> node.exe, and stopping the task ends the cmd wrapper while the
# node child survives as an orphan still holding port 4534. The next start
# then dies with EADDRINUSE and the stale build keeps serving, which looks
# exactly like "my changes did not deploy".

$ErrorActionPreference = 'Stop'
$TaskName = 'Nipo Music Server'
$Port = 4534

Write-Host "Stopping scheduled task..."
try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop } catch { Write-Host "  (task was not running)" }

# Kill whatever still holds the port, orphan or not.
Start-Sleep -Milliseconds 500
$holders = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
foreach ($h in $holders) {
  Write-Host "Killing leftover process $($h.OwningProcess) still on port $Port..."
  try { Stop-Process -Id $h.OwningProcess -Force -ErrorAction Stop } catch { Write-Warning $_ }
}

# Wait for the port to actually clear before starting again.
for ($i = 0; $i -lt 20; $i++) {
  if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 250
}

Write-Host "Starting scheduled task..."
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3

$now = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($now) {
  Write-Host "Server is listening on port $Port (pid $($now[0].OwningProcess))."
} else {
  Write-Warning "Nothing is listening on port $Port. Check C:\Users\pro\nipo\server.log"
}
