# ------------------------------------------------------------------------------
# CivicHelp - shared helpers for the scripts in this folder.
# Not meant to be run directly. Every script loads it with:
#     . "$PSScriptRoot\_common.ps1"
# Keep this file ASCII-only (Windows PowerShell 5.1 misreads UTF-8 without BOM).
# ------------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'

$script:ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Get-Setting {
    param([string]$EnvName, [string]$Default)
    $v = [Environment]::GetEnvironmentVariable($EnvName)
    if ([string]::IsNullOrWhiteSpace($v)) { return $Default }
    return $v
}

# ---- Settings (override with environment variables if ever needed) ----------
$script:InstanceId   = Get-Setting 'CIVICHELP_INSTANCE_ID' 'i-0073a3b992490e3df'
$script:Region       = Get-Setting 'CIVICHELP_AWS_REGION'  'us-east-1'
$script:AwsDir       = Get-Setting 'CIVICHELP_AWS_DIR'     'D:\AWSConfig'
$script:SshKeyPath   = Join-Path $script:AwsDir 'civichelp-key'
$script:SecretsFile  = Join-Path $script:AwsDir 'civichelp-deploy.env'
$script:DemoFile     = Join-Path $script:AwsDir 'civichelp-demo-accounts.txt'
$script:LastIpFile   = Join-Path $script:AwsDir 'civichelp-last-ip.txt'
$script:TerraformDir = Join-Path $script:ProjectDir 'terraform'
$script:WslDistro    = Get-Setting 'CIVICHELP_WSL_DISTRO'  'Ubuntu'
$script:TempDir      = Get-Setting 'CIVICHELP_TEMP_DIR'    'D:\DevCaches\Temp'

# AWS CLI configuration lives on D: (never on C:)
if (-not $env:AWS_SHARED_CREDENTIALS_FILE) { $env:AWS_SHARED_CREDENTIALS_FILE = Join-Path $script:AwsDir 'credentials' }
if (-not $env:AWS_CONFIG_FILE)             { $env:AWS_CONFIG_FILE             = Join-Path $script:AwsDir 'config' }
$env:AWS_DEFAULT_REGION = $script:Region
$env:AWS_PAGER = ''
if (-not (Test-Path $script:TempDir)) { New-Item -ItemType Directory -Path $script:TempDir -Force | Out-Null }

# ---- Console output helpers --------------------------------------------------
function Write-Banner { param([string]$Text) Write-Host ''; Write-Host "=== $Text ===" -ForegroundColor Cyan }
function Write-Step   { param([string]$Text) Write-Host ''; Write-Host "-> $Text" -ForegroundColor White }
function Write-Ok     { param([string]$Text) Write-Host "   [OK] $Text" -ForegroundColor Green }
function Write-Warn   { param([string]$Text) Write-Host "   [!!] $Text" -ForegroundColor Yellow }
function Write-Info   { param([string]$Text) Write-Host "   $Text" -ForegroundColor Gray }
function Stop-WithError {
    param([string]$Text, [string[]]$Hints)
    Write-Host ''
    Write-Host "   [FAILED] $Text" -ForegroundColor Red
    foreach ($h in $Hints) { Write-Host "            $h" -ForegroundColor Yellow }
    Write-Host ''
    exit 1
}

function Test-Interactive {
    return ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected)
}

# ---- AWS CLI -----------------------------------------------------------------
$script:AwsExe = $null
$cmd = Get-Command aws -ErrorAction SilentlyContinue
if ($cmd) { $script:AwsExe = $cmd.Source }
elseif (Test-Path 'D:\AWSCLI\aws.exe') { $script:AwsExe = 'D:\AWSCLI\aws.exe' }

function Assert-AwsCli {
    if (-not $script:AwsExe) {
        Stop-WithError 'The AWS CLI (aws.exe) was not found.' @('Expected at D:\AWSCLI\aws.exe or on PATH. See docs/START_STOP_AND_PRESENTATION_GUIDE.md, section 1.')
    }
}

# Runs the AWS CLI. Returns ExitCode and Output (stderr is discarded).
function Invoke-Aws {
    Assert-AwsCli
    # PS 5.1 turns native stderr into a terminating error when ErrorActionPreference is 'Stop'.
    # A failing AWS call (expired credentials) is a normal result here, so look at the exit code instead.
    $ErrorActionPreference = 'Continue'
    $out = & $script:AwsExe @args 2>$null
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = (($out | Out-String).Trim()) }
}

function Test-AwsCredentials {
    $r = Invoke-Aws sts get-caller-identity --query Arn --output text
    return ($r.ExitCode -eq 0)
}

function Assert-AwsCredentials {
    Write-Step 'Checking AWS credentials'
    if (Test-AwsCredentials) { Write-Ok 'AWS credentials are valid'; return }
    Write-Warn 'AWS credentials are missing or have expired (AWS Academy credentials only last for one lab session).'
    if (Test-Interactive) {
        $answer = Read-Host '   Enter fresh credentials now? [Y/n]'
        if ($answer -notmatch '^[nN]') {
            & (Join-Path $PSScriptRoot 'update-aws-credentials.ps1')
            if (Test-AwsCredentials) { Write-Ok 'AWS credentials are valid'; return }
        }
    }
    Stop-WithError 'No valid AWS credentials.' @(
        'Start the Learner Lab (green dot), then run:',
        '    powershell -ExecutionPolicy Bypass -File scripts\update-aws-credentials.ps1')
}

function Get-InstanceInfo {
    $q = 'Reservations[0].Instances[0].{State:State.Name,Ip:PublicIpAddress,Type:InstanceType,Az:Placement.AvailabilityZone,Launch:LaunchTime,Sg:SecurityGroups[0].GroupId}'
    $r = Invoke-Aws ec2 describe-instances --instance-ids $script:InstanceId --query $q --output json
    if ($r.ExitCode -ne 0 -or -not $r.Output) {
        Stop-WithError "Could not read EC2 instance $($script:InstanceId)." @(
            'Check that the Learner Lab is started and that the credentials are fresh.',
            "Instance ID is set in scripts\_common.ps1 (CIVICHELP_INSTANCE_ID).")
    }
    return ($r.Output | ConvertFrom-Json)
}

function Get-CurrentPublicIp {
    try { return ((Invoke-RestMethod -Uri 'https://checkip.amazonaws.com' -TimeoutSec 10) -as [string]).Trim() }
    catch { return $null }
}

function Save-LastIp { param([string]$Ip) if ($Ip) { try { Set-Content -Path $script:LastIpFile -Value $Ip -Encoding ASCII } catch {} } }
function Get-LastIp  { if (Test-Path $script:LastIpFile) { return (Get-Content $script:LastIpFile -TotalCount 1).Trim() } return $null }

# ---- Application health -----------------------------------------------------
function Get-AppHealth {
    param([string]$Ip)
    $base = "http://$Ip"
    $h = [ordered]@{ Frontend = $false; Api = $false; Database = $false; Complaints = $null }
    try {
        $r = Invoke-WebRequest -Uri "$base/" -UseBasicParsing -TimeoutSec 8
        $h.Frontend = ($r.StatusCode -eq 200 -and $r.Content -match 'CivicHelp')
    } catch {}
    try {
        $r = Invoke-WebRequest -Uri "$base/api/health" -UseBasicParsing -TimeoutSec 8
        $h.Api = ($r.StatusCode -eq 200 -and $r.Content -match 'running')
    } catch {}
    try {
        # /api/complaints runs a real SELECT, so a 200 proves the database answers.
        $r = Invoke-WebRequest -Uri "$base/api/complaints" -UseBasicParsing -TimeoutSec 8
        if ($r.StatusCode -eq 200) {
            $h.Database = $true
            $body = $r.Content.Trim()
            if ($body -eq '[]') { $h.Complaints = 0 }
            else {
                # PS 5.1 emits a JSON array as ONE pipeline object, so assign first, then count.
                $list = $body | ConvertFrom-Json
                $h.Complaints = @($list).Count
            }
        }
    } catch {}
    return [pscustomobject]$h
}

function Wait-AppHealthy {
    param([string]$Ip, [int]$TimeoutMinutes = 8)
    $deadline = (Get-Date).AddMinutes($TimeoutMinutes)
    $health = $null
    while ((Get-Date) -lt $deadline) {
        $health = Get-AppHealth -Ip $Ip
        if ($health.Frontend -and $health.Api -and $health.Database) { Write-Host ''; return $health }
        Write-Host '.' -NoNewline -ForegroundColor DarkGray
        Start-Sleep -Seconds 8
    }
    Write-Host ''
    return $health
}

function Write-HealthLines {
    param($Health)
    if ($Health.Frontend) { Write-Ok 'Website (Nginx + React) is serving pages' } else { Write-Warn 'Website is NOT responding' }
    if ($Health.Api)      { Write-Ok 'Backend API (Express) health check passed' } else { Write-Warn 'Backend API is NOT responding' }
    if ($Health.Database) { Write-Ok "MySQL database answers queries ($($Health.Complaints) complaints stored)" } else { Write-Warn 'Database is NOT answering through the API' }
}

# ---- WSL / SSH helpers (used for admin tasks on the EC2 instance) -----------
function ConvertTo-WslPath {
    param([string]$WindowsPath)
    $full = [IO.Path]::GetFullPath($WindowsPath)
    $drive = $full.Substring(0, 1).ToLower()
    return ('/mnt/' + $drive + ($full.Substring(2) -replace '\\', '/'))
}

# Runs a bash script on the EC2 instance over SSH (through WSL) and returns its output.
function Invoke-RemoteScript {
    param([string]$Ip, [string]$ScriptText)
    if (-not (Test-Path $script:SshKeyPath)) {
        Stop-WithError "SSH private key not found: $($script:SshKeyPath)" @('It was created for the EC2 key pair "civichelp-key".')
    }
    $ErrorActionPreference = 'Continue'   # ssh/wsl write warnings to stderr; judge success by exit code
    $local = Join-Path $script:TempDir 'civichelp-remote.sh'
    $keyWsl = ConvertTo-WslPath $script:SshKeyPath
    [IO.File]::WriteAllText($local, ($ScriptText -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
    try {
        # Make sure the key inside WSL has the strict permissions ssh requires.
        $prep = "mkdir -p ~/.ssh && cp $keyWsl ~/.ssh/civichelp-key && chmod 600 ~/.ssh/civichelp-key"
        & wsl.exe -d $script:WslDistro -- bash -c $prep | Out-Null
        $localWsl = ConvertTo-WslPath $local
        $ssh = "ssh -i ~/.ssh/civichelp-key -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=15 ubuntu@$Ip 'bash -s' < $localWsl"
        $out = & wsl.exe -d $script:WslDistro -- bash -c $ssh
        $code = $LASTEXITCODE
        return [pscustomobject]@{ ExitCode = $code; Output = (($out | Out-String) -replace "`0", '').Trim() }
    } finally {
        Remove-Item $local -Force -ErrorAction SilentlyContinue
    }
}

function Test-SshPort {
    param([string]$Ip, [int]$TimeoutMs = 4000)
    try {
        $c = New-Object Net.Sockets.TcpClient
        $iar = $c.BeginConnect($Ip, 22, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false) -and $c.Connected
        $c.Close()
        return $ok
    } catch { return $false }
}
