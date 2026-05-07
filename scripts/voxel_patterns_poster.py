#!/usr/bin/env python3
"""
TERLAB . voxel_patterns_poster.py
Poster pedagogique 4 patterns voxel-types pour TerlabGift Saint-Leu.
Vue 3D eclatee : voxels semantiques + carte classifiee + signature CHM.

Usage :
    python voxel_patterns_poster.py [--output docs/voxel-patterns/poster.pdf]
"""

import argparse
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
from matplotlib.patches import Patch
from mpl_toolkits.mplot3d import Axes3D  # noqa: F401  (registers 3d projection)


# ---------------------------------------------------------------------------
# 1. PALETTE SEMANTIQUE
# ---------------------------------------------------------------------------

PALETTE = {
    'sol':         '#C2B280',
    'route':       '#555555',
    'bati_R0':     '#A8967D',
    'bati_R1_R2':  '#8B7765',
    'bati_R3plus': '#4F423A',
    'feuillu':     '#3F7A4D',
    'palme':       '#6BAE5E',
    'arbuste':     '#8FB87F',
    'champ_canne': '#E8D26E',
}

ALPHA_VOX = 0.4
NX, NY, NZ = 20, 20, 16
SLAB_GAP = 5


# ---------------------------------------------------------------------------
# 2. PATTERN GENERATORS (slab 0 = donnee reelle simulee)
# ---------------------------------------------------------------------------

def _empty():
    total_z = NZ * 3 + SLAB_GAP * 2
    filled = np.zeros((NX, NY, total_z), dtype=bool)
    colors = np.empty(filled.shape, dtype=object)
    return filled, colors


def make_forest():
    """Foret des Hauts : densite 55%, hauteurs 5-12 vox, irregulier."""
    rng = np.random.default_rng(1)
    filled, colors = _empty()

    for x in range(NX):
        for y in range(NY):
            filled[x, y, 0] = True
            colors[x, y, 0] = PALETTE['sol']

    for x in range(NX):
        for y in range(NY):
            if rng.random() < 0.55:
                h = int(rng.integers(5, 12))
                sp = rng.choice(['feuillu', 'palme', 'arbuste'], p=[0.55, 0.25, 0.20])
                col = PALETTE[sp]
                for z in range(1, min(1 + h, NZ)):
                    filled[x, y, z] = True
                    colors[x, y, z] = col

    return filled, colors, 'FORET', 'Hauts de Saint-Leu  Bois de Sans-Souci'


def make_fields():
    """Plaine de canne : bandes parcellaires, h=2-3 vox uniforme."""
    rng = np.random.default_rng(2)
    filled, colors = _empty()

    for x in range(NX):
        for y in range(NY):
            filled[x, y, 0] = True
            colors[x, y, 0] = PALETTE['sol']

    for x in range(NX):
        if (x // 5) % 2 == 0:
            for y in range(NY):
                if y % 7 == 0:
                    continue
                filled[x, y, 1] = True
                colors[x, y, 1] = PALETTE['champ_canne']
                if rng.random() < 0.7:
                    filled[x, y, 2] = True
                    colors[x, y, 2] = PALETTE['champ_canne']

    for _ in range(8):
        x = int(rng.integers(0, NX))
        y = int(rng.integers(0, NY))
        h = int(rng.integers(4, 7))
        for z in range(1, 1 + h):
            filled[x, y, z] = True
            colors[x, y, z] = PALETTE['feuillu']

    return filled, colors, 'CHAMPS', 'Plaine de canne  Piton Saint-Leu'


def make_city():
    """Centre-bourg cotier : bati dense R+0 a R+5, voirie tous les 6 vox."""
    rng = np.random.default_rng(3)
    filled, colors = _empty()

    for x in range(NX):
        for y in range(NY):
            filled[x, y, 0] = True
            is_street = (x % 6 == 0) or (y % 6 == 0)
            colors[x, y, 0] = PALETTE['route'] if is_street else PALETTE['sol']
            if is_street:
                continue
            h = int(rng.integers(2, 7))
            if h <= 2:
                col = PALETTE['bati_R0']
            elif h <= 5:
                col = PALETTE['bati_R1_R2']
            else:
                col = PALETTE['bati_R3plus']
            for z in range(1, min(1 + h, NZ)):
                filled[x, y, z] = True
                colors[x, y, z] = col

    return filled, colors, 'VILLE', 'Centre-bourg cotier'


def make_subdivision():
    """Lotissement pavillonnaire : R+0/R+1 regulier + jardins arbores."""
    rng = np.random.default_rng(4)
    filled, colors = _empty()

    for x in range(NX):
        for y in range(NY):
            filled[x, y, 0] = True
            colors[x, y, 0] = PALETTE['sol']

    for cx in range(2, NX - 2, 5):
        for cy in range(2, NY - 2, 5):
            ox = cx + int(rng.integers(-1, 2))
            oy = cy + int(rng.integers(-1, 2))
            h = int(rng.choice([2, 3]))
            col = PALETTE['bati_R0'] if h == 2 else PALETTE['bati_R1_R2']
            for dx in range(2):
                for dy in range(2):
                    x, y = ox + dx, oy + dy
                    if 0 <= x < NX and 0 <= y < NY:
                        for z in range(1, 1 + h):
                            filled[x, y, z] = True
                            colors[x, y, z] = col
            for jx, jy in [(ox - 1, oy + 1), (ox + 2, oy - 1)]:
                if not (0 <= jx < NX and 0 <= jy < NY):
                    continue
                if filled[jx, jy, 1]:
                    continue
                ht = int(rng.integers(3, 6))
                for z in range(1, 1 + ht):
                    filled[jx, jy, z] = True
                    colors[jx, jy, z] = PALETTE['feuillu']

    for y in range(NY):
        colors[NX // 2, y, 0] = PALETTE['route']
    for x in range(NX):
        colors[x, NY // 2, 0] = PALETTE['route']

    return filled, colors, 'LOTISSEMENT', 'Pavillonnaire  Plateau Cailloux'


# ---------------------------------------------------------------------------
# 3. EXPLODED VIEW : empile 3 slabs Z dans la grille
# ---------------------------------------------------------------------------

def make_exploded(filled_real, colors_real):
    full = np.zeros_like(filled_real)
    cols = np.empty(full.shape, dtype=object)

    full[:, :, :NZ] = filled_real[:, :, :NZ]
    cols[:, :, :NZ] = colors_real[:, :, :NZ]

    z1 = NZ + SLAB_GAP
    for x in range(NX):
        for y in range(NY):
            top_color = colors_real[x, y, 0]
            for z in range(NZ - 1, 0, -1):
                if filled_real[x, y, z]:
                    top_color = colors_real[x, y, z]
                    break
            full[x, y, z1] = True
            cols[x, y, z1] = top_color

    z2 = 2 * NZ + 2 * SLAB_GAP
    for x in range(NX):
        max_h = 0
        for y in range(NY):
            for z in range(NZ - 1, 0, -1):
                if filled_real[x, y, z]:
                    if z > max_h:
                        max_h = z
                    break
        yc = NY // 2
        for z in range(max_h):
            full[x, yc, z2 + z] = True
            if z < 3:
                cols[x, yc, z2 + z] = PALETTE['sol']
            elif z < 7:
                cols[x, yc, z2 + z] = PALETTE['feuillu']
            else:
                cols[x, yc, z2 + z] = PALETTE['bati_R1_R2']

    return full, cols


# ---------------------------------------------------------------------------
# 4. RENDU
# ---------------------------------------------------------------------------

def _to_rgba(cols, full):
    rgba = np.zeros(full.shape + (4,))
    flat_idx = np.argwhere(full)
    for ix, iy, iz in flat_idx:
        c = cols[ix, iy, iz]
        if c is None:
            continue
        r, g, b = mcolors.to_rgb(c)
        rgba[ix, iy, iz] = (r, g, b, ALPHA_VOX)
    return rgba


def draw_pattern(ax, pattern_fn):
    filled, colors, title, subtitle = pattern_fn()
    full, cols = make_exploded(filled, colors)
    rgba = _to_rgba(cols, full)

    ax.voxels(full, facecolors=rgba, edgecolor='#222', linewidth=0.18)

    z0 = NZ // 2
    z1 = NZ + SLAB_GAP
    z2 = 2 * NZ + 2 * SLAB_GAP + 4
    ax.text(NX + 1.5, 0, z0, '1  Voxels 5 m classifies',
            fontsize=7, color='#222')
    ax.text(NX + 1.5, 0, z1, '2  Carte semantique aplatie',
            fontsize=7, color='#222')
    ax.text(NX + 1.5, 0, z2, '3  Signature CHM (skyline)',
            fontsize=7, color='#222')

    ax.set_title(f'{title}\n{subtitle}', fontsize=10, fontweight='bold', pad=2)
    ax.set_xticks([0, NX])
    ax.set_yticks([0, NY])
    ax.set_zticks([])
    ax.set_xlabel('250 m', fontsize=6)
    ax.set_ylabel('250 m', fontsize=6)
    ax.tick_params(labelsize=5)
    ax.grid(False)
    ax.view_init(elev=22, azim=-55)


def build_legend(fig):
    items = [
        ('Sol nu', PALETTE['sol']),
        ('Voirie', PALETTE['route']),
        ('Bati R+0', PALETTE['bati_R0']),
        ('Bati R+1/R+2', PALETTE['bati_R1_R2']),
        ('Bati R+3+', PALETTE['bati_R3plus']),
        ('Feuillu', PALETTE['feuillu']),
        ('Palmier', PALETTE['palme']),
        ('Arbuste', PALETTE['arbuste']),
        ('Canne a sucre', PALETTE['champ_canne']),
    ]
    handles = [
        Patch(facecolor=c, edgecolor='#222', alpha=ALPHA_VOX, label=l)
        for l, c in items
    ]
    fig.legend(
        handles=handles, loc='lower center', ncol=5,
        fontsize=8, frameon=False, bbox_to_anchor=(0.5, 0.01),
    )


# ---------------------------------------------------------------------------
# 5. MAIN
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description='TERLAB voxel patterns poster')
    p.add_argument(
        '--output',
        default='docs/voxel-patterns/voxel-patterns-poster.pdf',
        help='Chemin PDF sortie',
    )
    args = p.parse_args()

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)

    fig = plt.figure(figsize=(11.69, 8.27))  # A4 paysage
    fig.suptitle(
        'TerlabGift Saint-Leu  4 patterns voxel-types  Vue 3D eclatee',
        fontsize=13, fontweight='bold', y=0.97,
    )

    patterns = [make_forest, make_fields, make_city, make_subdivision]
    for i, pf in enumerate(patterns, start=1):
        ax = fig.add_subplot(2, 2, i, projection='3d')
        draw_pattern(ax, pf)

    build_legend(fig)

    fig.text(
        0.5, 0.045,
        "Couches d'analyse  1 voxels classifies (5 m, alpha 0.4)  "
        '2 carte semantique aplatie  3 signature hauteurs (CHM)',
        ha='center', fontsize=7, style='italic', color='#555',
    )

    plt.tight_layout(rect=[0, 0.07, 1, 0.95])
    fig.savefig(out, format='pdf', bbox_inches='tight')
    plt.close(fig)
    print(f'[OK] Poster ecrit: {out}')


if __name__ == '__main__':
    main()
