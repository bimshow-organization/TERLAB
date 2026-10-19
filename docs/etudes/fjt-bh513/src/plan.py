# Plan masse 1/500 (SVG) — repère maquette : x = est, z = sud (=> y SVG = z, nord en haut)
import json, math
from shapely.geometry import Polygon, LineString, Point, box
from shapely.affinity import rotate, translate

D = json.load(open('city_dump.json')); RD = json.load(open('roads_dump.json')); PRJ = json.load(open('fjt_project_city.json'))
SP = D['species']
DU, VAR, GAL, T1, T2, CORE = 5.9, 1.2, 1.5, 3.4, 7.8, 4.0
HALF = (DU + VAR + GAL) / 2
T1W, T2W, VARW = 3.4, 7.8, 1.9
def seq_de(name, k):
    A = name.endswith('A')
    if k == 1: return [] if A else ['T1', 'T2', 'T1']
    return ['T1', 'T1', 'T1', 'T1', 'T2', 'T1', 'T1', 'T1', 'T2', 'T1', 'T1'] if A else ['T1', 'T1', 'T1', 'T2', 'T1', 'T1', 'T1', 'T1']
def modules(name, k, L, CORE=4.0):
    """[(s0, s1, kind)] le long de la lame depuis l'extremite noyau (s = -L/2) : kind 'var' | 'mur' ; fenetres dans les murs"""
    out, s, flip = [], -L/2 + CORE, False
    for ty in seq_de(name, k):
        w = T1W if ty == 'T1' else T2W; s0, s1 = s, s + w
        if ty == 'T2':
            out += [(s0, s0 + 2.4, 'mur', [s0 + 1.2]), (s0 + 2.4, s1 - 2.4, 'var', []), (s1 - 2.4, s1, 'mur', [s1 - 1.2])]
        elif not flip:
            out += [(s0, s0 + VARW, 'var', []), (s0 + VARW, s1, 'mur', [(s0 + VARW + s1)/2])]
        else:
            out += [(s0, s1 - VARW, 'mur', [(s0 + s1 - VARW)/2]), (s1 - VARW, s1, 'var', [])]
        if ty == 'T1': flip = not flip
        s = s1
    return out


def pts(p, K, ox, oz): return ' '.join('%.1f,%.1f' % ((x - ox)*K, (z - oz)*K) for x, z in p)

def plan(key, fname, W=165, H=118, K=6.0, legend=True, labels=True):
    V = next(v for v in PRJ['variants'] if v['key'] == key) if key else None
    fjt = Polygon(PRJ['fjt']); c = fjt.centroid
    ox, oz = c.x - W/2 + 6, c.y - H/2 + 2
    view = box(ox, oz, ox + W, oz + H)
    E = []
    add = E.append
    # routes
    for r in RD:
        ls = LineString(r['pts'])
        if not ls.intersects(view.buffer(20)): continue
        add('<polyline points="%s" fill="none" stroke="#d9d6d0" stroke-width="%.1f" stroke-linecap="round" stroke-linejoin="round"/>' % (pts(r['pts'], K, ox, oz), max(3.0, r['w'])*K))
    for r in RD:
        ls = LineString(r['pts'])
        if not ls.intersects(view.buffer(20)): continue
        if r['nm'] and ls.length > 40 and ls.intersects(fjt.buffer(40)):
            m = ls.interpolate(0.5, normalized=True); p2 = ls.interpolate(0.52, normalized=True)
            ang = math.degrees(math.atan2(p2.y - m.y, p2.x - m.x));
            if ang > 90: ang -= 180
            if ang < -90: ang += 180
            add('<text x="%.1f" y="%.1f" font-size="8" fill="#8a857c" text-anchor="middle" transform="rotate(%.1f %.1f %.1f)" dy="3">%s</text>' % ((m.x-ox)*K, (m.y-oz)*K, ang, (m.x-ox)*K, (m.y-oz)*K, r['nm'].title()))
    # bâti existant
    for b in D['buildings']:
        pg = Polygon(b['fp'])
        if not pg.intersects(view): continue
        add('<polygon points="%s" fill="#ebe8e2" stroke="#9b968c" stroke-width="0.6"/>' % pts(b['fp'], K, ox, oz))
    # lots
    add('<polygon points="%s" fill="url(#hsidr)" stroke="#6b7fa8" stroke-width="1" stroke-dasharray="6 3"/>' % pts(PRJ['sidr'], K, ox, oz))
    add('<polygon points="%s" fill="#f4f7ee" stroke="none"/>' % pts(PRJ['fjt'], K, ox, oz))
    for b2 in PRJ['b2u']: add('<polygon points="%s" fill="url(#hppr)" stroke="#c0392b" stroke-width="0.6"/>' % pts(b2, K, ox, oz))
    if PRJ['serv']: add('<polygon points="%s" fill="none" stroke="#2a9db0" stroke-width="1" stroke-dasharray="3 2"/>' % pts(PRJ['serv'], K, ox, oz))
    add('<polygon points="%s" fill="none" stroke="#e08a2c" stroke-width="0.9" stroke-dasharray="2 2"/>' % pts(PRJ['env'], K, ox, oz))
    # arbres existants (hors lot FJT si variante)
    for t in D['trees']:
        x, y, z, sp, sc = t[:5]
        if not view.contains(Point(x, z)): continue
        if V and fjt.buffer(0.5).contains(Point(x, z)): continue
        r = SP[sp]['crown']*sc/2
        if r < 1.2: continue
        add('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="#cfdcc0" fill-opacity="0.55" stroke="#9fb08c" stroke-width="0.4"/>' % ((x-ox)*K, (z-oz)*K, r*K))
    if V:
        blocks = V['blocks']
        # jardin central + noue GIEP
        A, B = blocks
        pa, pb = Polygon(A['poly']), Polygon(B['poly'])
        hull = pa.union(pb).convex_hull.difference(pa.buffer(1.2)).difference(pb.buffer(1.2)).intersection(Polygon(PRJ['env']).buffer(2))
        if not hull.is_empty and hull.geom_type == 'Polygon':
            add('<polygon points="%s" fill="#dfe9cf" stroke="#9fb08c" stroke-width="0.5"/>' % pts(list(hull.exterior.coords), K, ox, oz))
        ca, cb = pa.centroid, pb.centroid
        a = math.radians(A['az']); u = (math.sin(a), -math.cos(a))
        mx, mz = (ca.x + cb.x)/2, (ca.y + cb.y)/2
        noue = [(mx - u[0]*20, mz - u[1]*20), (mx + u[0]*20, mz + u[1]*20)]
        add('<polyline points="%s" fill="none" stroke="#6aa8c9" stroke-width="%.1f" stroke-linecap="round" opacity="0.8"/>' % (pts(noue, K, ox, oz), 2.2*K))
        # parking
        if V['parking']:
            p = V['parking'][:4]
            add('<polygon points="%s" fill="#cfccc6" stroke="#8a857c" stroke-width="0.6"/>' % pts(p, K, ox, oz))
            a0, a1, a2, a3 = p; ux, uz = (a1[0]-a0[0])/25, (a1[1]-a0[1])/25; vx, vz = (a3[0]-a0[0])/15, (a3[1]-a0[1])/15
            for i in range(11):
                for t0, t1 in ((0, 5), (10, 15)):
                    x0, z0 = a0[0] + ux*i*2.5 + vx*t0, a0[1] + uz*i*2.5 + vz*t0
                    add('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#fff" stroke-width="0.7"/>' % ((x0-ox)*K, (z0-oz)*K, (x0 + vx*5 - ox)*K, (z0 + vz*5 - oz)*K))
            pc = Polygon(p).centroid
            add('<text x="%.1f" y="%.1f" font-size="8" text-anchor="middle" fill="#444">P · 20 pl.</text>' % ((pc.x-ox)*K, (pc.y-oz)*K + 3))
        # bâtiments : logements + coursive + noyau
        for bl in blocks:
            p = bl['poly'][:4]; cx = sum(q[0] for q in p)/4; cz = sum(q[1] for q in p)/4
            a = math.radians(bl['az']); u = (math.sin(a), -math.cos(a)); n = (-u[1], u[0]); gs = 1 if bl['gallery'] == 'S' else -1; L = bl['len']
            def R(s0, s1, t0, t1): return [(cx + u[0]*s + n[0]*t, cz + u[1]*s + n[1]*t) for s, t in ((s0, t0), (s1, t0), (s1, t1), (s0, t1))]
            tU0, tU1 = sorted((-gs*HALF, -gs*HALF + gs*(DU + VAR))); tG0, tG1 = sorted((gs*HALF - gs*GAL, gs*HALF))
            add('<polygon points="%s" fill="#ffffff" stroke="#222" stroke-width="1.3"/>' % pts(R(-L/2, L/2, tU0, tU1), K, ox, oz))
            add('<polygon points="%s" fill="#d8d4cc" stroke="#222" stroke-width="0.7"/>' % pts(R(-L/2 + CORE, L/2, tG0, tG1), K, ox, oz))
            add('<polygon points="%s" fill="#c9a27a" stroke="#222" stroke-width="1"/>' % pts(R(-L/2, -L/2 + CORE, -HALF, HALF), K, ox, oz))
            tV0, tV1 = sorted((-gs*HALF, -gs*HALF + gs*VAR))
            for (m0, m1, kind, _) in modules(bl['name'], 2, L):
                if kind == 'var': add('<polygon points="%s" fill="#efe6d6" stroke="#222" stroke-width="0.5"/>' % pts(R(m0, m1, tV0, tV1), K, ox, oz))
            s = -L/2 + CORE
            nT2 = 2 if bl['name'].endswith('A') else 1
            seq = ['T1']*(9 if nT2 == 2 else 7); seq = ['T2'] + seq[:len(seq)//2] + (['T2'] if nT2 == 2 else []) + seq[len(seq)//2:]
            for ty in seq[:-1]:
                s += T1 if ty == 'T1' else T2
                add('<polyline points="%s" fill="none" stroke="#888" stroke-width="0.4"/>' % pts(R(s, s, tU0, tU1)[:2] + [R(s, s, tU0, tU1)[2]], K, ox, oz))
            nl = bl['nlev']; lg = 33 if bl['name'].endswith('A') else 27
            txt = '%s · R+%d · %d lgts' % (bl['name'].replace('Batiment ', 'Bât. '), nl - 1, lg)
            ang = bl['az'] - 90
            if labels: add('<text x="%.1f" y="%.1f" font-size="9" font-weight="600" text-anchor="middle" fill="#222" transform="rotate(%.1f %.1f %.1f)" dy="3">%s</text>' % ((cx-ox)*K, (cz-oz)*K, ang, (cx-ox)*K, (cz-oz)*K, txt))
        # arbres projet (haies de limite + jardin) — mêmes règles que la maquette
        blocked = [Polygon(b['poly']) for b in blocks] + ([Polygon(V['parking'])] if V['parking'] else [])
        lot = PRJ['fjt']; P0 = (sum(q[0] for q in lot)/len(lot), sum(q[1] for q in lot)/len(lot))
        for i in range(len(lot) - 1):
            (x0, z0), (x1, z1) = lot[i], lot[i + 1]; Lg = math.hypot(x1 - x0, z1 - z0); d = 3
            while d < Lg - 2:
                x, z = x0 + (x1 - x0)*d/Lg, z0 + (z1 - z0)*d/Lg; cx2, cz2 = P0[0] - x, P0[1] - z; k = 2.2/math.hypot(cx2, cz2); px, pz = x + cx2*k, z + cz2*k
                if not any(bb.buffer(2.0).contains(Point(px, pz)) for bb in blocked):
                    add('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="#b9cf9e" fill-opacity="0.8" stroke="#6e8a55" stroke-width="0.5"/>' % ((px-ox)*K, (pz-oz)*K, 2.6*K))
                d += 7
        for s2 in range(-18, 19, 9):
            x, z = mx + u[0]*s2, mz + u[1]*s2
            add('<circle cx="%.1f" cy="%.1f" r="%.1f" fill="#a9c48c" fill-opacity="0.85" stroke="#5f7a48" stroke-width="0.6"/>' % ((x-ox)*K, (z-oz)*K, 3.6*K))
    if V:
        from shapely.ops import nearest_points
        lotP = Polygon(PRJ['fjt']); sidrP = Polygon(PRJ['sidr'])
        front = lotP.exterior.difference(sidrP.buffer(0.6))          # limites sur le chemin Mille Roches
        def marker(pt, inward, col, lab, anchor_txt='start', dxl=4, dyl=-4):
            # triangle pointant vers l'intérieur du lot, posé sur la limite
            ix, iz = inward; L = math.hypot(ix, iz) or 1; ix, iz = ix / L, iz / L; px, pz = -iz, ix
            tip = (pt.x + ix * 1.5, pt.y + iz * 1.5); b1 = (pt.x - ix * 3.2 + px * 2.2, pt.y - iz * 3.2 + pz * 2.2); b2 = (pt.x - ix * 3.2 - px * 2.2, pt.y - iz * 3.2 - pz * 2.2)
            add('<polygon points="%s" fill="%s" stroke="#fff" stroke-width="0.8"/>' % (pts([tip, b1, b2], K, ox, oz), col))
            tx, tz = (pt.x - ix * 5.0 - ox) * K + dxl, (pt.y - iz * 5.0 - oz) * K + dyl
            add('<text x="%.1f" y="%.1f" font-size="8.5" font-weight="700" fill="%s" text-anchor="%s" style="paint-order:stroke;stroke:#fbfaf7;stroke-width:3px">%s</text>' % (tx, tz, col, anchor_txt, lab))
        def inward_of(pt):
            c = lotP.centroid; return (c.x - pt.x, c.y - pt.y)
        # accès véhicules : point de la limite sur voie le plus proche du parking
        if V['parking']:
            pk = Polygon(V['parking']); _, pv = nearest_points(pk.centroid, front)
            marker(pv, inward_of(pv), '#c0392b', 'ACCÈS VÉHICULES', 'end', -6, 10)
        # entrée piétonne principale : prolongement du jardin (axe de la noue) jusqu'à la limite est/sud-est
        far = LineString([(mx, mz), (mx + u[0] * 120, mz + u[1] * 120)]).intersection(front)
        if not far.is_empty:
            pe = far if far.geom_type == 'Point' else min(far.geoms, key=lambda g: g.distance(Point(mx, mz)))
            marker(pe, (-u[0], -u[1]), '#1f5fa8', 'ENTRÉE PIÉTONS', 'start', 14, 16); add('<text x="%.1f" y="%.1f" font-size="7.5" fill="#1f5fa8" style="paint-order:stroke;stroke:#fbfaf7;stroke-width:3px">accueil par le jardin</text>' % ((pe.x + u[0] * 5.0 - ox) * K + 14, (pe.y + u[1] * 5.0 - oz) * K + 27))
            add('<polyline points="%s" fill="none" stroke="#1f5fa8" stroke-width="1.1" stroke-dasharray="4 3"/>' % pts([(pe.x, pe.y), (mx + u[0] * 21, mz + u[1] * 21)], K, ox, oz))
        # entrée piétonne secondaire : depuis le chemin sud, entre le parking et le bâtiment B
        bw = Polygon(B['poly']); pkc = Polygon(V['parking']).centroid if V['parking'] else bw.centroid
        tgt = Point((pkc.x + bw.centroid.x) / 2, (pkc.y + bw.centroid.y) / 2)
        _, ps = nearest_points(tgt, front)
        marker(ps, inward_of(ps), '#1f5fa8', 'entrée piétons', 'start', 6, 12)
    # contour parcelle BH 513
    add('<polygon points="%s" fill="none" stroke="#111" stroke-width="1.6"/>' % pts(PRJ['parcel'], K, ox, oz))
    if labels:
        s = Polygon(PRJ['sidr']).centroid
        add('<text x="%.1f" y="%.1f" font-size="9" text-anchor="middle" fill="#4a5f8a" transform="rotate(20 %.1f %.1f)">LOT SIDR · ≈ 2 000 m² · 20 LLS (MOE NKN) — hors mission</text>' % ((s.x-ox)*K, (s.y-oz)*K, (s.x-ox)*K, (s.y-oz)*K))
    # nord + échelle
    Wp, Hp = W*K, H*K
    add('<g transform="translate(%.1f,28)"><path d="M0,-16 L6,8 L0,3 L-6,8 Z" fill="#222"/><text y="20" font-size="10" text-anchor="middle">N</text></g>' % (Wp - 26))
    sx, sy = Wp - 20 - 20*K, Hp - 14
    add('<g font-size="8" fill="#333"><rect x="%.1f" y="%.1f" width="%.1f" height="3" fill="#333"/><rect x="%.1f" y="%.1f" width="%.1f" height="3" fill="#fff" stroke="#333" stroke-width=".5"/><text x="%.1f" y="%.1f">0</text><text x="%.1f" y="%.1f" text-anchor="end">20 m</text></g>' % (sx, sy, 10*K, sx + 10*K, sy, 10*K, sx, sy - 3, sx + 20*K, sy - 3))
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.0f %.0f" font-family="Helvetica, Arial, sans-serif">'
           '<defs><pattern id="hsidr" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7" stroke="#b7c3dc" stroke-width="1"/></pattern>'
           '<pattern id="hppr" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="5" stroke="#c0392b" stroke-width="0.8"/></pattern></defs>'
           '<rect width="100%%" height="100%%" fill="#fbfaf7"/>%s</svg>') % (Wp, Hp, ''.join(E))
    open(fname, 'w', encoding='utf-8').write(svg)

if __name__ == '__main__':
    plan(None, 'plan_base.svg')
    for v in PRJ['variants']: plan(v['key'], 'plan_%s.svg' % v['key'])
    print('ok')
