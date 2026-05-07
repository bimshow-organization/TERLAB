#!/usr/bin/env python3
"""
TERLAB . download_all_saint_leu.py
Pre-cache LiDAR + ortho + COSIA + BDTOPO routes/bati + cadastre par tuiles
500m couvrant la commune de Saint-Leu (bbox + filtre polygone INSEE 97415),
pour generer ensuite le multi-echelle 100% en local sans timeout.

Resume-friendly : skip les fichiers deja caches. Affichage compact :
  o ortho fetch ok    o* cache hit    O! fail
  c cosia                c*             C!
  l lidar                l*             L! / L? (server down)
  r routes BDTOPO        r*             R!
  b bati BDTOPO          b*             B!
  p parcelles cadastre   p*             P!

Usage :
    python download_all_saint_leu.py                       # lidar par defaut
    python download_all_saint_leu.py --types all           # tout
    python download_all_saint_leu.py --types lidar,bdtopo  # selectif
    python download_all_saint_leu.py --tile 500 --filter-polygon
    python download_all_saint_leu.py --limit 5             # test rapide
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path
from typing import Optional

import numpy as np
import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import voxel_patterns_real as vpr  # noqa: E402


# ---------------------------------------------------------------------------
# 1. CONFIG
# ---------------------------------------------------------------------------

# Bbox englobant Saint-Leu (~14 x 13 km = 180 km², commune reelle ~119 km²)
COMMUNE_BBOX = {
    'lat_min': -21.275,
    'lat_max': -21.130,
    'lng_min': 55.265,
    'lng_max': 55.410,
}
INSEE_SAINT_LEU = '97413'

TILE_SIZE_M_DEFAULT = 500.0   # 500m : compatible maxPoints=200k LiDAR HD
VOX_DEFAULT = 4.0             # 500/4=125 cells par tuile (cache npz ~70KB)

CACHE_ROOT = Path('docs/voxel-patterns/cache_commune')

COMMUNE_URL = (
    f'https://geo.api.gouv.fr/communes/{INSEE_SAINT_LEU}'
    '?fields=contour&format=geojson&geometry=contour'
)


# ---------------------------------------------------------------------------
# 2. POLYGONE COMMUNE (filtrage tuiles strictement dans Saint-Leu)
# ---------------------------------------------------------------------------

def fetch_commune_polygon() -> Optional[list]:
    """Retourne liste [[lng, lat], ...] du polygone Saint-Leu via
    geo.api.gouv.fr (Feature direct GeoJSON, pas de FeatureCollection)."""
    try:
        r = requests.get(COMMUNE_URL, timeout=30,
                         headers={'User-Agent': vpr.USER_AGENT})
        if r.status_code != 200:
            print(f'  HTTP {r.status_code}')
            return None
        d = r.json()
        # geo.api.gouv.fr renvoie une Feature directe (pas FeatureCollection)
        geom = d.get('geometry') or {}
        if not geom:
            feats = d.get('features', [])
            if feats:
                geom = feats[0].get('geometry', {})
        if geom.get('type') == 'Polygon':
            return geom['coordinates'][0]
        if geom.get('type') == 'MultiPolygon':
            polys = geom['coordinates']
            biggest = max(polys, key=lambda p: len(p[0]))
            return biggest[0]
    except Exception as e:
        print(f'  commune polygon EXC: {e}')
    return None


def point_in_polygon(lng: float, lat: float, polygon: list) -> bool:
    """Ray casting test. polygon = liste de [lng, lat]."""
    n = len(polygon)
    if n < 3:
        return True
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i][0], polygon[i][1]
        xj, yj = polygon[j][0], polygon[j][1]
        if ((yi > lat) != (yj > lat)) and \
           (lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


# ---------------------------------------------------------------------------
# 3. GRID DE TUILES
# ---------------------------------------------------------------------------

def iterate_tiles(tile_m: float, polygon: Optional[list] = None):
    """Yield (tile_id, lat_center, lng_center) sur la grille."""
    bbox = COMMUNE_BBOX
    lat_step = tile_m / 111320.0
    n_lat = int(math.ceil((bbox['lat_max'] - bbox['lat_min']) / lat_step))

    tid = 0
    for i in range(n_lat):
        lat = bbox['lat_min'] + (i + 0.5) * lat_step
        lng_step = tile_m / (103900.0 * math.cos(math.radians(lat)))
        n_lng = int(math.ceil(
            (bbox['lng_max'] - bbox['lng_min']) / lng_step))
        for j in range(n_lng):
            lng = bbox['lng_min'] + (j + 0.5) * lng_step
            if polygon and not point_in_polygon(lng, lat, polygon):
                continue
            tid += 1
            yield (tid, lat, lng)


# ---------------------------------------------------------------------------
# 4. DOWNLOAD TUILE (resume-friendly)
# ---------------------------------------------------------------------------

def slug_tile(lat: float, lng: float) -> str:
    """Slug stable pour fichier cache (lat,lng -> 'tm21_16900_55_28800')."""
    return (f't{lat:+.5f}_{lng:+.5f}'
            .replace('.', '_').replace('+', 'p').replace('-', 'm'))


def download_tile(tid: int, lat: float, lng: float,
                  side_m: float, vox: float,
                  types: list, cache_dir: Path) -> dict:
    """Telecharge tous les types pour 1 tuile. Skip si cache present."""
    slug = slug_tile(lat, lng)
    nx = max(1, int(round(side_m / vox)))
    side_tag = f's{int(side_m)}'
    stats = {'fetched': 0, 'cached': 0, 'failed': 0}

    print(f'[{tid:4d}] {lat:+.4f},{lng:.4f} ', end='', flush=True)

    def _try(p, fetch_fn, code_ok, code_fail):
        if p.exists():
            print(f'{code_ok}*', end='', flush=True)
            stats['cached'] += 1
            return True
        result = fetch_fn()
        if result is not None:
            print(code_ok, end='', flush=True)
            stats['fetched'] += 1
            return True
        print(code_fail, end='', flush=True)
        stats['failed'] += 1
        return False

    if 'ortho' in types:
        p = cache_dir / f'{slug}_{side_tag}_ortho.jpg'
        def fetch_o():
            img = vpr.fetch_ortho(lat, lng, side_m=side_m, pix=512)
            if img is None:
                return None
            Image.fromarray(img).save(p, quality=82)
            time.sleep(0.15)
            return True
        _try(p, fetch_o, 'o', 'O!')

    if 'cosia' in types:
        p = cache_dir / f'{slug}_{side_tag}_cosia.png'
        def fetch_c():
            img = vpr.fetch_cosia(lat, lng, side_m=side_m, pix=512)
            if img is None:
                return None
            Image.fromarray(img).save(p)
            time.sleep(0.15)
            return True
        _try(p, fetch_c, 'c', 'C!')

    if 'lidar' in types:
        p = cache_dir / f'{slug}_{side_tag}_n{nx}_lidar.npz'
        if p.exists():
            print('l*', end='', flush=True)
            stats['cached'] += 1
        else:
            if not vpr.lidar_is_available():
                print('L?', end='', flush=True)
                stats['failed'] += 1
            else:
                pts = vpr.fetch_lidar_points(lat, lng, side_m=side_m)
                if pts is not None:
                    h, dom, mnt = vpr.lidar_grid_from_points(
                        pts, lat, lng, side_m, nx, nx)
                    if h is not None:
                        np.savez(p, h=h, dom=dom, mnt=mnt)
                        print(f'l({len(pts)//1000}k)',
                              end='', flush=True)
                        stats['fetched'] += 1
                    else:
                        print('L!', end='', flush=True)
                        stats['failed'] += 1
                else:
                    print('L!', end='', flush=True)
                    stats['failed'] += 1

    if 'bdtopo' in types or 'routes' in types:
        p = cache_dir / f'{slug}_{side_tag}_routes.json'
        def fetch_r():
            g = vpr.fetch_bdtopo_routes(lat, lng, side_m)
            if g is None:
                return None
            p.write_text(json.dumps(g), encoding='utf-8')
            time.sleep(0.15)
            return True
        _try(p, fetch_r, 'r', 'R!')

    if 'bdtopo' in types or 'bati' in types:
        p = cache_dir / f'{slug}_{side_tag}_bati.json'
        def fetch_b():
            g = vpr.fetch_bdtopo_buildings(lat, lng, side_m)
            if g is None:
                return None
            p.write_text(json.dumps(g), encoding='utf-8')
            time.sleep(0.15)
            return True
        _try(p, fetch_b, 'b', 'B!')

    if 'cadastre' in types:
        p = cache_dir / f'{slug}_{side_tag}_cadastre.json'
        def fetch_p():
            g = vpr.fetch_cadastre_parcelles(lat, lng, side_m)
            if g is None:
                return None
            p.write_text(json.dumps(g), encoding='utf-8')
            time.sleep(0.15)
            return True
        _try(p, fetch_p, 'p', 'P!')

    print('')
    return stats


# ---------------------------------------------------------------------------
# 5. MAIN
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tile', type=float, default=TILE_SIZE_M_DEFAULT,
                    help='Cote tuile en metres (default 500)')
    ap.add_argument('--vox', type=float, default=VOX_DEFAULT,
                    help='Voxel size pour cache LiDAR (default 4m)')
    ap.add_argument('--types', default='lidar',
                    help="lidar,ortho,cosia,bdtopo,cadastre,all "
                         "(default 'lidar')")
    ap.add_argument('--cache', default=str(CACHE_ROOT))
    ap.add_argument('--filter-polygon', action='store_true',
                    help='Filtrer tuiles strictement dans polygone commune')
    ap.add_argument('--limit', type=int, default=0,
                    help='Limit nb tuiles (0 = pas de limit)')
    args = ap.parse_args()

    if args.types == 'all':
        types = ['lidar', 'ortho', 'cosia', 'bdtopo', 'cadastre']
    else:
        types = [t.strip() for t in args.types.split(',') if t.strip()]

    cache_dir = Path(args.cache)
    cache_dir.mkdir(parents=True, exist_ok=True)

    polygon = None
    if args.filter_polygon:
        print(f'-> fetch polygone Saint-Leu (INSEE {INSEE_SAINT_LEU})...')
        polygon = fetch_commune_polygon()
        if polygon:
            print(f'   {len(polygon)} sommets')
        else:
            print('   FAIL, on continue sans filtre (bbox seule)')

    tiles = list(iterate_tiles(args.tile, polygon))
    if args.limit > 0:
        tiles = tiles[:args.limit]

    print(f'-> {len(tiles)} tuiles {int(args.tile)}m')
    print(f'-> types : {types}')
    print(f'-> cache : {cache_dir}')
    print(f'-> vox   : {args.vox}m (NX={int(args.tile/args.vox)})')

    t0 = time.time()
    total_stats = {'fetched': 0, 'cached': 0, 'failed': 0}
    for tid, lat, lng in tiles:
        s = download_tile(tid, lat, lng, args.tile, args.vox,
                          types, cache_dir)
        for k in total_stats:
            total_stats[k] += s[k]

    elapsed = time.time() - t0
    print(f'\n=== Fini en {elapsed/60:.1f} min ===')
    print(f'   {total_stats["fetched"]} fetched, '
          f'{total_stats["cached"]} cached, '
          f'{total_stats["failed"]} failed')

    # Resume du cache
    sizes = sum(p.stat().st_size for p in cache_dir.glob('*'))
    print(f'-> cache total : {sizes / 1024**2:.1f} MB '
          f'({len(list(cache_dir.glob("*")))} fichiers)')


if __name__ == '__main__':
    main()
