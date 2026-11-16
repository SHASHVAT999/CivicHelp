<#
.SYNOPSIS
  Allow SSH from your CURRENT public IP (needed only for admin tasks; the website is public anyway).

.DESCRIPTION
  Your home/college IP address changes. The AWS security group only lets ONE address
  (your /32) use SSH. This script:
    1. detects your current IP,
    2. writes it to terraform\terraform.tfvars (gitignored),
    3. runs "terraform plan" and refuses to continue unless the plan is exactly
       "0 to add, 1 to change, 0 to destroy" (only the SSH rule),
    4. applies that saved plan after you confirm.
  It re-uses the existing Terraform state and never replaces the instance.

  Usage:  powershell -ExecutionPolicy Bypass -File scripts\update-ssh-access.ps1
#>
[CmdletBinding()]
param([switch]$Yes)
. "$PSScriptRoot\_common.ps1"
Write-Banner 'Update SSH access for this PC'
Assert-AwsCredentials

$terraform = (Get-Command terraform -ErrorAction SilentlyContinue)
if (-not $terraform) { Stop-WithError 'terraform.exe was not found on PATH (expected D:\Terraform).' }
$tfvars = Join-Path $script:TerraformDir 'terraform.tfvars'
if (-not (Test-Path (Join-Path $script:TerraformDir 'terraform.tfstate'))) {
    Stop-WithError 'terraform\terraform.tfstate is missing - refusing to run (it could create duplicate resources).' @('The state file must stay in D:\CivicHelp\terraform.')
}
if (-not (Test-Path $tfvars)) { Stop-WithError 'terraform\terraform.tfvars is missing.' @('It holds your key pair and admin_cidr; it is gitignored.') }

Write-Step 'Detecting your current public IP'
$ip = Get-CurrentPublicIp
if (-not $ip -or $ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { Stop-WithError 'Could not detect your public IP (no internet?).' }
$cidr = "$ip/32"
Write-Ok "Your IP is $ip"

$current = $null
$m = Select-String -Path $tfvars -Pattern '^\s*admin_cidr\s*=\s*"([^"]+)"' | Select-Object -First 1
if ($m) { $current = $m.Matches[0].Groups[1].Value }
Write-Info "admin_cidr in terraform.tfvars: $current"

$info = Get-InstanceInfo
$q = 'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[].CidrIp'
$live = (Invoke-Aws ec2 describe-security-groups --group-ids $info.Sg --query $q --output text).Output
if (($live -split '\s+') -contains $cidr) {
    Write-Ok 'AWS already allows SSH from your IP. Nothing to change.'
    exit 0
}

Write-Step 'Updating terraform.tfvars'
$text = Get-Content -Raw -Path $tfvars
if ($text -match '(?m)^\s*admin_cidr\s*=') { $text = [regex]::Replace($text, '(?m)^(\s*admin_cidr\s*=\s*)"[^"]*"', ('${1}"' + $cidr + '"')) }
else { $text = $text.TrimEnd() + "`r`nadmin_cidr = `"$cidr`"`r`n" }
[IO.File]::WriteAllText($tfvars, $text, (New-Object Text.UTF8Encoding $false))
Write-Ok "admin_cidr = $cidr"

Write-Step 'Running terraform plan (read-only)'
$planFile = Join-Path $script:TempDir 'civichelp-ssh.tfplan'
Push-Location $script:TerraformDir
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'   # native stderr (warnings) must not abort the script in PS 5.1
try {
    $planOut = & terraform plan -no-color -input=false "-out=$planFile" 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'terraform plan failed.' @(($planOut -split "`n" | Select-Object -Last 8)) }
    $sum = [regex]::Match($planOut, 'Plan:\s+(\d+) to add,\s+(\d+) to change,\s+(\d+) to destroy')
    if (-not $sum.Success) { Write-Ok 'Terraform reports no changes needed.'; exit 0 }
    $add = [int]$sum.Groups[1].Value; $chg = [int]$sum.Groups[2].Value; $del = [int]$sum.Groups[3].Value
    Write-Info "Plan: $add to add, $chg to change, $del to destroy"
    if ($add -ne 0 -or $del -ne 0 -or $chg -ne 1) {
        Stop-WithError 'The plan is not the expected "0 to add, 1 to change, 0 to destroy". Nothing was applied.' @(
            "Review it yourself:  cd terraform ; terraform plan",
            'Never apply a plan that adds or destroys the instance.')
    }
    if ($planOut -match 'must be replaced') { Stop-WithError 'The plan would REPLACE a resource. Nothing was applied.' }
    Write-Ok 'Plan is exactly the SSH rule change (no instance replacement)'

    if (-not $Yes -and (Test-Interactive)) {
        $a = Read-Host '   Apply this change? [Y/n]'
        if ($a -match '^[nN]') { Write-Warn 'Cancelled. (terraform.tfvars was already updated; the AWS rule is unchanged.)'; exit 0 }
    }
    Write-Step 'Applying the saved plan'
    $applyOut = & terraform apply -no-color -input=false $planFile 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { Stop-WithError 'terraform apply failed.' @(($applyOut -split "`n" | Select-Object -Last 8)) }
    Write-Ok 'Security group updated'
} finally {
    $ErrorActionPreference = $prevEap
    Pop-Location
    Remove-Item $planFile -Force -ErrorAction SilentlyContinue
}

Write-Step 'Verifying'
$live = (Invoke-Aws ec2 describe-security-groups --group-ids $info.Sg --query $q --output text).Output
if (($live -split '\s+') -contains $cidr) { Write-Ok 'AWS now allows SSH from your IP' } else { Write-Warn 'Could not confirm the rule - run status-civichelp.ps1' }
$info = Get-InstanceInfo
if ($info.Ip) { if (Test-SshPort $info.Ip) { Write-Ok "SSH port 22 on $($info.Ip) is reachable" } else { Write-Warn 'Port 22 not reachable yet (wait a few seconds and retry).' } }
Write-Host ''
