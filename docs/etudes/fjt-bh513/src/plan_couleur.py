# Plan masse coloré 1/500 : rendu orthographique de la maquette (fond) + calque d'étiquettes dans le MÊME repère (mètres maquette)
# Image : W×H px à MPP m/px centrée sur (cx, cz) → viewBox SVG = [cx − W·MPP/2, cz − H·MPP/2, W·MPP, H·MPP]  (x est, z sud = y SVG)
import json, math
from PIL import Image
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import nearest_points

M = json.load(open('ortho_meta.json')); PRJ = json.load(open('fjt_project_city.json'))
W, H = M['W'] * M['mpp'], M['H'] * M['mpp']; X0, Z0 = M['cx'] - W / 2, M['cz'] - H / 2
P = lambda pts: ' '.join('%.2f,%.2f' % (x, z) for x, z in pts)

def txt(x, z, s, size=1.7, anchor='middle', color='#1b1b1b', weight=600, halo='#fff', rot=0):
    tr = ' transform="rotate(%.1f %.2f %.2f)"' % (rot, x, z) if rot else ''
    return '<text x="%.2f" y="%.2f" font-size="%.2f" font-weight="%d" text-anchor="%s" fill="%s" style="paint-order:stroke;stroke:%s;stroke-width:%.2fpx"%s>%s</text>' % (x, z, size, weight, anchor, color, halo, size * 0.28, tr, s)

def plan(key, img, out):
    V = next(v for v in PRJ['variants'] if v['key'] == key)
    Image.open(img).convert('RGB').save(out.replace('.svg', '.jpg'), quality=88)
    E = ['<image href="%s" x="%.2f" y="%.2f" width="%.2f" height="%.2f" preserveAspectRatio="none"/>' % (out.replace('.svg', '.jpg').split('/')[-1], X0, Z0, W, H)]
    lot, par, sidr = Polygon(PRJ['fjt']), Polygon(PRJ['parcel']), Polygon(PRJ['sidr'])
    # limites
    E.append('<polygon points="%s" fill="#b7c6ea" fill-opacity="0.25" stroke="#dfe7ff" stroke-width="0.35" stroke-dasharray="1.6 0.9"/>' % P(PRJ['sidr']))
    E.append('<polygon points="%s" fill="none" stroke="#ff8a1f" stroke-width="0.7"/>' % P(PRJ['fjt']))
    E.append('<polygon points="%s" fill="none" stroke="#ffffff" stroke-width="0.35"/>' % P(PRJ['parcel']))
    # bâtiments projet : teinte + contour (plan coloré)
    a = math.radians(110); u = (math.sin(a), -math.cos(a))
    for b in V['blocks']:
        pg = Polygon(b['poly']); c = pg.centroid
        E.append('<polygon points="%s" fill="%s" fill-opacity="0.55" stroke="#2b1a0c" stroke-width="0.35"/>' % (P(b['poly'][:4]), '#d9853b' if b['name'].endswith('A') else '#c7663b'))
        A = b['name'].endswith('A'); ang = b['az'] - 90
        E.append(txt(c.x, c.y - 0.2, 'BÂT. %s · R+3 · %d logements' % ('A' if A else 'B', 33 if A else 27), 1.9, rot=ang))
        E.append(txt(c.x, c.y + 2.2, ('RDC : accueil, bureaux MLE, salle collective, laverie' if A else 'RDC : 3 logements PMR + locaux associés'), 1.35, weight=400, rot=ang))
    # jardin / noue
    A, B = [Polygon(b['poly']) for b in V['blocks']]
    mx, mz = (A.centroid.x + B.centroid.x) / 2, (A.centroid.y + B.centroid.y) / 2
    E.append('<polyline points="%s" fill="none" stroke="#5aa6d6" stroke-width="1.6" stroke-linecap="round" stroke-opacity="0.8"/>' % P([(mx - u[0] * 20, mz - u[1] * 20), (mx + u[0] * 20, mz + u[1] * 20)]))
    E.append(txt(mx + u[0] * 2, mz + u[1] * 2 - 1.4, 'jardin central · noue GIEP', 1.5, color='#0f4c6e', weight=600, rot=110 - 90))
    # parking
    PL = V.get('parkingLayout')
    if PL:
        pc = Polygon(PL['zone']).centroid
        E.append(txt(pc.x, pc.y, 'P · %d places dont %d PMR' % (PL['stalls'], PL['pmr']), 1.6))
    # entrées (triangles orientés vers l'intérieur) — mêmes règles que le plan masse
    front = lot.exterior.difference(sidr.buffer(0.6))
    def marker(pt, inward, col, lab, dx=0, dz=-3.2, anchor='middle'):
        ix, iz = inward; L = math.hypot(ix, iz) or 1; ix, iz = ix / L, iz / L; px, pz = -iz, ix
        tip = (pt.x + ix * 1.2, pt.y + iz * 1.2); b1 = (pt.x - ix * 2.4 + px * 1.6, pt.y - iz * 2.4 + pz * 1.6); b2 = (pt.x - ix * 2.4 - px * 1.6, pt.y - iz * 2.4 - pz * 1.6)
        E.append('<polygon points="%s" fill="%s" stroke="#fff" stroke-width="0.25"/>' % (P([tip, b1, b2]), col))
        E.append(txt(pt.x - ix * 4 + dx, pt.y - iz * 4 + dz, lab, 1.5, anchor=anchor, color=col, weight=700))
    cen = lot.centroid; inw = lambda p: (cen.x - p.x, cen.y - p.y)
    if PL:
        _, pv = nearest_points(Polygon(PL['zone']).centroid, front); marker(pv, inw(pv), '#c0392b', 'ACCÈS VÉHICULES', -1, -2.5, 'end')
    far = LineString([(mx, mz), (mx + u[0] * 120, mz + u[1] * 120)]).intersection(front)
    if not far.is_empty:
        pe = far if far.geom_type == 'Point' else min(far.geoms, key=lambda g: g.distance(Point(mx, mz)))
        marker(pe, (-u[0], -u[1]), '#1f5fa8', 'ENTRÉE PIÉTONS · accueil', 3, 3, 'start')
    tgt = Point((Polygon(PL['zone']).centroid.x + B.centroid.x) / 2, (Polygon(PL['zone']).centroid.y + B.centroid.y) / 2) if PL else B.centroid
    _, ps = nearest_points(tgt, front); marker(ps, inw(ps), '#1f5fa8', 'entrée piétons', 0, 3.5)
    # étiquettes de contexte
    s = sidr.centroid; E.append(txt(s.x, s.y, 'LOT SIDR · 20 LLS (MOE NKN) — hors mission', 1.5, color='#23355e', weight=600, rot=20))
    # nord, échelle 1/500, titre
    nx, nz = X0 + W - 6, Z0 + 8
    E.append('<g transform="translate(%.2f,%.2f)"><path d="M0,-4 L1.6,2 L0,1 L-1.6,2 Z" fill="#fff" stroke="#111" stroke-width="0.2"/>%s</g>' % (nx, nz, txt(0, 5, 'N', 1.8)))
    sx, sz = X0 + W - 30, Z0 + H - 5
    E.append('<rect x="%.2f" y="%.2f" width="26" height="4.2" fill="#fff" fill-opacity="0.85"/>' % (sx - 1.5, sz - 2.8))
    for i in range(4): E.append('<rect x="%.2f" y="%.2f" width="5" height="0.8" fill="%s" stroke="#111" stroke-width="0.12"/>' % (sx + 5 * i, sz, '#111' if i % 2 == 0 else '#fff'))
    E.append(txt(sx, sz - 0.6, '0', 1.3, weight=400, halo='#fff') + txt(sx + 20, sz - 0.6, '20 m', 1.3, weight=400) + txt(sx + 22.5, sz + 0.8, '1/500', 1.5, anchor='start'))
    # légende
    lx, lz = X0 + 3, Z0 + H - 17
    E.append('<rect x="%.2f" y="%.2f" width="44" height="15" fill="#fff" fill-opacity="0.9" stroke="#999" stroke-width="0.1"/>' % (lx - 1, lz - 2.2))
    items = [('#ff8a1f', 'line', 'assiette FJT (hypothèse ≈ 2 960 m²)'), ('#ffffff', 'line', 'parcelle BH 513'), ('#d9853b', 'fill', 'bâtiments FJT R+3 (toiture monopente)'),
             ('#5aa6d6', 'line', 'noue paysagère GIEP'), ('#c0392b', 'tri', 'accès véhicules'), ('#1f5fa8', 'tri', 'entrées piétonnes')]
    for i, (c, k, lab) in enumerate(items):
        y = lz + i * 2.2
        if k == 'line': E.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" stroke-width="0.6"/>' % (lx, y, lx + 3, y, '#999' if c == '#ffffff' else c))
        elif k == 'fill': E.append('<rect x="%.2f" y="%.2f" width="3" height="1.4" fill="%s" stroke="#2b1a0c" stroke-width="0.12"/>' % (lx, y - 0.7, c))
        else: E.append('<polygon points="%s" fill="%s"/>' % (P([(lx + 1.5, y - 0.8), (lx + 3, y + 0.7), (lx, y + 0.7)]), c))
        E.append('<text x="%.2f" y="%.2f" font-size="1.3" fill="#222">%s</text>' % (lx + 4, y + 0.45, lab))
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%.2f %.2f %.2f %.2f" font-family="Helvetica, Arial, sans-serif" style="width:384mm;height:249.6mm;display:block">%s</svg>' % (X0, Z0, W, H, ''.join(E))
    open(out, 'w', encoding='utf-8').write(svg)
    print(out, 'OK — 1/500 : %.1f × %.1f m sur 384 × 249,6 mm' % (W, H))

plan('V1', 'ortho_V1.png', 'report/plan_couleur_V1.svg')
plan('V3', 'ortho_V3.png', 'report/plan_couleur_V3.svg')
