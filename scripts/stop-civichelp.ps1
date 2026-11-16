<#
.SYNOPSIS
  Safely STOP the CivicHelp EC2 instance. Nothing is deleted.

.DESCRIPTION
  Stopping is like shutting down a computer: the operating system shuts Docker and
  MySQL down cleanly. The disk (EBS volume) keeps the database, photos and
  application, and the Terraform state on your PC is untouched. Start it again
  with scripts\start-civichelp.ps1 - all data will still be there.

  This script never terminates the instance, never deletes volumes and never runs terraform destroy.

  Usage:  powershell -ExecutionPolicy Bypass -File scripts\stop-civichelp.ps1
#>
[CmdletBinding()]
param([switch]$Force)
. "$PSScriptRoot\_common.ps1"
Write-Banner 'Stop CivicHelp on AWS'
Assert-AwsCredentials

Write-Step "Looking up EC2 instance $($script:InstanceId)"
$info = Get-InstanceInfo
Write-Info "Current state: $($info.State)"

if ($info.State -eq 'stopped') {
    Write-Ok 'The instance is already stopped. Nothing to do.'
} elseif ($info.State -notin @('running', 'pending')) {
    Stop-WithError "The instance is in state '$($info.State)'." @('Run scripts\status-civichelp.ps1 and try again in a minute.')
} else {
    if (-not $Force -and (Test-Interactive)) {
        $a = Read-Host '   Stop the instance? The website will go offline, data is kept. [Y/n]'
        if ($a -match '^[nN]') { Write-Warn 'Cancelled - the instance was left running.'; exit 0 }
    }
    Write-Step 'Sending the stop request (a normal, clean shutdown)'
    $r = Invoke-Aws ec2 stop-instances --instance-ids $script:InstanceId
    if ($r.ExitCode -ne 0) { Stop-WithError 'AWS refused to stop the instance.' @('Check that the Learner Lab is started.') }
    Write-Ok 'Stop request accepted'
    Write-Step 'Waiting until the instance is fully stopped'
    $w = Invoke-Aws ec2 wait instance-stopped --instance-ids $script:InstanceId
    if ($w.ExitCode -ne 0) { Write-Warn 'Still stopping - check again with scripts\status-civichelp.ps1' }
    else { Write-Ok 'The instance is stopped' }
}

Write-Host ''
Write-Host '   What is kept (nothing was deleted):' -ForegroundColor White
Write-Info '- The 20 GB disk with the database, uploaded photos and the application'
Write-Info '- The security group, SSH key pair and your Terraform state file'
Write-Host '   What can still cost money while the instance is STOPPED:' -ForegroundColor White
Write-Info '- The 20 GB EBS volume: roughly US$1.60 per month (about US$0.05 per day)'
Write-Info '- No hourly EC2 charge and no public-IP charge while stopped (the IP is released)'
Write-Info 'Start again with:  powershell -ExecutionPolicy Bypass -File scripts\start-civichelp.ps1'
Write-Host ''
