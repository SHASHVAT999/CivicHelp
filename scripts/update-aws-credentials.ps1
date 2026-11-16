<#
.SYNOPSIS
  Securely store fresh AWS Academy (Learner Lab) credentials and check that they work.

.DESCRIPTION
  AWS Academy credentials expire when the lab session ends. Run this script each
  time you start a new lab session:

    1. In AWS Academy open the Learner Lab and click "Start Lab" (wait for the green dot).
    2. Click "AWS Details", then "AWS CLI: Show".
    3. Click the copy icon (or select the whole block starting with [default]).
    4. Run:   powershell -ExecutionPolicy Bypass -File scripts\update-aws-credentials.ps1

  The script reads the block from the clipboard (nothing is typed or echoed),
  tests it against AWS, and only then saves it. The credentials never leave
  your PC and are written to D:\AWSConfig\credentials (outside the Git repository).

.PARAMETER FromFile
  Read the credentials block from a text file instead of the clipboard.
.PARAMETER CredentialsFile
  Where to save the credentials (default: $env:AWS_SHARED_CREDENTIALS_FILE or D:\AWSConfig\credentials).
.PARAMETER Manual
  Enter the three values one at a time (input is hidden).
#>
[CmdletBinding()]
param(
    [string]$FromFile,
    [string]$CredentialsFile,
    [switch]$Manual
)
. "$PSScriptRoot\_common.ps1"
Write-Banner 'Update AWS Academy credentials'
Assert-AwsCli

if (-not $CredentialsFile) { $CredentialsFile = $env:AWS_SHARED_CREDENTIALS_FILE }

function Read-Block {
    $usedClipboard = $false
    $text = $null
    if ($FromFile) {
        if (-not (Test-Path $FromFile)) { Stop-WithError "File not found: $FromFile" }
        $text = Get-Content -Raw -Path $FromFile
    } elseif (-not $Manual) {
        for ($i = 0; $i -lt 3; $i++) {
            $clip = $null
            try { $clip = Get-Clipboard -Raw } catch {}
            if ($clip -and $clip -match 'aws_access_key_id') { $text = $clip; $usedClipboard = $true; Write-Ok 'Found AWS credentials on the clipboard'; break }
            if (-not (Test-Interactive)) { break }
            Write-Host ''
            Write-Host '   No AWS credentials found on the clipboard.' -ForegroundColor Yellow
            Write-Host '   In AWS Academy: Start Lab > AWS Details > AWS CLI: Show > click the copy icon.' -ForegroundColor Gray
            $a = Read-Host '   Press Enter after copying (or type M to enter the values manually, Q to quit)'
            if ($a -match '^[mM]') { $Manual = $true; break }
            if ($a -match '^[qQ]') { exit 1 }
        }
    }
    if (-not $text -and $Manual -and (Test-Interactive)) {
        Write-Host '   Enter the three values (input is hidden).' -ForegroundColor Gray
        $vals = @()
        foreach ($name in 'aws_access_key_id', 'aws_secret_access_key', 'aws_session_token') {
            $s = Read-Host "   $name" -AsSecureString
            $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
            try { $vals += ('{0}={1}' -f $name, [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)) }
            finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        }
        $text = $vals -join "`n"
    }
    if (-not $text) {
        Stop-WithError 'No credentials were provided.' @(
            'Copy the "AWS CLI" block from AWS Academy (AWS Details > AWS CLI: Show) and run this script again.')
    }
    return [pscustomobject]@{ Text = $text; UsedClipboard = $usedClipboard }
}

function Get-Field {
    param([string]$Text, [string]$Name)
    $m = [regex]::Match($Text, "(?im)^\s*(?:export\s+|set\s+|`$env:)?$Name\s*=\s*[`"']?([^`"'\s]+)")
    if ($m.Success) { return $m.Groups[1].Value }
    return $null
}

$block = Read-Block
$key    = Get-Field $block.Text 'aws_access_key_id'
$secret = Get-Field $block.Text 'aws_secret_access_key'
$token  = Get-Field $block.Text 'aws_session_token'

$missing = @()
if (-not $key)    { $missing += 'aws_access_key_id' }
if (-not $secret) { $missing += 'aws_secret_access_key' }
if (-not $token)  { $missing += 'aws_session_token' }
if ($missing.Count -gt 0) {
    Stop-WithError ('The pasted text is missing: ' + ($missing -join ', ')) @(
        'Copy the COMPLETE block (all three lines, starting with [default]) from AWS Details > AWS CLI: Show.')
}

# 1) Test the new credentials BEFORE saving anything (environment variables win over files).
Write-Step 'Testing the new credentials with AWS'
$old = @{ K = $env:AWS_ACCESS_KEY_ID; S = $env:AWS_SECRET_ACCESS_KEY; T = $env:AWS_SESSION_TOKEN }
$env:AWS_ACCESS_KEY_ID = $key; $env:AWS_SECRET_ACCESS_KEY = $secret; $env:AWS_SESSION_TOKEN = $token
try { $test = Invoke-Aws sts get-caller-identity --query Arn --output text }
finally { $env:AWS_ACCESS_KEY_ID = $old.K; $env:AWS_SECRET_ACCESS_KEY = $old.S; $env:AWS_SESSION_TOKEN = $old.T }
if ($test.ExitCode -ne 0) {
    Stop-WithError 'AWS rejected these credentials (nothing was saved).' @(
        'They are expired or were copied incompletely.',
        'In AWS Academy click "Start Lab", wait for the green dot, then copy AWS Details > AWS CLI again.')
}
$parts = $test.Output -split '/'
$who = if ($parts.Count -ge 2) { $parts[1] } else { 'unknown role' }
Write-Ok "AWS accepted the credentials (role: $who)"

# 2) Save: replace only the [default] section and keep any other profiles.
Write-Step "Saving to $CredentialsFile"
$dir = Split-Path -Parent $CredentialsFile
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$others = @()
if (Test-Path $CredentialsFile) {
    $skip = $false
    foreach ($line in (Get-Content -Path $CredentialsFile)) {
        if ($line -match '^\s*\[(.+)\]\s*$') { $skip = ($Matches[1].Trim() -eq 'default') }
        if (-not $skip) { $others += $line }
    }
    while ($others.Count -gt 0 -and [string]::IsNullOrWhiteSpace($others[0])) { $others = $others[1..($others.Count - 1)] }
}
$content = @('[default]', "aws_access_key_id=$key", "aws_secret_access_key=$secret", "aws_session_token=$token")
if ($others.Count -gt 0) { $content += ''; $content += $others }
[IO.File]::WriteAllText($CredentialsFile, (($content -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))
Write-Ok 'Credentials saved'

# 3) Verify using the saved file (no environment variables).
Write-Step 'Verifying the saved file'
$saved = $env:AWS_SHARED_CREDENTIALS_FILE
$env:AWS_SHARED_CREDENTIALS_FILE = $CredentialsFile
try { $check = Invoke-Aws sts get-caller-identity --query Arn --output text }
finally { $env:AWS_SHARED_CREDENTIALS_FILE = $saved }
if ($check.ExitCode -ne 0) { Stop-WithError 'The saved file does not work. Run this script again.' }
Write-Ok 'Saved credentials work'

if ($block.UsedClipboard) {
    try { Set-Clipboard -Value ' '; Write-Ok 'Clipboard cleared (the secrets are no longer on it)' } catch {}
}
Write-Host ''
Write-Host '   Learner Lab credentials last until the lab session ends (about 4 hours).' -ForegroundColor Gray
Write-Host '   Next:  powershell -ExecutionPolicy Bypass -File scripts\start-civichelp.ps1' -ForegroundColor Gray
Write-Host ''
