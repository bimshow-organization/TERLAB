#!/usr/bin/env python3
"""
corpus_seed_builder.py — TERLAB corpus seed builder
====================================================
Interroge IGN BDTopo V3 (batiment) + PEIGEO (zonage PLU AGORAH) +
api-adresse.data.gouv.fr (reverse geocode), filtre les collectifs
residentiels R+2+ construits apres 2010 a La Reunion, et produit
data/corpus-seed.json compatible avec corpus-collector.js.

Pipeline par commune :
  1. BDTopo WFS  : BDTOPO_V3:batiment, bbox commune, usage_1='Residentiel',
                   hauteur >= MIN_HAUTEUR (~8m = R+2)
  2. Filtre geom : emprise entre MIN_FOOTPRINT et MAX_FOOTPRINT m^2
                   (aire projetee EPSG:32740 UTM40S)
  3. PEIGEO WFS  : zone PLU au centroide (point-in-polygon)
  4. Nominatim   : adresse postale inverse (api-adresse.data.gouv.fr)
  5. Emit seed   : {address, plu:{zone,reculs}, meta:{commune,annee,...}}

Usage :
  python scripts/corpus_seed_builder.py --out data/corpus-seed.json
  python scripts/corpus_seed_builder.py --communes Saint-Denis Saint-Paul \
                                        --max-per-commune 15

Depends : requests, shapely, pyproj
  pip install requests shapely pyproj

Respecte les limites de taux : >= 0.3s entre requetes PEIGEO/Nominatim.
Checkpoint incremental : le fichier est reecrit apres chaque commune.
"""

from __future__ import annotations
import argparse
import json
import sys
import time
from pathlib import Path

import requests
from shapely.geometry import shape
from shapely.ops import transform as shp_transform
from pyproj import Transformer

# ------------------------------------------------------------------ CONFIG
IGN_WFS       = "https://data.geopf.fr/wfs/ows"
PEIGEO_WFS    = "http://peigeo.re:8080/geoserver/ows"  # AGORAH GeoServer (HTTP port 8080)
REVERSE_API   = "https://api-adresse.data.gouv.fr/reverse/"

# bbox WGS84 = [lngMin, latMin, lngMax, latMax]
COMMUNES: dict[str, dict] = {
    "Saint-Denis":   {"insee": "97411", "bbox": [55.420, -20.920, 55.525, -20.850]},
    "Saint-Paul":    {"insee": "97415", "bbox": [55.260, -21.060, 55.330, -20.970]},
    "Saint-Pierre":  {"insee": "97416", "bbox": [55.455, -21.370, 55.525, -21.295]},
    "Le Tampon":     {"insee": "97422", "bbox": [55.460, -21.320, 55.560, -21.215]},
    "Saint-Andre":   {"insee": "97408", "bbox": [55.605, -20.995, 55.685, -20.920]},
    "Saint-Louis":   {"insee": "97414", "bbox": [55.395, -21.305, 55.465, -21.225]},
    "Sainte-Marie":  {"insee": "97418", "bbox": [55.520, -20.950, 55.585, -20.890]},
    "Le Port":       {"insee": "97406", "bbox": [55.280, -20.955, 55.340, -20.905]},
    "La Possession": {"insee": "97407", "bbox": [55.310, -20.940, 55.370, -20.880]},
    "Saint-Joseph":  {"insee": "97412", "bbox": [55.560, -21.400, 55.660, -21.315]},
}

# Filtres collectif residentiel
MIN_HAUTEUR_M   = 8.0      # >= R+2
MIN_FOOTPRINT   = 150.0    # m^2
MAX_FOOTPRINT   = 4000.0   # m^2
MIN_ANNEE       = 2005   # BDTopo date_creation = date d'entree en base (2006-2009 initial survey),
                         # pas la date de construction reelle. A annoter manuellement.
USAGES_RES      = ("Residentiel", "Résidentiel")

# PLU defaults par zone (surchargeables par plu-refs.json)
PLU_DEFAULTS = {
    "UA":  {"recul_voie_m": 3, "recul_fond_m": 3, "recul_lat_m": 3,
            "hauteur_faitage_max_m": 9,  "ces_max_pct": 60, "rtaa_zone": 1},
    "UB":  {"recul_voie_m": 4, "recul_fond_m": 3, "recul_lat_m": 3,
            "hauteur_faitage_max_m": 9,  "ces_max_pct": 50, "rtaa_zone": 1},
    "UC":  {"recul_voie_m": 5, "recul_fond_m": 4, "recul_lat_m": 3,
            "hauteur_faitage_max_m": 7,  "ces_max_pct": 40, "rtaa_zone": 2},
    "Ug":  {"recul_voie_m": 5, "recul_fond_m": 4, "recul_lat_m": 3,
            "hauteur_faitage_max_m": 7,  "ces_max_pct": 35, "rtaa_zone": 2},
    "AUb": {"recul_voie_m": 5, "recul_fond_m": 4, "recul_lat_m": 3,
            "hauteur_faitage_max_m": 9,  "ces_max_pct": 45, "rtaa_zone": 1},
}

WGS84_TO_UTM40S = Transformer.from_crs("EPSG:4326", "EPSG:32740", always_xy=True)

PLU_REFS_PATH = Path(__file__).resolve().parent.parent / "data" / "plu-refs.json"


# ------------------------------------------------------------------ HTTP helpers
_session = requests.Session()
_session.headers.update({"User-Agent": "TERLAB-corpus-seed-builder/1.0 (ENSA La Reunion)"})


def _wfs_get(url: str, typename: str, *, bbox=None, cql: str | None = None,
             count: int = 1000, srs: str = "CRS:84") -> list[dict]:
    """WFS 2.0 GetFeature. Avec srs=CRS:84, bbox = [lng_min, lat_min, lng_max, lat_max]
    (ordre lng/lat, contrairement au srs EPSG:4326 qui force lat/lng)."""
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": typename,
        "srsName": srs,
        "outputFormat": "application/json",
        "count": count,
    }
    if bbox is not None:
        params["bbox"] = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]},{srs}"
    if cql is not None:
        params["cql_filter"] = cql
    try:
        r = _session.get(url, params=params, timeout=90)
        r.raise_for_status()
        return r.json().get("features", []) or []
    except Exception as e:
        print(f"  [wfs-err] {typename}: {e}", file=sys.stderr)
        return []


def _reverse_geocode(lng: float, lat: float) -> str | None:
    try:
        r = _session.get(REVERSE_API, params={"lon": lng, "lat": lat}, timeout=15)
        if not r.ok:
            return None
        feats = r.json().get("features", [])
        if not feats:
            return None
        return feats[0].get("properties", {}).get("label")
    except Exception:
        return None


# ------------------------------------------------------------------ Business logic
def _area_m2_utm40s(geom_wgs84: dict) -> float:
    g = shape(geom_wgs84)
    g_utm = shp_transform(WGS84_TO_UTM40S.transform, g)
    return g_utm.area


def _strip_z(coords):
    """Retire la coord Z d'un tuple ou liste (x,y[,z])."""
    if isinstance(coords, (list, tuple)) and coords and isinstance(coords[0], (list, tuple)):
        return [_strip_z(c) for c in coords]
    if isinstance(coords, (list, tuple)) and len(coords) >= 2:
        return [coords[0], coords[1]]
    return coords


def _to_local_xy(geom_wgs84: dict, cx_utm: float, cy_utm: float) -> list[dict]:
    """Projette un geometry WGS84 (Polygon/MultiPolygon) en UTM40S centre
    sur (cx_utm, cy_utm), Y^ nord. Retourne la ring exterieure du plus
    grand polygone (cas mono-bloc — pour multi-bloc utiliser _to_local_blocs)."""
    g = shape(geom_wgs84)
    g_utm = shp_transform(WGS84_TO_UTM40S.transform, g)
    if g_utm.geom_type == "MultiPolygon":
        g_utm = max(g_utm.geoms, key=lambda p: p.area)
    ext = list(g_utm.exterior.coords)
    return [{"x": round(c[0] - cx_utm, 3), "y": round(c[1] - cy_utm, 3)} for c in ext]


def _to_local_blocs(geom_wgs84: dict, cx_utm: float, cy_utm: float) -> list[list[dict]]:
    """Comme _to_local_xy mais retourne TOUS les polygones (multi-blocs).
    Chaque bloc = ring exterieure en local. Cours interieures (interior rings) ignorees."""
    g = shape(geom_wgs84)
    g_utm = shp_transform(WGS84_TO_UTM40S.transform, g)
    polys = list(g_utm.geoms) if g_utm.geom_type == "MultiPolygon" else [g_utm]
    blocs = []
    for p in polys:
        ext = list(p.exterior.coords)
        if len(ext) < 4:
            continue
        blocs.append([{"x": round(c[0] - cx_utm, 3),
                       "y": round(c[1] - cy_utm, 3)} for c in ext])
    return blocs


# ---- Codes matériaux BDTopo V3 ------------------------------------
TOITURE_CODES = {
    "01": "tuiles", "02": "ardoises", "03": "beton", "04": "metal",
    "05": "verre", "06": "vegetation", "07": "bitume",
    "08": "indetermine", "09": "inconnu", "99": "autre",
}
MURS_CODES = {
    "01": "pierre", "02": "beton_agglomere", "03": "beton", "04": "bois",
    "05": "indetermine", "06": "briques", "07": "metal", "08": "verre",
    "09": "torchis", "99": "autre",
}


def _toiture_type(props: dict) -> str:
    """Devine le type de toiture depuis les altitudes BDTopo.
    plate (delta < 0.8m) | pente (>= 0.8m) | inconnu."""
    a_min = props.get("altitude_minimale_toit")
    a_max = props.get("altitude_maximale_toit")
    if a_min is None or a_max is None:
        return "inconnu"
    delta = float(a_max) - float(a_min)
    if delta < 0.8:
        return "plate"
    if delta < 2.0:
        return "monopente"
    return "double_pente"


def _classify_shape(blocs_local: list[list[dict]]) -> str:
    """Classifie la forme du plan d'emprise :
      - multi_barres si >= 2 polygones distincts
      - rect si compactness >= 0.92 (poly / convex_hull)
      - l_shape si compactness 0.72-0.92 et 1 coin concave saillant
      - t_shape si 2 coins concaves opposes
      - barre si OBB ratio L/l >= 3
      - irregular sinon."""
    if not blocs_local:
        return "irregular"
    if len(blocs_local) >= 2:
        return "multi_barres"
    poly_pts = [(p["x"], p["y"]) for p in blocs_local[0]]
    if len(poly_pts) < 4:
        return "irregular"
    try:
        from shapely.geometry import Polygon
        poly = Polygon(poly_pts)
        if not poly.is_valid:
            poly = poly.buffer(0)
        a = poly.area
        if a < 1.0:
            return "irregular"
        compact = a / max(1e-3, poly.convex_hull.area)
        # OBB ratio approx via minimum_rotated_rectangle
        mrr = poly.minimum_rotated_rectangle
        cx, cy = mrr.exterior.coords[0], mrr.exterior.coords[1]
        cz = mrr.exterior.coords[2]
        from math import hypot
        e1 = hypot(cy[0] - cx[0], cy[1] - cx[1])
        e2 = hypot(cz[0] - cy[0], cz[1] - cy[1])
        ratio = max(e1, e2) / max(1e-3, min(e1, e2))
    except Exception:
        return "irregular"
    if compact >= 0.92 and ratio < 3.0:
        return "rect"
    if compact >= 0.92 and ratio >= 3.0:
        return "barre"
    if compact >= 0.78 and ratio >= 1.6:
        return "l_shape"  # heuristique : decoche unique sur une longueur
    if compact >= 0.65:
        return "t_shape"  # 2 decoches symetriques
    return "irregular"


def _strategy_guess(shape_type: str, n_blocs: int) -> str:
    return {
        "rect":         "rect",
        "barre":        "barre",
        "l_shape":      "lshape",
        "t_shape":      "tshape",
        "multi_barres": "multi",
        "irregular":    "zone",
    }.get(shape_type, "inconnu")


def _fetch_batis_in_bbox(lng: float, lat: float, half_deg: float = 0.0015) -> list[dict]:
    """Tous les batis BDTopo dans une bbox autour du point."""
    bbox = [lng - half_deg, lat - half_deg, lng + half_deg, lat + half_deg]
    return _wfs_get(IGN_WFS, "BDTOPO_V3:batiment", bbox=bbox, count=80)


def _fetch_batis_in_bounds(bbox_wgs84: tuple[float, float, float, float]) -> list[dict]:
    """Batis BDTopo dans une bbox WGS84 explicite [lng_min, lat_min, lng_max, lat_max].
    Utilise pour scanner toute la parcelle (pas juste autour du centroide bati)."""
    return _wfs_get(IGN_WFS, "BDTOPO_V3:batiment",
                    bbox=list(bbox_wgs84), count=120)


def _fetch_parcelles(lng: float, lat: float, bat_geom: dict) -> list[dict]:
    """IGN cadastre PARCELLAIRE_EXPRESS — toutes les parcelles touchant
    le bati OU sa bbox. Retour : liste enrichie d'un '_inter_ratio'
    (fraction du bati intersectee), triee par ratio decroissant.

    Strategie 2 niveaux :
      a) parcelles intersectant le bati (ratio > 0)
      b) si aucune ou couverture < 30% : prendre les parcelles intersectant
         la bbox du bati (proximite) pour donner du contexte cadastral
         meme quand le bati est sur la voie publique."""
    d = 0.0015  # ~165m en lat — bbox elargi pour bati grand ou en bordure
    bbox = [lng - d, lat - d, lng + d, lat + d]
    feats = _wfs_get(IGN_WFS, "CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle",
                     bbox=bbox, count=80)
    if not feats:
        return []
    bat = shape(bat_geom)
    bat_area = max(1e-9, bat.area)
    bat_bbox = bat.envelope  # bati bbox elargi pour fallback proximite
    bat_bbox_buf = bat_bbox.buffer(d * 0.3)  # ~50m de buffer

    direct, neighbours = [], []
    for f in feats:
        try:
            p = shape(f["geometry"])
            inter = p.intersection(bat).area
            ratio = inter / bat_area
            if ratio > 0:
                f["_inter_ratio"] = ratio
                f["_origin"] = "direct"
                direct.append(f)
            elif p.intersects(bat_bbox_buf):
                f["_inter_ratio"] = 0.0
                f["_origin"] = "neighbour"
                # Distance bati centroide pour tri
                f["_dist"] = p.distance(bat.centroid)
                neighbours.append(f)
        except Exception:
            continue

    direct.sort(key=lambda f: -f.get("_inter_ratio", 0))
    coverage = sum(f.get("_inter_ratio", 0) for f in direct)
    if coverage >= 0.30 and direct:
        return direct
    # Couverture insuffisante : ajouter parcelles voisines pour contexte
    neighbours.sort(key=lambda f: f.get("_dist", 9e9))
    return direct + neighbours[:6]


def _fallback_parcel_around(bat_utm_pts: list[tuple[float, float]],
                            cx_utm: float, cy_utm: float,
                            buffer_m: float = 5.0) -> list[dict]:
    """Parcelle synthetique : bbox du bati + buffer. Utilise quand
    PARCELLAIRE_EXPRESS ne couvre pas (DOM, zones non-cadastrees)."""
    xs = [p[0] for p in bat_utm_pts]
    ys = [p[1] for p in bat_utm_pts]
    x0, x1 = min(xs) - buffer_m, max(xs) + buffer_m
    y0, y1 = min(ys) - buffer_m, max(ys) + buffer_m
    return [
        {"x": round(x0 - cx_utm, 3), "y": round(y0 - cy_utm, 3)},
        {"x": round(x1 - cx_utm, 3), "y": round(y0 - cy_utm, 3)},
        {"x": round(x1 - cx_utm, 3), "y": round(y1 - cy_utm, 3)},
        {"x": round(x0 - cx_utm, 3), "y": round(y1 - cy_utm, 3)},
    ]


def _obb_theta_deg(pts_local: list[dict]) -> float:
    """Orientation OBB (degres math, 0=est). Approx via axe de plus grand etalement."""
    if len(pts_local) < 3:
        return 0.0
    from math import atan2, degrees, cos, sin
    # Moindres carres : axe majeur de l'etalement
    xs = [p["x"] for p in pts_local]
    ys = [p["y"] for p in pts_local]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    theta = 0.5 * atan2(2 * sxy, sxx - syy)
    return round(degrees(theta), 2)


def _shape_ratio(pts_local: list[dict]) -> float:
    """Longueur/largeur de l'AABB, >1 = allonge."""
    if len(pts_local) < 3:
        return 1.0
    xs = [p["x"] for p in pts_local]
    ys = [p["y"] for p in pts_local]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    return round(max(w, h) / max(1e-3, min(w, h)), 2)


def _type_programme(niveaux: int, n_lgts: int) -> str:
    if n_lgts <= 1:
        return "maison_individuelle"
    if niveaux <= 2 and n_lgts <= 6:
        return "collectif_petit"
    if niveaux <= 4:
        return "collectif_moyen"
    return "collectif_grand"


def _fetch_batiments(cfg: dict) -> list[dict]:
    """BDTopo V3 batiment — bbox commune. Pas de CQL (IGN GeoPF renvoie
    'OperationProcessingFailed' sur cql_filter) : on filtre client-side."""
    return _wfs_get(IGN_WFS, "BDTOPO_V3:batiment", bbox=cfg["bbox"], count=3000)


def _plu_zone_at(lng: float, lat: float) -> dict | None:
    """PEIGEO/AGORAH zonage PLU — point-in-polygon.
    Layer peigeo:pos_plu_simple, geom field = 'geom', zone = 'libelle' (ex: UA, UBr, Ui)."""
    cql = f"INTERSECTS(geom, POINT({lng} {lat}))"
    feats = _wfs_get(PEIGEO_WFS, "peigeo:pos_plu_simple", cql=cql, count=1)
    if feats:
        return feats[0].get("properties", {})
    return None


def _zone_short(plu_props: dict) -> str | None:
    """Priorite : libelle (ex 'UA', 'UBr') > typezone (ex 'U', 'AU', 'N')."""
    if not plu_props:
        return None
    for k in ("libelle", "typezone", "zone", "ZONE"):
        v = plu_props.get(k)
        if isinstance(v, str) and v:
            return v.split()[0].strip().upper()[:6]
    return None


def _plu_block(zone: str, refs_by_commune: dict, commune: str) -> dict:
    """Construit le bloc plu du seed : defaults par zone, surcharge par plu-refs.json si match."""
    key_zone = (zone or "UA").upper()
    short = next((k for k in PLU_DEFAULTS if key_zone.startswith(k)), "UA")
    base = dict(PLU_DEFAULTS[short])
    key = f"{commune.replace(' ', '_')}_{short}"
    override = (refs_by_commune or {}).get(key) or {}
    base.update({k: v for k, v in override.items() if v is not None})
    base["zone"] = key_zone
    return base


def _load_plu_refs() -> dict:
    if PLU_REFS_PATH.exists():
        try:
            return json.loads(PLU_REFS_PATH.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[warn] plu-refs.json invalide: {e}", file=sys.stderr)
    return {}


def _usage_ok(props: dict) -> bool:
    u = str(props.get("usage_1") or props.get("usage1") or "").strip()
    if not u:
        return True
    return any(tag in u for tag in USAGES_RES)


def _extract_annee(props: dict) -> int:
    for k in ("date_creation", "date_d_apparition", "date_app", "year"):
        v = props.get(k)
        if v:
            try:
                return int(str(v)[:4])
            except Exception:
                pass
    return 2015


def build_seed_entry(feat: dict, commune: str, insee: str,
                     plu_refs: dict, pause_s: float) -> dict | None:
    geom = feat.get("geometry")
    props = feat.get("properties") or {}
    if not geom or geom.get("type") not in ("Polygon", "MultiPolygon"):
        return None
    if not _usage_ok(props):
        return None

    try:
        area = _area_m2_utm40s(geom)
    except Exception:
        return None
    if area < MIN_FOOTPRINT or area > MAX_FOOTPRINT:
        return None

    hauteur = float(props.get("hauteur") or 0)
    if hauteur < MIN_HAUTEUR_M:
        return None
    # max(BDTopo, hauteur/3) — BDTopo donne parfois 0 ou 1 a tort sur des
    # batiments hauts (donnees incompletes Reunion). On prefere la hauteur
    # geometrique observee qui est plus fiable.
    n_etages_bdtopo = props.get("nombre_d_etages") or 0
    n_etages_geom   = max(1, int(round(hauteur / 3.0)))
    n_etages = max(int(n_etages_bdtopo), n_etages_geom)
    if n_etages < 3:
        return None

    annee = _extract_annee(props)
    if annee < MIN_ANNEE:
        return None

    centroid = shape(geom).centroid
    lng, lat = centroid.x, centroid.y
    cx_utm, cy_utm = WGS84_TO_UTM40S.transform(lng, lat)

    address = _reverse_geocode(lng, lat) or f"{commune}, La Reunion"
    time.sleep(pause_s)

    plu_props = _plu_zone_at(lng, lat)
    time.sleep(pause_s)
    zone = _zone_short(plu_props) or "UA"
    plu = _plu_block(zone, plu_refs, commune)

    # Verite logements IGN si disponible, sinon estime
    n_lgts_bdtopo = props.get("nombre_de_logements")
    if isinstance(n_lgts_bdtopo, int) and n_lgts_bdtopo >= 1:
        n_lgts = n_lgts_bdtopo
        n_lgts_source = "BDTopo"
    else:
        n_lgts = max(1, int(round(area * n_etages / 60.0)))
        n_lgts_source = "estime"

    # Geometrie locale UTM40S (Y^ nord), centree sur centroide bati
    try:
        bat_local = _to_local_xy(geom, cx_utm, cy_utm)
        bat_blocs = _to_local_blocs(geom, cx_utm, cy_utm)  # multi-blocs
    except Exception:
        return None
    if not bat_blocs:
        return None

    # Materiaux et toiture (codes BDTopo decodes)
    mat_toit = TOITURE_CODES.get(str(props.get("materiaux_de_la_toiture") or "").zfill(2),
                                 "inconnu")
    mat_murs = MURS_CODES.get(str(props.get("materiaux_des_murs") or "").zfill(2),
                              "inconnu")
    toit_type = _toiture_type(props)
    pente_toit_m = (float(props.get("altitude_maximale_toit") or 0)
                    - float(props.get("altitude_minimale_toit") or 0))

    # Forme + strategy depuis geometrie
    shape_type = _classify_shape(bat_blocs)
    strategy_guess = _strategy_guess(shape_type, len(bat_blocs))

    # Cadastre IGN — TOUTES les parcelles touchant le bati (gestion straddle)
    parc_feats = _fetch_parcelles(lng, lat, bat_geom=geom)
    time.sleep(pause_s)
    parc_local = None
    parc_surface = None
    parc_id = None
    parc_geojson_wgs84 = None
    parcels_list = []   # liste de {idu, polygon_local, surface_m2, inter_ratio}
    bati_inter_ratio_total = 0.0
    if parc_feats:
        try:
            from shapely.ops import unary_union
            from shapely.geometry import mapping
            # Toujours capturer TOUTES les parcelles dans parcels_list (viewer)
            for f in parc_feats:
                p = f.get("properties") or {}
                parcels_list.append({
                    "idu":            p.get("idu"),
                    "polygon_local":  _to_local_xy(f["geometry"], cx_utm, cy_utm),
                    "surface_m2":     round(_area_m2_utm40s(f["geometry"]), 1),
                    "inter_ratio":    round(f.get("_inter_ratio", 0), 3),
                    "origin":         f.get("_origin", "direct"),
                })
            # MAIS la "parcelle principale" (consommee par AutoPlanEngine) ne doit
            # contenir QUE les parcelles directes (qui intersectent le bati).
            # Sinon les voisines de proximite trompent l'engine et le frame local
            # est decale par rapport au bati.
            direct_feats = [f for f in parc_feats if f.get("_origin") == "direct"]
            if direct_feats:
                geoms = [shape(f["geometry"]) for f in direct_feats]
                union_g = unary_union(geoms)
                bati_inter_ratio_total = union_g.intersection(shape(geom)).area \
                                         / max(1e-9, shape(geom).area)
                parc_geojson_wgs84 = mapping(union_g if union_g.geom_type == "Polygon"
                                             else union_g.convex_hull)
                main = direct_feats[0]
                parc_local   = _to_local_xy(main["geometry"], cx_utm, cy_utm)
                parc_surface = sum(_area_m2_utm40s(f["geometry"]) for f in direct_feats)
                parc_id      = (main.get("properties") or {}).get("idu")
        except Exception as e:
            parc_local = None
            # parcels_list garde les voisines pour visualisation contextuelle
    if not parc_local:
        # Aucune parcelle cadastrale ne contient le bati :
        # on REJETTE le cas. Le seed n'inclura pas ce candidat (l'engine ne
        # peut pas travailler de maniere fiable sans parcelle reelle).
        # Alternative future : approche parcelle-first (chercher parcelle
        # 1500-3000m^2 puis verifier qu'elle contient un bati R+2+ avec
        # emprise >= 10% de la parcelle).
        return None

    # ── Multi-batis sur meme parcelle (annexes, corps separes) ───────────────
    # Si on a des parcelles directes, fetch tous les batis BDTopo intersectant
    # leur union, en excluant le bati principal. Sert a representer le contexte
    # bati de la parcelle (garages, annexes, autres collectifs).
    voisins_blocs = []
    if parc_feats:
        try:
            from shapely.ops import unary_union
            from shapely.geometry import shape as _sh
            direct_parcs = [f for f in parc_feats if f.get("_origin") == "direct"]
            if direct_parcs:
                parcs_union = unary_union([_sh(f["geometry"]) for f in direct_parcs])
                main_id = props.get("cleabs")
                bati_main = _sh(geom)
                # Bbox = union des parcelles directes + 30m buffer
                # Garantit qu'on capture tous les batis BDTopo intersectant
                # meme les grandes parcelles irregulieres.
                pminx, pminy, pmaxx, pmaxy = parcs_union.bounds
                pad = 0.0003  # ~33m
                all_batis = _fetch_batis_in_bounds(
                    (pminx - pad, pminy - pad, pmaxx + pad, pmaxy + pad)
                )
                time.sleep(pause_s * 0.3)
                for bf in all_batis:
                    bp = bf.get("properties") or {}
                    if bp.get("cleabs") == main_id:
                        continue
                    bg = bf.get("geometry")
                    if not bg:
                        continue
                    try:
                        bs = _sh(bg)
                        if not bs.intersects(parcs_union):
                            continue
                        # Overlap avec bati principal > 80% -> meme entite, ignorer
                        if bs.intersection(bati_main).area / max(1e-9, bs.area) > 0.8:
                            continue
                        # Ratio d'intersection avec les parcelles directes
                        inter_ratio = bs.intersection(parcs_union).area / max(1e-9, bs.area)
                        if inter_ratio >= 0.85:
                            status = "sur_parcelle"
                        elif inter_ratio >= 0.15:
                            status = "a_cheval"
                        else:
                            status = "limitrophe"
                        bv_blocs = _to_local_blocs(bg, cx_utm, cy_utm)
                        for vp in bv_blocs:
                            if len(vp) < 4:
                                continue
                            voisins_blocs.append({
                                "polygon_local":   vp,
                                "hauteur_m":       bp.get("hauteur"),
                                "niveaux":         bp.get("nombre_d_etages") or
                                                   max(1, round((bp.get("hauteur") or 3) / 3)),
                                "usage":           bp.get("usage_1"),
                                "construction_legere": bool(bp.get("construction_legere")),
                                "bdtopo_id":       bp.get("cleabs"),
                                "inter_ratio":     round(inter_ratio, 3),
                                "status":          status,
                            })
                    except Exception:
                        continue
        except Exception:
            voisins_blocs = []

    obb_theta = _obb_theta_deg(bat_local)
    parc_theta = _obb_theta_deg(parc_local)
    ratio = _shape_ratio(parc_local)

    from math import hypot
    perim_parc = 0.0
    for i in range(len(parc_local)):
        a, b = parc_local[i], parc_local[(i + 1) % len(parc_local)]
        perim_parc += hypot(b["x"] - a["x"], b["y"] - a["y"])

    type_prog = _type_programme(n_etages, n_lgts)

    entry_id = f"REUNION_{zone}_{annee}_{(props.get('cleabs') or '0000')[-4:].upper()}"

    # ── Consolidation : TOUS les batis de la parcelle dans blocs[] ───────────
    # L'analyse engine doit raisonner sur l'ensemble du foncier, pas seulement
    # sur le bati BDTopo de depart. Chaque bloc porte un type :
    #   'principal' = bati seed (collectif R+2+ qui a declenche la selection)
    #   'autre_dur' = autre bati BDTopo dur sur les memes parcelles
    #   'leger'     = construction_legere (varangue, abri, paillote)
    from shapely.geometry import Polygon as _Pg
    blocs_out = []
    # 1) Bati principal (potentiellement multi-blocs si MultiPolygon BDTopo)
    for idx, bloc_pts in enumerate(bat_blocs):
        try:
            bloc_area = _Pg([(p["x"], p["y"]) for p in bloc_pts]).area
        except Exception:
            bloc_area = 0.0
        blocs_out.append({
            "polygon_local":     bloc_pts,
            "niveaux":           n_etages,
            "hauteur_faitage_m": round(hauteur, 1),
            "obb_theta_deg":     _obb_theta_deg(bloc_pts),
            "surface_m2":        round(bloc_area, 1),
            "type_bloc":         "principal" if idx == 0 else "principal_part",
            "bdtopo_id":         props.get("cleabs"),
        })
    # 2) Voisins consolides (autres batis sur memes parcelles)
    for v in voisins_blocs:
        try:
            v_area = _Pg([(p["x"], p["y"]) for p in v["polygon_local"]]).area
        except Exception:
            v_area = 0.0
        blocs_out.append({
            "polygon_local":     v["polygon_local"],
            "niveaux":           v.get("niveaux") or 1,
            "hauteur_faitage_m": v.get("hauteur_m"),
            "obb_theta_deg":     _obb_theta_deg(v["polygon_local"]),
            "surface_m2":        round(v_area, 1),
            "type_bloc":         "leger" if v.get("construction_legere") else "autre_dur",
            "bdtopo_id":         v.get("bdtopo_id"),
            "inter_ratio":       v.get("inter_ratio", 1.0),
            "status":            v.get("status", "sur_parcelle"),
        })

    # Principal + principal_part sont forcement sur_parcelle par construction
    for b in blocs_out:
        if b.get("status") is None:
            b["status"] = "sur_parcelle"
            b["inter_ratio"] = 1.0

    # ── Agregats parcelle : exclut 'limitrophe', prorata sur 'a_cheval' ──────
    # Chaque bloc contribue selon son ratio d'intersection avec les parcelles
    # directes (inter_ratio). 'limitrophe' (< 15%) ignore.
    def _weight(b):
        st = b.get("status")
        if st == "limitrophe":
            return 0.0
        return b.get("inter_ratio") or 1.0

    surface_emprise_totale = sum(b["surface_m2"] * _weight(b) for b in blocs_out)
    surface_plancher_totale = sum(b["surface_m2"] * (b.get("niveaux") or 1) * _weight(b)
                                  for b in blocs_out)
    niveaux_max = max((b.get("niveaux") or 1) for b in blocs_out
                      if b.get("status") != "limitrophe")
    n_logements_total = sum(
        max(1, int(round(b["surface_m2"] * (b.get("niveaux") or 1) / 60.0)))
        for b in blocs_out
        if b["type_bloc"] in ("principal", "principal_part", "autre_dur")
        and b["surface_m2"] >= 30
        and b.get("status") != "limitrophe"
    )
    ces_reel_total = (surface_emprise_totale / parc_surface) if parc_surface else None

    return {
        "id": entry_id,
        "address": address,
        "plu": plu,
        "meta": {
            "commune": commune,
            "code_insee": insee,
            "annee_construction": annee,
            "source": "BDTopo_verifie",
            "statut": "a_verifier",
            "bdtopo_id": props.get("cleabs") or props.get("id"),
            "centroid_wgs84": [round(lng, 6), round(lat, 6)],
            "hauteur_m": round(hauteur, 1),
            "niveaux_estime": n_etages,
            "surface_emprise_m2": round(area, 1),
            "n_logements":        n_lgts,
            "n_logements_source": n_lgts_source,
            "n_blocs_bdtopo":     len(bat_blocs),
            "materiaux_murs":     mat_murs,
            "materiaux_toiture":  mat_toit,
            "toiture_type":       toit_type,
            "toiture_pente_m":    round(pente_toit_m, 2),
            "altitude_min_sol_m": props.get("altitude_minimale_sol"),
            "altitude_max_toit_m": props.get("altitude_maximale_toit"),
            "construction_legere": bool(props.get("construction_legere")),
            "origine_bdtopo":     props.get("origine_du_batiment"),
            "nature":             props.get("nature"),
            "notes": (f"BDTopo R+{n_etages-1} h={hauteur:.1f}m, "
                      f"{len(bat_blocs)} bloc(s) {shape_type}, "
                      f"toit {toit_type}/{mat_toit}, murs {mat_murs}, "
                      f"{n_lgts} lgt({n_lgts_source})"),
            "cadastre_id": parc_id,
        },
        "parcelle": {
            "geojson_wgs84":    parc_geojson_wgs84,
            "geojson_local":    parc_local,
            "parcels":          parcels_list,
            "n_parcels":        len(parcels_list),
            "n_parcels_direct": sum(1 for p in parcels_list if p.get("origin") == "direct"),
            "n_parcels_neighbour": sum(1 for p in parcels_list if p.get("origin") == "neighbour"),
            "bati_inside_ratio": round(bati_inter_ratio_total, 3) if parc_feats else 0.0,
            "centroid_utm40s":  [round(cx_utm, 2), round(cy_utm, 2)],
            "surface_m2":       round(parc_surface or 0, 1),
            "perimetre_m":      round(perim_parc, 1),
            "shape_ratio":      ratio,
            "obb_theta_deg":    parc_theta,
            "bearing_voie_deg": 180.0,  # heuristique (a annoter manuellement)
            "edge_types":       ["voie", "lat", "fond", "lat"][:len(parc_local)] if parc_local else [],
            "topographie": {
                "pente_moy_pct":    None,
                "topo_case_id":     "flat",
                "altitude_ngr_m":   None,
            },
        },
        "bat_reel": {
            "blocs":               blocs_out,    # TOUS les batis de la parcelle
            "blocs_voisins":       voisins_blocs,  # legacy compat (= subset 'autre_dur'/'leger')
            "n_blocs":             len(blocs_out),
            "n_blocs_voisins":     len(voisins_blocs),
            "n_blocs_principal":   sum(1 for b in blocs_out if b["type_bloc"].startswith("principal")),
            "n_blocs_legers":      sum(1 for b in blocs_out if b["type_bloc"] == "leger"),
            "n_blocs_autres_dur":  sum(1 for b in blocs_out if b["type_bloc"] == "autre_dur"),
            "straddle":            sum(1 for p in parcels_list if p.get("origin") == "direct") > 1,
            "n_parcels_touched":   sum(1 for p in parcels_list if p.get("origin") == "direct"),
            "type_programme":      type_prog,
            "niveaux":             niveaux_max,        # max sur la parcelle
            "niveaux_principal":   n_etages,           # niveaux du bati seed seul
            "surface_emprise_m2":     round(surface_emprise_totale, 1),    # TOTAL parcelle
            "surface_emprise_principal_m2": round(area, 1),                # bati seed
            "surface_plancher_totale_m2": round(surface_plancher_totale, 1),
            "n_logements":         n_logements_total,  # somme parcelle
            "n_logements_principal": n_lgts,           # bati seed seul
            "has_pilotis":         False,
            "shape_type":          shape_type,
            "strategy_guess":      strategy_guess,
            "orientation_deg":     obb_theta,
            "toiture": {
                "type":          toit_type,
                "materiau":      mat_toit,
                "pente_delta_m": round(pente_toit_m, 2),
            },
            "source_bdtopo":       True,
        },
        "metriques_reelles": {
            # Toutes ces metriques portent sur l'ENSEMBLE des batis de la parcelle
            "ces_reel":           round(ces_reel_total, 3) if ces_reel_total is not None else None,
            "surface_emprise_m2": round(surface_emprise_totale, 1),
            "surface_plancher_m2": round(surface_plancher_totale, 1),
            "n_logements":        n_logements_total,
            "niveaux_max":        niveaux_max,
            "n_blocs_total":      len(blocs_out),
            # Sous-metriques specifiques au bati principal seed
            "principal_emprise_m2": round(area, 1),
            "principal_niveaux":    n_etages,
            "profondeur_bat_m":   None,
            "largeur_bat_m":      None,
            "conforme_plu":       (ces_reel_total <= plu["ces_max_pct"] / 100.0)
                                  if ces_reel_total is not None else None,
        },
        "comparable_filters": {
            "groupe_plu":      plu["zone"].split("r")[0][:2],
            "bucket_surface":  ("XS_<300" if parc_surface < 300 else
                                "S_300-600" if parc_surface < 600 else
                                "M_600-1200" if parc_surface < 1200 else
                                "L_1200-3000" if parc_surface < 3000 else "XL_>3000")
                                if parc_surface else "S_300-600",
            "bucket_pente":    "flat",
            "has_mitoyen":     False,
        },
    }


# ------------------------------------------------------------------ Main
def main() -> int:
    ap = argparse.ArgumentParser(description="Build TERLAB corpus-seed.json from IGN BDTopo")
    ap.add_argument("--out", default="data/corpus-seed.json",
                    help="Chemin du fichier seed a ecrire")
    ap.add_argument("--communes", type=str, default=None,
                    help="Sous-ensemble de communes, separees par ';' "
                         "(ex: 'Saint-Denis;Le Tampon'). Defaut : toutes.")
    ap.add_argument("--max-per-commune", type=int, default=12,
                    help="Nb max de candidats retenus par commune")
    ap.add_argument("--pause", type=float, default=0.4,
                    help="Delai (s) entre requetes PEIGEO/Nominatim")
    ap.add_argument("--limit-raw", type=int, default=200,
                    help="Nb max de candidats BDTopo scannes par commune")
    args = ap.parse_args()

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    plu_refs = _load_plu_refs()
    if plu_refs:
        print(f"[plu-refs] {len(plu_refs)} surcharges chargees depuis {PLU_REFS_PATH.name}")

    communes_list = [c.strip() for c in args.communes.split(";")] if args.communes else list(COMMUNES.keys())

    seeds: list[dict] = []
    for cname in communes_list:
        cfg = COMMUNES.get(cname)
        if not cfg:
            print(f"[skip] {cname} non configure dans COMMUNES")
            continue
        print(f"\n[{cname}] BDTopo bbox={cfg['bbox']} ...", flush=True)
        feats = _fetch_batiments(cfg)
        if not feats:
            print(f"[{cname}] aucun candidat WFS")
            continue
        print(f"[{cname}] {len(feats)} batiments bruts")

        kept: list[dict] = []
        scanned = 0
        for f in feats:
            if len(kept) >= args.max_per_commune:
                break
            if scanned >= args.limit_raw:
                break
            scanned += 1
            try:
                entry = build_seed_entry(f, cname, cfg["insee"], plu_refs, args.pause)
            except Exception as e:
                print(f"  [err] {e}", file=sys.stderr)
                continue
            if not entry:
                continue
            kept.append(entry)
            m = entry["meta"]
            print(f"  + {m['surface_emprise_m2']:>6.0f}m^2 "
                  f"R+{m['niveaux_estime']-1} {entry['plu']['zone']:<4} "
                  f"· {entry['address'][:64]}")

        seeds.extend(kept)
        out_path.write_text(json.dumps(seeds, indent=2, ensure_ascii=False),
                            encoding="utf-8")
        print(f"[{cname}] retenus {len(kept)}/{scanned} · total {len(seeds)} "
              f"-> {out_path}")

    print(f"\n[done] {len(seeds)} seeds -> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
