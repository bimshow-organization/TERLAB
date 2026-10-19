# FJT Mille Roches BH 513 — decoupage hypothetique + variantes d'implantation
# Repere local (m) : origine lon0/lat0, x = est, y = nord (converti en lon/lat en sortie)
import json, math
from shapely.geometry import Polygon, LineString, Point, box
from shapely.affinity import rotate, translate
from shapely import wkt as W
from shapely.ops import split, unary_union

lon0, lat0 = 55.64997, -20.97108
kx = 111320 * math.cos(math.radians(lat0)); ky = 110540
to_ll = lambda x, y: (lon0 + x / kx, lat0 + y / ky)

par = Polygon(json.load(open('parcel_local.json')))
ppr = json.load(open('ppr_on_parcel.json'))
b2u = unary_union([W.loads(p['wkt']) for p in ppr if p['code'] == 'B2u'])

# ── programme ───────────────────────────────────────────────
T1W, T2W, CORE, DEPTH_U, GAL = 3.40, 7.80, 4.00, 5.90 + 1.20, 1.50   # 5,90 logement + 1,20 varangue integree
DEPTH = DEPTH_U + GAL            # 7.40 m (lame simple orientation + coursive)
HN = 3.00                         # hauteur d'etage
RDC_RAISE = 0.60                  # plancher RDC cale au-dessus de la cote de reference (B3, a confirmer)
SU = {'T1': 20.0, 'T2': 46.0}

# ── decoupage : bande nord SIDR ~2000 m2 parallele a la limite nord (az 110) ──
nA, nB = (-36.7, 39.0), (52.0, 6.6)
ux, uy = (nB[0]-nA[0]), (nB[1]-nA[1]); L = math.hypot(ux, uy); ux, uy = ux/L, uy/L
nx, ny = uy, -ux                  # normale vers le sud (interieur)
def cut_at(d):
    p0 = (nA[0] + nx*d - ux*200, nA[1] + ny*d - uy*200); p1 = (nA[0] + nx*d + ux*200, nA[1] + ny*d + uy*200)
    parts = split(par, LineString([p0, p1])).geoms
    north = [g for g in parts if g.centroid.y*1 > (nA[1]+ny*d) - 999 and g.distance(LineString([nA, nB])) < 0.5]
    return north[0], [g for g in parts if g not in north][0]
lo, hi = 5, 40
for _ in range(50):
    m = (lo+hi)/2; n, s = cut_at(m)
    if n.area < 2000: lo = m
    else: hi = m
sidr, fjt = cut_at((lo+hi)/2)
print('SIDR %.0f m2 | FJT %.0f m2 | profondeur bande %.1f m' % (sidr.area, fjt.area, (lo+hi)/2))

# servitude reseaux : bande 4 m le long de la limite ouest du lot FJT (SIDR -> chemin Mille Roches, point bas sud-ouest)
west = LineString([(-52.5, -5.1), (-36.7, 39.0)])
serv = fjt.intersection(west.buffer(4.0, cap_style=2)).intersection(fjt)

# enveloppe constructible (hypothese PLU UC 2019 en attendant PLU 07/25) :
# voie 4 m (limites S/SE/O sur chemin Mille Roches), separatives 3 m (limite SIDR), hors B2u, hors servitude
road_side = par.exterior.difference(LineString([nA, nB]).buffer(0.5))
env = fjt.difference(road_side.buffer(3.0)).difference(sidr.buffer(4.0))   # PLU 2025 Ue : voie 3 m, limites 4 m.difference(b2u.buffer(1.0)).difference(serv)
env = max(env.geoms, key=lambda g: g.area) if env.geom_type == 'MultiPolygon' else env
print('Enveloppe constructible %.0f m2' % env.area)

def bar(cx, cy, length, az_deg, depth=DEPTH):
    """rectangle centre (cx,cy), grand axe selon azimut boussole az_deg"""
    r = box(-length/2, -depth/2, length/2, depth/2)
    return translate(rotate(r, 90 - az_deg, origin=(0, 0)), cx, cy)

AZ = 110  # axe de la parcelle (limite nord)
def levels(spec):  # spec: liste de niveaux {T1:n, T2:m} ; None = RDC communs
    return spec

BLD_A = {'name': 'Batiment A', 'len': 9*T1W + 2*T2W + CORE, 'levels': [None, {'T1': 9, 'T2': 2}, {'T1': 9, 'T2': 2}, {'T1': 9, 'T2': 2}],
         'rdc': 'Accueil, bureau gestionnaire MLE, salle collective, laverie, local velos'}
BLD_B = {'name': 'Batiment B', 'len': 7*T1W + 1*T2W + CORE, 'levels': [{'T1': 2, 'T2': 1, 'pmr': True}, {'T1': 7, 'T2': 1}, {'T1': 7, 'T2': 1}, {'T1': 7, 'T2': 1}],
         'rdc': '3 logements PMR, local poubelles, local technique'}

def place_variant(key, label, blocks, parking_rect, note):
    out = {'key': key, 'label': label, 'note': note, 'blocks': [], 'ok': True, 'warn': []}
    fps = []
    for spec, (cx, cy, az) in blocks:
        fp = bar(cx, cy, spec['len'], az)
        inside = fp.difference(env).area
        if inside > 0.5: out['warn'].append('%s deborde de l\'enveloppe de %.1f m2' % (spec['name'], inside)); out['ok'] = False
        fps.append(fp)
        out['blocks'].append({'name': spec['name'], 'az': az, 'len': round(spec['len'], 2), 'depth': DEPTH, 'nlev': len(spec['levels']),
                              'levels': spec['levels'], 'rdc': spec['rdc'], 'poly': [list(map(lambda v: round(v, 2), c)) for c in fp.exterior.coords]})
    if len(fps) == 2:
        gap = fps[0].distance(fps[1]); out['gap'] = round(gap, 1)
        if gap < 8: out['warn'].append('prospect entre batiments %.1f m < 8 m' % gap); out['ok'] = False
    pk = bar(*parking_rect) if parking_rect else None
    if pk is not None:
        out['parking'] = [list(map(lambda v: round(v, 2), c)) for c in pk.exterior.coords]
        if pk.difference(fjt).area > 0.5: out['warn'].append('parking hors lot'); out['ok'] = False
        if any(pk.intersects(f) for f in fps): out['warn'].append('parking chevauche un batiment'); out['ok'] = False
    emprise = sum(f.area for f in fps)
    imper = emprise + (pk.area if pk is not None else 0) + 0.12 * fjt.area   # + voirie/cheminements (12 % forfait)
    out['emprise'] = round(emprise); out['imper'] = round(imper); out['perm_pct'] = round(100 * (1 - imper / fjt.area))
    return out

# centres choisis a la main dans l'enveloppe (verifies par le script)
c = env.centroid
print('centroid env', c.x, c.y, 'bounds', [round(v, 1) for v in env.bounds])
json.dump({'par': list(par.exterior.coords), 'sidr': list(sidr.exterior.coords), 'fjt': list(fjt.exterior.coords),
           'env': list(env.exterior.coords), 'b2u': [list(g.exterior.coords) for g in (b2u.geoms if hasattr(b2u, 'geoms') else [b2u])],
           'serv': list(serv.exterior.coords) if not serv.is_empty else []}, open('fjt_base_var.json', 'w'))


# ── recherche de placement : parking fixe d'abord, puis batiments ──
roads_zone = fjt.intersection(road_side.buffer(10.0))
def park_cands(corner, azs):
    free = fjt.difference(b2u.buffer(1))
    out = []
    for x in range(-56, 40, 2):
        for y in range(-42, 20, 2):
            for a in azs:
                r = bar(x, y, 25.0, a, depth=15.0)
                if r.within(free) and r.intersects(roads_zone): out.append((Point(x, y).distance(Point(*corner)), (x, y, 25.0, a, 15.0)))
    out.sort(); return [c for _, c in out[:6]]

def search(azsA, azsB, gap_rng, prefer, pk):
    pkg = bar(*pk).buffer(1.5); best = None
    xs = range(-50, 32); ys = range(-36, 16)
    def cands(L, azs):
        return [(x, y, a) for a in azs for x in xs for y in ys if (lambda f: f.within(env) and not f.intersects(pkg))(bar(x, y, L, a))]
    cA, cB = cands(BLD_A['len'], azsA), cands(BLD_B['len'], azsB)
    for (ax, ay, aa) in cA:
        fa = bar(ax, ay, BLD_A['len'], aa)
        for (bx, by, ba) in cB:
            fb = bar(bx, by, BLD_B['len'], ba); g = fa.distance(fb)
            if not (gap_rng[0] <= g <= gap_rng[1]): continue
            s = prefer(fa, fb, g)
            if best is None or s > best[0]: best = (s, (ax, ay, aa), (bx, by, ba))
    return best

VARS = {
 'V1': ('Deux lames paralleles, jardin central', [110], [110], (9, 20), (-48, -10), [334, 20],
        lambda fa, fb, g: -abs(g - 11) + 0.3 * fb.centroid.x),
 'V3': ('Lames decalees en redents', [110], [100, 105], (9, 20), (-48, -10), [334, 20],
        lambda fa, fb, g: -abs(g - 10) - abs((fb.centroid.x - fa.centroid.x) - 10) * 0.3),
}
res = []
for k, (lab, azA, azB, gr, corner, pazs, pref) in VARS.items():
    done = False
    for pk in park_cands(corner, pazs):
        b = search(azA, azB, gr, pref, pk)
        if not b: continue
        _, (ax, ay, aa), (bx, by, ba) = b
        v = place_variant(k, lab, [(BLD_A, (ax, ay, aa)), (BLD_B, (bx, by, ba))], pk, '')
        print(k, lab, 'A', (ax, ay, aa), 'B', (bx, by, ba), 'gap', v.get('gap'), 'pk', pk[:2], pk[3], 'perm%', v['perm_pct'], v['warn'])
        res.append(v); done = True; break
    if not done: print(k, 'AUCUNE SOLUTION')
json.dump(res, open('fjt_variants_var.json', 'w'), indent=1)
