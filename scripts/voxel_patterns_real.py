#!/usr/bin/env python3
"""
TERLAB . voxel_patterns_real.py
Poster pedagogique v2 : 12 zones reelles Saint-Leu (3 par type).
Pipeline : fetch BD ORTHO IGN -> classif couleur heuristique -> voxel axo -> PDF.

Sans LiDAR (fallback heuristique hauteur typique par classe).

Usage :
    python voxel_patterns_real.py [--output docs/voxel-patterns/poster-real.pdf]
                                   [--side 250] [--zoom-cells 20]
"""

from __future__ import annotations

import argparse
import datetime
import io
import math
import time
from pathlib import Path
from typing import Optional

import numpy as np
import requests
from PIL import Image
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
import matplotlib.image as mpimg
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Patch
from mpl_toolkits.mplot3d import Axes3D  # noqa: F401


# ---------------------------------------------------------------------------
# 1. CONFIG
# ---------------------------------------------------------------------------

WMS_URL = 'https://data.geopf.fr/wms-r/wms'
WMS_LAYER = 'HR.ORTHOIMAGERY.ORTHOPHOTOS'
WMS_FALLBACK_LAYER = 'ORTHOIMAGERY.ORTHOPHOTOS'
USER_AGENT = 'TERLAB-voxel-pattern/2.0 (mathiasgiraud@gmail.com)'

LIDAR_URL = 'http://localhost:8001/api/points-bbox'
LIDAR_HEALTH = 'http://localhost:8001/api/files'
LIDAR_CLASSES = '2,3,4,5,6,9'  # sol, vege basse/moy/haute, bati, eau
LIDAR_MAXPOINTS = 200000
LIDAR_TIMEOUT = 60.0

BDTOPO_URL = 'https://data.geopf.fr/wfs/ows'
BDTOPO_LAYER = 'BDTOPO_V3:troncon_de_route'
BDTOPO_BATI_LAYER = 'BDTOPO_V3:batiment'
BDTOPO_TIMEOUT = 20.0

COSIA_LAYER = 'IGNF_COSIA_2021-2023'
COSIA_TIMEOUT = 30.0

ZONES = {
    'FORET': [
        ('Bois de Sans-Souci',     -21.183, 55.327),
        ('Foret Tevelave',         -21.207, 55.310),
        ('Bras des Calumets',      -21.232, 55.318),
    ],
    'CHAMPS': [
        ('Plaine Piton St-Leu',    -21.166, 55.310),
        ('Stella canne',           -21.193, 55.312),
        ('Le Plate canne',         -21.213, 55.305),
    ],
    'VILLE': [
        ('Centre St-Leu',          -21.169, 55.288),
        ('Pointe des Chateaux',    -21.157, 55.283),
        ('Etang St-Leu',           -21.200, 55.290),
    ],
    'LOTISSEMENT': [
        ('Plateau Cailloux',       -21.193, 55.293),
        ('Bras Mouton residentiel',-21.181, 55.300),
        ('La Chaloupe centre',     -21.227, 55.314),
    ],
}

PALETTE = {
    'sol':         '#C2B280',
    'route':       '#404040',
    'eau':         '#5B8FA8',
    'bati':        '#D34E2D',  # rouge brique : franche distinction sur fond vert
    'bati_haut':   '#7A2818',  # bordeaux pour R+2+
    'feuillu':     '#3F7A4D',
    'champ_canne': '#E8D26E',
}

ALPHA_VOX = 0.40  # transparent : voir a travers les voxels (relief lisible)
# NX/NY/NZ sont calcules depuis --side et --voxel-size dans main().
NX = NY = 20
NZ = 25
SIDE_M_DEFAULT = 60          # zoom fin par defaut (etait 250)
VOXEL_XY_DEFAULT = 2.0       # vox 2m XY (etait 12.5)
VOXEL_Z_M = 1.0              # vertical : toujours 1 m


# ---------------------------------------------------------------------------
# 2. WMS FETCH
# ---------------------------------------------------------------------------

def lonlat_to_3857(lon: float, lat: float) -> tuple[float, float]:
    R = 6378137.0
    x = R * math.radians(lon)
    y = R * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return x, y


def fetch_ortho(lat: float, lng: float, side_m: float = 250.0,
                pix: int = 512) -> Optional[np.ndarray]:
    """Fetch BD ORTHO HD IGN, retourne RGB (pix, pix, 3) uint8."""
    cx, cy = lonlat_to_3857(lng, lat)
    half = (side_m / 2) / math.cos(math.radians(lat))
    bbox = f'{cx-half},{cy-half},{cx+half},{cy+half}'

    for layer in (WMS_LAYER, WMS_FALLBACK_LAYER):
        params = {
            'SERVICE': 'WMS',
            'VERSION': '1.3.0',
            'REQUEST': 'GetMap',
            'LAYERS': layer,
            'STYLES': '',
            'CRS': 'EPSG:3857',
            'BBOX': bbox,
            'WIDTH': pix,
            'HEIGHT': pix,
            'FORMAT': 'image/jpeg',
        }
        try:
            r = requests.get(WMS_URL, params=params,
                             headers={'User-Agent': USER_AGENT}, timeout=30)
            ct = r.headers.get('Content-Type', '')
            if r.status_code == 200 and 'image' in ct:
                img = Image.open(io.BytesIO(r.content)).convert('RGB')
                return np.array(img, dtype=np.uint8)
            print(f'  WMS {layer} HTTP {r.status_code} ct={ct[:40]}')
        except Exception as e:
            print(f'  WMS {layer} EXC: {e}')
    return None


# ---------------------------------------------------------------------------
# 3. CLASSIFICATION COULEUR HEURISTIQUE
# ---------------------------------------------------------------------------

def classify_cell(rgb_block: np.ndarray) -> str:
    """rgb_block: (H, W, 3) -> classe."""
    med = np.median(rgb_block.reshape(-1, 3), axis=0)
    r, g, b = float(med[0]), float(med[1]), float(med[2])
    brightness = (r + g + b) / 3
    chroma = max(r, g, b) - min(r, g, b)

    # Eau : B dominant, plutot fonce
    if b > r + 10 and b > g - 5 and brightness < 160:
        return 'eau'

    # Vegetation : G dominant
    if g > r and g > b and chroma > 12:
        if (g - r) > 20 and brightness < 150:
            return 'feuillu'
        return 'champ_canne'

    # Gris : route ou bati selon brightness
    if chroma < 28:
        if brightness < 95:
            return 'route'
        if brightness < 170:
            return 'bati'
        return 'sol'

    # Toit rouge / brun
    if r > g + 10 and r > b + 10:
        return 'bati'

    # Sable / sol
    return 'sol'


def grid_classify(img: np.ndarray, nx: int, ny: int) -> np.ndarray:
    """img (H, W, 3) -> grid classe (nx, ny) de strings."""
    H, W = img.shape[:2]
    cw = W // nx
    ch = H // ny
    grid = np.empty((nx, ny), dtype=object)
    for ix in range(nx):
        for iy in range(ny):
            block = img[iy * ch:(iy + 1) * ch, ix * cw:(ix + 1) * cw]
            grid[ix, iy] = classify_cell(block)
    return grid


# ---------------------------------------------------------------------------
# 2b. COSIA IGN (segmentation IA pre-classifiee, WMS PNG)
# ---------------------------------------------------------------------------

# Couleurs de reference COSIA (extraites du legend service IGN, approchees).
# Mapping vers nos 5 classes TERLAB (sol/route/eau/feuillu/champ_canne/bati).
COSIA_REFS = np.array([
    [170, 0, 0],      # 0: bati
    [48, 48, 48],     # 1: zones pavees -> route
    [113, 113, 113],  # 2: zones non pavees -> route
    [200, 152, 95],   # 3: sol nu
    [26, 79, 124],    # 4: eau
    [26, 83, 0],      # 5: coniferes -> feuillu
    [42, 143, 0],     # 6: feuillus
    [130, 199, 80],   # 7: broussailles -> feuillu
    [184, 224, 112],  # 8: prairies -> champ_canne
    [245, 224, 64],   # 9: cultures -> champ_canne
    [122, 80, 40],    # 10: terres labourees -> sol
], dtype=np.float32)
COSIA_CLASSES = [
    'bati', 'route', 'route', 'sol', 'eau',
    'feuillu', 'feuillu', 'feuillu',
    'champ_canne', 'champ_canne', 'sol',
]


def fetch_cosia(lat: float, lng: float, side_m: float,
                pix: int = 512) -> Optional[np.ndarray]:
    """Fetch COSIA IGN WMS, retourne RGBA (pix, pix, 4) uint8 ou None."""
    half = side_m / 2
    d_lat = half / 111320.0
    d_lng = half / (103900.0 * math.cos(math.radians(lat)))
    # WMS 1.3.0 + EPSG:4326 -> ordre Y,X (lat,lng)
    bbox = f'{lat - d_lat},{lng - d_lng},{lat + d_lat},{lng + d_lng}'
    params = {
        'SERVICE': 'WMS', 'VERSION': '1.3.0', 'REQUEST': 'GetMap',
        'LAYERS': COSIA_LAYER, 'CRS': 'EPSG:4326',
        'BBOX': bbox, 'WIDTH': pix, 'HEIGHT': pix,
        'FORMAT': 'image/png', 'STYLES': '',
    }
    try:
        r = requests.get(WMS_URL, params=params,
                         headers={'User-Agent': USER_AGENT},
                         timeout=COSIA_TIMEOUT)
        if r.status_code != 200:
            print(f'  COSIA HTTP {r.status_code}')
            return None
        if 'image' not in r.headers.get('Content-Type', ''):
            return None
        img = Image.open(io.BytesIO(r.content)).convert('RGBA')
        return np.array(img, dtype=np.uint8)
    except Exception as e:
        print(f'  COSIA EXC: {e}')
        return None


def cosia_grid_classify(cosia_img: Optional[np.ndarray],
                         nx: int, ny: int) -> Optional[np.ndarray]:
    """Bin RGBA COSIA en (nx, ny) classes par nearest reference."""
    if cosia_img is None:
        return None
    H, W = cosia_img.shape[:2]
    cw = W // nx
    ch = H // ny
    grid = np.empty((nx, ny), dtype=object)
    has_alpha = cosia_img.shape[2] == 4
    for ix in range(nx):
        for iy in range(ny):
            block = cosia_img[iy * ch:(iy + 1) * ch, ix * cw:(ix + 1) * cw]
            if has_alpha and block[..., 3].mean() < 100:
                grid[ix, iy] = None  # tile transparente
                continue
            med = np.median(block[..., :3].reshape(-1, 3), axis=0)
            d = np.sum((COSIA_REFS - med) ** 2, axis=1)
            grid[ix, iy] = COSIA_CLASSES[int(np.argmin(d))]
    return grid


def merge_grids(cosia: Optional[np.ndarray],
                rgb: np.ndarray) -> np.ndarray:
    """Prefere COSIA si dispo (non-None), sinon RGB heuristique."""
    if cosia is None:
        return rgb
    out = np.empty_like(rgb)
    for ix in range(rgb.shape[0]):
        for iy in range(rgb.shape[1]):
            c = cosia[ix, iy]
            out[ix, iy] = c if c is not None else rgb[ix, iy]
    return out


# ---------------------------------------------------------------------------
# 3b. LIDAR (HD IGN via lidar-fetcher local)
# ---------------------------------------------------------------------------

LIDAR_AVAILABLE: Optional[bool] = None  # cache health check


def lidar_is_available() -> bool:
    global LIDAR_AVAILABLE
    if LIDAR_AVAILABLE is not None:
        return LIDAR_AVAILABLE
    try:
        r = requests.get(LIDAR_HEALTH, timeout=4)
        LIDAR_AVAILABLE = r.status_code == 200
    except Exception:
        LIDAR_AVAILABLE = False
    print(f'  LiDAR health: {"OK" if LIDAR_AVAILABLE else "DOWN"}')
    return LIDAR_AVAILABLE


def fetch_lidar_points(lat: float, lng: float,
                       side_m: float) -> Optional[np.ndarray]:
    """Retourne (N, 7) : [lng, lat, alt, r, g, b, class]. None si echec."""
    half = side_m / 2
    d_lat = half / 111320.0
    d_lng = half / (103900.0 * math.cos(math.radians(lat)))  # corrige latitude
    params = {
        'minLng': lng - d_lng, 'maxLng': lng + d_lng,
        'minLat': lat - d_lat, 'maxLat': lat + d_lat,
        'classes': LIDAR_CLASSES,
        'maxPoints': LIDAR_MAXPOINTS,
    }
    try:
        r = requests.get(LIDAR_URL, params=params, timeout=LIDAR_TIMEOUT)
        if r.status_code != 200:
            print(f'  LiDAR HTTP {r.status_code}')
            return None
        pts = r.json().get('points', [])
        if not pts:
            return None
        return np.array(pts, dtype=np.float64)
    except Exception as e:
        print(f'  LiDAR EXC: {e}')
        return None


def lidar_grid_from_points(points: np.ndarray, lat: float, lng: float,
                            side_m: float, nx: int, ny: int):
    """Bin points par cellule.
    Retourne (h_grid CHM, dom_class_grid, mnt_grid z_sol absolu)."""
    if points is None or len(points) == 0:
        return None, None, None

    half = side_m / 2
    m_per_deg_lat = 111320.0
    m_per_deg_lng = 103900.0 * math.cos(math.radians(lat))

    x_m = (points[:, 0] - lng) * m_per_deg_lng
    y_m = (points[:, 1] - lat) * m_per_deg_lat
    z = points[:, 2]
    cls = points[:, 6].astype(int)

    cell = side_m / nx
    ix = np.clip(((x_m + half) / cell).astype(int), 0, nx - 1)
    iy = np.clip(((y_m + half) / cell).astype(int), 0, ny - 1)

    h_grid = np.zeros((nx, ny), dtype=np.float32)
    # MNT : NaN par defaut, on fill ensuite depuis les voisins valides
    mnt_grid = np.full((nx, ny), np.nan, dtype=np.float32)
    dom_grid = np.full((nx, ny), -1, dtype=np.int8)

    flat_key = ix * ny + iy
    order = np.argsort(flat_key)
    keys_sorted = flat_key[order]
    z_sorted = z[order]
    cls_sorted = cls[order]

    boundaries = np.where(np.diff(keys_sorted) != 0)[0] + 1
    starts = np.concatenate(([0], boundaries))
    ends = np.concatenate((boundaries, [len(keys_sorted)]))

    for s, e in zip(starts, ends):
        k = int(keys_sorted[s])
        i, j = divmod(k, ny)
        z_cell = z_sorted[s:e]
        c_cell = cls_sorted[s:e]

        sol_mask = c_cell == 2
        if sol_mask.any():
            z_sol = float(np.median(z_cell[sol_mask]))
            mnt_grid[i, j] = z_sol
        else:
            # Pas de point cls 2 : on laisse NaN sur MNT (sera fill ensuite).
            # Pour le CHM on utilise quand meme une approximation.
            z_sol = float(np.percentile(z_cell, 5))

        z_top = float(z_cell.max())
        chm = max(0.0, z_top - z_sol)

        non_sol = c_cell[c_cell != 2]
        if len(non_sol):
            vals, counts = np.unique(non_sol, return_counts=True)
            dom = int(vals[counts.argmax()])
        else:
            dom = 2

        h_grid[i, j] = chm
        dom_grid[i, j] = dom

    # Fill MNT NaN par dilatation iterative (min des voisins valides 3x3)
    nans = np.isnan(mnt_grid)
    if nans.any():
        for _ in range(20):
            nans = np.isnan(mnt_grid)
            if not nans.any():
                break
            new = mnt_grid.copy()
            ys_n, xs_n = np.where(nans)
            for ix, iy in zip(ys_n, xs_n):
                sub = mnt_grid[max(0, ix - 1):ix + 2,
                               max(0, iy - 1):iy + 2]
                valid = sub[~np.isnan(sub)]
                if len(valid):
                    new[ix, iy] = float(valid.min())
            mnt_grid = new
        # Reste : fill avec moyenne globale
        if np.isnan(mnt_grid).any():
            mnt_grid[np.isnan(mnt_grid)] = float(np.nanmean(mnt_grid))

    return h_grid, dom_grid, mnt_grid


# ---------------------------------------------------------------------------
# 3c. BDTOPO routes vectorielles (Geoplateforme WFS)
# ---------------------------------------------------------------------------

BDTOPO_EXPAND = 3.0  # bbox WFS elargi pour capter les axes voisins


def fetch_bdtopo_routes(lat: float, lng: float, side_m: float):
    """Retourne GeoJSON FeatureCollection ou None.
    Bbox WFS elargi BDTOPO_EXPAND fois pour eviter les zones sans tronçon
    quand la grille est petite (60m). Le rasterisation est ensuite clippe
    par la grille NX x NY de side_m exact."""
    half = (side_m * BDTOPO_EXPAND) / 2
    d_lat = half / 111320.0
    d_lng = half / (103900.0 * math.cos(math.radians(lat)))
    # Geoplateforme WFS attend ordre X,Y (lng,lat) pour EPSG:4326
    bbox = (f'{lng - d_lng},{lat - d_lat},'
            f'{lng + d_lng},{lat + d_lat},EPSG:4326')
    params = {
        'SERVICE': 'WFS', 'VERSION': '2.0.0',
        'REQUEST': 'GetFeature', 'typenames': BDTOPO_LAYER,
        'bbox': bbox, 'outputFormat': 'application/json',
        'count': 200,
    }
    try:
        r = requests.get(BDTOPO_URL, params=params,
                         headers={'User-Agent': USER_AGENT},
                         timeout=BDTOPO_TIMEOUT)
        if r.status_code != 200:
            print(f'  BDTOPO HTTP {r.status_code}')
            return None
        return r.json()
    except Exception as e:
        print(f'  BDTOPO EXC: {e}')
        return None


def routes_to_grid(geojson, lat: float, lng: float,
                   side_m: float, nx: int, ny: int) -> np.ndarray:
    """Rasterise routes BDTOPO en mask cellule (nx, ny)."""
    mask = np.zeros((nx, ny), dtype=bool)
    if not geojson or not geojson.get('features'):
        return mask

    half = side_m / 2
    m_per_deg_lat = 111320.0
    m_per_deg_lng = 103900.0 * math.cos(math.radians(lat))
    cell = side_m / nx

    for feat in geojson['features']:
        geom = feat.get('geometry') or {}
        props = feat.get('properties') or {}
        largeur = props.get('largeur_de_chaussee') or 4.0
        try:
            largeur = float(largeur)
        except (TypeError, ValueError):
            largeur = 4.0
        radius_cells = max(0, int(round(largeur / 2 / cell)))

        gtype = geom.get('type')
        if gtype == 'LineString':
            lines = [geom['coordinates']]
        elif gtype == 'MultiLineString':
            lines = geom['coordinates']
        else:
            continue

        for coords in lines:
            for k in range(len(coords) - 1):
                lng1, lat1 = coords[k][0], coords[k][1]
                lng2, lat2 = coords[k + 1][0], coords[k + 1][1]
                gx1 = ((lng1 - lng) * m_per_deg_lng + half) / cell
                gy1 = ((lat1 - lat) * m_per_deg_lat + half) / cell
                gx2 = ((lng2 - lng) * m_per_deg_lng + half) / cell
                gy2 = ((lat2 - lat) * m_per_deg_lat + half) / cell
                n_samples = max(2, int(math.hypot(gx2 - gx1, gy2 - gy1) * 2))
                for s in range(n_samples + 1):
                    t = s / n_samples
                    gx = gx1 + (gx2 - gx1) * t
                    gy = gy1 + (gy2 - gy1) * t
                    ix0 = int(gx)
                    iy0 = int(gy)
                    for dx in range(-radius_cells, radius_cells + 1):
                        for dy in range(-radius_cells, radius_cells + 1):
                            if dx * dx + dy * dy > radius_cells * radius_cells:
                                continue
                            ix = ix0 + dx
                            iy = iy0 + dy
                            if 0 <= ix < nx and 0 <= iy < ny:
                                mask[ix, iy] = True
    return mask


CADASTRE_LAYER = 'CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle'


def fetch_cadastre_parcelles(lat: float, lng: float, side_m: float):
    """Fetch parcelles cadastre IGN (PARCELLAIRE EXPRESS), retourne GeoJSON."""
    half = (side_m * 1.1) / 2
    d_lat = half / 111320.0
    d_lng = half / (103900.0 * math.cos(math.radians(lat)))
    bbox = (f'{lng - d_lng},{lat - d_lat},'
            f'{lng + d_lng},{lat + d_lat},EPSG:4326')
    params = {
        'SERVICE': 'WFS', 'VERSION': '2.0.0',
        'REQUEST': 'GetFeature', 'typenames': CADASTRE_LAYER,
        'bbox': bbox, 'outputFormat': 'application/json',
        'count': 500,
    }
    try:
        r = requests.get(BDTOPO_URL, params=params,
                         headers={'User-Agent': USER_AGENT},
                         timeout=BDTOPO_TIMEOUT)
        if r.status_code != 200:
            print(f'  cadastre HTTP {r.status_code}')
            return None
        return r.json()
    except Exception as e:
        print(f'  cadastre EXC: {e}')
        return None


def overlay_parcelles_on_mockup_3d(ax, parcelles_geojson, mnt: np.ndarray,
                                     lat: float, lng: float, side_m: float,
                                     fence_height: float = 1.0):
    """Trace les limites cadastrales comme cloturres 3D 1m de haut,
    plaquees sur le MNT terrain LiDAR cellule par cellule."""
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    if not parcelles_geojson or not parcelles_geojson.get('features'):
        return

    nx, ny = mnt.shape
    half = side_m / 2
    cell = side_m / nx
    z_min = float(mnt.min())
    m_per_deg_lat = 111320.0
    m_per_deg_lng = 103900.0 * math.cos(math.radians(lat))

    def _get_z(x: float, y: float) -> Optional[float]:
        if abs(x) > half or abs(y) > half:
            return None
        ix = int(np.clip((x + half) / cell, 0, nx - 1))
        iy = int(np.clip((y + half) / cell, 0, ny - 1))
        return float(mnt[ix, iy]) - z_min

    quads = []
    for feat in parcelles_geojson['features']:
        geom = feat.get('geometry') or {}
        gtype = geom.get('type')
        if gtype == 'Polygon':
            rings = [geom['coordinates'][0]]
        elif gtype == 'MultiPolygon':
            rings = [poly[0] for poly in geom['coordinates']]
        else:
            continue

        for ring in rings:
            for k in range(len(ring) - 1):
                c1, c2 = ring[k], ring[k + 1]
                p1x = (c1[0] - lng) * m_per_deg_lng
                p1y = (c1[1] - lat) * m_per_deg_lat
                p2x = (c2[0] - lng) * m_per_deg_lng
                p2y = (c2[1] - lat) * m_per_deg_lat
                z1 = _get_z(p1x, p1y)
                z2 = _get_z(p2x, p2y)
                if z1 is None or z2 is None:
                    continue
                quads.append([
                    (p1x, p1y, z1),
                    (p2x, p2y, z2),
                    (p2x, p2y, z2 + fence_height),
                    (p1x, p1y, z1 + fence_height),
                ])

    if quads:
        pc = Poly3DCollection(
            quads, facecolors='#a0a0a0', edgecolors='#3a3a3a',
            linewidths=0.18, alpha=0.55, zorder=4)  # entre terrain=1 et routes=5
        ax.add_collection3d(pc)


def fetch_bdtopo_buildings(lat: float, lng: float, side_m: float):
    """Fetch BDTOPO_V3:batiment, retourne GeoJSON ou None."""
    half = (side_m * 1.1) / 2  # bati : leger overlap pour capter ceux a cheval bord
    d_lat = half / 111320.0
    d_lng = half / (103900.0 * math.cos(math.radians(lat)))
    bbox = (f'{lng - d_lng},{lat - d_lat},'
            f'{lng + d_lng},{lat + d_lat},EPSG:4326')
    params = {
        'SERVICE': 'WFS', 'VERSION': '2.0.0',
        'REQUEST': 'GetFeature', 'typenames': BDTOPO_BATI_LAYER,
        'bbox': bbox, 'outputFormat': 'application/json',
        'count': 200,
    }
    try:
        r = requests.get(BDTOPO_URL, params=params,
                         headers={'User-Agent': USER_AGENT},
                         timeout=BDTOPO_TIMEOUT)
        if r.status_code != 200:
            print(f'  BDTOPO bati HTTP {r.status_code}')
            return None
        return r.json()
    except Exception as e:
        print(f'  BDTOPO bati EXC: {e}')
        return None


# ---------------------------------------------------------------------------
# 4. VOXELISATION (LiDAR si dispo, sinon heuristique typique)
# ---------------------------------------------------------------------------

TYPICAL_HEIGHT_M = {
    'sol': 0,
    'route': 0,
    'eau': 0,
    'champ_canne': 2,
    'feuillu': 9,
    'bati': 5,
    'bati_haut': 11,
}


def _density_score(grid: np.ndarray, ix: int, iy: int, target_class: str) -> int:
    """Compte voisins 3x3 de meme classe."""
    nx, ny = grid.shape
    n = 0
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            x, y = ix + dx, iy + dy
            if 0 <= x < nx and 0 <= y < ny and grid[x, y] == target_class:
                n += 1
    return n


def voxelize(grid: np.ndarray, rng: np.random.Generator,
             h_grid: Optional[np.ndarray] = None,
             dom_grid: Optional[np.ndarray] = None,
             routes_mask: Optional[np.ndarray] = None,
             ortho_img: Optional[np.ndarray] = None,
             side_m: Optional[float] = None) -> tuple[np.ndarray, np.ndarray]:
    """Retourne (filled, colors_obj) shape (NX, NY, NZ).

    Si h_grid/dom_grid fournis (LiDAR), priorite a la hauteur reelle CHM
    et a la classe LiDAR dominante. Sinon fallback heuristique typique.
    Si routes_mask fourni (BDTOPO), force la couleur sol=route et empeche
    le bati heuristique sur ces cellules (la vege LiDAR au-dessus reste).
    Si ortho_img + side_m fournis, les cellules route prennent la couleur
    du pixel ortho a l'aplomb (au lieu du gris PALETTE['route']).
    """
    filled = np.zeros((NX, NY, NZ), dtype=bool)
    colors = np.empty(filled.shape, dtype=object)
    has_lidar = h_grid is not None and dom_grid is not None
    has_routes = routes_mask is not None
    has_ortho = ortho_img is not None and side_m is not None
    cell_xy = (side_m / NX) if has_ortho else 0.0

    for ix in range(NX):
        for iy in range(NY):
            cls = grid[ix, iy]
            is_route_vec = bool(has_routes and routes_mask[ix, iy])
            is_eau = (cls == 'eau') or (has_lidar and int(dom_grid[ix, iy]) == 9)

            # Slab sol toujours present
            filled[ix, iy, 0] = True
            lidar_cls = int(dom_grid[ix, iy]) if has_lidar else -1
            if is_eau:
                colors[ix, iy, 0] = PALETTE['eau']
            elif is_route_vec:
                # Couleur du pixel ortho a l'aplomb (route reelle visible)
                if has_ortho:
                    cx_m = -side_m / 2 + (ix + 0.5) * cell_xy
                    cy_m = -side_m / 2 + (iy + 0.5) * cell_xy
                    col_route = _sample_ortho_color(
                        ortho_img, side_m, cx_m, cy_m, saturate=1.0)
                    if col_route == '#888888':
                        col_route = PALETTE['route']
                else:
                    col_route = PALETTE['route']
                colors[ix, iy, 0] = col_route
                # Epaississement Z=1 (sauf si vege/bati LiDAR va extruder)
                lidar_will_extrude = (has_lidar
                                      and h_grid[ix, iy] > 0.4
                                      and lidar_cls in (3, 4, 5))
                if not lidar_will_extrude and NZ > 1:
                    filled[ix, iy, 1] = True
                    colors[ix, iy, 1] = col_route
            elif cls == 'route':
                colors[ix, iy, 0] = PALETTE['route']
            else:
                colors[ix, iy, 0] = PALETTE['sol']

            # Eau : pas d'extrusion (les vagues/ecume creent du bruit LiDAR)
            if is_eau:
                continue

            # LiDAR : hauteur reelle + classe dominante
            if has_lidar and h_grid[ix, iy] > 0.4 and lidar_cls in (3, 4, 5, 6):
                h_m = float(h_grid[ix, iy])
                # Si route vecteur + LiDAR classe 6 -> contradiction, on
                # croit a la donnee vecteur (toit gris pris pour bati souvent)
                if is_route_vec and lidar_cls == 6:
                    continue
                if lidar_cls == 6:  # bati
                    col = PALETTE['bati_haut'] if h_m > 8 else PALETTE['bati']
                elif lidar_cls == 5:  # vege haute (peut surplomber une route)
                    col = PALETTE['feuillu']
                elif lidar_cls in (3, 4):  # vege basse/moy
                    if is_route_vec:
                        continue  # buisson de bord de route, on n'extrude pas
                    col = (PALETTE['champ_canne'] if cls == 'champ_canne'
                           else PALETTE['feuillu'])
                else:
                    col = PALETTE['sol']

                h_vox = max(1, int(round(h_m)))  # voxel z = 1m
                for z in range(1, min(1 + h_vox, NZ)):
                    filled[ix, iy, z] = True
                    colors[ix, iy, z] = col
                continue

            # Fallback heuristique (pas de LiDAR pour cette cellule)
            if cls in ('sol', 'route', 'eau') or is_route_vec:
                continue

            base_h = TYPICAL_HEIGHT_M[cls]
            jitter = (rng.random() - 0.5) * 0.6
            h = max(1, int(round(base_h * (1 + jitter))))

            if cls == 'bati':
                d = _density_score(grid, ix, iy, 'bati')
                if d >= 7:
                    h = max(h, TYPICAL_HEIGHT_M['bati_haut'])
                    col = PALETTE['bati_haut']
                else:
                    col = PALETTE['bati']
            else:
                col = PALETTE[cls]

            for z in range(1, min(1 + h, NZ)):
                filled[ix, iy, z] = True
                colors[ix, iy, z] = col

    return filled, colors


# ---------------------------------------------------------------------------
# 5. RENDU AXO
# ---------------------------------------------------------------------------

def _to_rgba_face_edge(filled: np.ndarray, colors: np.ndarray,
                        routes_mask: Optional[np.ndarray] = None):
    """Construit facecolors + edgecolors RGBA. Edge invisible pour l'eau.
    Si routes_mask fourni, les voxels route (iz <= 1) sont rendus opaques
    (alpha=1.0) au lieu de la transparence ALPHA_VOX, pour qu'ils restent
    lisibles a travers la masse vege transparente."""
    fc = np.zeros(filled.shape + (4,))
    ec = np.zeros(filled.shape + (4,))
    eau_rgb = mcolors.to_rgb(PALETTE['eau'])
    for ix, iy, iz in np.argwhere(filled):
        c = colors[ix, iy, iz]
        if c is None:
            continue
        r, g, b = mcolors.to_rgb(c)
        is_route_vox = (routes_mask is not None
                        and routes_mask[ix, iy]
                        and iz < 2)
        a = 1.0 if is_route_vox else ALPHA_VOX
        fc[ix, iy, iz] = (r, g, b, a)
        if (r, g, b) == eau_rgb:
            ec[ix, iy, iz] = (0, 0, 0, 0)  # eau : pas d'edge
        elif is_route_vox:
            ec[ix, iy, iz] = (0.05, 0.05, 0.05, 1.0)  # edge route plus marque
        else:
            ec[ix, iy, iz] = (0.13, 0.13, 0.13, 1.0)
    return fc, ec


def draw_axo(ax, filled, colors, title='',
             routes_mask: Optional[np.ndarray] = None):
    fc, ec = _to_rgba_face_edge(filled, colors, routes_mask)
    ax.voxels(filled, facecolors=fc, edgecolors=ec, linewidth=0.15)
    ax.set_proj_type('ortho')
    ax.view_init(elev=30, azim=-55)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_zticks([])
    ax.set_box_aspect((NX, NY, NZ * 0.3))  # voxels aplatis : pas d'exageration Z
    if title:
        ax.set_title(title, fontsize=8, pad=1)
    ax.set_facecolor('white')
    ax.grid(False)
    # Cacher panneaux
    for axis in (ax.xaxis, ax.yaxis, ax.zaxis):
        axis.pane.fill = False
        axis.pane.set_edgecolor('white')


def overlay_routes_on_axo(ax, routes_geojson, lat: float, lng: float,
                           side_m: float, nx: int, ny: int, nz: int,
                           mnt: Optional[np.ndarray] = None):
    """Trace les LineStrings BDTOPO en rouge AU-DESSUS de la masse voxel
    (z = nz + 1.0), pour visibilite maximale par-dessus la canopee."""
    if not routes_geojson or not routes_geojson.get('features'):
        return
    half = side_m / 2
    m_per_deg_lat = 111320.0
    m_per_deg_lng = 103900.0 * math.cos(math.radians(lat))
    cell = side_m / nx
    has_mnt = mnt is not None
    z_min_mnt = float(mnt.min()) if has_mnt else 0.0
    # Au-dessus de la canopee : nz + 1m
    base_offset = float(nz) + 1.0

    for feat in routes_geojson['features']:
        geom = feat.get('geometry') or {}
        gtype = geom.get('type')
        if gtype == 'LineString':
            lines = [geom['coordinates']]
        elif gtype == 'MultiLineString':
            lines = geom['coordinates']
        else:
            continue
        for coords in lines:
            xs, ys, zs = [], [], []
            for c in coords:
                cx_m = (c[0] - lng) * m_per_deg_lng
                cy_m = (c[1] - lat) * m_per_deg_lat
                ix_f = (cx_m + half) / cell
                iy_f = (cy_m + half) / cell
                if -0.5 <= ix_f <= nx + 0.5 and -0.5 <= iy_f <= ny + 0.5:
                    cix = int(np.clip(ix_f, 0, nx - 1))
                    ciy = int(np.clip(iy_f, 0, ny - 1))
                    if has_mnt:
                        # Plaque sur le terrain LiDAR cellule par cellule
                        z = float(mnt[cix, ciy]) - z_min_mnt + base_offset
                    else:
                        z = base_offset
                    xs.append(float(np.clip(ix_f, 0, nx)))
                    ys.append(float(np.clip(iy_f, 0, ny)))
                    zs.append(z)
            if len(xs) >= 2:
                ax.plot(xs, ys, zs, color='#ff3344',
                        linewidth=1.5, alpha=0.9, zorder=20)


def overlay_routes_on_mockup_3d(ax, routes_geojson, mnt: np.ndarray,
                                  lat: float, lng: float, side_m: float):
    """Trace les routes BDTOPO comme rubans polygonaux 3D rouges, poses
    sur le MNT terrain (altimetrie LiDAR cellule par cellule).
    Largeur = largeur_de_chaussee BDTOPO."""
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    if not routes_geojson or not routes_geojson.get('features'):
        return

    nx, ny = mnt.shape
    half = side_m / 2
    cell = side_m / nx
    z_min = float(mnt.min())
    m_per_deg_lat = 111320.0
    m_per_deg_lng = 103900.0 * math.cos(math.radians(lat))

    def _get_z(x: float, y: float) -> Optional[float]:
        if abs(x) > half or abs(y) > half:
            return None
        ix = int(np.clip((x + half) / cell, 0, nx - 1))
        iy = int(np.clip((y + half) / cell, 0, ny - 1))
        return float(mnt[ix, iy]) - z_min + 0.4  # leger offset au-dessus sol

    quads = []
    for feat in routes_geojson['features']:
        geom = feat.get('geometry') or {}
        props = feat.get('properties') or {}
        largeur = props.get('largeur_de_chaussee')
        try:
            largeur = float(largeur) if largeur is not None else 4.0
        except (TypeError, ValueError):
            largeur = 4.0
        half_w = max(1.0, largeur / 2)

        gtype = geom.get('type')
        if gtype == 'LineString':
            lines = [geom['coordinates']]
        elif gtype == 'MultiLineString':
            lines = geom['coordinates']
        else:
            continue

        for coords in lines:
            pts = []
            for c in coords:
                pts.append(((c[0] - lng) * m_per_deg_lng,
                            (c[1] - lat) * m_per_deg_lat))

            for k in range(len(pts) - 1):
                p1, p2 = pts[k], pts[k + 1]
                dx, dy = p2[0] - p1[0], p2[1] - p1[1]
                length = math.hypot(dx, dy)
                if length < 0.05:
                    continue
                nxv, nyv = -dy / length, dx / length  # perpendiculaire
                p1l = (p1[0] + nxv * half_w, p1[1] + nyv * half_w)
                p1r = (p1[0] - nxv * half_w, p1[1] - nyv * half_w)
                p2l = (p2[0] + nxv * half_w, p2[1] + nyv * half_w)
                p2r = (p2[0] - nxv * half_w, p2[1] - nyv * half_w)
                z1l = _get_z(*p1l)
                z1r = _get_z(*p1r)
                z2l = _get_z(*p2l)
                z2r = _get_z(*p2r)
                if None in (z1l, z1r, z2l, z2r):
                    continue
                quads.append([
                    (p1l[0], p1l[1], z1l),
                    (p2l[0], p2l[1], z2l),
                    (p2r[0], p2r[1], z2r),
                    (p1r[0], p1r[1], z1r),
                ])

    if quads:
        pc = Poly3DCollection(
            quads, facecolors='#dc2828', edgecolors='#7a1414',
            linewidths=0.2, alpha=0.85, zorder=5)
        ax.add_collection3d(pc)


def _sample_ortho_color(img: Optional[np.ndarray], side_m: float,
                         x_m: float, y_m: float,
                         saturate: float = 1.15) -> str:
    """Median RGB sur 5x5 px de l'ortho a la position locale (x_m, y_m).
    Retourne hex string. saturate>1 boost la saturation pour plus de punch."""
    if img is None:
        return '#888888'
    h, w = img.shape[:2]
    half = side_m / 2
    px = int(np.clip((x_m + half) / side_m * w, 0, w - 1))
    # lat decroissante = pixel y croissant : on flip Y
    py = int(np.clip((half - y_m) / side_m * h, 0, h - 1))
    s = max(2, min(8, w // 60))
    block = img[max(0, py - s):py + s + 1,
                max(0, px - s):px + s + 1, :3]
    if block.size == 0:
        return '#888888'
    rgb = np.median(block.reshape(-1, 3), axis=0)
    # Boost saturation
    mean = rgb.mean()
    rgb = np.clip(mean + (rgb - mean) * saturate, 0, 255).astype(int)
    return f'#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}'


def draw_mockup_3d(ax, mnt: np.ndarray, h_grid: np.ndarray,
                   dom_grid: np.ndarray, buildings_geo,
                   lat: float, lng: float, side_m: float,
                   eau_mask: Optional[np.ndarray] = None,
                   ortho_img: Optional[np.ndarray] = None):
    """Maquette 3D : terrain MNT + batis BDTOPO extrudes + arbres LiDAR.
    ortho_img : si fourni, sample la vraie couleur de toit/cime depuis l'ortho.
    eau_mask  : si fourni, nappe bleue translucide z=niveau mer."""
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    # Desactive le tri auto par profondeur de matplotlib pour respecter
    # l'ordre explicite : terrain=1 (fond), eau=2, bati=10, arbres=15.
    ax.computed_zorder = False

    nx, ny = mnt.shape
    cell = side_m / nx
    half = side_m / 2
    z_min = float(mnt.min())

    xs = np.linspace(-half + cell / 2, half - cell / 2, nx)
    ys = np.linspace(-half + cell / 2, half - cell / 2, ny)
    X, Y = np.meshgrid(xs, ys, indexing='ij')
    Z = mnt - z_min

    # Terrain colore par face depuis ortho (ou marron par defaut)
    if ortho_img is not None:
        h_ortho, w_ortho = ortho_img.shape[:2]
        facecolors = np.zeros((nx, ny, 4))
        sample_s = max(2, min(8, w_ortho // (nx * 2)))
        for i in range(nx):
            for j in range(ny):
                x_m = -half + (i + 0.5) * cell
                y_m = -half + (j + 0.5) * cell
                px = int(np.clip((x_m + half) / side_m * w_ortho,
                                  0, w_ortho - 1))
                py = int(np.clip((half - y_m) / side_m * h_ortho,
                                  0, h_ortho - 1))
                block = ortho_img[
                    max(0, py - sample_s):py + sample_s + 1,
                    max(0, px - sample_s):px + sample_s + 1, :3]
                if block.size:
                    rgb = np.median(block.reshape(-1, 3), axis=0) / 255.0
                    facecolors[i, j] = (rgb[0], rgb[1], rgb[2], 0.92)
                else:
                    facecolors[i, j] = (0.61, 0.53, 0.41, 0.92)
        # Eclairage doux pour donner du relief sans modifier les couleurs
        from matplotlib.colors import LightSource
        ls = LightSource(azdeg=315, altdeg=55)
        shaded = ls.shade_rgb(facecolors[..., :3], Z, blend_mode='soft',
                              vert_exag=1.0)
        facecolors[..., :3] = shaded
        ax.plot_surface(X, Y, Z, facecolors=facecolors,
                        edgecolor='none', antialiased=True,
                        shade=False, rcount=nx, ccount=ny, zorder=1)
    else:
        ax.plot_surface(X, Y, Z, color='#9b8868', alpha=0.95,
                        edgecolor='#7a6a4f', linewidth=0.05,
                        antialiased=True, shade=True, zorder=1)

    # Nappe eau (cellules eau) : surface bleue translucide a z=0 (niveau mer local)
    if eau_mask is not None and eau_mask.any():
        # Niveau mer = mediane des MNT eau (peut etre 0 ou 1m)
        eau_z_abs = float(np.median(mnt[eau_mask]))
        eau_z = eau_z_abs - z_min + 0.3  # leger surplomb pour visibilite
        # Construction des quads par cellule eau
        eau_quads = []
        for ix in range(nx):
            for iy in range(ny):
                if not eau_mask[ix, iy]:
                    continue
                x0 = -half + ix * cell
                x1 = x0 + cell
                y0 = -half + iy * cell
                y1 = y0 + cell
                eau_quads.append([
                    [x0, y0, eau_z], [x1, y0, eau_z],
                    [x1, y1, eau_z], [x0, y1, eau_z],
                ])
        if eau_quads:
            pc_eau = Poly3DCollection(eau_quads, facecolors='#5B8FA8',
                                      edgecolors='none', alpha=0.55,
                                      zorder=2)
            ax.add_collection3d(pc_eau)

    # Batiments BDTOPO. Logique alignee sur services/buildings-service.js :
    # 1) `hauteur` BDTOPO si valid, sinon
    # 2) `nombre_d_etages` * 3 si valid, sinon
    # 3) hauteur par defaut selon `usage_1` (residentiel=6m, commercial=8m,
    #    industriel=7m, religieux=10m, agricole=2.5m), sinon 3m fallback
    USAGE_HEIGHTS = {
        'residentiel':  6.0,
        'habitation':   6.0,
        'commercial':   8.0,
        'service':      8.0,
        'industriel':   7.0,
        'religieux':    10.0,
        'sportif':      6.0,
        'agricole':     2.5,
        'annexe':       2.5,
    }

    def _bati_height(props: dict) -> float:
        h = props.get('hauteur')
        try:
            if h is not None and float(h) > 0:
                return float(h)
        except (TypeError, ValueError):
            pass
        et = props.get('nombre_d_etages')
        try:
            if et is not None and float(et) > 0:
                return max(3.0, float(et) * 3.0)
        except (TypeError, ValueError):
            pass
        usage = (props.get('usage_1') or props.get('nature') or '').lower()
        for key, val in USAGE_HEIGHTS.items():
            if key in usage:
                return val
        return 3.0

    n_bati = 0
    if buildings_geo and buildings_geo.get('features'):
        m_per_deg_lat = 111320.0
        m_per_deg_lng = 103900.0 * math.cos(math.radians(lat))

        for feat in buildings_geo['features']:
            geom = feat.get('geometry') or {}
            props = feat.get('properties') or {}
            hauteur = _bati_height(props)

            gtype = geom.get('type')
            if gtype == 'Polygon':
                rings = [geom['coordinates'][0]]
            elif gtype == 'MultiPolygon':
                rings = [poly[0] for poly in geom['coordinates']]
            else:
                continue

            for ring in rings:
                pts = [
                    ((c[0] - lng) * m_per_deg_lng,
                     (c[1] - lat) * m_per_deg_lat)
                    for c in ring
                ]
                if len(pts) < 3:
                    continue

                # Centroide du bati ; skip si hors de la zone visible stricte
                cx0 = float(np.mean([p[0] for p in pts]))
                cy0 = float(np.mean([p[1] for p in pts]))
                if abs(cx0) > half or abs(cy0) > half:
                    continue

                # z_base : prefer BDTOPO altitude_minimale_sol (mesure exacte
                # du sol au pied du bati), fallback sur median MNT echantillon.
                alt_sol = props.get('altitude_minimale_sol')
                z_base = None
                try:
                    if alt_sol is not None:
                        z_base = max(0.0, float(alt_sol) - z_min)
                except (TypeError, ValueError):
                    pass
                if z_base is None:
                    sample_zs = []
                    for px, py in pts[::max(1, len(pts) // 6)]:
                        ix = int(np.clip((px + half) / cell, 0, nx - 1))
                        iy = int(np.clip((py + half) / cell, 0, ny - 1))
                        sample_zs.append(float(mnt[ix, iy]))
                    ix = int(np.clip((cx0 + half) / cell, 0, nx - 1))
                    iy = int(np.clip((cy0 + half) / cell, 0, ny - 1))
                    sample_zs.append(float(mnt[ix, iy]))
                    z_base = max(0.0, float(np.median(sample_zs)) - z_min)

                # z_top : prefer altitude_maximale_toit BDTOPO (vraie hauteur
                # toiture mesuree), fallback hauteur typique
                alt_toit = props.get('altitude_maximale_toit')
                z_top = None
                try:
                    if alt_toit is not None:
                        z_top = max(z_base + 1.0, float(alt_toit) - z_min)
                except (TypeError, ValueError):
                    pass
                if z_top is None:
                    z_top = z_base + float(hauteur)
                hauteur_render = z_top - z_base  # pour la couleur

                # Couleur du toit : sample ortho au centroide si dispo
                col_roof = _sample_ortho_color(ortho_img, side_m, cx0, cy0,
                                                saturate=1.2)
                if col_roof == '#888888':
                    col_roof = '#D34E2D' if hauteur_render < 8 else '#7A2818'
                # Murs verticaux : BLANC (style maquette d'urbanisme)
                wall_polys = []
                for k in range(len(pts) - 1):
                    p1, p2 = pts[k], pts[k + 1]
                    wall_polys.append([
                        [p1[0], p1[1], z_base],
                        [p2[0], p2[1], z_base],
                        [p2[0], p2[1], z_top],
                        [p1[0], p1[1], z_top],
                    ])
                pc_walls = Poly3DCollection(
                    wall_polys, facecolors='#ffffff',
                    edgecolors='#3F1A0E', linewidths=0.30, alpha=0.96,
                    zorder=10)
                ax.add_collection3d(pc_walls)
                # Toit : couleur ortho echantillonnee (top face seule)
                roof = [[p[0], p[1], z_top] for p in pts[:-1]]
                pc_roof = Poly3DCollection(
                    [roof], facecolors=col_roof,
                    edgecolors='#3F1A0E', linewidths=0.30, alpha=0.96,
                    zorder=11)
                ax.add_collection3d(pc_roof)
                n_bati += 1

    # Arbres : local maxima sur h_grid (cells cls 5 ou 4)
    n_trees = 0
    if h_grid is not None and dom_grid is not None:
        peaks = []
        for ix in range(1, nx - 1):
            for iy in range(1, ny - 1):
                if dom_grid[ix, iy] not in (4, 5):
                    continue
                h = float(h_grid[ix, iy])
                if h < 3.0:
                    continue
                neighbours = h_grid[ix-1:ix+2, iy-1:iy+2]
                if h >= float(neighbours.max()):
                    peaks.append((ix, iy, h))
        # Limiter a 80 arbres (les plus hauts)
        peaks.sort(key=lambda t: -t[2])
        peaks = peaks[:80]

        for ix, iy, h in peaks:
            cx = -half + cell / 2 + ix * cell
            cy = -half + cell / 2 + iy * cell
            cz_base = float(mnt[ix, iy]) - z_min  # ancrage SOL local
            cz_top = cz_base + h
            radius = max(0.6, h * 0.18)  # plus fin

            # Cone plein du SOL au sommet (pas de tronc separe : silhouette
            # propre, le pied est exactement au niveau du terrain a la cellule)
            n_seg = 6
            base_pts = [
                (cx + radius * math.cos(2 * math.pi * k / n_seg),
                 cy + radius * math.sin(2 * math.pi * k / n_seg),
                 cz_base)
                for k in range(n_seg)
            ]
            triangles = []
            apex = (cx, cy, cz_top)
            for k in range(n_seg):
                triangles.append([base_pts[k],
                                  base_pts[(k + 1) % n_seg],
                                  apex])
            # Couleur cime : sample ortho au pic, sinon vert sombre
            col_tree = _sample_ortho_color(ortho_img, side_m, cx, cy,
                                            saturate=1.25)
            if col_tree == '#888888':
                col_tree = '#3F7A4D'
            pc = Poly3DCollection(
                triangles, facecolors=col_tree,
                edgecolors='#1F3F25', linewidths=0.12, alpha=0.92,
                zorder=15)
            ax.add_collection3d(pc)
            n_trees += 1

    # Camera ortho axo
    ax.set_proj_type('ortho')
    ax.view_init(elev=28, azim=-55)
    ax.set_xlim(-half, half)
    ax.set_ylim(-half, half)
    z_max = float(Z.max() + 12)
    ax.set_zlim(0, max(20, z_max))
    ax.set_box_aspect((1, 1, 0.20))  # Z aplati : hauteurs proches du reel
    ax.set_xticks([]); ax.set_yticks([]); ax.set_zticks([])
    ax.grid(False)
    for axis in (ax.xaxis, ax.yaxis, ax.zaxis):
        axis.pane.fill = False
        axis.pane.set_edgecolor('white')
    ax.set_title(f'{n_bati} bati BDTOPO + {n_trees} arbres LiDAR',
                 fontsize=7, pad=1)


def class_legend(fig):
    items = [
        ('Sol nu',       PALETTE['sol']),
        ('Voirie',       PALETTE['route']),
        ('Eau',          PALETTE['eau']),
        ('Bati R+0/R+1', PALETTE['bati']),
        ('Bati R+2+',    PALETTE['bati_haut']),
        ('Feuillu',      PALETTE['feuillu']),
        ('Canne',        PALETTE['champ_canne']),
    ]
    handles = [Patch(facecolor=c, edgecolor='#222', alpha=ALPHA_VOX, label=l)
               for l, c in items]
    fig.legend(handles=handles, loc='lower center', ncol=7,
               fontsize=7, frameon=False, bbox_to_anchor=(0.5, 0.02))


# ---------------------------------------------------------------------------
# 6. PAGE PAR TYPE
# ---------------------------------------------------------------------------

def render_type_page(pdf: PdfPages, type_name: str, zones: list,
                     side_m: float, cache_dir: Path):
    fig = plt.figure(figsize=(11.69, 8.27))  # A4 paysage
    fig.suptitle(
        f'TerlabGift Saint-Leu  Pattern {type_name}  3 zones reelles',
        fontsize=12, fontweight='bold', y=0.97,
    )

    rng = np.random.default_rng(hash(type_name) & 0xFFFF)
    use_lidar = lidar_is_available()
    side_tag = f's{int(side_m)}'

    for col, (name, lat, lng) in enumerate(zones):
        cache = cache_dir / f'{type_name.lower()}_{col}_{side_tag}.jpg'
        if cache.exists():
            img = np.array(Image.open(cache).convert('RGB'))
            print(f'  cache hit {cache.name}')
        else:
            print(f'  fetch ortho {name} ({lat:.4f},{lng:.4f}) ...')
            img = fetch_ortho(lat, lng, side_m=side_m, pix=512)
            if img is None:
                print(f'    FAIL fetch ortho {name}')
                continue
            Image.fromarray(img).save(cache, quality=82)
            time.sleep(0.4)

        # LiDAR : cache .npz par side+nx (h+dom+mnt). Re-fetch si vieux cache sans mnt.
        h_grid = dom_grid = mnt_grid = None
        if use_lidar:
            lidar_cache = cache_dir / (
                f'{type_name.lower()}_{col}_{side_tag}_n{NX}_lidar.npz'
            )
            need_refetch = True
            if lidar_cache.exists():
                d = np.load(lidar_cache)
                if 'mnt' in d.files:
                    h_grid, dom_grid, mnt_grid = d['h'], d['dom'], d['mnt']
                    print(f'  cache hit {lidar_cache.name} '
                          f'(h_max={h_grid.max():.1f}m, mnt={mnt_grid.mean():.0f}m)')
                    need_refetch = False
                else:
                    print(f'  cache obsolete (sans mnt) -> refetch')
            if need_refetch:
                print(f'  fetch lidar {name} ...')
                pts = fetch_lidar_points(lat, lng, side_m=side_m)
                if pts is not None:
                    h_grid, dom_grid, mnt_grid = lidar_grid_from_points(
                        pts, lat, lng, side_m, NX, NY)
                    if h_grid is not None:
                        np.savez(lidar_cache, h=h_grid, dom=dom_grid, mnt=mnt_grid)
                        print(f'    -> {len(pts)} pts, h_max={h_grid.max():.1f}m, '
                              f'mnt={mnt_grid.mean():.0f}m')

        # COSIA IGN : cache PNG + grille classes IA
        cosia_grid = None
        cosia_img = None
        cosia_cache = cache_dir / f'{type_name.lower()}_{col}_{side_tag}_cosia.png'
        if cosia_cache.exists():
            cosia_img = np.array(Image.open(cosia_cache).convert('RGBA'))
            print(f'  cache hit {cosia_cache.name}')
        else:
            print(f'  fetch COSIA {name} ...')
            cosia_img = fetch_cosia(lat, lng, side_m=side_m, pix=512)
            if cosia_img is not None:
                Image.fromarray(cosia_img).save(cosia_cache)
                print(f'    -> COSIA {cosia_img.shape[:2]} ok')
                time.sleep(0.4)
        if cosia_img is not None:
            cosia_grid = cosia_grid_classify(cosia_img, NX, NY)

        # BDTOPO routes vectorielles : cache GeoJSON + mask grille
        routes_geojson = None
        routes_mask = None
        routes_cache = cache_dir / f'{type_name.lower()}_{col}_{side_tag}_routes.json'
        if routes_cache.exists():
            import json
            routes_geojson = json.loads(routes_cache.read_text(encoding='utf-8'))
            print(f'  cache hit {routes_cache.name} '
                  f'({len(routes_geojson.get("features", []))} feat)')
        else:
            print(f'  fetch BDTOPO routes {name} ...')
            routes_geojson = fetch_bdtopo_routes(lat, lng, side_m)
            if routes_geojson is not None:
                import json
                routes_cache.write_text(json.dumps(routes_geojson),
                                        encoding='utf-8')
                print(f'    -> {len(routes_geojson.get("features", []))} troncons')
        if routes_geojson:
            routes_mask = routes_to_grid(routes_geojson, lat, lng,
                                         side_m, NX, NY)

        # BDTOPO batiment : footprint + hauteur pour la maquette 3D
        buildings_geo = None
        bati_cache = cache_dir / f'{type_name.lower()}_{col}_{side_tag}_bati.json'
        if bati_cache.exists():
            import json
            buildings_geo = json.loads(bati_cache.read_text(encoding='utf-8'))
            print(f'  cache hit {bati_cache.name} '
                  f'({len(buildings_geo.get("features", []))} bati)')
        else:
            print(f'  fetch BDTOPO bati {name} ...')
            buildings_geo = fetch_bdtopo_buildings(lat, lng, side_m)
            if buildings_geo is not None:
                import json
                bati_cache.write_text(json.dumps(buildings_geo),
                                      encoding='utf-8')
                print(f'    -> {len(buildings_geo.get("features", []))} bati')

        grid_rgb = grid_classify(img, NX, NY)
        grid = merge_grids(cosia_grid, grid_rgb)
        filled, colors = voxelize(grid, rng, h_grid, dom_grid, routes_mask)

        # Stats sur le RESULTAT FINAL (compter couleurs PALETTE des voxels)
        col_to_name = {v.lower(): k for k, v in PALETTE.items()}
        cls_counts = {}
        for ix in range(NX):
            for iy in range(NY):
                top_color = None
                for iz in range(NZ - 1, -1, -1):
                    if filled[ix, iy, iz] and colors[ix, iy, iz] is not None:
                        top_color = str(colors[ix, iy, iz]).lower()
                        break
                if top_color is None:
                    continue
                name = col_to_name.get(top_color, 'autre')
                cls_counts[name] = cls_counts.get(name, 0) + 1

        # Rangee 1 : image sat + overlay COSIA (alpha 0.35) + routes BDTOPO en rouge
        ax_img = fig.add_subplot(3, 3, col + 1)
        ax_img.imshow(img)
        if cosia_img is not None:
            # Resize COSIA pour matcher l'ortho
            from PIL import Image as _PIL
            cosia_pil = _PIL.fromarray(cosia_img).resize(
                (img.shape[1], img.shape[0]), resample=_PIL.NEAREST)
            cosia_arr = np.array(cosia_pil)
            ax_img.imshow(cosia_arr, alpha=0.35)
        if routes_geojson and routes_geojson.get('features'):
            half = side_m / 2
            d_lat = half / 111320.0
            d_lng = half / (103900.0 * math.cos(math.radians(lat)))
            img_h, img_w = img.shape[:2]
            for feat in routes_geojson['features']:
                geom = feat.get('geometry') or {}
                gtype = geom.get('type')
                if gtype == 'LineString':
                    lines = [geom['coordinates']]
                elif gtype == 'MultiLineString':
                    lines = geom['coordinates']
                else:
                    continue
                for coords in lines:
                    xs = [(c[0] - (lng - d_lng)) / (2 * d_lng) * img_w
                          for c in coords]
                    ys = [((lat + d_lat) - c[1]) / (2 * d_lat) * img_h
                          for c in coords]
                    ax_img.plot(xs, ys, color='#ff3344', alpha=0.65,
                                linewidth=1.4)
        ax_img.set_title(f'{name}\n{lat:.4f}, {lng:.4f}', fontsize=8, pad=2)
        ax_img.set_xlim(0, img.shape[1])
        ax_img.set_ylim(img.shape[0], 0)
        ax_img.axis('off')

        # Rangee 2 : voxel axo + stats finales (couleurs voxels rendus)
        ax_vox = fig.add_subplot(3, 3, 3 + col + 1, projection='3d')
        top3 = sorted(cls_counts.items(), key=lambda kv: -kv[1])[:3]
        stat = ' | '.join(f'{k}:{int(100*v/(NX*NY))}%' for k, v in top3)
        draw_axo(ax_vox, filled, colors, title=stat)

        # Rangee 3 : maquette 3D (terrain + bati BDTOPO + arbres LiDAR + eau)
        ax_mock = fig.add_subplot(3, 3, 6 + col + 1, projection='3d')
        if mnt_grid is not None:
            # Mask eau depuis grid + LiDAR cls 9
            eau_mask = np.zeros((NX, NY), dtype=bool)
            for ix in range(NX):
                for iy in range(NY):
                    if grid[ix, iy] == 'eau' or (
                            dom_grid is not None and dom_grid[ix, iy] == 9):
                        eau_mask[ix, iy] = True
            draw_mockup_3d(ax_mock, mnt_grid, h_grid, dom_grid,
                           buildings_geo, lat, lng, side_m,
                           eau_mask=eau_mask if eau_mask.any() else None)
        else:
            ax_mock.set_axis_off()
            ax_mock.text2D(0.5, 0.5, 'Pas de MNT LiDAR',
                           ha='center', va='center',
                           transform=ax_mock.transAxes,
                           fontsize=8, color='#999')

    class_legend(fig)
    fig.text(0.5, 0.055,
             'Pipeline : ortho+COSIA / voxel LiDAR+CHM / maquette MNT+BDTOPO bati+arbres',
             ha='center', fontsize=7, style='italic', color='#555')

    plt.tight_layout(rect=[0, 0.07, 1, 0.94])
    pdf.savefig(fig, bbox_inches='tight')
    plt.close(fig)


# ---------------------------------------------------------------------------
# 7. MAIN
# ---------------------------------------------------------------------------

def main():
    global NX, NY, NZ
    p = argparse.ArgumentParser()
    p.add_argument('--output', default='docs/voxel-patterns/poster-real.pdf')
    p.add_argument('--side', type=float, default=SIDE_M_DEFAULT,
                   help='Cote de la zone capturee (m)')
    p.add_argument('--voxel-size', type=float, default=VOXEL_XY_DEFAULT,
                   help='Taille horizontale d\'un voxel (m)')
    p.add_argument('--max-z', type=float, default=25.0,
                   help='Hauteur Z max representee (m)')
    p.add_argument('--types', default='all',
                   help='Types a traiter (FORET,CHAMPS,VILLE,LOTISSEMENT ou all)')
    p.add_argument('--max-zones', type=int, default=3,
                   help='Max zones par type (3 par defaut)')
    p.add_argument('--cache', default='docs/voxel-patterns/cache')
    args = p.parse_args()

    # Recalibrer la grille voxel
    NX = NY = max(1, int(round(args.side / args.voxel_size)))
    NZ = max(5, int(round(args.max_z / VOXEL_Z_M)))
    print(f'-> grille NX={NX} NY={NY} NZ={NZ} (vox {args.voxel_size}m XY '
          f'x {VOXEL_Z_M}m Z, side {args.side}m)')

    # Filtrer types
    if args.types.lower() == 'all':
        types_list = list(ZONES.keys())
    else:
        types_list = [t.strip().upper() for t in args.types.split(',')]
    selected = {t: ZONES[t][:args.max_zones] for t in types_list if t in ZONES}
    if not selected:
        print(f'!! aucun type valide dans {args.types}')
        return

    base = Path(args.output)
    base.parent.mkdir(parents=True, exist_ok=True)
    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)

    # Suffixe timestamp + index : poster-real_2026-04-27T03-45-12_001.pdf
    ts = datetime.datetime.now().strftime('%Y-%m-%dT%H-%M-%S')
    idx = 1
    while True:
        out = base.with_name(f'{base.stem}_{ts}_{idx:03d}{base.suffix}')
        if not out.exists():
            break
        idx += 1

    print(f'-> WMS {WMS_URL} layer={WMS_LAYER}')
    print(f'-> {sum(len(v) for v in selected.values())} zones (sur {len(selected)} types)')

    with PdfPages(out) as pdf:
        for type_name, zones in selected.items():
            print(f'[{type_name}]')
            render_type_page(pdf, type_name, zones, args.side, cache)

    print(f'[OK] PDF ecrit: {out}')


if __name__ == '__main__':
    main()
