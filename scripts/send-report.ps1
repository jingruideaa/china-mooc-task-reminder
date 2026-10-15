param([Parameter(Mandatory=$true)][string]$ReportPath,[Parameter(Mandatory=$true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not ('MoocCredentialStore' -as [type])) { Add-Type -Path (Join-Path $projectRoot 'bridge\CredentialStore.cs') }
$credentialUser = $null
$secret = [MoocCredentialStore]::Read($config.smtp.credentialTarget, [ref]$credentialUser)
if (-not $secret -or $credentialUser -ne $config.smtp.username) { throw 'SMTP credential is missing or does not match the configured account.' }
if (-not $config.smtp.enableSsl) { throw 'TLS is required for SMTP.' }
$mail = [Net.Mail.MailMessage]::new()
$smtp = [Net.Mail.SmtpClient]::new([string]$config.smtp.host, [int]$config.smtp.port)
try {
    $mail.From = [Net.Mail.MailAddress]::new([string]$config.smtp.from)
    foreach ($recipient in $config.smtp.to) { $mail.To.Add([string]$recipient) }
    $chinaNow = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([datetime]::UtcNow, 'China Standard Time')
    $mail.Subject = 'MOOC daily report ' + $chinaNow.ToString('yyyy-MM-dd')
    $mail.SubjectEncoding = [Text.Encoding]::UTF8
    $mail.Body = Get-Content -LiteralPath $ReportPath -Raw -Encoding UTF8
    $mail.BodyEncoding = [Text.Encoding]::UTF8
    $smtp.EnableSsl = $true
    $smtp.Timeout = 16000
    $smtp.Credentials = [Net.NetworkCredential]::new($credentialUser, $secret)
    $smtp.Send($mail)
    Write-Output 'Mail sent successfully.'
} finally { $smtp.Dispose(); $mail.Dispose(); $secret = $null }
