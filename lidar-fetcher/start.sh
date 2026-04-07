#!/bin/bash
# Lidar-fetcher — demarrage rapide (Linux/Mac)
echo "=== Lidar-fetcher pour TERLAB ==="

# Verifier Python
if ! command -v python3 &>/dev/null; then
    echo "ERREUR : python3 n'est pas installe"
    exit 1
fi

# Creer/activer le venv
if [ ! -d ".venv" ]; then
    echo "Creation de l'environnement virtuel..."
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
else
    source .venv/bin/activate
fi

echo ""
echo "Demarrage du serveur sur http://localhost:8000"
echo "Appuyez sur Ctrl+C pour arreter."
echo ""
python3 server.py
