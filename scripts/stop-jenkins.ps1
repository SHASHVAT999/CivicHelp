<#
.SYNOPSIS
  Stop the Jenkins that was started from D:\cloud-devops-assignment\vle-pbl3\tools\jenkins.war.

  Usage:  powershell -ExecutionPolicy Bypass -File scripts\stop-jenkins.ps1 [-Force]
#>
[CmdletBinding()]
param([switch]$Force)
. "$PSScriptRoot\_common.ps1"

$JenkinsBase = 'D:\cloud-devops-assignment\vle-pbl3'
$JenkinsHome = Join-Path $JenkinsBase 'shared\jenkins_home'
$PidFile     = Join-Path $JenkinsBase 'shared\jenkins.pid'

Write-Banner 'Stop Jenkins'

# Only processes started from the existing jenkins.war are touched.
$procs = @(Get-CimInstance Win32_Process -Filter "Name='java.exe'" | Where-Object { $_.CommandLine -match 'jenkins\.war' })
if ($procs.Count -eq 0) {
    Write-Ok 'Jenkins is not running.'
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    exit 0
}

if (-not $Force) {
    # A build that is still running has a build.xml without a <result> and a recent timestamp.
    $running = @()
    foreach ($job in (Get-ChildItem (Join-Path $JenkinsHome 'jobs') -Directory -ErrorAction SilentlyContinue)) {
        $builds = Join-Path $job.FullName 'builds'
        if (-not (Test-Path $builds)) { continue }
        $last = Get-ChildItem $builds -Directory | Where-Object { $_.Name -match '^\d+$' } | Sort-Object { [int]$_.Name } | Select-Object -Last 1
        if (-not $last) { continue }
        $xml = Join-Path $last.FullName 'build.xml'
        if ((Test-Path $xml) -and ((Get-Date) - (Get-Item $xml).LastWriteTime).TotalHours -lt 2) {
            if (-not (Select-String -Path $xml -Pattern '^  <result>' -Quiet)) { $running += "$($job.Name) #$($last.Name)" }
        }
    }
    if ($running.Count -gt 0) {
        Stop-WithError ('A build is still running: ' + ($running -join ', ')) @('Wait for it to finish, or stop anyway with:  scripts\stop-jenkins.ps1 -Force')
    }
}

Write-Step "Stopping Jenkins (PID $($procs.ProcessId -join ', '))"
foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3
$left = @(Get-CimInstance Win32_Process -Filter "Name='java.exe'" | Where-Object { $_.CommandLine -match 'jenkins\.war' })
if ($left.Count -gt 0) { Stop-WithError 'Jenkins is still running.' @('Close it from Task Manager (java.exe).') }
Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
Write-Ok 'Jenkins stopped. Jobs, builds and settings are kept in jenkins_home.'
Write-Host ''
