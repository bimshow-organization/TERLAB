#!/usr/bin/env python3
"""
TERLAB · terrain_api.py
Serveur local (dev) ou Cloud Function (prod)
Expose le pipeline terrain via HTTP.

Usage :
    python terrain_api.py [--port 7474]
"""

import json
import os
import subprocess
import tempfile

from flask import Flask, request, jsonify, send_file

app = Flask(__name__)

PIPELINE_SCRIPT = os.path.join(os.path.dirname(__file__), 'terrain_pipeline.py')


@app.route('/terrain/generate', methods=['POST'])
def generate_terrain():
    """
    POST JSON :
    {
      "copc_path":        "/path/to/terrain.copc.laz",
      "parcelle_geojson": { ... GeoJSON ... },
      "resolution":       0.05,
      "poisson_depth":    12,
      "simplify":         50000,
      "texture_zoom":     18
    }

    Retourne le fichier GLB en téléchargement.
    """
    data = request.json

    copc_path = data.get('copc_path')
    if not copc_path or not os.path.isfile(copc_path):
        return jsonify({'error': f'Fichier COPC introuvable: {copc_path}'}), 400

    parcelle_gj = data.get('parcelle_geojson')
    if not parcelle_gj:
        return jsonify({'error': 'parcelle_geojson requis'}), 400

    with tempfile.TemporaryDirectory(prefix='terlab_api_') as tmp_dir:
        parcelle_path = os.path.join(tmp_dir, 'parcelle.geojson')
        with open(parcelle_path, 'w') as f:
            json.dump(parcelle_gj, f)

        output_glb = os.path.join(tmp_dir, 'terrain.glb')

        cmd = [
            'python', PIPELINE_SCRIPT,
            '--input', copc_path,
            '--parcelle', parcelle_path,
            '--output', output_glb,
            '--poisson-depth', str(data.get('poisson_depth', 12)),
            '--simplify', str(data.get('simplify', 50000)),
            '--texture-zoom', str(data.get('texture_zoom', 18)),
            '--resolution', str(data.get('resolution', 0.05)),
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

        if result.returncode != 0:
            return jsonify({
                'error': 'Pipeline failed',
                'stderr': result.stderr,
                'stdout': result.stdout,
            }), 500

        if not os.path.isfile(output_glb):
            return jsonify({'error': 'GLB non produit'}), 500

        return send_file(
            output_glb,
            mimetype='model/gltf-binary',
            as_attachment=True,
            download_name='terrain.glb'
        )


@app.route('/terrain/health', methods=['GET'])
def health():
    """Vérification rapide des dépendances."""
    checks = {}
    for mod in ['pdal', 'open3d', 'numpy', 'shapely', 'pyproj', 'trimesh']:
        try:
            __import__(mod)
            checks[mod] = 'ok'
        except ImportError:
            checks[mod] = 'missing'

    all_ok = all(v == 'ok' for v in checks.values())
    return jsonify({'status': 'ok' if all_ok else 'degraded', 'modules': checks}), (200 if all_ok else 503)


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('--port', type=int, default=7474)
    args = p.parse_args()
    print(f'TERLAB Terrain API · http://localhost:{args.port}')
    app.run(host='0.0.0.0', port=args.port, debug=True)
