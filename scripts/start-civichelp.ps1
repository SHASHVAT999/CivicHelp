<#
.SYNOPSIS
  Start the existing CivicHelp EC2 instance and wait until the application is healthy.

.DESCRIPTION
  1. Checks your AWS Academy credentials (offers to refresh them if expired).
  2. Starts the EXISTING EC2 instance (nothing is created or deleted).
  3. Waits for the containers to come back (Docker restarts them automatically).
  4. Prints the CURRENT public URL (the IP address changes after every stop/start).

  Usage:  powershell -ExecutionPolicy Bypass -File scripts\start-civichelp.ps1
#>
[CmdletBinding()]
param(
    [int]$TimeoutMinutes = 8,
    [switch]$OpenBrowser
)
. "$PSScriptRoot\_common.ps1"
Write-Banner 'Start CivicHelp on AWS'
Assert-AwsCredentials

Write-Step "Looking up EC2 instance $($script:InstanceId)"
$info = Get-InstanceInfo
Write-Info "Current state: $($info.State)  ($($info.Type), $($info.Az))"

switch ($info.State) {
    'running' { Write-Ok 'Instance is already running' }
    'pending' { Write-Info 'Instance is already starting...' }
    'stopping' {
        Write-Info 'Instance is still stopping - waiting for it to stop first...'
        $null = Invoke-Aws ec2 wait instance-stopped --instance-ids $script:InstanceId
        $r = Invoke-Aws ec2 start-instances --instance-ids $script:InstanceId
        if ($r.ExitCode -ne 0) { Stop-WithError 'AWS refused to start the instance.' @('Check that the Learner Lab is started.') }
    }
    'stopped' {
        Write-Step 'Starting the instance'
        $r = Invoke-Aws ec2 start-instances --instance-ids $script:InstanceId
        if ($r.ExitCode -ne 0) { Stop-WithError 'AWS refused to start the instance.' @('Check that the Learner Lab is started and has budget left.') }
        Write-Ok 'Start request accepted'
    }
    default { Stop-WithError "The instance is in state '$($info.State)' and cannot be started." @('Do not recreate it with scripts - ask your teacher/see the guide, section 9.') }
}

Write-Step 'Waiting for the instance to reach the running state'
$w = Invoke-Aws ec2 wait instance-running --instance-ids $script:InstanceId
if ($w.ExitCode -ne 0) { Stop-WithError 'The instance did not reach the running state in time.' @('Run scripts\status-civichelp.ps1 in a minute.') }
$info = Get-InstanceInfo
$ip = $info.Ip
if (-not $ip) { Stop-WithError 'The instance is running but has no public IP yet.' @('Wait 30 seconds and run scripts\status-civichelp.ps1.') }
Save-LastIp $ip
Write-Ok "Instance is running. Public IP: $ip"

Write-Step "Waiting for the application to answer (up to $TimeoutMinutes minutes; usually 1-3)"
$health = Wait-AppHealthy -Ip $ip -TimeoutMinutes $TimeoutMinutes
Write-HealthLines $health
if (-not ($health.Frontend -and $health.Api -and $health.Database)) {
    Stop-WithError 'The instance is up but the application is not fully healthy yet.' @(
        'Wait another minute and run:  powershell -ExecutionPolicy Bypass -File scripts\status-civichelp.ps1',
        'If it stays unhealthy see the guide, section 9 (Common problems).')
}

Write-Host ''
Write-Host '   ==============================================' -ForegroundColor Green
Write-Host "    CivicHelp is LIVE:  http://$ip" -ForegroundColor Green
Write-Host '   ==============================================' -ForegroundColor Green
Write-Host '   Note: this address changes every time the instance is stopped and started.' -ForegroundColor Gray
Write-Host ''
if ($OpenBrowser) { Start-Process "http://$ip" }
