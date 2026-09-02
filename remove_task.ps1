# Undoes install_task.ps1: stops and deletes the scheduled task. Must be run
# elevated. Does not kill an already-running node.exe process started by the
# task — stop that separately (Stop-ScheduledTask only prevents future runs;
# see the Get-Process line below) if you need it down immediately.

$ErrorActionPreference = 'Stop'
$TaskName = 'Nipo Music Server'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host "No task named '$TaskName' is registered — nothing to remove."
} else {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task '$TaskName'."
}

Write-Host "Note: this does not stop a node.exe process the task already started."
Write-Host "To find and stop it manually:"
Write-Host '  Get-CimInstance Win32_Process -Filter "Name=''node.exe''" | Where-Object { $_.CommandLine -like "*navidrome-client*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }'
