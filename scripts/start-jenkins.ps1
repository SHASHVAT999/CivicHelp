<#
.SYNOPSIS
  Start YOUR EXISTING Jenkins (no new install) and make sure the CivicHelp pipelines are set up.

.DESCRIPTION
  Uses the Jenkins you installed for your coursework:
    WAR     D:\cloud-devops-assignment\vle-pbl3\tools\jenkins.war
    JDK 21  D:\cloud-devops-assignment\vle-pbl3\tools\jdk21\jdk-21.0.13+9
    Home    D:\cloud-devops-assignment\vle-pbl3\shared\jenkins_home

  Every start it (idempotently) makes sure that
    - credentials CIVICHELP_DB_PASSWORD / CIVICHELP_JWT_SECRET exist,
    - the jobs CivicHelp-CI and CivicHelp-Deploy-AWS exist.
  Your other Jenkins jobs are never touched. Jenkins listens on http://localhost:8080 (this PC only).

  Usage:  powershell -ExecutionPolicy Bypass -File scripts\start-jenkins.ps1 [-OpenBrowser] [-RunBuild CI|Deploy]

  -RunBuild CI      starts Jenkins and immediately runs one CivicHelp-CI build (no login needed).
  -RunBuild Deploy  does the same for the AWS deployment job (changes AWS - use deliberately).
#>
[CmdletBinding()]
param(
    [switch]$OpenBrowser,
    [ValidateSet('None', 'CI', 'Deploy')][string]$RunBuild = 'None',
    [int]$TimeoutSeconds = 300
)
. "$PSScriptRoot\_common.ps1"

$JenkinsBase = 'D:\cloud-devops-assignment\vle-pbl3'
$War         = Join-Path $JenkinsBase 'tools\jenkins.war'
$JavaHome    = Join-Path $JenkinsBase 'tools\jdk21\jdk-21.0.13+9'
$JenkinsHome = Join-Path $JenkinsBase 'shared\jenkins_home'
$LogDir      = Join-Path $JenkinsBase 'shared\logs'
$PidFile     = Join-Path $JenkinsBase 'shared\jenkins.pid'
$JavaTmp     = 'D:\DevCaches\JavaTemp'
$Url         = 'http://localhost:8080'

function Test-JenkinsUp {
    try { $r = Invoke-WebRequest -Uri "$Url/login" -UseBasicParsing -TimeoutSec 5; return ($r.StatusCode -eq 200) } catch { return $false }
}

Write-Banner 'Start Jenkins'

Write-Step 'Checking the existing Jenkins installation'
foreach ($p in @($War, (Join-Path $JavaHome 'bin\java.exe'), $JenkinsHome)) {
    if (-not (Test-Path $p)) { Stop-WithError "Missing: $p" @('This script re-uses the Jenkins from your coursework (see the guide, section 1).') }
}
Write-Ok 'jenkins.war, JDK 21 and jenkins_home found (all on D:)'

# ---- One-time / idempotent preparation --------------------------------------
Write-Step 'Preparing CivicHelp setup files'
$initDir = Join-Path $JenkinsHome 'init.groovy.d'
if (-not (Test-Path $initDir)) { New-Item -ItemType Directory -Path $initDir -Force | Out-Null }
Copy-Item (Join-Path $script:ProjectDir 'jenkins\init\civichelp-setup.groovy') (Join-Path $initDir 'civichelp-setup.groovy') -Force
Write-Ok 'Startup setup script installed in jenkins_home\init.groovy.d'

if (-not (Test-Path $script:SecretsFile)) {
    # Same secrets the EC2 deployment uses. Created once; never printed.
    $rng = New-Object Security.Cryptography.RNGCryptoServiceProvider
    function New-Hex([int]$bytes) { $b = New-Object byte[] $bytes; $rng.GetBytes($b); return (($b | ForEach-Object { $_.ToString('x2') }) -join '') }
    [IO.File]::WriteAllText($script:SecretsFile, ("DB_PASSWORD=$(New-Hex 24)`r`nJWT_SECRET=$(New-Hex 32)`r`n"), (New-Object Text.UTF8Encoding $false))
    Write-Ok "Created new secrets file $($script:SecretsFile)"
    Write-Warn 'If CivicHelp was already deployed to AWS with other secrets, copy those into this file first.'
}

if (Test-JenkinsUp) {
    if ($RunBuild -ne 'None') {
        Stop-WithError 'Jenkins is already running, so -RunBuild cannot be applied.' @('Log in at http://localhost:8080 and click "Build Now" on the job,', 'or run scripts\stop-jenkins.ps1 first and then start-jenkins.ps1 -RunBuild ' + $RunBuild)
    }
    Write-Ok "Jenkins is already running at $Url"
    Write-Warn 'Jobs/credentials are only (re)created at start-up. Run stop-jenkins.ps1 then start-jenkins.ps1 if they are missing.'
} else {
    Write-Step 'Checking that port 8080 is free'
    $busy = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
    if ($busy) {
        $owner = (Get-Process -Id $busy[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
        Stop-WithError "Port 8080 is used by another program ($owner)." @('Close it (for example another Jenkins or a web server) and run this script again.')
    }
    Write-Ok 'Port 8080 is free'

    Write-Step 'Starting Jenkins (JDK 21)'
    foreach ($d in @($LogDir, $JavaTmp)) { if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null } }

    # Environment the pipelines need (everything is inherited by Jenkins and its build steps)
    $env:JENKINS_HOME = $JenkinsHome
    $env:JAVA_HOME = $JavaHome
    $env:CIVICHELP_SECRETS_FILE = $script:SecretsFile
    if ($RunBuild -ne 'None') { $env:CIVICHELP_RUN_BUILD = $RunBuild } else { Remove-Item Env:CIVICHELP_RUN_BUILD -ErrorAction SilentlyContinue }
    $env:MSYS_NO_PATHCONV = '1'
    $extra = @('D:\Git\bin', 'D:\Git\usr\bin', 'D:\Git\mingw64\bin', 'C:\Program Files\Docker\Docker\resources\bin', 'D:\Terraform', 'D:\AWSCLI', (Join-Path $JavaHome 'bin'))
    $env:PATH = (($extra | Where-Object { Test-Path $_ }) -join ';') + ';' + $env:PATH

    $out = Join-Path $LogDir 'civichelp-jenkins-out.log'
    $err = Join-Path $LogDir 'civichelp-jenkins-err.log'
    $java = Join-Path $JavaHome 'bin\java.exe'
    $javaArgs = @('-Xmx1g', "-Djava.io.tmpdir=$JavaTmp", '-Dfile.encoding=UTF-8', '-jar', "`"$War`"", '--httpPort=8080', '--httpListenAddress=127.0.0.1')
    $proc = Start-Process -FilePath $java -ArgumentList $javaArgs -WorkingDirectory $JenkinsHome -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
    Set-Content -Path $PidFile -Value $proc.Id -Encoding ASCII
    Write-Ok "Jenkins process started (PID $($proc.Id)); logs: $LogDir"

    Write-Step "Waiting for Jenkins to become ready (up to $TimeoutSeconds seconds; first start can take 1-2 minutes)"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $up = $false
    while ((Get-Date) -lt $deadline) {
        if ($proc.HasExited) { Stop-WithError 'The Jenkins process exited during start-up.' @("See: $err") }
        if (Test-JenkinsUp) { $up = $true; break }
        Write-Host '.' -NoNewline -ForegroundColor DarkGray
        Start-Sleep -Seconds 4
    }
    Write-Host ''
    if (-not $up) { Stop-WithError 'Jenkins did not become ready in time.' @("See: $err") }
    Write-Ok 'Jenkins is ready'
}

Write-Step 'Checking the CivicHelp pipelines'
foreach ($job in 'CivicHelp-CI', 'CivicHelp-Deploy-AWS') {
    if (Test-Path (Join-Path $JenkinsHome "jobs\$job\config.xml")) { Write-Ok "Job exists: $job" }
    else { Write-Warn "Job missing: $job (see $LogDir\civichelp-jenkins-err.log)" }
}

Write-Host ''
Write-Host '   ==============================================' -ForegroundColor Green
Write-Host "    Jenkins is running:  $Url" -ForegroundColor Green
Write-Host '   ==============================================' -ForegroundColor Green
Write-Host '   Log in with your existing Jenkins admin account (see the guide if you forgot it).' -ForegroundColor Gray
Write-Host '   Jobs:  CivicHelp-CI (build)   CivicHelp-Deploy-AWS (separate, deploys to AWS)' -ForegroundColor Gray
Write-Host ''
if ($OpenBrowser) { Start-Process $Url }
