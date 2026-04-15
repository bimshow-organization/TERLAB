#!/usr/bin/env python3
"""
corpus_lidar_enrich.py — enrichit data/corpus-seed.json avec les hauteurs
LiDAR HD IGN (MNH) mesurees par percentile 95 sur chaque bloc de chaque cas.

Pour chaque bloc dans cas.bat_reel.blocs[] :
  - rasterize le polygone dans le CRS MNH (RGR92 UTM40S)
  - extrait les pixels MNH qui tombent dedans
  - calcule p95 -> height_lidar_m
  - flag veg_suspect si le bati BDTopo dit 'bati dur' mais p95 < 3m

Usage :
  python scripts/corpus_lidar_enrich.py
  python scripts/corpus_lidar_enrich.py --case REUNION_UA_2010_2134
  python scripts/corpus_lidar_enrich.py --resolution 0.5 --cache-dir data/mnh-cache/

Reuse : functions from .docs/terlab-v4/lidar-heights-module/reunion_osm_heights.py
"""

from __future__ import annotations
import argparse
import json
import sys
import time
from pathlib import Path
import numpy as np
import requests
import rasterio
from rasterio.io import MemoryFile
from rasterio.mask import mask as rio_mask
from shapely.geometry import Polygon, mapping
from shapely.ops import transform as shp_transform
from pyproj import Transformer

# ATTENTION : IGN Geoplateforme a migre son WCS au printemps 2026 et
# l'ancien endpoint data.geopf.fr/wcs?... retourne 404. Aucun nouveau WCS
# public raw MNH n'est documente a ce jour. Les couches WMTS disponibles
# ('IGNF_LIDAR-HD_MNH_*.SHADOW') sont des rasters hillshades (RGB), pas
# des valeurs d'elevation extractibles.
#
# Pistes pour v2 :
#   - IGN LiDAR HD COPC tiles (directes OVH) + laspy + laz-perf (format LAZ)
#   - Ou piper via le module JS existant (services/lidar-heights-service.js)
#     depuis la console navigateur (necessite mapboxgl + geotiff.js)
#   - Ou telechargement en bulk des dalles LIDAR HD depuis geoservices.ign.fr
#     et stockage local
#
# Ce script reste utilisable si LIDARHD_MNH reapparait sur un autre endpoint.
IGN_WCS_URL = "https://data.geopf.fr/wcs"
MNH_LAYER   = "LIDARHD_MNH"
MNH_CRS     = "EPSG:4471"  # RGR92 / UTM40S

WGS84_TO_RGR92 = Transformer.from_crs("EPSG:4326", "EPSG:4471", always_xy=True)
UTM40S_TO_RGR92 = Transformer.from_crs("EPSG:32740", "EPSG:4471", always_xy=True)


def fetch_mnh_tile(bbox_wgs84, resolution_m=0.5, out_path: Path | None = None) -> bytes:
    """Download MNH LiDAR HD for bbox via WCS, returns GeoTIFF bytes."""
    lon_min, lat_min, lon_max, lat_max = bbox_wgs84
    x_min, y_min = WGS84_TO_RGR92.transform(lon_min, lat_min)
    x_max, y_max = WGS84_TO_RGR92.transform(lon_max, lat_max)
    width  = min(int((x_max - x_min) / resolution_m), 4000)
    height = min(int((y_max - y_min) / resolution_m), 4000)
    if width < 8 or height < 8:
        return b""
    url = (f"{IGN_WCS_URL}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage"
           f"&COVERAGEID={MNH_LAYER}&FORMAT=image/tiff"
           f"&OUTPUTCRS={MNH_CRS}&SUBSETTINGCRS={MNH_CRS}"
           f"&SUBSET=E({x_min:.2f},{x_max:.2f})"
           f"&SUBSET=N({y_min:.2f},{y_max:.2f})"
           f"&WIDTH={width}&HEIGHT={height}")
    r = requests.get(url, timeout=120)
    if not r.ok:
        raise RuntimeError(f"WCS {r.status_code} sur bbox {bbox_wgs84}")
    ct = r.headers.get("Content-Type", "")
    if "tiff" not in ct and "octet-stream" not in ct:
        raise RuntimeError(f"Content-Type inattendu: {ct}")
    data = r.content
    if out_path:
        out_path.write_bytes(data)
    return data


def bloc_to_rgr92(bloc_pts_local, cx_utm, cy_utm):
    """Convertit un polygone local UTM40S (centre sur cx/cy) en RGR92."""
    utm_pts = [(p["x"] + cx_utm, p["y"] + cy_utm) for p in bloc_pts_local]
    rgr_pts = [UTM40S_TO_RGR92.transform(x, y) for x, y in utm_pts]
    return Polygon(rgr_pts)


def extract_height_stats(mnh_bytes: bytes, poly_rgr92: Polygon, nodata=-9999):
    """Rasterize poly sur MNH, retourne {p95, p50, p_count, coverage, h_max}."""
    with MemoryFile(mnh_bytes) as memfile:
        with memfile.open() as ds:
            try:
                out, _ = rio_mask(ds, [mapping(poly_rgr92)], crop=True, nodata=nodata)
            except Exception:
                return None
            arr = out[0].astype(np.float32)
            valid = arr[(arr != nodata) & (arr > -1) & (arr < 100)]
            if valid.size < 4:
                return None
            return {
                "height_p95":  float(np.percentile(valid, 95)),
                "height_p50":  float(np.percentile(valid, 50)),
                "height_max":  float(valid.max()),
                "pixel_count": int(valid.size),
                "coverage":    float(valid.size / max(1, arr.size)),
            }


def parcelle_bbox_wgs84(cas) -> tuple[float, float, float, float]:
    """bbox WGS84 des parcelles directes (ou fallback sur centroide + marge)."""
    pg = cas.get("parcelle", {}).get("geojson_wgs84")
    if pg and pg.get("type") == "Polygon":
        coords = pg["coordinates"][0]
        xs = [c[0] for c in coords]; ys = [c[1] for c in coords]
        return min(xs), min(ys), max(xs), max(ys)
    lng, lat = cas["meta"]["centroid_wgs84"]
    return lng - 0.001, lat - 0.001, lng + 0.001, lat + 0.001


def enrich_case(cas, resolution_m=0.5, cache_dir: Path | None = None,
                verbose=True) -> int:
    """Enrichit cas.bat_reel.blocs[] avec height_lidar_m + veg_suspect.
    Retourne le nombre de blocs enrichis."""
    cid = cas.get("id", "?")
    bbox = parcelle_bbox_wgs84(cas)
    # Marge pour eviter les bords exacts
    d = 0.0002  # ~22m
    bbox = (bbox[0] - d, bbox[1] - d, bbox[2] + d, bbox[3] + d)

    cache_path = None
    if cache_dir:
        cache_dir.mkdir(parents=True, exist_ok=True)
        cache_path = cache_dir / f"{cid}_MNH.tif"
        if cache_path.exists() and cache_path.stat().st_size > 1024:
            mnh = cache_path.read_bytes()
        else:
            try:
                mnh = fetch_mnh_tile(bbox, resolution_m, cache_path)
            except Exception as e:
                if verbose: print(f"  [{cid}] WCS err: {e}")
                return 0
    else:
        try:
            mnh = fetch_mnh_tile(bbox, resolution_m)
        except Exception as e:
            if verbose: print(f"  [{cid}] WCS err: {e}")
            return 0
    if not mnh:
        return 0

    cx_utm, cy_utm = cas["parcelle"]["centroid_utm40s"]
    enriched = 0
    for bloc in cas["bat_reel"]["blocs"]:
        try:
            poly_r = bloc_to_rgr92(bloc["polygon_local"], cx_utm, cy_utm)
            stats = extract_height_stats(mnh, poly_r)
            if not stats:
                continue
            bloc["height_lidar_m"] = round(stats["height_p95"], 2)
            bloc["height_lidar_max_m"] = round(stats["height_max"], 2)
            bloc["lidar_pixel_count"] = stats["pixel_count"]
            # veg_suspect : bati dur mais p95 < 3m → probablement un abri/varangue
            h_bdtopo = bloc.get("hauteur_faitage_m") or 0
            bloc["veg_suspect"] = (
                bloc.get("type_bloc") != "leger"
                and stats["height_p95"] < 3.0
                and h_bdtopo > 0
            )
            enriched += 1
        except Exception:
            continue
    return enriched


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed",  default="data/corpus-seed.json")
    ap.add_argument("--resolution", type=float, default=0.5)
    ap.add_argument("--cache-dir", default="data/mnh-cache")
    ap.add_argument("--case", default=None, help="enrichir un cas specifique (id)")
    ap.add_argument("--pause", type=float, default=0.5)
    args = ap.parse_args()

    seed_path = Path(args.seed)
    if not seed_path.exists():
        print(f"[err] {seed_path} introuvable")
        return 1
    cache_dir = Path(args.cache_dir) if args.cache_dir else None

    cases = json.loads(seed_path.read_text(encoding="utf-8"))
    if args.case:
        cases_to_run = [c for c in cases if c.get("id") == args.case]
        if not cases_to_run:
            print(f"[err] cas {args.case} introuvable")
            return 1
    else:
        cases_to_run = cases

    print(f"[corpus-lidar] {len(cases_to_run)} cas a enrichir · resolution {args.resolution}m")
    total_enriched = 0
    for i, cas in enumerate(cases_to_run):
        cid = cas.get("id", "?")
        n = enrich_case(cas, args.resolution, cache_dir)
        total_enriched += n
        print(f"  [{i+1}/{len(cases_to_run)}] {cid} -> {n}/{len(cas['bat_reel']['blocs'])} blocs")
        time.sleep(args.pause)

    seed_path.write_text(json.dumps(cases, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[done] {total_enriched} blocs enrichis -> {seed_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
