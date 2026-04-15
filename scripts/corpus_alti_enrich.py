#!/usr/bin/env python3
"""
corpus_alti_enrich.py — enrichit data/corpus-seed.json avec l'altimetrie
IGN via l'API REST (data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json).

Pourquoi REST et pas WCS : l'endpoint WCS IGN ne gere pas correctement CORS
pour les navigateurs ET a migre sans documentation claire au printemps 2026.
L'API REST reste stable, CORS-friendly, et supporte la Reunion via la
ressource 'ign_rge_alti_wld' (worldwide = couvre les DOM).

Pour chaque cas du seed :
  1. Echantillonne une grille N*N de points dans la bbox parcelle
  2. POST batch a l'API REST -> altitudes Z
  3. Calcule pente moyenne (gradient), azimut dominant, altitude min/max/moy
  4. Genere des courbes de niveau (marching squares) a intervalle 1m
  5. Ecrit dans parcelle.topographie + parcelle.contours_local[]

Usage :
  python scripts/corpus_alti_enrich.py
  python scripts/corpus_alti_enrich.py --grid 15 --interval 1.0
  python scripts/corpus_alti_enrich.py --case REUNION_UA_2010_2134

Notes :
  - Rate-limit IGN : 10 req/s, pause 0.1s minimum
  - 1 requete par cas couvre toute la grille (50 points max par POST)
  - Contours derives en local UTM40S (memes coords que parcelle.geojson_local)
"""

from __future__ import annotations
import argparse
import json
import sys
import time
from pathlib import Path
from math import atan2, degrees, hypot
import numpy as np
import requests
from pyproj import Transformer

ALTI_URL = "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json"
RESOURCE = "ign_rge_alti_wld"  # couvre France + DOM (Reunion OK)
ALTI_MAX_POINTS = 50           # limite IGN par POST

WGS84_TO_UTM40S = Transformer.from_crs("EPSG:4326", "EPSG:32740", always_xy=True)
UTM40S_TO_WGS84 = Transformer.from_crs("EPSG:32740", "EPSG:4326", always_xy=True)

_session = requests.Session()
_session.headers.update({"User-Agent": "TERLAB-corpus-alti/1.0"})


def fetch_alti_batch(lons: list[float], lats: list[float]) -> list[float] | None:
    """POST batch a l'API Altimetrie. Retourne liste Z ou None si echec."""
    if not lons:
        return []
    payload = {
        "lon":       "|".join(f"{l:.6f}" for l in lons),
        "lat":       "|".join(f"{l:.6f}" for l in lats),
        "resource":  RESOURCE,
        "zonly":     "true",
        "delimiter": "|",
    }
    try:
        r = _session.post(ALTI_URL, json=payload, timeout=30)
        r.raise_for_status()
        return r.json().get("elevations", [])
    except Exception as e:
        print(f"  [alti-err] {e}", file=sys.stderr)
        return None


def sample_grid(bbox_wgs84, n=15) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Genere une grille n*n de points WGS84 dans bbox. Retourne (lng, lat, xy_utm)."""
    lng_min, lat_min, lng_max, lat_max = bbox_wgs84
    lngs = np.linspace(lng_min, lng_max, n)
    lats = np.linspace(lat_min, lat_max, n)
    LNG, LAT = np.meshgrid(lngs, lats)
    X, Y = WGS84_TO_UTM40S.transform(LNG.ravel(), LAT.ravel())
    return LNG.ravel(), LAT.ravel(), np.stack([X, Y], axis=1)


def query_grid_elevations(lngs: np.ndarray, lats: np.ndarray,
                          pause_s: float = 0.12) -> np.ndarray | None:
    """Interroge altitudes par chunks (max 50/POST)."""
    zs = []
    for i in range(0, len(lngs), ALTI_MAX_POINTS):
        bl = fetch_alti_batch(lngs[i:i + ALTI_MAX_POINTS].tolist(),
                              lats[i:i + ALTI_MAX_POINTS].tolist())
        if bl is None:
            return None
        zs.extend(bl)
        time.sleep(pause_s)
    return np.asarray(zs, dtype=np.float32)


def compute_slope_stats(xy_utm: np.ndarray, z: np.ndarray, n: int) -> dict:
    """Pente moyenne (%), azimut pente (compass, 0=N), min/max/moy altitude."""
    Z = z.reshape(n, n)
    # Filtre NoData (-99999 ou valeurs aberrantes)
    Z = np.where((Z < -1000) | (Z > 5000), np.nan, Z)
    if np.isnan(Z).all():
        return {}
    X = xy_utm[:, 0].reshape(n, n)
    Y = xy_utm[:, 1].reshape(n, n)
    dx = np.nanmean(np.diff(X, axis=1))
    dy = np.nanmean(np.diff(Y, axis=0))
    gz_dx = np.gradient(Z, axis=1) / max(1e-6, dx)
    gz_dy = np.gradient(Z, axis=0) / max(1e-6, dy)
    slope_pct = np.hypot(gz_dx, gz_dy) * 100
    # Azimut de la pente (vers le bas) : atan2(-gz_dy, -gz_dx), compass (N=0)
    az_math = np.degrees(np.arctan2(-np.nanmean(gz_dy), -np.nanmean(gz_dx)))
    az_compass = (90 - az_math) % 360
    return {
        "alt_min_m":        float(np.nanmin(Z)),
        "alt_max_m":        float(np.nanmax(Z)),
        "alt_moy_m":        float(np.nanmean(Z)),
        "alt_median_m":     float(np.nanmedian(Z)),
        "pente_moy_pct":    float(np.nanmean(slope_pct)),
        "pente_max_pct":    float(np.nanmax(slope_pct)),
        "azimut_pente_deg": float(az_compass),
    }


def marching_squares_contours(xy_utm: np.ndarray, z: np.ndarray, n: int,
                              interval_m: float, cx_utm: float, cy_utm: float
                              ) -> list[dict]:
    """Genere courbes de niveau via np.vectorize (simple, pas shapely).
    Utilise un seuil binaire puis edge-detection basique."""
    Z = z.reshape(n, n)
    if np.isnan(Z).any() or np.all(Z < -100):
        return []
    X = xy_utm[:, 0].reshape(n, n)
    Y = xy_utm[:, 1].reshape(n, n)
    z_min = np.floor(Z.min() / interval_m) * interval_m
    z_max = np.ceil(Z.max() / interval_m) * interval_m
    contours = []
    for level in np.arange(z_min, z_max + interval_m / 2, interval_m):
        segs = []
        # Parcourt chaque cellule et trouve les transitions du niveau
        for j in range(n - 1):
            for i in range(n - 1):
                # 4 coins de la cellule
                v = np.array([Z[j, i], Z[j, i + 1], Z[j + 1, i + 1], Z[j + 1, i]])
                if np.isnan(v).any():
                    continue
                # Sign par rapport au niveau
                s = v >= level
                if s.all() or (~s).all():
                    continue
                # Points de transition par arete (interpolation lineaire)
                def interp(a, b, va, vb):
                    t = (level - va) / (vb - va) if (vb - va) != 0 else 0.5
                    return (a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]))
                corners = [
                    (X[j, i],     Y[j, i],     Z[j, i]),
                    (X[j, i+1],   Y[j, i+1],   Z[j, i+1]),
                    (X[j+1, i+1], Y[j+1, i+1], Z[j+1, i+1]),
                    (X[j+1, i],   Y[j+1, i],   Z[j+1, i]),
                ]
                pts = []
                for k in range(4):
                    a = corners[k]; b = corners[(k+1) % 4]
                    va, vb = a[2], b[2]
                    if (va >= level) != (vb >= level):
                        pts.append(interp((a[0], a[1]), (b[0], b[1]), va, vb))
                if len(pts) == 2:
                    segs.append(pts)
        if segs:
            # Convertit en coords local
            local_segs = [
                [{"x": round(p[0] - cx_utm, 2), "y": round(p[1] - cy_utm, 2)}
                 for p in seg]
                for seg in segs
            ]
            contours.append({"level_m": round(float(level), 2), "segments": local_segs})
    return contours


def enrich_case(cas: dict, grid_n: int = 15, interval_m: float = 1.0,
                pause_s: float = 0.2) -> bool:
    parc = cas.get("parcelle", {})
    pg = parc.get("geojson_wgs84")
    if not pg or pg.get("type") != "Polygon":
        return False
    coords = pg["coordinates"][0]
    xs = [c[0] for c in coords]; ys = [c[1] for c in coords]
    bbox = (min(xs), min(ys), max(xs), max(ys))
    # Marge 5m environ pour les contours periphery
    pad = 0.00005
    bbox = (bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad)
    cx_utm, cy_utm = parc.get("centroid_utm40s", [0, 0])

    lngs, lats, xy_utm = sample_grid(bbox, grid_n)
    z = query_grid_elevations(lngs, lats, pause_s)
    if z is None or len(z) == 0:
        return False

    stats = compute_slope_stats(xy_utm, z, grid_n)
    if not stats:
        return False

    topo = parc.setdefault("topographie", {})
    topo.update(stats)
    # Topo case (aligne sur topo-case-service.js)
    slope = stats["pente_moy_pct"]
    if   slope < 5:  topo["topo_case_id"] = "flat"
    elif slope < 15: topo["topo_case_id"] = "gentle"
    elif slope < 30: topo["topo_case_id"] = "medium"
    elif slope < 50: topo["topo_case_id"] = "steep"
    else:            topo["topo_case_id"] = "extreme"
    topo["source"] = "IGN_RGE_ALTI_REST"
    topo["grid_n"] = grid_n

    contours = marching_squares_contours(xy_utm, z, grid_n, interval_m, cx_utm, cy_utm)
    if contours:
        parc["contours_local"] = contours
        parc["contours_interval_m"] = interval_m
        parc["contours_n_levels"] = len(contours)
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", default="data/corpus-seed.json")
    ap.add_argument("--grid", type=int, default=15, help="N points per axis (N*N total)")
    ap.add_argument("--interval", type=float, default=1.0, help="Intervalle courbes (m)")
    ap.add_argument("--case", default=None)
    ap.add_argument("--pause", type=float, default=0.15)
    args = ap.parse_args()

    seed_path = Path(args.seed)
    if not seed_path.exists():
        print(f"[err] {seed_path} introuvable"); return 1
    cases = json.loads(seed_path.read_text(encoding="utf-8"))
    targets = [c for c in cases if c.get("id") == args.case] if args.case else cases
    if args.case and not targets:
        print(f"[err] cas {args.case} introuvable"); return 1

    ok_n = 0
    for i, cas in enumerate(targets):
        cid = cas.get("id", "?")
        t0 = time.time()
        ok = enrich_case(cas, args.grid, args.interval, args.pause)
        dt = time.time() - t0
        if ok:
            ok_n += 1
            t = cas["parcelle"]["topographie"]
            print(f"  [{i+1}/{len(targets)}] {cid} · alt {t['alt_min_m']:.0f}-{t['alt_max_m']:.0f}m "
                  f"· pente {t['pente_moy_pct']:.1f}% ({t['topo_case_id']}) "
                  f"· {cas['parcelle'].get('contours_n_levels', 0)} courbes · {dt:.1f}s")
        else:
            print(f"  [{i+1}/{len(targets)}] {cid} · ECHEC")

    seed_path.write_text(json.dumps(cases, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n[done] {ok_n}/{len(targets)} cas enrichis -> {seed_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
