<#
.SYNOPSIS
  Show whether Jenkins is running and the latest results of the CivicHelp jobs.
  Reads the build records from jenkins_home directly, so no Jenkins login is needed.

  Usage:  powershell -ExecutionPolicy Bypass -File scripts\status-jenkins.ps1 [-ShowLog CivicHelp-Pipeline]
#>
[CmdletBinding()]
param(
    [string]$ShowLog,   # job name, e.g. CivicHelp-Pipeline
    [int]$Tail = 40
)
. "$PSScriptRoot\_common.ps1"
$JenkinsHome = 'D:\cloud-devops-assignment\vle-pbl3\shared\jenkins_home'
Write-Banner 'Jenkins status'

$up = $false
try { $up = ((Invoke-WebRequest -Uri 'http://localhost:8080/login' -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) } catch {}
if ($up) { Write-Ok 'Jenkins is running:  http://localhost:8080' } else { Write-Warn 'Jenkins is NOT running.  Start it with: scripts\start-jenkins.ps1' }

foreach ($job in 'CivicHelp-Pipeline', 'CivicHelp-CI', 'CivicHelp-Deploy-AWS') {
    if ($job -ne 'CivicHelp-Pipeline' -and -not (Test-Path (Join-Path $JenkinsHome "jobs\$job"))) { continue }
    $cfg = Join-Path $JenkinsHome "jobs\$job\config.xml"
    $label = $job
    if ((Test-Path $cfg) -and ((Get-Content -Raw $cfg) -match '<disabled>true</disabled>')) { $label = "$job  (retired - disabled)" }
    Write-Step $label
    $dir = Join-Path $JenkinsHome "jobs\$job\builds"
    if (-not (Test-Path $dir)) { Write-Info 'no builds yet'; continue }
    $nums = Get-ChildItem $dir -Directory | Where-Object { $_.Name -match '^\d+$' } | Sort-Object { [int]$_.Name } -Descending | Select-Object -First 5
    if (-not $nums) { Write-Info 'no builds yet'; continue }
    foreach ($n in $nums) {
        $xml = Join-Path $n.FullName 'build.xml'
        $result = 'RUNNING'; $dur = ''; $when = ''
        if (Test-Path $xml) {
            $text = Get-Content -Raw $xml
            # The build's own result is a top-level (2-space indented) element; nested ones belong to pipeline steps.
            # A running pipeline can already carry a provisional <result>; only <completed>true</completed> means finished.
            $done = $text -match '(?m)^  <completed>true</completed>'
            $m = [regex]::Match($text, '(?m)^  <result>([^<]+)</result>'); if ($done -and $m.Success) { $result = $m.Groups[1].Value }
            $d = [regex]::Match($text, '(?m)^  <duration>(\d+)</duration>'); if ($d.Success -and $result -ne 'RUNNING') { $dur = ('{0:N0} s' -f ([int64]$d.Groups[1].Value / 1000)) }
            $s = [regex]::Match($text, '<startTime>(\d+)</startTime>')
            if ($s.Success) { $when = ([DateTimeOffset]::FromUnixTimeMilliseconds([int64]$s.Groups[1].Value)).LocalDateTime.ToString('yyyy-MM-dd HH:mm') }
        }
        $color = switch ($result) { 'SUCCESS' { 'Green' } 'FAILURE' { 'Red' } 'RUNNING' { 'Cyan' } default { 'Yellow' } }
        Write-Host ('   #{0,-3} {1,-9} {2,-17} {3}' -f $n.Name, $result, $when, $dur) -ForegroundColor $color
    }
}

if ($ShowLog) {
    $dir = Join-Path $JenkinsHome "jobs\$ShowLog\builds"
    $last = Get-ChildItem $dir -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d+$' } | Sort-Object { [int]$_.Name } | Select-Object -Last 1
    if (-not $last) { Stop-WithError "No builds found for $ShowLog" }
    Write-Step "Console output of $ShowLog #$($last.Name) (last $Tail lines)"
    # Jenkins stores hidden console annotations (ESC[8m ha://// ... ESC[0m) in the log; strip them and colour codes.
    $esc = [char]27
    Get-Content (Join-Path $last.FullName 'log') -Tail $Tail | ForEach-Object {
        $line = $_ -replace "$esc\[8mha:////[^$esc]*$esc\[0m", '' -replace "$esc\[[0-9;]*[A-Za-z]", ''
        if ($line.Trim()) { Write-Host "   $line" -ForegroundColor Gray }
    }
}
Write-Host ''
