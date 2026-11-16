<#
.SYNOPSIS
  Show the state of the CivicHelp EC2 instance and the health of the application.

  Usage:  powershell -ExecutionPolicy Bypass -File scripts\status-civichelp.ps1
#>
[CmdletBinding()]
param()
. "$PSScriptRoot\_common.ps1"
Write-Banner 'CivicHelp status'

Write-Step 'AWS credentials'
if (-not (Test-AwsCredentials)) {
    Write-Warn 'Credentials are missing or expired - AWS cannot be queried.'
    Write-Info 'Fix:  powershell -ExecutionPolicy Bypass -File scripts\update-aws-credentials.ps1'
    $last = Get-LastIp
    if ($last) {
        Write-Step "Trying the last known address ($last) anyway"
        $h = Get-AppHealth -Ip $last
        Write-HealthLines $h
        if ($h.Frontend) { Write-Info "The site is still reachable at http://$last" }
    }
    exit 1
}
Write-Ok 'Credentials are valid'

Write-Step "EC2 instance $($script:InstanceId)"
$info = Get-InstanceInfo
$color = if ($info.State -eq 'running') { 'Green' } elseif ($info.State -eq 'stopped') { 'Yellow' } else { 'Cyan' }
Write-Host "   State       : $($info.State)" -ForegroundColor $color
Write-Info "Type / zone : $($info.Type) / $($info.Az)"
if ($info.Ip) { Write-Info "Public IP   : $($info.Ip)"; Save-LastIp $info.Ip } else { Write-Info 'Public IP   : (none while stopped)' }

if ($info.State -eq 'running' -and $info.Ip) {
    Write-Step 'Application health'
    $health = Get-AppHealth -Ip $info.Ip
    Write-HealthLines $health
    Write-Step 'SSH access from this PC (only needed for admin tasks)'
    $mine = Get-CurrentPublicIp
    $q = 'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[].CidrIp'
    $r = Invoke-Aws ec2 describe-security-groups --group-ids $info.Sg --query $q --output text
    if ($mine -and $r.ExitCode -eq 0) {
        if (($r.Output -split '\s+') -contains "$mine/32") { Write-Ok 'Your current IP is allowed to SSH' }
        else { Write-Warn 'Your IP changed - SSH is blocked (the website is not affected).'; Write-Info 'Fix:  powershell -ExecutionPolicy Bypass -File scripts\update-ssh-access.ps1' }
    }
    Write-Host ''
    if ($health.Frontend -and $health.Api -and $health.Database) {
        Write-Host "   CivicHelp is LIVE:  http://$($info.Ip)" -ForegroundColor Green
    } else {
        Write-Host '   The instance is running but the app is not healthy (it may still be booting).' -ForegroundColor Yellow
    }
} elseif ($info.State -eq 'stopped') {
    Write-Host ''
    Write-Host '   The instance is stopped. Start it with: powershell -ExecutionPolicy Bypass -File scripts\start-civichelp.ps1' -ForegroundColor Yellow
}
Write-Host ''
