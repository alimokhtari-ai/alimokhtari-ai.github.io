@echo off
setlocal
cd /d "%~dp0"

echo RAVAL local demo: http://127.0.0.1:8765
echo Keep this terminal open. Press Ctrl+C to stop.
echo Default mode: fixture. Telegram in the web interface is a simulator.

where py >nul 2>nul
if errorlevel 1 goto use_python
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"
if errorlevel 1 goto version_error
py -3 server.py --open
goto finish

:use_python
where python >nul 2>nul
if errorlevel 1 goto version_error
python -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)"
if errorlevel 1 goto version_error
python server.py --open
goto finish

:version_error
echo RAVAL needs Python 3.10 or newer. Install Python and try again.
pause
exit /b 1

:finish
set "raval_exit_code=%errorlevel%"
if not "%raval_exit_code%"=="0" (
  echo The server stopped. Review any message above.
  pause
)
exit /b %raval_exit_code%
