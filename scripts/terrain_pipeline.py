#!/usr/bin/env python3
"""
TERLAB · terrain_pipeline.py
Pipeline COPC → mesh terrain texturé → GLB Three.js
MGA Architecture · Saint-Leu, La Réunion · 2026

Usage :
    python terrain_pipeline.py \
        --input terrain.copc.laz \
        --parcelle parcelle.geojson \
        --output terrain.glb \
        [--resolution 0.05] \
        [--poisson-depth 12] \
        [--simplify 50000] \
        [--texture-zoom 18]
"""

import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import open3d as o3d
import pdal
import requests
from PIL import Image
from pyproj import Transformer
from shapely.geometry import shape, mapping


# ─────────────────────────────────────────────────────────────────────────────
# 1. ARGUMENTS
# ─────────────────────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description='TERLAB Terrain Pipeline')
    p.add_argument('--input',          required=True, help='Fichier COPC/LAZ')
    p.add_argument('--parcelle',       required=True, help='GeoJSON polygone parcelle')
    p.add_argument('--output',         default='terrain.glb', help='Fichier GLB sortie')
    p.add_argument('--resolution',     type=float, default=0.05, help='Résolution DTM en mètres')
    p.add_argument('--poisson-depth',  type=int,   default=12,   help='Profondeur Poisson [8-16]')
    p.add_argument('--simplify',       type=int,   default=50000, help='Nb triangles cible')
    p.add_argument('--texture-zoom',   type=int,   default=18,   help='Zoom tuiles IGN [16-20]')
    p.add_argument('--buffer',         type=float, default=5.0,  help='Buffer autour parcelle (m)')
    p.add_argument('--epsg',           type=int,   default=2975, help='EPSG projection locale (2975=RGR92)')
    p.add_argument('--input-epsg',     type=int,   default=None, help='EPSG du fichier COPC (auto-detect si omis)')
    p.add_argument('--dtm-only',       action='store_true',      help='Produire DTM uniquement')
    p.add_argument('--verbose',        action='store_true')
    return p.parse_args()


# ─────────────────────────────────────────────────────────────────────────────
# 2. LECTURE PARCELLE + BBOX
# ─────────────────────────────────────────────────────────────────────────────

def load_parcelle(geojson_path: str, buffer_m: float, epsg_local: int):
    """
    Charge la géométrie de la parcelle depuis un GeoJSON WGS84.
    Retourne bbox WGS84 et bbox projetée en mètres.
    """
    with open(geojson_path) as f:
        gj = json.load(f)

    # Accepter Feature ou FeatureCollection ou Geometry
    if gj['type'] == 'FeatureCollection':
        geom_wgs = shape(gj['features'][0]['geometry'])
    elif gj['type'] == 'Feature':
        geom_wgs = shape(gj['geometry'])
    else:
        geom_wgs = shape(gj)

    # Projeter en RGR92 (EPSG:2975) pour buffer en mètres
    to_local = Transformer.from_crs('EPSG:4326', f'EPSG:{epsg_local}', always_xy=True)
    to_wgs   = Transformer.from_crs(f'EPSG:{epsg_local}', 'EPSG:4326', always_xy=True)

    coords_wgs = list(geom_wgs.exterior.coords)
    coords_loc = [to_local.transform(lon, lat) for lon, lat in coords_wgs]

    from shapely.geometry import Polygon
    geom_local = Polygon(coords_loc)
    geom_buf   = geom_local.buffer(buffer_m)

    minx, miny, maxx, maxy = geom_buf.bounds

    # Convertir bbox locale → WGS84 pour PDAL/IGN
    lon_min, lat_min = to_wgs.transform(minx, miny)
    lon_max, lat_max = to_wgs.transform(maxx, maxy)

    return {
        'bbox_wgs84':   [lon_min, lat_min, lon_max, lat_max],
        'bbox_local':   [minx, miny, maxx, maxy],
        'center_wgs84': [(lon_min + lon_max) / 2, (lat_min + lat_max) / 2],
        'geom_local':   geom_local,
        'geom_buf':     geom_buf,
        'epsg_local':   epsg_local,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 3. TRAITEMENT PDAL : CLASSIFICATION SOL + DTM
# ─────────────────────────────────────────────────────────────────────────────

def detect_copc_srs(input_path: str):
    """Détecte l'EPSG du fichier COPC via PDAL quickinfo."""
    info_pipeline = json.dumps({
        "pipeline": [{
            "type": "readers.copc",
            "filename": str(input_path),
            "count": 0
        }]
    })
    p = pdal.Pipeline(info_pipeline)
    p.execute()
    qi = p.quickinfo.get("readers.copc", {})
    srs_json = qi.get("srs", {}).get("json", {})
    epsg_id = srs_json.get("id", {})
    if epsg_id.get("authority") == "EPSG":
        return epsg_id["code"]
    return None


def run_pdal(input_path: str, bbox_wgs84: list, bbox_local: list,
             resolution: float, poisson_depth: int, tmp_dir: str,
             input_epsg: int = None, target_epsg: int = 2975, verbose: bool = False):
    """
    Pipeline PDAL :
    1. Lecture COPC avec découpe bbox (adapté au SRS du fichier)
    2. Reprojection vers target_epsg si nécessaire
    3. Débruitage (outlier removal)
    4. Classification sol (SMRF)
    5. Extraction points sol → PLY
    6. Poisson mesh → PLY
    7. DTM GeoTIFF
    """
    ply_ground = os.path.join(tmp_dir, 'ground.ply')
    dtm_tif    = os.path.join(tmp_dir, 'dtm.tif')

    # Auto-detect SRS si non spécifié
    if input_epsg is None:
        input_epsg = detect_copc_srs(input_path)
        if verbose:
            print(f'[PDAL] SRS détecté : EPSG:{input_epsg}')

    # Choisir les bounds selon le SRS du fichier
    already_projected = (input_epsg == target_epsg)
    if already_projected:
        minx, miny, maxx, maxy = bbox_local
        bounds_str = f"([{minx},{maxx}],[{miny},{maxy}])"
    else:
        lon_min, lat_min, lon_max, lat_max = bbox_wgs84
        bounds_str = f"([{lon_min},{lon_max}],[{lat_min},{lat_max}])"

    stages = [
        {
            "type":     "readers.copc",
            "filename": str(input_path),
            "bounds":   bounds_str
        }
    ]

    # Reprojection seulement si nécessaire
    if not already_projected:
        stages.append({
            "type":    "filters.reprojection",
            "in_srs":  f"EPSG:{input_epsg or 4326}",
            "out_srs": f"EPSG:{target_epsg}"
        })

    stages.extend([
        {
            "type":       "filters.outlier",
            "method":     "statistical",
            "mean_k":     8,
            "multiplier": 2.5
        },
        {
            "type":      "filters.smrf",
            "slope":     0.15,
            "window":    18.0,
            "threshold": 0.45,
            "scalar":    1.2,
            "cell":      1.0
        },
        {
            "type":   "filters.range",
            "limits": "Classification[2:2]"
        },
        {
            "type":     "writers.ply",
            "filename": ply_ground
        }
    ])

    pipeline_json = json.dumps({"pipeline": stages})

    if verbose:
        print('[PDAL] Exécution pipeline classification sol...')

    pipeline = pdal.Pipeline(pipeline_json)
    pipeline.execute()

    count = pipeline.arrays[0].shape[0]
    if verbose:
        print(f'[PDAL] {count} points sol extraits')

    if count < 100:
        raise ValueError(f'Trop peu de points sol ({count}) — vérifier le COPC et la bbox')

    # DTM GeoTIFF depuis points sol
    pipeline_dtm = json.dumps({
        "pipeline": [
            {
                "type":     "readers.ply",
                "filename": ply_ground
            },
            {
                "type":        "writers.gdal",
                "filename":    dtm_tif,
                "resolution":  resolution,
                "output_type": "min",
                "radius":      resolution * 3,
                "gdalopts":    "COMPRESS=LZW"
            }
        ]
    })

    pipeline_d = pdal.Pipeline(pipeline_dtm)
    pipeline_d.execute()

    return ply_ground, dtm_tif, count


# ─────────────────────────────────────────────────────────────────────────────
# 4. TRAITEMENT OPEN3D : POISSON RECONSTRUCTION + SIMPLIFICATION MESH
# ─────────────────────────────────────────────────────────────────────────────

def process_mesh_open3d(ply_ground_path: str, target_triangles: int,
                        poisson_depth: int, bbox_local: list, verbose: bool):
    """
    Triangulation Delaunay 2D (XY) avec Z comme hauteur — la bonne méthode
    pour un terrain / MNT. Poisson est inadapté aux surfaces quasi-planes.

    1. Chargement point cloud sol (PLY)
    2. Sous-échantillonnage grille régulière (voxel grid)
    3. Triangulation Delaunay 2D sur (X, Y)
    4. Construction mesh Open3D avec Z
    5. Lissage + simplification
    """
    from scipy.spatial import Delaunay

    if verbose:
        print('[Mesh] Chargement point cloud sol...')

    pcd = o3d.io.read_point_cloud(ply_ground_path)
    pts = np.asarray(pcd.points)

    if verbose:
        print(f'[Mesh] {len(pts)} points sol chargés')
        print(f'[Mesh] Z range : {pts[:,2].min():.2f} — {pts[:,2].max():.2f} m')

    # Découpe bbox + marge
    minx, miny, maxx, maxy = bbox_local
    margin = 2.0
    mask = (
        (pts[:, 0] >= minx - margin) & (pts[:, 0] <= maxx + margin) &
        (pts[:, 1] >= miny - margin) & (pts[:, 1] <= maxy + margin)
    )
    pts = pts[mask]

    if verbose:
        print(f'[Mesh] {len(pts)} points dans bbox (+{margin}m marge)')

    # Sous-échantillonnage sur grille régulière pour contrôler la densité
    # Calcul de la résolution de grille pour atteindre ~target_triangles
    area = (maxx - minx + 2 * margin) * (maxy - miny + 2 * margin)
    # ~2 triangles par point en Delaunay
    target_pts = target_triangles // 2
    grid_res = np.sqrt(area / target_pts) if target_pts > 0 else 0.2

    # Min 0.05m (résolution LiDAR), max 2m
    grid_res = max(0.05, min(grid_res, 2.0))

    if verbose:
        print(f'[Mesh] Grille sous-échantillonnage : {grid_res:.3f}m')

    # Grille : pour chaque cellule, garder le point avec le Z médian
    grid_ix = ((pts[:, 0] - pts[:, 0].min()) / grid_res).astype(int)
    grid_iy = ((pts[:, 1] - pts[:, 1].min()) / grid_res).astype(int)
    grid_keys = grid_ix * 100000 + grid_iy

    unique_keys, inverse = np.unique(grid_keys, return_inverse=True)
    sampled_pts = np.empty((len(unique_keys), 3))
    for i, key in enumerate(unique_keys):
        cell_pts = pts[inverse == i]
        # Médian pour robustesse aux outliers
        sampled_pts[i] = np.median(cell_pts, axis=0)

    if verbose:
        print(f'[Mesh] {len(sampled_pts)} points après sous-échantillonnage')

    # Triangulation Delaunay 2D sur (X, Y)
    tri_2d = Delaunay(sampled_pts[:, :2])
    faces = tri_2d.simplices

    if verbose:
        print(f'[Mesh] Delaunay : {len(faces)} triangles')

    # Filtrer les triangles trop grands (artefacts convex hull)
    # Seuil = 3x l'espacement moyen réel entre points voisins
    from scipy.spatial import cKDTree
    tree = cKDTree(sampled_pts[:, :2])
    dists, _ = tree.query(sampled_pts[:, :2], k=2)
    mean_spacing = dists[:, 1].mean()
    edge_max = mean_spacing * 3.0
    v0 = sampled_pts[faces[:, 0], :2]
    v1 = sampled_pts[faces[:, 1], :2]
    v2 = sampled_pts[faces[:, 2], :2]
    e01 = np.linalg.norm(v1 - v0, axis=1)
    e12 = np.linalg.norm(v2 - v1, axis=1)
    e20 = np.linalg.norm(v0 - v2, axis=1)
    valid = (e01 < edge_max) & (e12 < edge_max) & (e20 < edge_max)
    faces = faces[valid]

    if verbose:
        print(f'[Mesh] {len(faces)} triangles après filtrage arêtes (max {edge_max:.2f}m)')

    # Construire le mesh Open3D
    mesh = o3d.geometry.TriangleMesh()
    mesh.vertices = o3d.utility.Vector3dVector(sampled_pts)
    mesh.triangles = o3d.utility.Vector3iVector(faces)
    mesh.compute_vertex_normals()

    # Lissage Laplacien léger
    mesh = mesh.filter_smooth_laplacian(number_of_iterations=3, lambda_filter=0.5)
    mesh.compute_vertex_normals()

    # Simplification si encore trop de triangles
    n_tris = len(mesh.triangles)
    if n_tris > target_triangles:
        if verbose:
            print(f'[Mesh] Simplification {n_tris} → {target_triangles} triangles...')
        mesh = mesh.simplify_quadric_decimation(target_triangles)
        mesh.compute_vertex_normals()

    if verbose:
        print(f'[Mesh] Final : {len(mesh.triangles)} triangles, '
              f'{len(mesh.vertices)} vertices')

    return mesh


# ─────────────────────────────────────────────────────────────────────────────
# 5. TEXTURE : FETCH ORTHO IGN + UV BAKING
# ─────────────────────────────────────────────────────────────────────────────

def fetch_ign_ortho(bbox_wgs84: list, zoom: int, tmp_dir: str, verbose: bool):
    """
    Télécharge l'ortho IGN via WMS Géoplateforme (GetMap).
    Résolution native ~20cm/px pour La Réunion.
    Fallback WMTS si WMS échoue.
    """
    import io as _io

    lon_min, lat_min, lon_max, lat_max = bbox_wgs84

    # Calculer la taille pixel adaptée à la parcelle (~20cm/px natif IGN)
    # 1° lat ≈ 111km, 1° lon ≈ 111km * cos(lat)
    import math
    lat_mid = (lat_min + lat_max) / 2
    width_m  = (lon_max - lon_min) * 111000 * math.cos(math.radians(lat_mid))
    height_m = (lat_max - lat_min) * 111000

    # Résolution cible : 0.10m/px (IGN natif ~0.20m, on demande un peu plus)
    px_per_m = 10  # 10 px par mètre = 0.10 m/px
    tex_w = int(width_m * px_per_m)
    tex_h = int(height_m * px_per_m)

    # Clamper entre 256 et 4096
    tex_w = max(256, min(tex_w, 4096))
    tex_h = max(256, min(tex_h, 4096))

    # Arrondir à la puissance de 2 supérieure pour WebGL
    def next_pow2(n):
        p = 1
        while p < n:
            p *= 2
        return min(p, 4096)

    tex_w = next_pow2(tex_w)
    tex_h = next_pow2(tex_h)

    if verbose:
        print(f'[IGN] WMS GetMap {tex_w}x{tex_h}px (parcelle {width_m:.0f}x{height_m:.0f}m)')

    # WMS GetMap — Géoplateforme (gratuit, pas de clé)
    WMS_URL = (
        'https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
        '&LAYERS=ORTHOIMAGERY.ORTHOPHOTOS'
        '&CRS=EPSG:4326'
        f'&BBOX={lat_min},{lon_min},{lat_max},{lon_max}'
        f'&WIDTH={tex_w}&HEIGHT={tex_h}'
        '&FORMAT=image/jpeg'
        '&STYLES='
    )

    texture = None
    try:
        resp = requests.get(WMS_URL, timeout=30,
                            headers={'User-Agent': 'TERLAB/1.0 MGA Architecture'})
        resp.raise_for_status()
        if resp.headers.get('content-type', '').startswith('image'):
            texture = Image.open(_io.BytesIO(resp.content))
            if verbose:
                print(f'[IGN] WMS OK : {texture.size[0]}x{texture.size[1]}px')
        else:
            if verbose:
                print(f'[IGN] WMS a retourné du non-image: {resp.headers.get("content-type")}')
    except Exception as e:
        if verbose:
            print(f'[IGN] WMS échoué: {e} — fallback WMTS')

    # Fallback WMTS si WMS échoue
    if texture is None:
        texture = _fetch_ign_wmts(bbox_wgs84, zoom, verbose)

    # S'assurer que c'est en RGB
    if texture.mode != 'RGB':
        texture = texture.convert('RGB')

    texture_path = os.path.join(tmp_dir, 'ortho_texture.jpg')
    texture.save(texture_path, 'JPEG', quality=92)

    if verbose:
        print(f'[IGN] Texture finale : {texture.size[0]}x{texture.size[1]}px')

    return texture_path, (lon_min, lat_min, lon_max, lat_max)


def _fetch_ign_wmts(bbox_wgs84, zoom, verbose):
    """Fallback WMTS tuiles si WMS échoue."""
    import math
    import io as _io

    lon_min, lat_min, lon_max, lat_max = bbox_wgs84

    def deg2tile(lat_deg, lon_deg, z):
        lat_r = math.radians(lat_deg)
        n = 2 ** z
        x = int((lon_deg + 180.0) / 360.0 * n)
        y = int((1.0 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2.0 * n)
        return x, y

    def tile2deg(x, y, z):
        n = 2 ** z
        lon = x / n * 360.0 - 180.0
        lat_r = math.atan(math.sinh(math.pi * (1 - 2 * y / n)))
        return lon, math.degrees(lat_r)

    x_min, y_max = deg2tile(lat_min, lon_min, zoom)
    x_max, y_min = deg2tile(lat_max, lon_max, zoom)

    WMTS_URL = (
        'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
        '&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal'
        '&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'
        '&FORMAT=image/jpeg'
    )

    tile_size = 256
    cols = x_max - x_min + 1
    rows = y_max - y_min + 1
    mosaic = Image.new('RGB', (cols * tile_size, rows * tile_size))

    for xi, x in enumerate(range(x_min, x_max + 1)):
        for yi, y in enumerate(range(y_min, y_max + 1)):
            url = WMTS_URL.format(z=zoom, x=x, y=y)
            try:
                resp = requests.get(url, timeout=15,
                                    headers={'User-Agent': 'TERLAB/1.0 MGA Architecture'})
                resp.raise_for_status()
                tile_img = Image.open(_io.BytesIO(resp.content))
                mosaic.paste(tile_img, (xi * tile_size, yi * tile_size))
            except Exception as e:
                if verbose:
                    print(f'  [WMTS] Tuile {x},{y} échouée: {e}')

    ul_lon, ul_lat = tile2deg(x_min, y_min, zoom)
    lr_lon, lr_lat = tile2deg(x_max + 1, y_max + 1, zoom)

    total_lon = lr_lon - ul_lon
    total_lat = ul_lat - lr_lat

    crop_left   = int((lon_min - ul_lon) / total_lon * mosaic.width)
    crop_top    = int((ul_lat - lat_max) / total_lat * mosaic.height)
    crop_right  = int((lon_max - ul_lon) / total_lon * mosaic.width)
    crop_bottom = int((ul_lat - lat_min) / total_lat * mosaic.height)

    return mosaic.crop((
        max(0, crop_left), max(0, crop_top),
        min(mosaic.width, crop_right), min(mosaic.height, crop_bottom)
    ))


def apply_uv_texture(mesh, texture_path: str, bbox_wgs84: tuple,
                     bbox_local: list, epsg_local: int, verbose: bool):
    """
    UV mapping planaire : projection du mesh (RGR92) sur la texture (WGS84).
    """
    lon_min, lat_min, lon_max, lat_max = bbox_wgs84
    minx, miny, maxx, maxy = bbox_local

    to_wgs = Transformer.from_crs(f'EPSG:{epsg_local}', 'EPSG:4326', always_xy=True)

    verts_local = np.asarray(mesh.vertices)

    uvs = []
    for v in verts_local:
        lon, lat = to_wgs.transform(v[0], v[1])
        u = (lon - lon_min) / (lon_max - lon_min)
        v_uv = 1.0 - (lat - lat_min) / (lat_max - lat_min)
        uvs.append([np.clip(u, 0, 1), np.clip(v_uv, 0, 1)])

    mesh.triangle_uvs = o3d.utility.Vector2dVector(
        np.array(uvs)[np.asarray(mesh.triangles).flatten()]
    )
    mesh.triangle_material_ids = o3d.utility.IntVector(
        [0] * len(mesh.triangles)
    )

    texture_img = o3d.io.read_image(texture_path)
    mesh.textures = [texture_img]

    if verbose:
        print('[UV] Mapping planaire appliqué')

    return mesh


# ─────────────────────────────────────────────────────────────────────────────
# 6. EXPORT GLB
# ─────────────────────────────────────────────────────────────────────────────

def export_glb(mesh, output_path: str, meta: dict, verbose: bool):
    """
    Export GLB via trimesh (meilleure compatibilité Three.js que Open3D natif).
    """
    import trimesh
    import io
    import datetime

    verts = np.asarray(mesh.vertices).copy()
    tris  = np.asarray(mesh.triangles)
    norms = np.asarray(mesh.vertex_normals)

    # Centrer à l'origine pour Blender/Three.js (coords UTM trop grandes)
    origin = verts.mean(axis=0)
    verts -= origin
    if verbose:
        print(f'[GLB] Centrage à l\'origine (offset {origin})')

    # UVs : de triangle_uvs (format flat) → par vertex
    if len(mesh.triangle_uvs) > 0:
        tri_uvs_flat = np.asarray(mesh.triangle_uvs)
        uv_per_tri   = tri_uvs_flat.reshape(-1, 3, 2)
        uvs = np.zeros((len(verts), 2))
        counts = np.zeros(len(verts))
        for ti, tri in enumerate(tris):
            for vi, v_idx in enumerate(tri):
                uvs[v_idx]    += uv_per_tri[ti, vi]
                counts[v_idx] += 1
        counts = np.maximum(counts, 1)
        uvs /= counts[:, None]
    else:
        uvs = None

    tm_mesh = trimesh.Trimesh(
        vertices=verts,
        faces=tris,
        vertex_normals=norms
    )

    # Appliquer la texture si disponible
    if uvs is not None and len(mesh.textures) > 0:
        tex_np  = np.asarray(mesh.textures[0])
        tex_pil = Image.fromarray(tex_np)

        buf = io.BytesIO()
        tex_pil.save(buf, 'PNG')
        buf.seek(0)

        material = trimesh.visual.texture.SimpleMaterial(
            image=Image.open(buf),
            ambient=[255, 255, 255, 255],
            diffuse=[255, 255, 255, 255],
        )
        # PBR : terrain = non-métal, rugosité max
        material.kwargs['metallicFactor'] = 0.0
        material.kwargs['roughnessFactor'] = 1.0
        tm_mesh.visual = trimesh.visual.TextureVisuals(
            uv=uvs,
            material=material
        )

    tm_mesh.metadata.update({
        'terlab_version': '1.0',
        'epsg': meta.get('epsg_local', 2975),
        'bbox_wgs84': meta.get('bbox_wgs84', []),
        'origin_offset': origin.tolist(),
        'alt_min': float(origin[2] + verts[:, 2].min()),
        'alt_max': float(origin[2] + verts[:, 2].max()),
        'n_triangles': len(tris),
        'source': 'iOS LiDAR COPC + IGN WMTS',
        'generated': datetime.datetime.now().isoformat()
    })

    tm_mesh.export(output_path)

    size_mb = os.path.getsize(output_path) / 1e6
    if verbose:
        print(f'[GLB] Exporté : {output_path} ({size_mb:.2f} Mo)')

    return size_mb


# ─────────────────────────────────────────────────────────────────────────────
# 7. MAIN
# ─────────────────────────────────────────────────────────────────────────────

def main():
    args = parse_args()
    t0 = time.time()

    print(f'\n=== TERLAB Terrain Pipeline ===')
    print(f'Entrée : {args.input}')
    print(f'Parcelle : {args.parcelle}')

    with tempfile.TemporaryDirectory(prefix='terlab_terrain_') as tmp_dir:

        # 1. Bbox depuis parcelle
        print('\n[1/5] Chargement parcelle...')
        parcelle = load_parcelle(args.parcelle, args.buffer, args.epsg)
        print(f'  BBox WGS84 : {[round(x, 6) for x in parcelle["bbox_wgs84"]]}')
        print(f'  BBox locale : {[round(x, 2) for x in parcelle["bbox_local"]]} m')

        # 2. PDAL : classification + mesh Poisson
        print('\n[2/5] Pipeline PDAL (classification sol + Poisson)...')
        ply_ground, dtm_tif, n_pts = run_pdal(
            input_path=args.input,
            bbox_wgs84=parcelle['bbox_wgs84'],
            bbox_local=parcelle['bbox_local'],
            resolution=args.resolution,
            poisson_depth=args.poisson_depth,
            tmp_dir=tmp_dir,
            input_epsg=args.input_epsg,
            target_epsg=args.epsg,
            verbose=args.verbose
        )
        print(f'  {n_pts} points sol extraits')

        if args.dtm_only:
            import shutil
            dtm_out = args.output.replace('.glb', '_dtm.tif')
            shutil.copy(dtm_tif, dtm_out)
            print(f'  DTM exporté : {dtm_out}')
            return

        # 3. Open3D : Poisson reconstruction + nettoyage + simplification
        print('\n[3/5] Open3D Poisson reconstruction + mesh processing...')
        mesh = process_mesh_open3d(
            ply_ground_path=ply_ground,
            target_triangles=args.simplify,
            poisson_depth=args.poisson_depth,
            bbox_local=parcelle['bbox_local'],
            verbose=args.verbose
        )

        # 4. Texture IGN
        print('\n[4/5] Fetch ortho IGN WMTS...')
        texture_path, tex_bbox = fetch_ign_ortho(
            bbox_wgs84=parcelle['bbox_wgs84'],
            zoom=args.texture_zoom,
            tmp_dir=tmp_dir,
            verbose=args.verbose
        )
        mesh = apply_uv_texture(
            mesh=mesh,
            texture_path=texture_path,
            bbox_wgs84=tex_bbox,
            bbox_local=parcelle['bbox_local'],
            epsg_local=args.epsg,
            verbose=args.verbose
        )

        # 5. Export GLB (centré à l'origine)
        print('\n[5/5] Export GLB...')
        verts_raw = np.asarray(mesh.vertices)
        origin_offset = verts_raw.mean(axis=0)
        meta = {
            'bbox_wgs84': parcelle['bbox_wgs84'],
            'bbox_local': parcelle['bbox_local'],
            'epsg_local': args.epsg,
            'n_triangles': len(mesh.triangles),
            'origin_offset': origin_offset.tolist(),
        }
        size_mb = export_glb(mesh, args.output, meta, args.verbose)

        # Copier DTM
        import shutil
        dtm_out = args.output.replace('.glb', '_dtm.tif')
        shutil.copy(dtm_tif, dtm_out)

        # Meta JSON
        meta_out = args.output.replace('.glb', '_meta.json')
        meta_full = {
            **meta,
            'alt_min': float(verts_raw[:, 2].min()),
            'alt_max': float(verts_raw[:, 2].max()),
            'n_points_sol': n_pts,
            'resolution_dtm': args.resolution,
            'poisson_depth': args.poisson_depth,
            'texture_zoom': args.texture_zoom,
            'size_mb': size_mb,
            'duration_s': round(time.time() - t0, 1),
            'source_copc': os.path.basename(args.input),
            'source_texture': 'IGN WMTS ORTHOIMAGERY.ORTHOPHOTOS',
        }
        with open(meta_out, 'w') as f:
            json.dump(meta_full, f, indent=2)

        elapsed = time.time() - t0
        print(f'\nTerminé en {elapsed:.1f}s')
        print(f'   GLB : {args.output} ({size_mb:.2f} Mo)')
        print(f'   DTM : {dtm_out}')
        print(f'   Meta: {meta_out}')


if __name__ == '__main__':
    main()
