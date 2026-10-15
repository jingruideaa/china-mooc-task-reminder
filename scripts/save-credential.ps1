param([string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ConfigPath) { $ConfigPath = Join-Path $projectRoot '.local\config.json' }
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $config.smtp.username -or $config.smtp.username -like '*@example.com') { throw 'Set your own email with npm run setup -- --email YOUR_EMAIL first.' }
if (-not ('MoocCredentialStore' -as [type])) { Add-Type -Path (Join-Path $projectRoot 'bridge\CredentialStore.cs') }
$secret = Read-Host 'QQ SMTP authorization code (input is hidden)' -AsSecureString
$plain = [Net.NetworkCredential]::new('', $secret).Password
try { [MoocCredentialStore]::Write($config.smtp.credentialTarget, $config.smtp.username, $plain) }
finally { $plain = $null; $secret.Dispose() }
Write-Output 'SMTP credential saved in Windows Credential Manager.'
