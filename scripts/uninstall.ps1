$ErrorActionPreference = 'Stop'
$taskName = 'ChinaMOOC-MailBridge'
$projectRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $projectRoot '.local\mail-bridge.vbs'
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    if ($task.Actions.Arguments -notcontains "`"$launcher`"") { throw 'The installed task belongs to another folder; it was not removed.' }
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Write-Output 'Mail bridge task removed. Remove the browser extension in Edge. Local reports, settings and Windows credentials were preserved.'
