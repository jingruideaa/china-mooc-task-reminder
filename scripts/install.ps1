param([switch]$ReplaceExisting)
$ErrorActionPreference = 'Stop'
$taskName = 'ChinaMOOC-MailBridge'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localRoot = Join-Path $projectRoot '.local'
if (-not (Test-Path -LiteralPath (Join-Path $localRoot 'config.json'))) { throw 'Run npm run setup first.' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$script = Join-Path $projectRoot 'bridge\start.js'
$launcher = Join-Path $localRoot 'mail-bridge.vbs'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Actions.Arguments -notcontains "`"$launcher`"" -and -not $ReplaceExisting) { throw 'A MOOC bridge from another folder is already installed. See the migration guide, or explicitly use -ReplaceExisting.' }
if ($existing) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
$command = '"' + $node + '" "' + $script + '"'
$vbs = 'Set shell = CreateObject("WScript.Shell")' + "`r`n" + 'WScript.Quit shell.Run("' + $command.Replace('"','""') + '", 0, True)'
[IO.File]::WriteAllText($launcher, $vbs, [Text.Encoding]::Unicode)
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wscript.exe" -Argument "`"$launcher`"" -WorkingDirectory $projectRoot
$taskUser = "$env:USERDOMAIN\$env:USERNAME"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$principal = New-ScheduledTaskPrincipal -UserId $taskUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([timespan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Local-only China MOOC email bridge, started at Windows logon' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State
