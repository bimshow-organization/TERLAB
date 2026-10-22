# Coupe AA et façades urbaines en contexte, au style de sections_v2.py (ind 0), alimentées par la planche BVE de l'ind 1 :
# terrain = maillage GLB de la maquette, voisins et arbres = pcmi.json, projet = pcmi.blocks (RDC, égout) + faîtage lu dans les pièces dessinées.
# Repère : x est, z sud, y = altitude − alt0 ; cotes affichées en m NGR.
import math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shapely.geometry import Polygon, LineString
import ind1_data as D
import facade_glb as GL

ALT0 = D.ALT0; th = D.terrain(); BAY = 3.6; OV = 0.8; TAN = math.tan(math.radians(22))

class Dr:
    def __init__(s, O, v, span, depth, K=4.0):
        s.O, s.v, s.span, s.depth, s.K = O, v, span, depth, K; s.right = (-v[1], v[0]); s.el = []
    def S(s, x, z): return (x - s.O[0]) * s.right[0] + (z - s.O[1]) * s.right[1]
    def T(s, x, z): return (x - s.O[0]) * s.v[0] + (z - s.O[1]) * s.v[1]
    def P(s, sv, y): return ((sv - s.span[0]) * s.K, (s.yhi - y) * s.K)
    def poly(s, pts, **a): s.el.append('<polygon points="%s" %s/>' % (' '.join('%.1f,%.1f' % s.P(*q) for q in pts), s.at(a)))
    def line(s, pts, **a): s.el.append('<polyline fill="none" points="%s" %s/>' % (' '.join('%.1f,%.1f' % s.P(*q) for q in pts), s.at(a)))
    def text(s, sv, y, t, size=7, anchor='middle', **a):
        x, yy = s.P(sv, y); s.el.append('<text x="%.1f" y="%.1f" font-size="%s" text-anchor="%s" %s>%s</text>' % (x, yy, size, anchor, s.at(a), t))
    @staticmethod
    def at(a): return ' '.join('%s="%s"' % (k.replace('_', '-'), v) for k, v in a.items())

def fade(t, depth):
    k = max(0.0, min(1.0, t / depth)); g = int(0x33 + k * (0xb8 - 0x33)); return '#%02x%02x%02x' % (g, g, g)

def roof_rise(b): return b['faitage'] - b['egout']

def draw_block_elev(d, b, t):
    """projet vu en élévation : volume, niveaux, baies, toiture 4 pans (silhouette)"""
    fp = Polygon(b['fp']); sv = [d.S(*q) for q in b['fp']]; s0, s1 = min(sv), max(sv)
    g0 = min(th(*q) for q in b['fp']); y0 = b['egout'] - ALT0 - b['nlev'] * b['hEtage']   # sol fini (RDC) en y maquette
    ye = b['egout'] - ALT0; yf = b['faitage'] - ALT0
    pil = 'parking' in b['name']
    d.poly([(s0, g0 - 0.5), (s1, g0 - 0.5), (s1, ye), (s0, ye)], fill='#ffffff', stroke='none')
    u = (math.sin(math.radians(b['az'])), -math.cos(math.radians(b['az']))); cosang = abs(u[0] * d.right[0] + u[1] * d.right[1])
    sc = d.S(*b['at'].values()) if isinstance(b['at'], dict) else d.S(*b['at'])
    base = y0 + b['hEtage'] if pil else g0
    d.poly([(s0, base), (s1, base), (s1, ye), (s0, ye)], fill='#f6e9d3', stroke='#1f1f1f', stroke_width=1.2)
    if pil:
        d.poly([(s0, y0 + b['hEtage'] - 0.35), (s1, y0 + b['hEtage'] - 0.35), (s1, y0 + b['hEtage']), (s0, y0 + b['hEtage'])], fill='#cfc7b8', stroke='#222', stroke_width=0.6)
        for q in (s0 + 0.5, (s0 + s1) / 2, s1 - 0.5): d.line([(q, g0), (q, y0 + b['hEtage'] - 0.35)], stroke='#444', stroke_width=1.0)
    for k in range(1 if not pil else 2, b['nlev']):
        yk = y0 + k * b['hEtage']; d.line([(s0, yk), (s1, yk)], stroke='#555', stroke_width=0.5)
    if cosang > 0.5:       # baies : une par travée sur la longueur de la lame (écriture indicative, travée 3,60 m)
        n = int(b['len'] // BAY)
        for k in range(1 if pil else 0, b['nlev']):
            yk = y0 + k * b['hEtage']
            if k == 0 and not pil and b['name'].endswith('A') is False and False: continue
            for i in range(n):
                tt = -b['len'] / 2 + (i + 0.5) * BAY; x = sc + (u[0] * d.right[0] + u[1] * d.right[1]) * tt; w = 0.5 * min(1, cosang * 1.4)
                d.poly([(x - w, yk + 0.95), (x + w, yk + 0.95), (x + w, yk + 2.3), (x - w, yk + 2.3)], fill='#4f6f85', stroke='#222', stroke_width=0.35)
            d.line([(s0, yk + b['hEtage'] - 0.9), (s1, yk + b['hEtage'] - 0.9)], stroke='#9a7a52', stroke_width=0.7)
    hr = (b['len'] - b['depth']) / 2 * cosang
    d.poly([(s0 - OV, ye), (s1 + OV, ye), (sc + hr, yf), (sc - hr, yf)], fill='#8e9ea8', stroke='#222', stroke_width=1.1)

def draw_block_cut(d, b, t):
    """lame coupée par le plan : section avec niveaux, dalles, toiture 4 pans coupée"""
    ln = LineString([(d.O[0] + d.right[0] * d.span[0], d.O[1] + d.right[1] * d.span[0]), (d.O[0] + d.right[0] * d.span[1], d.O[1] + d.right[1] * d.span[1])])
    seg = ln.intersection(Polygon(b['fp']))
    if seg.is_empty: return False
    pts = [d.S(*q) for q in seg.coords]; a, c = min(pts), max(pts)
    g0 = min(th(d.O[0] + d.right[0] * q, d.O[1] + d.right[1] * q) for q in (a, (a + c) / 2, c))
    y0 = b['egout'] - ALT0 - b['nlev'] * b['hEtage']; ye = b['egout'] - ALT0; yf = b['faitage'] - ALT0; mid = (a + c) / 2
    d.poly([(a, g0 - 0.6), (c, g0 - 0.6), (c, y0), (a, y0)], fill='#d9c7a8', stroke='#222', stroke_width=1)
    for k in range(b['nlev']):
        yk = y0 + k * b['hEtage']
        d.poly([(a, yk), (c, yk), (c, yk + b['hEtage']), (a, yk + b['hEtage'])], fill='#f6e9d3', stroke='#222', stroke_width=0.9)
        d.poly([(a - 1.0, yk + b['hEtage'] - 0.22), (c + 0.4, yk + b['hEtage'] - 0.22), (c + 0.4, yk + b['hEtage']), (a - 1.0, yk + b['hEtage'])], fill='#b5452a', stroke='none')
        d.line([(a - 1.0, yk + b['hEtage']), (a - 1.0, yk + b['hEtage'] + 1.0)], stroke='#222', stroke_width=0.8)
    d.poly([(a - OV - 1.0, ye + 0.0), (mid, yf), (c + OV + 0.4, ye)], fill='#8e9ea8', stroke='#222', stroke_width=1.2)
    return True

def cotes(d, b, edge, side=1, col=3.0):
    """colonne de cotes en m NGR à gauche (side=-1) ou à droite (side=1) du bâtiment : lignes de rappel depuis l'arête, texte à halo blanc"""
    halo = 'paint-order:stroke;stroke:#fff;stroke-width:3.2px;stroke-linejoin:round'
    xc = edge + side * col
    ys = [(b['egout'] - ALT0 - b['nlev'] * b['hEtage'], 'RDC'), (b['egout'] - ALT0, 'égout'), (b['faitage'] - ALT0, 'faîtage')]
    d.line([(xc, ys[0][0] - 0.4), (xc, ys[-1][0] + 0.4)], stroke='#b5452a', stroke_width=0.5)
    for yv, lab in ys:
        d.line([(edge, yv), (xc + side * 0.8, yv)], stroke='#b5452a', stroke_width=0.45, stroke_dasharray='1.5 1')
        d.poly([(xc, yv), (xc + side * 0.9, yv + 0.35), (xc + side * 0.9, yv - 0.35)], fill='#b5452a', stroke='none')
        d.text(xc + side * 1.3, yv - 0.35, '%s %s m NGR' % (lab, D.f2(yv + ALT0)), 6.4, anchor='start' if side > 0 else 'end', fill='#b5452a', font_weight='600', style=halo)

def draw(O, v, span, depth, fname, cut=False, scale_m=20, labels=()):
    d = Dr(O, v, span, depth)
    ss = [span[0] + i * 0.5 for i in range(int((span[1] - span[0]) / 0.5) + 1)]
    from scipy.ndimage import median_filter
    gy = median_filter([th(O[0] + d.right[0] * q, O[1] + d.right[1] * q) for q in ss], size=19, mode='nearest'); ground = list(zip(ss, gy))   # médiane 9 m : gomme les cuvettes du maillage sous les bâtiments voisins
    gmin = min(g for _, g in ground); gmax = max(g for _, g in ground); d.ylo = gmin - 5; d.yhi = max(gmin + 27, max(b['faitage'] for b in D.BLOCKS) - ALT0 + 4)
    items = []
    for bd in D.Q['blds']:
        if bd.get('projected') and False: continue
        fp = bd['fp']; ts = [d.T(*q) for q in fp]; sv = [d.S(*q) for q in fp]
        if max(ts) < -2 or min(ts) > depth or max(sv) < span[0] or min(sv) > span[1]: continue
        if not cut and max(ts) < 0.5: continue
        py = Polygon(fp); mrr = list(py.minimum_rotated_rectangle.exterior.coords); e1, e2 = math.dist(mrr[0], mrr[1]), math.dist(mrr[1], mrr[2])
        rh = min(e1, e2) / 2 * TAN if bd['h'] < 8 else 0
        y0 = min([th(*q) for q in fp] + [th(py.centroid.x, py.centroid.y)])
        items.append((max(0, min(ts)), 'bat', dict(s0=min(sv), s1=max(sv), y0=y0, h=bd['h'], rh=rh, cutb=(min(ts) < 0 < max(ts)) and cut)))
    for tr in D.Q['trees']:
        if tr.get('felled'): continue
        tr = dict(tr, h=tr.get('h') or 7.0, r=tr.get('r') or 3.0)
        tt = d.T(tr['x'], tr['z']); sv = d.S(tr['x'], tr['z'])
        if not (-3 < tt < depth) or not (span[0] < sv < span[1]) or tr['h'] < 2.5: continue
        items.append((max(0, tt), 'tree', dict(s=sv, y=th(tr['x'], tr['z']), h=tr['h'], r=tr['r'])))
    use_glb = (not cut) and GL.has_detail(); glb_done = False
    for b in D.BLOCKS:
        ts = [d.T(*q) for q in b['fp']]
        if cut and min(ts) < 0 < max(ts): items.append((0, 'cut', dict(b=b)))
        elif min(ts) >= -0.01 or not cut:
            if use_glb:
                if not glb_done: items.append((max(0, min(ts)), 'glb', dict(b=b))); glb_done = True
            else: items.append((max(0, min(ts)), 'prj', dict(b=b)))
    items.sort(key=lambda it: -it[0])
    tP = min([t for t, k, _ in items if k in ('prj', 'cut', 'glb')] or [0]); CTX, PRJ, FG, MARK = [], [], [], []
    for t, k, a in items:
        fg = (k == 'tree' and t < tP - 1); d.el = PRJ if k in ('prj', 'cut', 'glb') else FG if fg else CTX
        col = fade(t, depth); sw = 0.6 if t > 5 else 0.9
        if k == 'bat':
            y0, y1 = a['y0'], a['y0'] + a['h']
            if a['cutb']: d.poly([(a['s0'], y0), (a['s1'], y0), (a['s1'], y1), (a['s0'], y1)], fill='#8c8c8c', stroke='#333', stroke_width=1.2)
            else:
                pts = [(a['s0'], y0 - 0.5), (a['s1'], y0 - 0.5), (a['s1'], y1)] + ([((a['s0'] + a['s1']) / 2, y1 + a['rh'])] if a['rh'] > 0.3 else []) + [(a['s0'], y1)]
                d.poly(pts, fill='#ffffff', stroke=col, stroke_width=sw)
        elif k == 'tree':
            tc = '#5f6f55' if t < depth * 0.5 else '#9aa592'; s0, y, h, r = a['s'], a['y'], a['h'], a['r']
            d.line([(s0, y), (s0, y + h * 0.45)], stroke=tc, stroke_width=0.8); cy = y + h - r * 0.9
            d.el.append('<ellipse cx="%.1f" cy="%.1f" rx="%.1f" ry="%.1f" fill="%s" fill-opacity="0.85" stroke="%s" stroke-width="0.7"/>' % (*d.P(s0, cy), r * d.K, r * 0.85 * d.K, 'none' if fg else '#ffffff', tc))
        elif k == 'cut': draw_block_cut(d, a['b'], t)
        elif k == 'glb': d.el.extend(GL.render(d))
        else: draw_block_elev(d, a['b'], t)
    if not cut:   # élévation : sol naturel visible = enveloppe du terrain entre l'observateur et le projet
        tmax = min(depth, max(tP, 5)); ground = [(q, max(th(O[0] + d.right[0] * q + v[0] * t, O[1] + d.right[1] * q + v[1] * t) for t in range(0, int(tmax) + 1, 3))) for q in ss]; ground = list(zip(ss, median_filter([g for _, g in ground], size=7, mode='nearest')))
    gp = ground + [(span[1], d.ylo), (span[0], d.ylo)]; d.el = []
    d.poly(gp, fill='#ffffff', stroke='none'); d.poly(gp, fill='url(#hatch)', stroke='none'); SOL = d.el; d.el = []
    d.line(ground, stroke='#1d1d1d', stroke_width=1.6); TN = d.el; d.el = []
    # repères latéraux (nord/sud/est/ouest) et cotes
    for sx, lab in labels: d.text(span[0] + 2 if sx < 0 else span[1] - 2, d.yhi - 1.4, lab, 8, anchor='start' if sx < 0 else 'end', fill='#555', font_weight='600')
    # cotes NGR sur les deux lames principales
    named = [b for b in D.BLOCKS if 'parking' not in b['name']]
    for i, b in enumerate(named):
        sv = [d.S(*q) for q in b['fp']]
        if cut:
            ln = LineString([(d.O[0] + d.right[0] * span[0], d.O[1] + d.right[1] * span[0]), (d.O[0] + d.right[0] * span[1], d.O[1] + d.right[1] * span[1])]).intersection(Polygon(b['fp']))
            if ln.is_empty: continue
            q = [d.S(*p) for p in ln.coords]; sx = (max(q) + OV, 1) if b['name'] == 'Bât. A' else (min(q) - OV, -1)
        else:
            allsv = [d.S(*q) for bb in D.BLOCKS for q in bb['fp']]
            sx = (max(allsv) + OV + 0.5, 1) if i == 0 else (min(allsv) - OV - 0.5, -1)
        cotes(d, b, sx[0], sx[1])
    LAB = d.el; d.el = []
    GRID = []
    for yy in range(int(math.ceil((d.ylo + 3) / 5) * 5), int(d.yhi), 5):
        x, y = d.P(span[0], yy)
        GRID.append('<line x1="0" x2="%.1f" y1="%.1f" y2="%.1f" stroke="#e4e4e4" stroke-width="0.4" stroke-dasharray="2 4"/>' % ((span[1] - span[0]) * d.K, y, y))
        GRID.append('<g font-size="7" fill="#777"><rect x="1" y="%.1f" width="40" height="9" fill="#fff" fill-opacity="0.85"/><text x="3" y="%.1f">%.0f m NGR</text></g>' % (y - 5, y + 2.5, yy + ALT0))
    Wpx = (span[1] - span[0]) * d.K; Hpx = (d.yhi - d.ylo) * d.K
    x0 = Wpx - 20 - scale_m * d.K; y0s = Hpx - 12
    sb = ('<g font-size="9" fill="#333"><rect x="%.1f" y="%.1f" width="%.1f" height="3" fill="#333"/><rect x="%.1f" y="%.1f" width="%.1f" height="3" fill="#fff" stroke="#333" stroke-width=".5"/><text x="%.1f" y="%.1f">0</text><text x="%.1f" y="%.1f" text-anchor="end">%d m</text></g>' % (x0, y0s, scale_m / 2 * d.K, x0 + scale_m / 2 * d.K, y0s, scale_m / 2 * d.K, x0, y0s - 3, x0 + scale_m * d.K, y0s - 3, scale_m))
    body = ''.join(GRID + CTX + FG + SOL + PRJ + TN + LAB)
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.0f %.0f" font-family="Helvetica, Arial, sans-serif" class="sx">'
           '<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#b9b2a4" stroke-width="0.6"/></pattern></defs>'
           '<rect width="100%%" height="100%%" fill="#fff"/>%s%s</svg>') % (Wpx, Hpx, body, sb)
    open(fname, 'w', encoding='utf-8').write(svg); return fname

def build(outdir):
    A = next(b for b in D.BLOCKS if b['name'] == 'Bât. A'); B = next(b for b in D.BLOCKS if b['name'] == 'Bât. B')
    az = math.radians(A['az']); u = (math.sin(az), -math.cos(az)); n = (-u[1], u[0])      # u : axe des lames (NNE), n : transversale (ESE)
    cA, cB = (A['at']['x'], A['at']['z']), (B['at']['x'], B['at']['z']); mid = ((cA[0] + cB[0]) / 2, (cA[1] + cB[1]) / 2)
    from shapely.geometry import Polygon as P_
    lot = P_(D.LOT); c = lot.centroid; res = {}
    # AA : coupe transversale au droit des deux lames, regard vers le NNE (ouest à gauche, est à droite)
    draw(mid, u, (-95, 95), 90, os.path.join(outdir, 'coupe_AA.svg'), cut=True, labels=[(-85, 'OUEST · lot SIDR'), (85, 'EST · chemin Mille Roches')])
    # façade urbaine est : depuis le chemin, regard vers l'ouest-nord-ouest (perpendiculaire aux lames)
    Oe = (c.x + n[0] * 36, c.y + n[1] * 36); draw(Oe, (-n[0], -n[1]), (-95, 95), 110, os.path.join(outdir, 'facade_est.svg'), cut=False, labels=[(-85, 'SSO'), (85, 'NNE')])
    # façade urbaine sud : depuis le chemin Mille Roches sud, regard vers le nord
    Os = (c.x, max(q[1] for q in D.LOT) + 6); draw(Os, (0, -1), (-95, 95), 110, os.path.join(outdir, 'facade_sud.svg'), cut=False, labels=[(-85, 'OUEST'), (85, 'EST')])
    return dict(A=(A['rdc'], A['egout'], A['faitage']), B=(B['rdc'], B['egout'], B['faitage']))

if __name__ == '__main__':
    print(build(D.OUT))
