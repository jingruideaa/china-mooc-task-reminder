param([Parameter(Mandatory=$true)][string]$ReportPath,[Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not ('MoocCredentialStore' -as [type])) { Add-Type -Path (Join-Path $projectRoot 'bridge\CredentialStore.cs') }
$credentialUser = $null
$secret = [MoocCredentialStore]::Read($config.smtp.credentialTarget, [ref]$credentialUser)
if (-not $secret -or $credentialUser -ne $config.smtp.username) { throw 'SMTP credential is missing or does not match the configured account.' }
if (-not $config.smtp.enableSsl) { throw 'TLS is required for SMTP.' }
try {
    $chinaNow = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([datetime]::UtcNow, 'China Standard Time')
    # ReadAllText returns plain text without PowerShell file metadata in JSON.
    $reportBody = [IO.File]::ReadAllText($ReportPath, [Text.Encoding]::UTF8)
    $payload = @{ smtp = $config.smtp; password = $secret; body = $reportBody; subject = ('MOOC daily report ' + $chinaNow.ToString('yyyy-MM-dd')) } | ConvertTo-Json -Depth 6 -Compress
    $OutputEncoding = [Text.UTF8Encoding]::new($false)
    $payload | & node (Join-Path $projectRoot 'bridge\smtp-cli.js')
    if ($LASTEXITCODE -ne 0) { throw 'Mail delivery failed.' }
} finally { $secret = $null; $payload = $null }
