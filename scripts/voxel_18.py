#!/usr/bin/env python3
"""
TERLAB . voxel_18.py
Genere 6 PDFs (1 par zone), chaque PDF = 3 echelles cote a cote (E1/E2/E3)
x 3 lignes (sat+overlays / voxel axo / maquette 3D).
6 zones x 3 echelles = 18 vues.

Reutilise toutes les briques de voxel_patterns_real.py.
"""

from __future__ import annotations

import datetime
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from PIL import Image

# Import des briques existantes
sys.path.insert(0, str(Path(__file__).resolve().parent))
import voxel_patterns_real as vpr  # noqa: E402

ZONES_18 = [
    # (nom, lat, lng, label)
    ('Centre St-Leu',          -21.169, 55.288, 'bati dense cotier'),
    ('Bras Mouton residentiel',-21.181, 55.300, 'pavillonnaire'),
    ('Plateau Cailloux',       -21.193, 55.293, 'lotissement rural'),
    ('Bois de Sans-Souci',     -21.183, 55.327, 'foret des Hauts'),
    ('Stella canne',           -21.193, 55.312, 'canne a sucre'),
    ('Pointe des Chateaux',    -21.157, 55.283, 'cote ocean'),
]

# 3 echelles : (side_m, voxel_xy_m, label)
ECHELLES = [
    (240, 8.0, 'E1 - 240m / vox 8x8x1m'),
    (120, 4.0, 'E2 - 120m / vox 4x4x1m'),
    (60,  2.0, 'E3 - 60m / vox 2x2x1m'),
]

CACHE_DIR = Path('docs/voxel-patterns/cache_18')
OUTPUT_DIR = Path('docs/voxel-patterns/zones_18')


def _slug(s: str) -> str:
    return (s.lower()
            .replace(' ', '_')
            .replace('-', '_')
            .replace("'", '')
            .replace('/', '_'))


def fetch_all(name: str, lat: float, lng: float, side_m: float,
              cache_dir: Path):
    """Fetch + cache : ortho, cosia, lidar, routes, bati. Retourne dict."""
    slug = _slug(name)
    side_tag = f's{int(side_m)}'
    nx = max(1, int(round(side_m / _vox_for_side(side_m))))

    out = {'side_m': side_m, 'nx': nx, 'lat': lat, 'lng': lng}

    # ORTHO
    p = cache_dir / f'{slug}_{side_tag}_ortho.jpg'
    if p.exists():
        out['ortho'] = np.array(Image.open(p).convert('RGB'))
    else:
        print(f'    ortho ...', end='', flush=True)
        img = vpr.fetch_ortho(lat, lng, side_m=side_m, pix=512)
        if img is not None:
            Image.fromarray(img).save(p, quality=82)
            out['ortho'] = img
            print(' OK')
            time.sleep(0.3)
        else:
            print(' FAIL')
            out['ortho'] = None

    # COSIA
    p = cache_dir / f'{slug}_{side_tag}_cosia.png'
    if p.exists():
        out['cosia'] = np.array(Image.open(p).convert('RGBA'))
    else:
        print(f'    cosia ...', end='', flush=True)
        img = vpr.fetch_cosia(lat, lng, side_m=side_m, pix=512)
        if img is not None:
            Image.fromarray(img).save(p)
            out['cosia'] = img
            print(' OK')
            time.sleep(0.3)
        else:
            print(' FAIL')
            out['cosia'] = None

    # LIDAR
    p = cache_dir / f'{slug}_{side_tag}_n{nx}_lidar.npz'
    if p.exists():
        d = np.load(p)
        if 'mnt' in d.files:
            out['lidar_h'], out['lidar_dom'], out['lidar_mnt'] = (
                d['h'], d['dom'], d['mnt'])
        else:
            p.unlink()  # ancien cache, on refetch
    if 'lidar_h' not in out:
        print(f'    lidar ...', end='', flush=True)
        if vpr.lidar_is_available():
            pts = vpr.fetch_lidar_points(lat, lng, side_m=side_m)
            if pts is not None:
                h, dom, mnt = vpr.lidar_grid_from_points(
                    pts, lat, lng, side_m, nx, nx)
                if h is not None:
                    np.savez(p, h=h, dom=dom, mnt=mnt)
                    out['lidar_h'] = h
                    out['lidar_dom'] = dom
                    out['lidar_mnt'] = mnt
                    print(f' OK (h_max={h.max():.1f}m)')
                else:
                    print(' FAIL grid')
            else:
                print(' FAIL fetch')
        else:
            print(' DOWN')

    # ROUTES BDTOPO
    p = cache_dir / f'{slug}_{side_tag}_routes.json'
    if p.exists():
        out['routes'] = json.loads(p.read_text(encoding='utf-8'))
    else:
        print(f'    routes ...', end='', flush=True)
        g = vpr.fetch_bdtopo_routes(lat, lng, side_m)
        if g is not None:
            p.write_text(json.dumps(g), encoding='utf-8')
            out['routes'] = g
            print(f' OK ({len(g.get("features", []))})')
            time.sleep(0.3)
        else:
            print(' FAIL')
            out['routes'] = None

    # BATI BDTOPO
    p = cache_dir / f'{slug}_{side_tag}_bati.json'
    if p.exists():
        out['bati'] = json.loads(p.read_text(encoding='utf-8'))
    else:
        print(f'    bati ...', end='', flush=True)
        g = vpr.fetch_bdtopo_buildings(lat, lng, side_m)
        if g is not None:
            p.write_text(json.dumps(g), encoding='utf-8')
            out['bati'] = g
            print(f' OK ({len(g.get("features", []))})')
            time.sleep(0.3)
        else:
            print(' FAIL')
            out['bati'] = None

    # PARCELLES CADASTRE
    p = cache_dir / f'{slug}_{side_tag}_cadastre.json'
    if p.exists():
        out['cadastre'] = json.loads(p.read_text(encoding='utf-8'))
    else:
        print(f'    cadastre ...', end='', flush=True)
        g = vpr.fetch_cadastre_parcelles(lat, lng, side_m)
        if g is not None:
            p.write_text(json.dumps(g), encoding='utf-8')
            out['cadastre'] = g
            print(f' OK ({len(g.get("features", []))})')
            time.sleep(0.3)
        else:
            print(' FAIL')
            out['cadastre'] = None

    return out


_VOX_BY_SIDE = {60: 2.0, 120: 4.0, 240: 8.0}


def _vox_for_side(side_m: float) -> float:
    return _VOX_BY_SIDE.get(int(side_m), 2.0)


def render_column(fig, col_idx: int, ncols: int, data: dict,
                  side_m: float, vox: float, label: str):
    """Remplit la colonne col_idx d'un layout 3 lignes x ncols colonnes."""
    nx = data['nx']
    ny = nx
    nz = max(5, int(round(25 / vpr.VOXEL_Z_M)))
    vpr.NX, vpr.NY, vpr.NZ = nx, ny, nz

    img = data.get('ortho')
    cosia_img = data.get('cosia')
    h_grid = data.get('lidar_h')
    dom_grid = data.get('lidar_dom')
    mnt_grid = data.get('lidar_mnt')
    routes_geo = data.get('routes')
    bati_geo = data.get('bati')
    cadastre_geo = data.get('cadastre')

    lat, lng = data['lat'], data['lng']

    # Classifications
    grid_rgb = vpr.grid_classify(img, nx, ny) if img is not None else None
    cosia_grid = (vpr.cosia_grid_classify(cosia_img, nx, ny)
                  if cosia_img is not None else None)
    grid = (vpr.merge_grids(cosia_grid, grid_rgb)
            if grid_rgb is not None else None)

    routes_mask = None
    if routes_geo:
        routes_mask = vpr.routes_to_grid(routes_geo, lat, lng,
                                          side_m, nx, ny)

    rng = np.random.default_rng(hash(label) & 0xFFFF)

    # Voxelize (passe ortho_img + side_m pour couleurs routes a l'aplomb)
    if grid is not None:
        filled, colors = vpr.voxelize(grid, rng, h_grid, dom_grid,
                                       routes_mask,
                                       ortho_img=img, side_m=side_m)
    else:
        filled = np.zeros((nx, ny, nz), dtype=bool)
        colors = np.empty(filled.shape, dtype=object)

    # ----- Rangee 1 : ortho + COSIA overlay + routes BDTOPO en rouge -----
    ax_img = fig.add_subplot(3, ncols, col_idx + 1)
    if img is not None:
        ax_img.imshow(img)
        if cosia_img is not None:
            cosia_pil = Image.fromarray(cosia_img).resize(
                (img.shape[1], img.shape[0]), resample=Image.NEAREST)
            ax_img.imshow(np.array(cosia_pil), alpha=0.35)
        if routes_geo and routes_geo.get('features'):
            half = side_m / 2
            d_lat = half / 111320.0
            d_lng = half / (103900.0 * math.cos(math.radians(lat)))
            for feat in routes_geo['features']:
                geom = feat.get('geometry') or {}
                gtype = geom.get('type')
                if gtype == 'LineString':
                    lines = [geom['coordinates']]
                elif gtype == 'MultiLineString':
                    lines = geom['coordinates']
                else:
                    continue
                for coords in lines:
                    xs = [(c[0] - (lng - d_lng)) / (2 * d_lng) * img.shape[1]
                          for c in coords]
                    ys = [((lat + d_lat) - c[1]) / (2 * d_lat) * img.shape[0]
                          for c in coords]
                    ax_img.plot(xs, ys, color='#ff3344', alpha=0.65,
                                linewidth=1.2)
        ax_img.set_xlim(0, img.shape[1])
        ax_img.set_ylim(img.shape[0], 0)
    ax_img.set_title(label, fontsize=8, pad=2)
    ax_img.axis('off')

    # ----- Rangee 2 : voxel axo + stats par presence (LiDAR/BDTOPO) -----
    ax_vox = fig.add_subplot(3, ncols, ncols + col_idx + 1, projection='3d')
    total = nx * ny
    n_bati_l = int((dom_grid == 6).sum()) if dom_grid is not None else 0
    n_arbre = int(((dom_grid == 5) & (h_grid > 1.5)).sum()) \
        if h_grid is not None and dom_grid is not None else 0
    n_eau = int((dom_grid == 9).sum()) if dom_grid is not None else 0
    n_route = int(routes_mask.sum()) if routes_mask is not None else 0
    n_bati_bd = (len(bati_geo.get('features', [])) if bati_geo else 0)
    parts = []
    if n_bati_l: parts.append(f'bati(L):{100*n_bati_l/total:.0f}%')
    if n_bati_bd: parts.append(f'bati(BD):{n_bati_bd}')
    if n_route: parts.append(f'route:{100*n_route/total:.0f}%')
    if n_arbre: parts.append(f'arbre:{100*n_arbre/total:.0f}%')
    if n_eau: parts.append(f'eau:{100*n_eau/total:.0f}%')
    stat = ' | '.join(parts) or '-'
    # Ajout taille voxel en sous-titre
    vox_label = f'vox {vox:.0f}x{vox:.0f}x{vpr.VOXEL_Z_M:.0f}m'
    title_full = f'{stat}\n{vox_label}'
    vpr.draw_axo(ax_vox, filled, colors, title=title_full,
                 routes_mask=routes_mask)
    # Overlay des LineStrings BDTOPO rouges sur le voxel axo,
    # plaque au terrain LiDAR si dispo (sinon juste au-dessus du sol).
    if routes_geo:
        vpr.overlay_routes_on_axo(ax_vox, routes_geo, lat, lng,
                                   side_m, nx, ny, nz, mnt=mnt_grid)

    # ----- Rangee 3 : maquette 3D -----
    ax_mock = fig.add_subplot(3, ncols, 2 * ncols + col_idx + 1, projection='3d')
    if mnt_grid is not None:
        eau_mask = np.zeros((nx, ny), dtype=bool)
        if grid is not None:
            for ix in range(nx):
                for iy in range(ny):
                    if grid[ix, iy] == 'eau' or (
                            dom_grid is not None and dom_grid[ix, iy] == 9):
                        eau_mask[ix, iy] = True
        vpr.draw_mockup_3d(ax_mock, mnt_grid, h_grid, dom_grid,
                            bati_geo, lat, lng, side_m,
                            eau_mask=(eau_mask if eau_mask.any() else None),
                            ortho_img=img)
        # Cloturres cadastrales 1m sur le terrain (avant routes pour zorder)
        if cadastre_geo:
            vpr.overlay_parcelles_on_mockup_3d(ax_mock, cadastre_geo,
                                                  mnt_grid, lat, lng, side_m)
        # Rubans rouges des routes BDTOPO sur le terrain (altimetrie LiDAR)
        if routes_geo:
            vpr.overlay_routes_on_mockup_3d(ax_mock, routes_geo, mnt_grid,
                                              lat, lng, side_m)
    else:
        ax_mock.set_axis_off()
        ax_mock.text2D(0.5, 0.5, 'Pas de MNT LiDAR',
                       ha='center', va='center',
                       transform=ax_mock.transAxes,
                       fontsize=8, color='#999')


def render_zone_pdf(name: str, lat: float, lng: float, kind: str,
                    output_dir: Path, cache_dir: Path):
    print(f'\n=== {name} ({lat:.4f},{lng:.4f}) - {kind} ===')

    # Fetch toutes les echelles
    datasets = {}
    for side_m, vox, label in ECHELLES:
        print(f'  [echelle {label}]')
        datasets[side_m] = fetch_all(name, lat, lng, side_m, cache_dir)

    # PDF avec 1 page (3x3 layout)
    ts = datetime.datetime.now().strftime('%Y-%m-%dT%H-%M-%S')
    out = output_dir / f'zone_{_slug(name)}_{ts}.pdf'
    out.parent.mkdir(parents=True, exist_ok=True)

    fig = plt.figure(figsize=(14, 10))
    fig.suptitle(f'TerlabGift Saint-Leu  {name}  ({kind})  '
                 f'{lat:.4f}, {lng:.4f}',
                 fontsize=12, fontweight='bold', y=0.97)

    for col_idx, (side_m, vox, label) in enumerate(ECHELLES):
        render_column(fig, col_idx, len(ECHELLES),
                      datasets[side_m], side_m, vox, label)

    fig.text(0.5, 0.04,
             'L1 ortho IGN + COSIA + routes BDTOPO  L2 voxel axo (LiDAR+CHM)  '
             'L3 maquette 3D (terrain MNT + bati BDTOPO + arbres LiDAR + eau)',
             ha='center', fontsize=8, style='italic', color='#555')

    plt.tight_layout(rect=[0, 0.06, 1, 0.95])
    fig.savefig(out, format='pdf', bbox_inches='tight')
    plt.close(fig)
    print(f'  -> {out}')
    return out


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)

    print(f'-> {len(ZONES_18)} zones x {len(ECHELLES)} echelles = '
          f'{len(ZONES_18) * len(ECHELLES)} vues')
    print(f'-> output: {OUTPUT_DIR}')
    print(f'-> cache:  {CACHE_DIR}')

    pdfs = []
    for name, lat, lng, kind in ZONES_18:
        try:
            pdfs.append(render_zone_pdf(name, lat, lng, kind,
                                         OUTPUT_DIR, CACHE_DIR))
        except Exception as e:
            print(f'  !! ERROR on {name}: {e}')
            import traceback
            traceback.print_exc()

    print(f'\n=== {len(pdfs)} PDFs generes ===')
    for p in pdfs:
        print(f'  {p}')


if __name__ == '__main__':
    main()
