"""
tile_index.py - Index des tuiles COPC LiDAR HD IGN pour La Reunion
Repris du serveur original BIMSHOW Lidar-fetcher (c:/GITHUB/Lidar-fetcher).

IGN diffuse les dalles LiDAR HD au format COPC (.copc.laz)
Grille : dalles de 1km x 1km en UTM40S (EPSG:2975) pour La Reunion.
Nommage : LHD_REU_{X:04d}_{Y:04d}_PTS_RGR92UTM40S_REUN89.copc.laz

ATTENTION convention Y IGN : dalle Y=7658 couvre northing [7657000, 7658000]
=> utiliser ceil() pour le Y !
"""

import math
import logging
from dataclasses import dataclass
from pyproj import Transformer

logger = logging.getLogger(__name__)

# ── Transformation de coordonnees ────────────────────────────────────────

# WGS84 (EPSG:4326) <-> RGR92 / UTM 40S (EPSG:2975)
_to_utm40s = Transformer.from_crs("EPSG:4326", "EPSG:2975", always_xy=True)
_to_wgs84 = Transformer.from_crs("EPSG:2975", "EPSG:4326", always_xy=True)


def wgs84_to_utm40s(lng: float, lat: float) -> tuple[float, float]:
    """Convertit WGS84 (lng, lat) en UTM40S (easting, northing)."""
    return _to_utm40s.transform(lng, lat)


def utm40s_to_wgs84(e: float, n: float) -> tuple[float, float]:
    """Convertit UTM40S (easting, northing) en WGS84 (lng, lat)."""
    return _to_wgs84.transform(e, n)


# ── Configuration IGN LiDAR HD Reunion ───────────────────────────────────

# URL de telechargement IGN Geoplateforme (confirmee fonctionnelle)
IGN_BASE_URL = "https://data.geopf.fr/telechargement/download/LiDARHD-NUALID"
IGN_FOLDER = "NUALHD_1-0__LAZ_RGR92UTM40S_REU_2025-06-18"

TILE_SIZE_M = 1000

# Emprise approximative de La Reunion en WGS84
REUNION_BOUNDS_WGS84 = {
    "min_lng": 55.2,
    "max_lng": 55.9,
    "min_lat": -21.4,
    "max_lat": -20.85,
}


@dataclass
class TileInfo:
    """Informations sur une tuile COPC."""
    tile_id: str          # ex: "LHD_REU_0340_7660"
    x_km: int             # dalle X (easting en km, floor)
    y_km: int             # dalle Y (convention IGN, ceil)
    min_e: float          # easting min (m)
    max_e: float          # easting max (m)
    min_n: float          # northing min (m)
    max_n: float          # northing max (m)
    url: str              # URL du fichier COPC


def build_tile_url(x_km: int, y_km: int) -> str:
    """Construit l'URL de telechargement IGN pour une tuile."""
    filename = f"LHD_REU_{x_km:04d}_{y_km:04d}_PTS_RGR92UTM40S_REUN89.copc.laz"
    return f"{IGN_BASE_URL}/{IGN_FOLDER}/{filename}"


class TileIndex:
    """
    Index des tuiles COPC pour La Reunion.
    Reproduit la logique du serveur original BIMSHOW.
    """

    def tiles_for_bbox_wgs84(
        self, min_lng: float, min_lat: float, max_lng: float, max_lat: float
    ) -> list[TileInfo]:
        """
        Retourne la liste des tuiles COPC couvrant la bbox en WGS84.
        """
        # Verifier que la bbox touche La Reunion
        rb = REUNION_BOUNDS_WGS84
        if (max_lng < rb["min_lng"] or min_lng > rb["max_lng"] or
                max_lat < rb["min_lat"] or min_lat > rb["max_lat"]):
            logger.warning("BBox hors emprise Reunion : %.4f,%.4f -> %.4f,%.4f",
                           min_lng, min_lat, max_lng, max_lat)
            return []

        # Convertir les coins en UTM40S
        min_x, min_y = wgs84_to_utm40s(min_lng, min_lat)
        max_x, max_y = wgs84_to_utm40s(max_lng, max_lat)

        # Assurer le bon ordre
        if min_x > max_x:
            min_x, max_x = max_x, min_x
        if min_y > max_y:
            min_y, max_y = max_y, min_y

        # Convention IGN : dalle Y=7658 couvre [7657000, 7658000]
        # => floor pour X, ceil pour Y
        x_start = int(min_x // TILE_SIZE_M)
        x_end = int(max_x // TILE_SIZE_M)
        y_start = int(math.ceil(min_y / TILE_SIZE_M))
        y_end = int(math.ceil(max_y / TILE_SIZE_M))

        tiles = []
        for dx in range(x_start, x_end + 1):
            for dy in range(y_start, y_end + 1):
                tile_id = f"LHD_REU_{dx:04d}_{dy:04d}"
                # Convention IGN : dalle Y couvre [(Y-1)*1000, Y*1000]
                tile_min_n = (dy - 1) * TILE_SIZE_M
                tile_max_n = dy * TILE_SIZE_M
                tile_min_e = dx * TILE_SIZE_M
                tile_max_e = tile_min_e + TILE_SIZE_M

                tiles.append(TileInfo(
                    tile_id=tile_id,
                    x_km=dx,
                    y_km=dy,
                    min_e=tile_min_e,
                    max_e=tile_max_e,
                    min_n=tile_min_n,
                    max_n=tile_max_n,
                    url=build_tile_url(dx, dy),
                ))

        logger.info("BBox %.4f,%.4f -> %.4f,%.4f => %d tuiles : %s",
                     min_lng, min_lat, max_lng, max_lat, len(tiles),
                     [t.tile_id.split("_")[2:4] for t in tiles])
        return tiles

    def tiles_for_point_wgs84(
        self, lng: float, lat: float, radius_m: float
    ) -> list[TileInfo]:
        """Retourne les tuiles couvrant un cercle (point + rayon) en WGS84."""
        m_per_deg_lat = 111320
        m_per_deg_lng = 103900
        d_lat = radius_m / m_per_deg_lat
        d_lng = radius_m / m_per_deg_lng
        return self.tiles_for_bbox_wgs84(
            lng - d_lng, lat - d_lat,
            lng + d_lng, lat + d_lat,
        )

    def get_utm_bbox(
        self, min_lng: float, min_lat: float, max_lng: float, max_lat: float
    ) -> tuple[float, float, float, float, float, float]:
        """
        Convertit une bbox WGS84 en UTM40S.
        Retourne (min_x, min_y, max_x, max_y, center_x, center_y).
        """
        min_x, min_y = wgs84_to_utm40s(min_lng, min_lat)
        max_x, max_y = wgs84_to_utm40s(max_lng, max_lat)
        if min_x > max_x:
            min_x, max_x = max_x, min_x
        if min_y > max_y:
            min_y, max_y = max_y, min_y
        cx = (min_x + max_x) / 2
        cy = (min_y + max_y) / 2
        return min_x, min_y, max_x, max_y, cx, cy
