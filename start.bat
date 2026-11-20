@echo off
setlocal enabledelayedexpansion

echo Starting EV SENSE containers...
set "DOCKER_EXE=%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe"
if not exist "%DOCKER_EXE%" (
    for /f "delims=" %%i in ('where docker.exe 2^>nul') do (
        if not "%%~dpnxi"=="%~dpnx0" (
            set "DOCKER_EXE=%%i"
            goto :found
        )
    )
)
:found

"%DOCKER_EXE%" compose up -d
if %ERRORLEVEL% EQU 0 (
    if exist "%~dp0scripts\show_status.py" (
        python "%~dp0scripts\show_status.py"
    )
) else (
    echo docker compose up -d failed.
)
