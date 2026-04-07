"""
server.py - Serveur lidar-fetcher pour TERLAB
API REST locale (FastAPI) servant les donnees LiDAR HD IGN La Reunion.

Adapte du serveur original BIMSHOW (c:/GITHUB/Lidar-fetcher/lidar-server).
Utilise COPC streaming (python-pdal ou laspy) pour ne telecharger
que les points dans la bbox demandee.

Usage :
    cd lidar-fetcher
    pip install -r requirements.txt
    python server.py

Le serveur ecoute sur http://localhost:8000
Compatible avec services/lidar-service.js de TERLAB.
"""

import logging
import os
import time
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from tile_index import TileIndex, REUNION_BOUNDS_WGS84
from copc_reader import read_points_bbox, HAS_PDAL, HAS_LASPY

# ── Logging ──────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("lidar-fetcher")

# ── Configuration ────────────────────────────────────────────────────────

HOST = os.getenv("LIDAR_HOST", "0.0.0.0")
PORT = int(os.getenv("LIDAR_PORT", "8000"))

# ── Index des tuiles ─────────────────────────────────────────────────────

tile_index = TileIndex()

# ── App FastAPI ──────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=== Lidar-fetcher TERLAB demarre sur http://%s:%d ===", HOST, PORT)
    logger.info("Backends : pdal=%s laspy=%s", HAS_PDAL, HAS_LASPY)
    if not HAS_PDAL and not HAS_LASPY:
        logger.error("AUCUN BACKEND COPC ! Installer pdal ou laspy[lazrs]")
    yield
    logger.info("=== Lidar-fetcher arrete ===")


app = FastAPI(
    title="Lidar-fetcher — TERLAB",
    description="API REST locale pour les donnees LiDAR HD IGN La Reunion",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Endpoints ────────────────────────────────────────────────────────────

@app.get("/api/files")
async def list_files():
    """
    Health check. Utilise par LidarService.isAvailable() cote client.
    """
    return {
        "status": "ok",
        "server": "lidar-fetcher",
        "version": "2.0.0",
        "source": "IGN LiDAR HD - La Reunion (COPC streaming)",
        "backends": {
            "pdal": HAS_PDAL,
            "laspy": HAS_LASPY,
        },
        "crs_input": "EPSG:4326 (WGS84)",
        "crs_internal": "EPSG:2975 (RGR92 / UTM 40S)",
        "tile_size_m": 1000,
        "bounds": REUNION_BOUNDS_WGS84,
        "classes": {
            "2": "Sol",
            "3": "Vegetation basse",
            "4": "Vegetation moyenne",
            "5": "Vegetation haute",
            "6": "Batiments",
            "9": "Eau",
        },
    }


@app.get("/api/points-bbox")
async def get_points_bbox(
    minLng: float = Query(..., description="Longitude min (WGS84)"),
    minLat: float = Query(..., description="Latitude min (WGS84)"),
    maxLng: float = Query(..., description="Longitude max (WGS84)"),
    maxLat: float = Query(..., description="Latitude max (WGS84)"),
    maxPoints: int = Query(200_000, ge=100, le=1_000_000),
    classes: str = Query("2", description="Classes LiDAR (ex: '2' ou '2,3,5,6')"),
):
    """
    Retourne les points LiDAR dans une bounding box WGS84.
    Format : { points: [[lng,lat,alt,r,g,b,class],...], count, bounds, tile_count, source }
    """
    t0 = time.time()

    if minLng >= maxLng or minLat >= maxLat:
        raise HTTPException(400, "BBox invalide : min >= max")

    rb = REUNION_BOUNDS_WGS84
    if (maxLng < rb["min_lng"] or minLng > rb["max_lng"] or
            maxLat < rb["min_lat"] or minLat > rb["max_lat"]):
        raise HTTPException(400, "BBox hors emprise La Reunion")

    # Parser les classes
    class_set = None
    if classes and classes.strip():
        try:
            class_set = {int(c.strip()) for c in classes.split(",")}
        except ValueError:
            raise HTTPException(400, f"Format classes invalide : '{classes}'")

    # Trouver les tuiles
    tiles = tile_index.tiles_for_bbox_wgs84(minLng, minLat, maxLng, maxLat)
    if not tiles:
        return JSONResponse({
            "points": [], "count": 0,
            "bounds": {"minLng": minLng, "maxLng": maxLng,
                       "minLat": minLat, "maxLat": maxLat,
                       "minAlt": 0, "maxAlt": 0},
            "tile_count": 0, "source": "copc_streaming", "elapsed_s": 0,
        })

    # Convertir bbox en UTM40S
    min_x, min_y, max_x, max_y, cx, cy = tile_index.get_utm_bbox(
        minLng, minLat, maxLng, maxLat
    )

    logger.info(
        "Requete bbox [%.5f,%.5f -> %.5f,%.5f] classes=%s maxPts=%d => %d tuiles",
        minLng, minLat, maxLng, maxLat, classes, maxPoints, len(tiles),
    )
    logger.info("UTM: (%.0f,%.0f) -> (%.0f,%.0f)", min_x, min_y, max_x, max_y)

    # Lire les points (bbox en UTM40S)
    result = read_points_bbox(
        tiles, min_x, min_y, max_x, max_y,
        classes=class_set,
        max_points=maxPoints,
    )

    elapsed = time.time() - t0
    result["elapsed_s"] = round(elapsed, 2)

    logger.info("Reponse : %d points, %d tuiles, %.1fs",
                result["count"], result["tile_count"], elapsed)

    return JSONResponse(result)


@app.get("/api/points")
async def get_points_radius(
    lat: float = Query(..., description="Latitude centre (WGS84)"),
    lng: float = Query(..., description="Longitude centre (WGS84)"),
    radius: float = Query(100, ge=10, le=2000, description="Rayon en metres"),
    maxPoints: int = Query(200_000, ge=100, le=1_000_000),
    classes: str = Query("2", description="Classes LiDAR"),
):
    """Retourne les points LiDAR dans un cercle (centre + rayon)."""
    m_per_deg_lat = 111320
    m_per_deg_lng = 103900
    d_lat = radius / m_per_deg_lat
    d_lng = radius / m_per_deg_lng

    return await get_points_bbox(
        minLng=lng - d_lng, minLat=lat - d_lat,
        maxLng=lng + d_lng, maxLat=lat + d_lat,
        maxPoints=maxPoints, classes=classes,
    )


@app.get("/api/stats")
async def get_stats(
    minLng: float = Query(...),
    minLat: float = Query(...),
    maxLng: float = Query(...),
    maxLat: float = Query(...),
):
    """Statistiques sans lire les points (estimation temps)."""
    tiles = tile_index.tiles_for_bbox_wgs84(minLng, minLat, maxLng, maxLat)
    return {
        "tile_count": len(tiles),
        "tiles": [{"id": t.tile_id, "url": t.url} for t in tiles],
        "estimated_time_s": len(tiles) * 3,
    }


# ── Point d'entree ──────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host=HOST,
        port=PORT,
        reload=True,
        log_level="info",
    )
