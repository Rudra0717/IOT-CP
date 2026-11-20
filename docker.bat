@echo off
setlocal enabledelayedexpansion

set "REAL_DOCKER=%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin\docker.exe"
if not exist "%REAL_DOCKER%" (
    for /f "delims=" %%i in ('where docker.exe 2^>nul') do (
        if not "%%~dpnxi"=="%~dpnx0" (
            set "REAL_DOCKER=%%i"
            goto :found
        )
    )
)
:found

"%REAL_DOCKER%" %*
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% EQU 0 (
    set "CMD_ARGS=%*"
    echo !CMD_ARGS! | findstr /i "compose" | findstr /i "up" >nul
    if !ERRORLEVEL! EQU 0 (
        if exist "%~dp0scripts\show_status.py" (
            python "%~dp0scripts\show_status.py"
        )
    )
)

exit /b %EXIT_CODE%
