@echo off
REM Lidar-fetcher — demarrage rapide (Windows)
echo === Lidar-fetcher pour TERLAB ===
echo.

REM Verifier Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERREUR : Python n'est pas installe ou pas dans le PATH
    pause
    exit /b 1
)

REM Installer les dependances si necessaire
if not exist ".venv" (
    echo Creation de l'environnement virtuel...
    python -m venv .venv
    call .venv\Scripts\activate.bat
    pip install -r requirements.txt
) else (
    call .venv\Scripts\activate.bat
)

echo.
echo Demarrage du serveur sur http://localhost:8000
echo Appuyez sur Ctrl+C pour arreter.
echo.
python server.py
