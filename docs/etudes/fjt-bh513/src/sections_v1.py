# Coupes / façades urbaines depuis la maquette (city.js) + projet FJT
# Repère maquette : x = est, z = sud, y = altitude - alt0.  Échelle de dessin : 1 m = K px.
import json, math, sys
from shapely.geometry import Polygon, LineString, Point

D = json.load(open('city_dump.json'))
PRJ = json.load(open('fjt_project_city.json'))
TER = D['terrain']; ALT0 = D['origin']['alt0']
SP = D['species']

def th(x, z):
    """hauteur terrain bilinéaire (y maquette)"""
    fx = (x - TER['x0']) / TER['step']; fz = (z - TER['z0']) / TER['step']
    i = max(0, min(TER['nx'] - 2, int(fx))); j = max(0, min(TER['nz'] - 2, int(fz)))
    tx = min(1, max(0, fx - i)); tz = min(1, max(0, fz - j)); h = TER['h']; n = TER['nx']
    a = h[j*n+i]; b = h[j*n+i+1]; c = h[(j+1)*n+i]; d = h[(j+1)*n+i+1]
    return (a*(1-tx) + b*tx)*(1-tz) + (c*(1-tx) + d*tx)*tz

HN, RAISE, DU, VAR, GAL = 3.0, 0.6, 5.9, 1.2, 1.5
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


def project_blocks(key):
    V = next(v for v in PRJ['variants'] if v['key'] == key)
    out = []
    for b in V['blocks']:
        p = b['poly'][:4]; cx = sum(q[0] for q in p)/4; cz = sum(q[1] for q in p)/4
        a = math.radians(b['az']); u = (math.sin(a), -math.cos(a)); n = (-u[1], u[0])
        g0 = min(th(cx + u[0]*s*b['len'] + n[0]*t*2*HALF, cz + u[1]*s*b['len'] + n[1]*t*2*HALF) for s in [i/10-0.5 for i in range(11)] for t in (-0.5, 0, 0.5))
        out.append({**b, 'c': (cx, cz), 'u': u, 'n': n, 'g0': g0, 'y0': g0 + RAISE, 'H': b['nlev']*HN, 'gs': 1 if b['gallery'] == 'S' else -1})
    return V, out

class Drawing:
    def __init__(s, O, v, span, depth, K=4.0, ylo=None, yhi=None, title=''):
        s.O = O; s.v = v; s.right = (-v[1], v[0]); s.span = span; s.depth = depth; s.K = K; s.title = title
        s.el = []
        s.ylo = ylo; s.yhi = yhi
    def S(s, x, z): return (x - s.O[0])*s.right[0] + (z - s.O[1])*s.right[1]
    def T(s, x, z): return (x - s.O[0])*s.v[0] + (z - s.O[1])*s.v[1]
    def P(s, sv, y): return ((sv - s.span[0])*s.K, (s.yhi - y)*s.K)
    def poly(s, pts, **a):
        s.el.append('<polygon points="%s" %s/>' % (' '.join('%.1f,%.1f' % s.P(*q) for q in pts), ' '.join('%s="%s"' % (k.replace('_', '-'), v) for k, v in a.items())))
    def line(s, pts, **a):
        s.el.append('<polyline fill="none" points="%s" %s/>' % (' '.join('%.1f,%.1f' % s.P(*q) for q in pts), ' '.join('%s="%s"' % (k.replace('_', '-'), v) for k, v in a.items())))
    def text(s, sv, y, t, size=11, anchor='middle', **a):
        x, yy = s.P(sv, y); s.el.append('<text x="%.1f" y="%.1f" font-size="%d" text-anchor="%s" %s>%s</text>' % (x, yy, size, anchor, ' '.join('%s="%s"' % (k.replace('_', '-'), v) for k, v in a.items()), t))

def fade(t, depth):  # gris de trait selon profondeur
    k = max(0.0, min(1.0, t/depth)); g = int(0x33 + k*(0xb8-0x33)); return '#%02x%02x%02x' % (g, g, g)

def draw(key, O, v, span, depth, title, fname, labels=(), elev=False):
    V, blocks = project_blocks(key)
    d = Drawing(O, v, span, depth, title=title)
    # emprise verticale
    ss = [span[0] + i*0.5 for i in range(int((span[1]-span[0])/0.5)+1)]
    ground = [(sv, th(O[0] + d.right[0]*sv, O[1] + d.right[1]*sv)) for sv in ss]
    gmin = min(g for _, g in ground); d.ylo = gmin - 5; d.yhi = gmin + 27
    items = []  # (t, kind, data)
    # bâtiments existants (hors lot) : élévation projetée
    for b in D['buildings']:
        fp = b['fp']; ts = [d.T(*q) for q in fp]; sv = [d.S(*q) for q in fp]
        if max(ts) < -2 or min(ts) > depth or max(sv) < span[0] or min(sv) > span[1]: continue
        if elev and max(ts) < 0.5: continue
        cut = (min(ts) < 0 < max(ts)) and not elev
        roofh = 0.0
        if b['roof'] and b['roof']['type'] == 'pente':
            poly = Polygon(fp); w = min(poly.minimum_rotated_rectangle.exterior.length/2 - max(Polygon(fp).bounds[2]-Polygon(fp).bounds[0], 0), 12)
            mrr = list(poly.minimum_rotated_rectangle.exterior.coords); e1 = math.dist(mrr[0], mrr[1]); e2 = math.dist(mrr[1], mrr[2])
            roofh = min(e1, e2)/2*math.tan(math.radians(22))
        items.append((max(0, min(ts)), 'bat', dict(s0=min(sv), s1=max(sv), y0=b['y0'], h=b['h'], rh=roofh, cut=cut)))
    # arbres
    for t in D['trees']:
        x, y, z, sp, sc = t[:5]; tt = d.T(x, z); sv = d.S(x, z)
        if not (-3 < tt < depth) or not (span[0] < sv < span[1]): continue
        S = SP[sp]; h = S['h']*sc; r = S['crown']*sc/2
        if h < 2.5: continue
        items.append((max(0, tt), 'tree', dict(s=sv, y=y, h=h, r=r, palm=('palm' in (S['shape'] or '') or 'coco' in S['id'] or 'latan' in S['id'] or S['form'] == 'palm'))))
    # projet
    for b in blocks:
        corners = b['poly'][:4]; ts = [d.T(*q) for q in corners]; sv = [d.S(*q) for q in corners]
        items.append((max(0, min(ts)), 'prj', dict(b=b, s0=min(sv), s1=max(sv), cut=(min(ts) < 0 < max(ts)) and not elev)))
    items.sort(key=lambda it: -it[0])   # du fond vers l'avant
    for t, k, a in items:
        col = fade(t, depth); sw = 0.6 if t > 5 else 0.9
        if k == 'bat':
            y0, y1 = a['y0'], a['y0'] + a['h']
            if a['cut']:
                d.poly([(a['s0'], y0), (a['s1'], y0), (a['s1'], y1), (a['s0'], y1)], fill='#4a4a4a', stroke='#222', stroke_width=1.2)
            else:
                pts = [(a['s0'], y0 - 0.5), (a['s1'], y0 - 0.5), (a['s1'], y1)]
                if a['rh'] > 0.3: pts += [((a['s0']+a['s1'])/2, y1 + a['rh'])]
                pts += [(a['s0'], y1)]
                d.poly(pts, fill='#ffffff', stroke=col, stroke_width=sw)
        elif k == 'tree':
            s0, y, h, r = a['s'], a['y'], a['h'], a['r']
            tc = '#5f6f55' if t < depth*0.5 else '#9aa592'
            if a['palm']:
                d.line([(s0, y), (s0 + 0.3, y + h)], stroke=tc, stroke_width=0.8)
                for ang in (-60, -30, 0, 30, 60, 150, 120):
                    rr = math.radians(ang + 90); d.line([(s0 + 0.3, y + h), (s0 + 0.3 + math.cos(rr)*r*1.3, y + h + math.sin(rr)*r*0.6 - 0.8)], stroke=tc, stroke_width=0.6)
            else:
                d.line([(s0, y), (s0, y + h*0.45)], stroke=tc, stroke_width=0.8)
                cy = y + h - r*0.9
                d.el.append('<ellipse cx="%.1f" cy="%.1f" rx="%.1f" ry="%.1f" fill="#ffffff" fill-opacity="0.85" stroke="%s" stroke-width="0.7"/>' % (*d.P(s0, cy), r*d.K, r*0.85*d.K, tc))
        elif k == 'prj':
            b = a['b']; y0, H = b['y0'], b['H']; L = b['len']
            if a['cut']:
                # coupe transversale : logements (DU) + coursive (GAL), côtés selon la direction de visée
                # position du nu logements / coursive sur l'axe s : projeter les deux arêtes longitudinales
                c = b['c']; n = b['n']; gs = b['gs']
                sN = d.S(c[0] - n[0]*HALF, c[1] - n[1]*HALF); sSd = d.S(c[0] + n[0]*HALF, c[1] + n[1]*HALF)
                sG_out = sSd if gs == 1 else sN; sU_out = sN if gs == 1 else sSd
                dirG = 1 if sG_out > sU_out else -1
                sG_in = sG_out - dirG*GAL
                d.poly([(sU_out - dirG*0.3, b['g0']), (sG_out + dirG*0.3, b['g0']), (sG_out + dirG*0.3, y0), (sU_out - dirG*0.3, y0)], fill='#8a8a8a', stroke='#222', stroke_width=1)
                for k2 in range(b['nlev']):
                    yk = y0 + k2*HN
                    sV = sU_out + dirG*VAR   # nu du logement (fond de varangue)
                    d.poly([(sV, yk), (sG_in, yk), (sG_in, yk + HN), (sV, yk + HN)], fill='#fbf8f2', stroke='#222', stroke_width=0.9)
                    if k2 > 0 or not b['name'].endswith('A'):
                        d.line([(sU_out, yk + 0.05), (sU_out, yk + 1.05)], stroke='#8a5f38', stroke_width=1.1)   # garde-corps bois
                    d.line([(sU_out, yk + HN - 0.25), (sU_out, yk + HN)], stroke='#222', stroke_width=0.6)
                    d.poly([(sU_out, yk + HN - 0.22), (sG_out, yk + HN - 0.22), (sG_out, yk + HN), (sU_out, yk + HN)], fill='#2b2b2b', stroke='none')  # dalle coupée
                    d.line([(sG_out, yk + HN), (sG_out, yk + HN + 1.0)], stroke='#222', stroke_width=0.9)   # garde-corps
                    d.line([(sU_out - dirG*0.02, yk + HN - 0.35), (sU_out - dirG*0.72, yk + HN - 0.35)], stroke='#222', stroke_width=1.2)  # brise-soleil
                yR = y0 + H + 0.25; half = HALF + 0.8; mid = (sU_out + sG_out)/2
                d.line([(sU_out - dirG*0.6, yR), (mid, yR + math.tan(math.radians(12))*half), (sG_out + dirG*0.6, yR)], stroke='#222', stroke_width=1.4)
                d.text(mid, yR + 3.2, b['name'].replace('Batiment', 'Bât.') + ' — R+%d' % (b['nlev']-1), 10, fill='#222', font_weight='600')
            else:
                s0, s1 = a['s0'], a['s1']
                d.poly([(s0, b['g0']), (s1, b['g0']), (s1, y0 + H), (s0, y0 + H)], fill='#fbf8f2', stroke='#222', stroke_width=1.1)
                for k2 in range(1, b['nlev']):
                    d.line([(s0, y0 + k2*HN), (s1, y0 + k2*HN)], stroke='#555', stroke_width=0.5)
                # écriture de façade : côté logements vu (normale extérieure = -gs*n) ou côté coursive
                ux_, uz_ = b['u']; sgn = ux_*d.right[0] + uz_*d.right[1]; cosang = abs(sgn)
                on = (-b['gs']*b['n'][0])*(-d.v[0]) + (-b['gs']*b['n'][1])*(-d.v[1]) > 0
                c = b['c']; sc = d.S(*c)
                S_ = lambda sl: sc + sgn*sl
                if cosang > 0.35:
                    for k2 in range(b['nlev']):
                        yk = y0 + k2*HN; kk = k2 + 1
                        if on:
                            if not modules(b['name'], kk, L):   # RDC communs vitré
                                d.poly([(S_(-L/2 + 4), yk + 0.25), (S_(L/2), yk + 0.25), (S_(L/2), yk + 2.6), (S_(-L/2 + 4), yk + 2.6)], fill='#d9dde0', stroke='#555', stroke_width=0.4)
                                continue
                            for (m0, m1, kind, fen) in modules(b['name'], kk, L):
                                a0, a1 = sorted((S_(m0), S_(m1)))
                                if kind == 'var':
                                    d.poly([(a0, yk), (a1, yk), (a1, yk + HN - 0.25), (a0, yk + HN - 0.25)], fill='#cfc8bb', stroke='#555', stroke_width=0.4)
                                    q = a0 + 0.12*cosang
                                    while q < a1 - 0.05: d.line([(q, yk), (q, yk + 1.0)], stroke='#8a5f38', stroke_width=0.35); q += 0.16*cosang
                                    d.line([(a0, yk + 1.02), (a1, yk + 1.02)], stroke='#333', stroke_width=0.5)
                                else:
                                    d.poly([(a0, yk), (a1, yk), (a1, yk + HN - 0.25), (a0, yk + HN - 0.25)], fill='url(#lames)', stroke='#555', stroke_width=0.4)
                                    for f in fen:
                                        fx = S_(f); w2 = 0.525*cosang
                                        d.poly([(fx - w2, yk + 0.95), (fx + w2, yk + 0.95), (fx + w2, yk + 2.48), (fx - w2, yk + 2.48)], fill='#3a444c', stroke='#222', stroke_width=0.4)
                        else:
                            d.line([(s0, yk + HN), (s1, yk + HN)], stroke='#333', stroke_width=0.6)
                            d.poly([(S_(-L/2 + 4), yk + HN), (S_(L/2), yk + HN), (S_(L/2), yk + HN + 1.0), (S_(-L/2 + 4), yk + HN + 1.0)], fill='#e8e8e4', fill_opacity='0.6', stroke='#777', stroke_width=0.3)
                            t = -L/2 + 4 + 1.1
                            while t < L/2:
                                dx = S_(t); d.poly([(dx - 0.45*cosang, yk), (dx + 0.45*cosang, yk), (dx + 0.45*cosang, yk + 2.15), (dx - 0.45*cosang, yk + 2.15)], fill='#b3814f', stroke='#555', stroke_width=0.3); t += 3.4
                yR = y0 + H + 0.25
                d.line([(s0 - 0.6, yR), (s1 + 0.6, yR), (s1 + 0.6, yR + 0.9), (s0 - 0.6, yR + 0.9), (s0 - 0.6, yR)], stroke='#222', stroke_width=0.9)
                d.text((s0 + s1)/2 + (8 if b['name'].endswith('A') else -8), yR + (6.5 if b['name'].endswith('A') else 3.2), b['name'].replace('Batiment', 'Bât.') + ' — R+%d' % (b['nlev']-1), 10, fill='#222', font_weight='600')
    # terrain naturel : trait fort + sol hachuré
    gp = ground + [(span[1], d.ylo), (span[0], d.ylo)]
    d.poly(gp, fill='url(#hatch)', stroke='none')
    d.line(ground, stroke='#1d1d1d', stroke_width=1.6)
    # repères
    for sv, txt in labels:
        g = th(O[0] + d.right[0]*sv, O[1] + d.right[1]*sv)
        d.line([(sv, g - 0.2), (sv, g - 3.2)], stroke='#b5552a', stroke_width=0.8)
        d.text(sv, g - 4.6, txt, 10, fill='#b5552a')
    # cotes NGR
    for yy in range(int(math.ceil(d.ylo + 6)), int(d.yhi), 5):
        x, y = d.P(span[0], yy); d.el.append('<text x="4" y="%.1f" font-size="9" fill="#888">%.0f NGR</text>' % (y + 3, yy + ALT0))
        d.el.append('<line x1="0" x2="%.1f" y1="%.1f" y2="%.1f" stroke="#ddd" stroke-width="0.4" stroke-dasharray="2 4"/>' % ((span[1]-span[0])*d.K, y, y))
    Wpx = (span[1]-span[0])*d.K; Hpx = (d.yhi - d.ylo)*d.K
    # échelle graphique
    x0 = Wpx - 20 - 20*d.K; y0 = Hpx - 12
    sb = '<g font-size="9" fill="#333"><rect x="%.1f" y="%.1f" width="%.1f" height="3" fill="#333"/><rect x="%.1f" y="%.1f" width="%.1f" height="3" fill="#fff" stroke="#333" stroke-width=".5"/><text x="%.1f" y="%.1f">0</text><text x="%.1f" y="%.1f" text-anchor="end">20 m</text></g>' % (x0, y0, 10*d.K, x0 + 10*d.K, y0, 10*d.K, x0, y0 - 3, x0 + 20*d.K, y0 - 3)
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.0f %.0f" width="%.0f" height="%.0f" font-family="Helvetica, Arial, sans-serif">'
           '<defs><pattern id="lames" width="2.2" height="10" patternUnits="userSpaceOnUse"><rect width="2.2" height="10" fill="#c9a27a"/><line x1="0" y1="0" x2="0" y2="10" stroke="#8a5f38" stroke-width="0.35"/></pattern><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="#b9b2a4" stroke-width="0.6"/></pattern></defs>'
           '<rect width="100%%" height="100%%" fill="#fff"/>%s%s</svg>') % (Wpx, Hpx, Wpx, Hpx, ''.join(d.el), sb)
    open(fname, 'w', encoding='utf-8').write(svg)
    return fname

if __name__ == '__main__':
    fjt = PRJ['fjt']; cx = sum(q[0] for q in fjt)/len(fjt); cz = sum(q[1] for q in fjt)/len(fjt)
    a = math.radians(110); u = (math.sin(a), -math.cos(a)); n = (-u[1], u[0])   # u : axe parcelle (O→E), n : vers le sud
    for key in [v['key'] for v in PRJ['variants']]:
        # AA : coupe transversale nord-sud au droit des lames, regard vers l'ouest (profondeur 90 m)
        V, bl = project_blocks(key)
        mid = ((bl[0]['c'][0] + bl[1]['c'][0])/2, (bl[0]['c'][1] + bl[1]['c'][1])/2)
        O = (mid[0] + u[0]*6, mid[1] + u[1]*6)
        draw(key, O, (-u[0], -u[1]), (-95, 95), 90, 'Coupe AA', 'coupe_AA_%s.svg' % key,
             labels=[(0, '')])
        # BB : façade urbaine sud, depuis le chemin Mille Roches, regard vers le nord
        O2 = (cx + n[0]*27, cz + n[1]*27)
        draw(key, O2, (-n[0], -n[1]), (-100, 100), 110, 'Facade urbaine sud', 'facade_BB_%s.svg' % key, elev=True)
        # CC : façade urbaine ouest (depuis le chemin Mille Roches ouest, regard vers l'est)
        O3 = (cx - u[0]*48, cz - u[1]*48)
        draw(key, O3, (u[0], u[1]), (-80, 80), 110, 'Facade urbaine ouest', 'facade_CC_%s.svg' % key, elev=True)
    print('ok')
