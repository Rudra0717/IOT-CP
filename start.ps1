# EV SENSE Startup Script
Write-Host "Starting EV SENSE containers..." -ForegroundColor Cyan

$dockerExe = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe"
if (-not (Test-Path $dockerExe)) {
    $dockerExe = (Get-Command docker.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
}

if (-not $dockerExe) {
    Write-Error "docker.exe not found. Please ensure Docker Desktop is installed and running."
    exit 1
}

& $dockerExe compose up -d
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
    if (Test-Path "$PSScriptRoot\scripts\show_status.py") {
        python "$PSScriptRoot\scripts\show_status.py"
    }
} else {
    Write-Error "docker compose up -d failed with exit code $exitCode"
}

exit $exitCode
