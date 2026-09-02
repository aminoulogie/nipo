# Registers the nipo music server as an always-on Windows Task Scheduler task.
# Must be run elevated (as Administrator) — the SYSTEM principal requires it.
#
#   - Runs at system startup, under SYSTEM, whether or not anyone is logged in
#   - Restarts automatically if the node process exits, every 1 minute, up to
#     999 times (effectively "keep trying")
#   - No execution time limit; Task Scheduler otherwise kills a task after 72
#     hours, which would silently take the server down every three days
#   - stdout/stderr redirected to server.log next to server.js, since Task
#     Scheduler does not capture console output on its own

$ErrorActionPreference = 'Stop'

$TaskName = 'Nipo Music Server'
# This must be the live tree. C:\Users\pro\Desktop\navidrome-client is an old
# abandoned copy — pointing the task at it would serve a stale app every boot.
$AppDir   = 'C:\Users\pro\nipo'
$NodeExe  = 'C:\Program Files\nodejs\node.exe'
$ServerJs = Join-Path $AppDir 'server.js'
$LogFile  = Join-Path $AppDir 'server.log'

if (-not (Test-Path $NodeExe))  { throw "node.exe not found at $NodeExe" }
if (-not (Test-Path $ServerJs)) { throw "server.js not found at $ServerJs" }

# cmd.exe wraps the call purely to redirect output — Task Scheduler itself does
# not capture stdout/stderr from the action it launches.
$cmdArgs = "/c `"cd /d `"$AppDir`" && `"$NodeExe`" `"$ServerJs`" >> `"$LogFile`" 2>&1`""

$action  = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmdArgs -WorkingDirectory $AppDir
$trigger = New-ScheduledTaskTrigger -AtStartup

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0)   # 0 = unlimited

$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Registered '$TaskName' -> $ServerJs"

# Only start it now if nothing already holds the port, otherwise the task's node
# process would exit immediately with EADDRINUSE.
$inUse = Get-NetTCPConnection -LocalPort 4534 -State Listen -ErrorAction SilentlyContinue
if ($inUse) {
  Write-Host ""
  Write-Host "Port 4534 is already in use, so the task was NOT started now."
  Write-Host "Close the server you are running by hand, then run:"
  Write-Host "    Start-ScheduledTask -TaskName '$TaskName'"
  Write-Host "It will start on its own at the next reboot either way."
} else {
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 3
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host "Started. Last run result: $($info.LastTaskResult)  (0 = running/success)"
}

Write-Host "Logs: $LogFile"
