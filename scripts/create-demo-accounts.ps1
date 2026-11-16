<#
.SYNOPSIS
  Create the demo logins (citizen, ward officer, field worker) on the local Docker app or on AWS.

.DESCRIPTION
  Public registration only creates citizens, so the officer and worker are created by
  an administrator. This script creates three accounts and stores their random
  passwords in D:\AWSConfig\civichelp-demo-accounts.txt (OUTSIDE the Git repository,
  because the AWS site is reachable from the internet).

    citizen@civichelp.demo   officer@civichelp.demo   worker@civichelp.demo

  Run again any time; existing accounts are left unchanged unless -ResetPasswords is given.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\create-demo-accounts.ps1 -Target Local
    powershell -ExecutionPolicy Bypass -File scripts\create-demo-accounts.ps1 -Target Aws
#>
[CmdletBinding()]
param(
    [ValidateSet('Local', 'Aws')][string]$Target = 'Local',
    [switch]$ResetPasswords
)
. "$PSScriptRoot\_common.ps1"
Write-Banner "Create demo accounts ($Target)"

function New-DemoPassword {
    $words = 'river','maple','falcon','amber','cedar','lotus','coral','harbor','meadow','pixel','summit','willow'
    $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
    $b = New-Object byte[] 4; $rng.GetBytes($b)
    $a = $words[$b[0] % $words.Count]; $c = $words[$b[1] % $words.Count]
    $n = 1000 + ([BitConverter]::ToUInt16($b, 2) % 9000)
    return "$a-$c-$n"
}

# ---- Passwords: create the file once, then reuse -----------------------------
$accounts = @(
    @{ Role = 'citizen'; Name = 'Demo Citizen';       Email = 'citizen@civichelp.demo' },
    @{ Role = 'officer'; Name = 'Ward Officer (Demo)'; Email = 'officer@civichelp.demo' },
    @{ Role = 'worker';  Name = 'Field Worker (Demo)'; Email = 'worker@civichelp.demo' }
)
$known = @{}
if (Test-Path $script:DemoFile) {
    foreach ($line in (Get-Content $script:DemoFile)) {
        if ($line -match '^\s*(citizen|officer|worker)\s+(\S+)\s+(\S+)\s*$') { $known[$Matches[1]] = $Matches[3] }
    }
}
$changed = $false
foreach ($a in $accounts) {
    if (-not $known.ContainsKey($a.Role)) { $known[$a.Role] = New-DemoPassword; $changed = $true }
    $a.Password = $known[$a.Role]
}
if ($changed -or -not (Test-Path $script:DemoFile)) {
    $lines = @('# CivicHelp demo logins (keep private - do not commit)', '# role  email  password')
    foreach ($a in $accounts) { $lines += ('{0}  {1}  {2}' -f $a.Role, $a.Email, $a.Password) }
    [IO.File]::WriteAllText($script:DemoFile, (($lines -join "`r`n") + "`r`n"), (New-Object Text.UTF8Encoding $false))
    Write-Ok "Passwords saved to $($script:DemoFile)"
}

$reset = ''
if ($ResetPasswords) { $reset = ' --reset-password' }
$staff = @($accounts | Where-Object { $_.Role -ne 'citizen' })
$citizen = $accounts | Where-Object { $_.Role -eq 'citizen' }

if ($Target -eq 'Local') {
    Write-Step 'Staff accounts in the local Docker backend'
    Push-Location $script:ProjectDir
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'   # native stderr (warnings) must not abort the script in PS 5.1
    try {
        foreach ($a in $staff) {
            $cliArgs = @('compose', 'exec', '-T', 'backend', 'node', 'scripts/create-staff.js', $a.Role, $a.Name, $a.Email, $a.Password)
            if ($ResetPasswords) { $cliArgs += '--reset-password' }
            $out = & docker @cliArgs 2>&1 | Out-String
            if ($LASTEXITCODE -ne 0) { Stop-WithError "Could not create $($a.Role)." @('Is the app running?  docker compose ps', $out.Trim()) }
            Write-Ok ($out.Trim() -split "`n" | Select-Object -Last 1)
        }
    } finally { $ErrorActionPreference = $prevEap; Pop-Location }
    $base = 'http://localhost'
} else {
    Assert-AwsCredentials
    $info = Get-InstanceInfo
    if ($info.State -ne 'running' -or -not $info.Ip) { Stop-WithError 'The EC2 instance is not running.' @('Start it first: scripts\start-civichelp.ps1') }
    Write-Step 'Staff accounts on EC2 (through SSH)'
    if (-not (Test-SshPort $info.Ip)) {
        Stop-WithError 'SSH port 22 is not reachable from this PC (your public IP probably changed).' @('Run:  powershell -ExecutionPolicy Bypass -File scripts\update-ssh-access.ps1')
    }
    $sh = "set -e`ncd ~/civichelp`n"
    foreach ($a in $staff) {
        # </dev/null: the script itself arrives on stdin, so docker must not read (and swallow) it.
        $sh += ('docker compose exec -T backend node scripts/create-staff.js {0} "{1}" {2} {3}{4} </dev/null' -f $a.Role, $a.Name, $a.Email, $a.Password, $reset) + "`n"
    }
    $r = Invoke-RemoteScript -Ip $info.Ip -ScriptText $sh
    if ($r.ExitCode -ne 0) { Stop-WithError 'Creating the staff accounts over SSH failed.' @($r.Output) }
    foreach ($l in ($r.Output -split "`n" | Where-Object { $_ -match 'account' })) { Write-Ok $l.Trim() }
    $base = "http://$($info.Ip)"
}

Write-Step 'Citizen account (normal registration through the public API)'
try {
    $body = @{ name = $citizen.Name; email = $citizen.Email; password = $citizen.Password } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "$base/api/auth/register" -ContentType 'application/json' -Body $body -TimeoutSec 20 | Out-Null
    Write-Ok "Created citizen account: $($citizen.Email)"
} catch {
    $code = $null; try { $code = [int]$_.Exception.Response.StatusCode } catch {}
    if ($code -eq 409) { Write-Ok "Citizen account already exists: $($citizen.Email)" }
    else { Stop-WithError "Could not register the citizen account (HTTP $code)." @($_.Exception.Message) }
}

Write-Step 'Verifying that all three can log in'
foreach ($a in $accounts) {
    try {
        $body = @{ email = $a.Email; password = $a.Password } | ConvertTo-Json
        $r = Invoke-RestMethod -Method Post -Uri "$base/api/auth/login" -ContentType 'application/json' -Body $body -TimeoutSec 20
        if ($r.user.role -eq $a.Role) { Write-Ok "$($a.Role) login works" } else { Write-Warn "$($a.Role): unexpected role '$($r.user.role)'" }
    } catch { Write-Warn "$($a.Role) login FAILED - existing account with a different password? Use -ResetPasswords." }
}
Write-Host ''
Write-Host "   Passwords: open $($script:DemoFile)" -ForegroundColor Gray
Write-Host ''
