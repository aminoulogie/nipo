# Registers the nipo music server as an always-on Windows Task Scheduler task.
# Must be run elevated (as Administrator) — the SYSTEM principal requires it.
#
#   - Runs at system startup, under SYSTEM, whether or not anyone is logged in
#   - Restarts automatically if the node process exits (crash), every 1 minute,
#     up to 999 times (effectively "keep trying forever")
#   - No execution time limit (Task Scheduler's default kills tasks after 72
#     hours — that would silently take the server down every 3 days)
#   - stdout/stderr redirected to server.log next to server.js, since Task
#     Scheduler does not capture console output on its own

$ErrorActionPreference = 'Stop'

$TaskName   = 'Nipo Music Server'
$AppDir     = 'C:\Users\pro\Desktop\navidrome-client'
$NodeExe    = 'C:\Program Files\nodejs\node.exe'
$ServerJs   = Join-Path $AppDir 'server.js'
$LogFile    = Join-Path $AppDir 'server.log'

if (-not (Test-Path $NodeExe)) { throw "node.exe not found at $NodeExe" }
if (-not (Test-Path $ServerJs)) { throw "server.js not found at $ServerJs" }

# cmd.exe wraps the call purely to redirect output — Task Scheduler itself
# does not capture stdout/stderr from the action it launches.
$cmdArgs = "/c `"cd /d `"$AppDir`" && `"$NodeExe`" `"$ServerJs`" >> `"$LogFile`" 2>&1`""

$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $cmdArgs -WorkingDirectory $AppDir
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

# Start it immediately too, rather than making the user reboot to see it running.
Start-ScheduledTask -TaskName $TaskName

Start-Sleep -Seconds 2
$info = Get-ScheduledTaskInfo -TaskName $TaskName
Write-Host "Registered and started '$TaskName'. Last run result: $($info.LastTaskResult) (0 = success/still running)"
Write-Host "Logs: $LogFile"
