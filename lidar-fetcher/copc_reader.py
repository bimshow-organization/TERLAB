"""
copc_reader.py - Lecture streaming de fichiers COPC LiDAR HD IGN
Adapte du serveur original BIMSHOW (c:/GITHUB/Lidar-fetcher).

Supporte 2 backends par ordre de preference :
1. python-pdal (le plus rapide, HTTP range requests natif)
2. laspy CopcReader (fallback, HTTP range requests via requests)

Les fichiers COPC IGN La Reunion contiennent :
- Coordonnees en UTM40S (EPSG:2975)
- Classification ASPRS : 2=sol, 3=veg basse, 4=veg moy, 5=veg haute, 6=bati, 9=eau
- Couleurs RGB 16 bits
- Altitudes en metres NGR (Nivellement General de La Reunion)

Format de sortie TERLAB : [[lng, lat, alt, r, g, b, classification], ...]
"""

import json
import logging
import time
import numpy as np

from tile_index import TileInfo, utm40s_to_wgs84

logger = logging.getLogger(__name__)

# ── Detection des backends disponibles ───────────────────────────────────

HAS_PDAL = False
HAS_LASPY = False

try:
    import pdal
    HAS_PDAL = True
    logger.info("Backend pdal disponible (streaming rapide)")
except ImportError:
    pass

try:
    from laspy import CopcReader
    HAS_LASPY = True
    logger.info("Backend laspy disponible (fallback)")
except ImportError:
    pass

if not HAS_PDAL and not HAS_LASPY:
    logger.error("Aucun backend COPC disponible ! Installer pdal ou laspy[lazrs]")


# ── Backend 1 : python-pdal (prefere) ───────────────────────────────────

def _read_with_pdal(
    url: str,
    min_x: float, min_y: float, max_x: float, max_y: float,
    classes: set[int] | None,
    max_points: int,
) -> tuple[np.ndarray | None, int]:
    """
    Lit les points via python-pdal (streaming COPC natif).
    Retourne (structured_array, total_count) ou (None, 0) en cas d'erreur.
    """
    pipeline_stages = [
        {
            "type": "readers.copc",
            "filename": url,
            "bounds": f"([{min_x}, {max_x}], [{min_y}, {max_y}])",
        }
    ]

    if classes:
        class_expr = " || ".join([f"Classification == {c}" for c in classes])
        pipeline_stages.append({
            "type": "filters.expression",
            "expression": class_expr,
        })

    pipeline = pdal.Pipeline(json.dumps({"pipeline": pipeline_stages}))
    count = pipeline.execute()

    if count == 0:
        return None, 0

    arrays = pipeline.arrays
    if len(arrays) == 0 or len(arrays[0]) == 0:
        return None, 0

    arr = arrays[0]

    # Sous-echantillonnage si necessaire
    if len(arr) > max_points:
        indices = np.random.choice(len(arr), max_points, replace=False)
        arr = arr[indices]

    return arr, count


def _pdal_array_to_points(arr: np.ndarray) -> list[list]:
    """Convertit un structured array PDAL en liste de points TERLAB."""
    x = arr['X'].astype(np.float64)
    y = arr['Y'].astype(np.float64)
    z = arr['Z'].astype(np.float64)
    classification = arr['Classification'].astype(np.int32)

    # Couleurs RGB
    has_color = 'Red' in arr.dtype.names and arr['Red'].max() > 0
    if has_color:
        r = (arr['Red'] / 256).astype(np.uint8)
        g = (arr['Green'] / 256).astype(np.uint8)
        b = (arr['Blue'] / 256).astype(np.uint8)
    else:
        r = np.zeros(len(arr), dtype=np.uint8)
        g = np.zeros(len(arr), dtype=np.uint8)
        b = np.zeros(len(arr), dtype=np.uint8)

    # Convertir UTM40S -> WGS84
    lngs, lats = utm40s_to_wgs84(x, y)

    points = []
    for i in range(len(arr)):
        points.append([
            round(float(lngs[i]), 7),
            round(float(lats[i]), 7),
            round(float(z[i]), 2),
            int(r[i]), int(g[i]), int(b[i]),
            int(classification[i]),
        ])
    return points


# ── Backend 2 : laspy CopcReader (fallback) ──────────────────────────────

def _read_with_laspy(
    url: str,
    min_x: float, min_y: float, max_x: float, max_y: float,
    classes: set[int] | None,
    max_points: int,
) -> list[list]:
    """Lit les points via laspy CopcReader (HTTP range requests)."""
    from laspy import CopcReader
    from laspy.copc import Bounds

    with CopcReader.open(url) as reader:
        bounds = Bounds(
            mins=np.array([min_x, min_y, -1000.0]),
            maxs=np.array([max_x, max_y, 10000.0]),
        )
        points_data = reader.query(bounds=bounds)

        if points_data is None or len(points_data.x) == 0:
            return []

        x = np.array(points_data.x)
        y = np.array(points_data.y)
        z = np.array(points_data.z)
        classification = np.array(points_data.classification)

        # Filtrer par classification
        if classes:
            mask = np.isin(classification, list(classes))
            x, y, z = x[mask], y[mask], z[mask]
            classification = classification[mask]
        else:
            mask = None

        if len(x) == 0:
            return []

        # Sous-echantillonnage
        subsample = None
        if len(x) > max_points:
            subsample = np.random.choice(len(x), max_points, replace=False)
            subsample.sort()
            x, y, z = x[subsample], y[subsample], z[subsample]
            classification = classification[subsample]

        # Couleurs RGB (16 bits -> 8 bits)
        try:
            r_all = np.array(points_data.red)
            g_all = np.array(points_data.green)
            b_all = np.array(points_data.blue)
            if mask is not None:
                r_all, g_all, b_all = r_all[mask], g_all[mask], b_all[mask]
            if subsample is not None:
                r_all, g_all, b_all = r_all[subsample], g_all[subsample], b_all[subsample]
            r = (r_all >> 8).astype(np.uint8)
            g = (g_all >> 8).astype(np.uint8)
            b = (b_all >> 8).astype(np.uint8)
        except (AttributeError, TypeError):
            r = np.zeros(len(x), dtype=np.uint8)
            g = np.zeros(len(x), dtype=np.uint8)
            b = np.zeros(len(x), dtype=np.uint8)

        # UTM40S -> WGS84
        lngs, lats = utm40s_to_wgs84(x, y)

        points = []
        for i in range(len(x)):
            points.append([
                round(float(lngs[i]), 7),
                round(float(lats[i]), 7),
                round(float(z[i]), 2),
                int(r[i]), int(g[i]), int(b[i]),
                int(classification[i]),
            ])
        return points


# ── API publique ─────────────────────────────────────────────────────────

def read_points_from_tile(
    tile: TileInfo,
    min_x: float, max_x: float,
    min_y: float, max_y: float,
    classes: set[int] | None = None,
    max_points: int = 200_000,
) -> dict:
    """
    Lit les points d'une tuile COPC dans la bbox UTM40S donnee.
    Essaie python-pdal d'abord, puis fallback laspy.
    """
    t0 = time.time()
    points = []

    # 1. Essayer python-pdal
    if HAS_PDAL:
        try:
            arr, total = _read_with_pdal(
                tile.url, min_x, min_y, max_x, max_y,
                classes, max_points,
            )
            if arr is not None and len(arr) > 0:
                points = _pdal_array_to_points(arr)
                logger.info("Tuile %s : %d pts (pdal) en %.1fs",
                            tile.tile_id, len(points), time.time() - t0)
        except Exception as e:
            logger.warning("pdal echec sur %s : %s", tile.tile_id, e)

    # 2. Fallback laspy
    if not points and HAS_LASPY:
        try:
            points = _read_with_laspy(
                tile.url, min_x, min_y, max_x, max_y,
                classes, max_points,
            )
            logger.info("Tuile %s : %d pts (laspy) en %.1fs",
                        tile.tile_id, len(points), time.time() - t0)
        except Exception as e:
            logger.warning("laspy echec sur %s : %s", tile.tile_id, e)

    if not points:
        logger.info("Tuile %s : 0 points", tile.tile_id)
        return {"points": [], "count": 0, "bounds": None}

    # Calculer bounds depuis les points
    lngs = [p[0] for p in points]
    lats = [p[1] for p in points]
    alts = [p[2] for p in points]

    return {
        "points": points,
        "count": len(points),
        "bounds": {
            "minLng": round(min(lngs), 6),
            "maxLng": round(max(lngs), 6),
            "minLat": round(min(lats), 6),
            "maxLat": round(max(lats), 6),
            "minAlt": round(min(alts), 2),
            "maxAlt": round(max(alts), 2),
        },
    }


def read_points_bbox(
    tiles: list[TileInfo],
    min_x: float, min_y: float,
    max_x: float, max_y: float,
    classes: set[int] | None = None,
    max_points: int = 200_000,
) -> dict:
    """
    Lit les points de plusieurs tuiles dans une bbox UTM40S.
    Fusionne et sous-echantillonne si necessaire.

    Retourne le format attendu par lidar-service.js :
    { points, count, bounds, tile_count, source }
    """
    all_points = []
    merged_bounds = None
    pts_per_tile = max(max_points // max(len(tiles), 1), 10_000)

    for tile in tiles:
        if len(all_points) >= max_points:
            break

        result = read_points_from_tile(
            tile, min_x, max_x, min_y, max_y,
            classes=classes,
            max_points=pts_per_tile,
        )
        all_points.extend(result["points"])

        if result["bounds"]:
            if merged_bounds is None:
                merged_bounds = dict(result["bounds"])
            else:
                b = result["bounds"]
                merged_bounds["minLng"] = min(merged_bounds["minLng"], b["minLng"])
                merged_bounds["maxLng"] = max(merged_bounds["maxLng"], b["maxLng"])
                merged_bounds["minLat"] = min(merged_bounds["minLat"], b["minLat"])
                merged_bounds["maxLat"] = max(merged_bounds["maxLat"], b["maxLat"])
                merged_bounds["minAlt"] = min(merged_bounds["minAlt"], b["minAlt"])
                merged_bounds["maxAlt"] = max(merged_bounds["maxAlt"], b["maxAlt"])

    # Sous-echantillonnage global
    if len(all_points) > max_points:
        indices = np.random.choice(len(all_points), max_points, replace=False)
        indices.sort()
        all_points = [all_points[i] for i in indices]

    backend = "pdal_streaming" if HAS_PDAL else "laspy_copc"

    return {
        "points": all_points,
        "count": len(all_points),
        "bounds": merged_bounds or {
            "minLng": 0, "maxLng": 0,
            "minLat": 0, "maxLat": 0,
            "minAlt": 0, "maxAlt": 0,
        },
        "tile_count": len(tiles),
        "source": backend,
    }
