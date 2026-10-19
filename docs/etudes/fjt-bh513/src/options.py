# Planche intermédiaire : familles d'implantation + typologies de logements (même enveloppe Ue, même programme 60 lgts)
import json, math
from shapely.geometry import Polygon, box, Point
from shapely.affinity import rotate, translate

B = json.load(open('fjt_base.json')); V = json.load(open('fjt_variants.json'))
par, sidr, fjt, env = (Polygon(B[k]) for k in ('par', 'sidr', 'fjt', 'env'))
b2u = [Polygon(p) for p in B['b2u']]
LOT = fjt.area

def bar(cx, cy, L, az, d):
    r = box(-L/2, -d/2, L/2, d/2); return translate(rotate(r, 90 - az, origin=(0, 0)), cx, cy)

def search(shapes, min_gap, score, xs=range(-50, 32, 2), ys=range(-38, 16, 2), avoid=()):
    """place successivement chaque forme (L, d, az) dans l'enveloppe, écart >= min_gap, maximise score"""
    placed = []
    for (L, d, az, pref) in shapes:
        best = None
        for x in xs:
            for y in ys:
                f = bar(x, y, L, az, d)
                if not f.within(env) or any(f.distance(p) < min_gap for p in placed) or any(f.intersects(a) for a in avoid): continue
                s = pref(f)
                if best is None or s > best[0]: best = (s, f)
        if not best: return None
        placed.append(best[1])
    return placed

PK = Polygon(V[0]['parking'])            # parking commun (ouest, sur la servitude)
AV = [PK.buffer(1.5)]
N = lambda f: f.centroid.y; S = lambda f: -f.centroid.y; E = lambda f: f.centroid.x; W = lambda f: -f.centroid.x

opts = []
def add(key, titre, fps, niveaux, lgts, notes, retenu=False, rythme=''):
    if not fps: print(key, 'NON FAISABLE'); opts.append({'key': key, 'titre': titre, 'ok': False, 'notes': notes}); return
    emp = sum(f.area for f in fps); gaps = [fps[i].distance(fps[j]) for i in range(len(fps)) for j in range(i + 1, len(fps))]
    imper = emp + PK.area + 0.12 * LOT
    opts.append({'key': key, 'titre': titre, 'ok': True, 'retenu': retenu, 'fps': [list(f.exterior.coords) for f in fps], 'niveaux': niveaux, 'lgts': lgts,
                 'emprise': round(emp), 'emprise_pct': round(100 * emp / LOT), 'gap': round(min(gaps), 1) if gaps else None,
                 'perm': round(100 * (1 - imper / LOT)), 'nb': 1 if key == 'O3' else len(fps), 'notes': notes})
    print(key, titre, 'emprise', round(emp), 'gap', opts[-1]['gap'], 'perm', opts[-1]['perm'])

# 1 & 2 : variantes étudiées (lames 8,60 m, coursives sur jardin)
for v, k, t, r in ((V[0], 'O1', 'Deux lames parallèles, jardin central', True), (V[1], 'O2', 'Lames décalées en redents', False)):
    add(k, t, [Polygon(b['poly']) for b in v['blocks']], 'R+3', 60,
        ['Coursives sur jardin, logements mono-orientés + varangue', 'Ventilation traversante par imposte sur coursive', 'Jardin central ≈ 10 m (noue GIEP)'], r)
# 3 : bâtiment en T — lame nord + aile perpendiculaire (un seul volume)
def s3():
    from shapely.ops import unary_union
    A = search([(50.2, 8.6, 110, N)], 0, None, avoid=AV)[0]
    for Lw in (30, 27, 24):
        for x in range(-50, 32):
            for y in range(-40, 16):
                w = bar(x, y, Lw, 200, 8.6)
                if w.within(env) and not w.intersects(AV[0]) and w.intersection(A.buffer(0.2)).area > 1 and unary_union([A, w]).geom_type == 'Polygon':
                    return [A, w]
    return None
add('O3', 'Bâtiment en T (un seul volume)', s3(), 'R+3', 60, ['Un seul bâtiment : 1 noyau, gestion simplifiée', 'Angles intérieurs : logements peu ventilés, vis-à-vis', 'Jardin coupé en deux cours'])
# 4 : lame unique à couloir central (épaisseur 13,2 m)
add('O4', 'Lame unique à couloir central', search([(46, 13.2, 110, lambda f: N(f) + 0.2 * E(f))], 0, None, avoid=AV), 'R+3', 60,
    ['Compacité maximale, un seul noyau, emprise mini', 'Logements mono-orientés sans ventilation traversante (RTAA DOM)', 'Couloir intérieur à éclairer / ventiler : à éviter en climat tropical'])
# 5 : plots — testés : aucune combinaison de 2-3 plots 15 × 15 m à 8 m de prospect n'entre dans l'enveloppe avec le parking
add('O5', 'Plots (2 à 3 plots 15 × 15 m)', None, 'R+3', 60,
    ['Testé : profondeur constructible ≈ 36 m < lame 8,6 + 8 m + plot 15 m', 'Aucune combinaison de plots à 8 m de prospect avec le parking', 'Écarté (supposerait R+4 ou parking réduit)'])
json.dump(opts, open('options.json', 'w'), indent=1)

# ── vignettes SVG ──
def thumb(o, K=2.6):
    x0, y0, x1, y1 = par.bounds; W, H = (x1 - x0 + 8) * K, (y1 - y0 + 8) * K
    P = lambda pts: ' '.join('%.1f,%.1f' % ((x - x0 + 4) * K, (y1 - y + 4) * K) for x, y in pts)
    g = ['<polygon points="%s" fill="url(#hs)" stroke="#8a9ac0" stroke-width="0.6"/>' % P(sidr.exterior.coords),
         '<polygon points="%s" fill="#f1f5ea" stroke="none"/>' % P(fjt.exterior.coords),
         '<polygon points="%s" fill="none" stroke="#e08a2c" stroke-width="0.6" stroke-dasharray="2 2"/>' % P(env.exterior.coords),
         '<polygon points="%s" fill="#d6d3cc" stroke="#999" stroke-width="0.4"/>' % P(PK.exterior.coords)]
    g += ['<polygon points="%s" fill="url(#hr)" stroke="none"/>' % P(b.exterior.coords) for b in b2u]
    if o.get('ok'):
        for f in o['fps']: g.append('<polygon points="%s" fill="%s" stroke="#222" stroke-width="0.9"/>' % (P(f), '#c98f55' if o.get('retenu') else '#e0cdb0'))
    else:
        g.append('<text x="%.0f" y="%.0f" font-size="11" text-anchor="middle" fill="#c0392b">non faisable</text>' % (W / 2, H / 2))
    g.append('<polygon points="%s" fill="none" stroke="#111" stroke-width="1.1"/>' % P(par.exterior.coords))
    return ('<svg viewBox="0 0 %.0f %.0f" style="width:100%%;height:auto"><defs><pattern id="hs" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line y2="5" stroke="#c5cde3" stroke-width="0.8"/></pattern>'
            '<pattern id="hr" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line y2="4" stroke="#c0392b" stroke-width="0.6"/></pattern></defs>%s</svg>') % (W, H, ''.join(g))

# ── typologies T1 (schémas 1/100 : trame 3,40 m) ──
def typo(kind):
    K = 14; E = []
    R = lambda x, y, w, h, fill, lab='': E.append('<rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill="%s" stroke="#333" stroke-width="0.7"/>%s' % (x*K, y*K, w*K, h*K, fill,
        ('<text x="%.1f" y="%.1f" font-size="7" text-anchor="middle" fill="#333">%s</text>' % ((x + w/2)*K, (y + h/2)*K + 2.5, lab)) if lab else ''))
    if kind == 'coursive':      # 3,40 × 5,90 + varangue 1,20 + coursive 1,50
        R(0, 0, 3.4, 1.5, '#e9e9e4', 'coursive'); R(0, 1.5, 1.6, 2.0, '#dfe8ef', 'sde'); R(1.6, 1.5, 1.8, 2.0, '#f3ead8', 'kitch.'); R(0, 3.5, 3.4, 3.9, '#fbf6ec', 'pièce 20 m²'); R(1.5, 7.4, 1.9, 1.2, '#e6c9a0', 'var.'); R(0, 7.4, 1.5, 1.2, '#c98f55')
    elif kind == 'couloir':
        R(0, 0, 3.4, 5.9, '#fbf6ec', 'T1'); R(0, 5.9, 3.4, 1.4, '#e9e9e4', 'couloir'); R(0, 7.3, 3.4, 5.9, '#fbf6ec', 'T1')
    elif kind == 'angle':
        R(0, 0, 4.2, 4.8, '#fbf6ec', 'T1 angle'); R(4.2, 0, 2.2, 2.2, '#e9e9e4', 'palier'); R(4.2, 2.2, 2.2, 2.6, '#dfe8ef', 'sde'); R(0, 4.8, 2.0, 1.4, '#e6c9a0', 'var.')
    elif kind == 'traversant':  # T1' traversant 2,90 × 8,60, desservi par palier (2 lgts / palier)
        R(0, 0, 2.9, 1.2, '#e6c9a0', 'var.'); R(0, 1.2, 2.9, 3.6, '#fbf6ec', 'pièce'); R(0, 4.8, 1.4, 1.8, '#dfe8ef', 'sde'); R(1.4, 4.8, 1.5, 1.8, '#f3ead8', 'k'); R(0, 6.6, 2.9, 2.0, '#fbf6ec', 'coin nuit')
    x1 = max(float(e.split('x="')[1].split('"')[0]) + float(e.split('width="')[1].split('"')[0]) for e in E) + 4
    y1 = max(float(e.split('y="')[1].split('"')[0]) + float(e.split('height="')[1].split('"')[0]) for e in E) + 4
    return '<svg viewBox="-2 -2 %.0f %.0f" style="height:34mm;width:auto">%s</svg>' % (x1, y1, ''.join(E))

TYPOS = [
 ('coursive', 'T1 sur coursive + varangue intégrée', True, ['20 m² + varangue 2,3 m²', 'ventilation traversante (imposte sur coursive)', 'coursive = lieu de rencontre, contrôle social', 'retenu']),
 ('couloir', 'T1 sur couloir central', False, ['lame épaisse 13,2 m, très compacte', 'mono-orienté, pas de ventilation traversante', 'couloir intérieur à climatiser/éclairer']),
 ('angle', 'T1 d\'angle en plot', False, ['bi-orienté, varangue d\'angle', '4 à 6 lgts par palier', 'noyaux plus nombreux (coût, gestion)']),
 ('traversant', 'T1\' traversant sur palier', False, ['2 lgts / palier : pas de coursive', 'traversant idéal, mais noyaux ×3', 'surface ≈ 25 m² (hors cible 20 m²)']),
]
json.dump({'thumbs': {o['key']: thumb(o) for o in opts}, 'typos': [(k, t, r, n, typo(k)) for k, t, r, n in TYPOS]}, open('options_svg.json', 'w'))
print('ok')
