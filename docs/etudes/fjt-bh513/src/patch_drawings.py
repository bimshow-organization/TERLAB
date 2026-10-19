# Lames 8,60 m (logement 5,90 + varangue intégrée 1,20 + coursive 1,50) dans plan.py / sections.py / build_report.py
import re

# ── séquence commune (identique à la maquette fjt-bh513.html) ──
SEQ = '''
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
'''

# ── plan.py ──
p = open('plan.py', encoding='utf-8').read()
p = p.replace("DU, GAL, T1, T2, CORE = 5.9, 1.5, 3.4, 7.8, 4.0", "DU, VAR, GAL, T1, T2, CORE = 5.9, 1.2, 1.5, 3.4, 7.8, 4.0\nHALF = (DU + VAR + GAL) / 2" + SEQ)
p = p.replace("tU0, tU1 = sorted((-gs*3.7, -gs*3.7 + gs*DU)); tG0, tG1 = sorted((gs*3.7 - gs*GAL, gs*3.7))",
              "tU0, tU1 = sorted((-gs*HALF, -gs*HALF + gs*(DU + VAR))); tG0, tG1 = sorted((gs*HALF - gs*GAL, gs*HALF))")
p = p.replace("pts(R(-L/2, -L/2 + CORE, -3.7, 3.7), K, ox, oz))",
              "pts(R(-L/2, -L/2 + CORE, -HALF, HALF), K, ox, oz))\n"
              "            tV0, tV1 = sorted((-gs*HALF, -gs*HALF + gs*VAR))\n"
              "            for (m0, m1, kind, _) in modules(bl['name'], 2, L):\n"
              "                if kind == 'var': add('<polygon points=\"%s\" fill=\"#efe6d6\" stroke=\"#222\" stroke-width=\"0.5\"/>' % pts(R(m0, m1, tV0, tV1), K, ox, oz))")
open('plan.py', 'w', encoding='utf-8').write(p)

# ── sections.py ──
s = open('sections.py', encoding='utf-8').read()
s = s.replace("HN, RAISE, DU, GAL = 3.0, 0.6, 5.9, 1.5", "HN, RAISE, DU, VAR, GAL = 3.0, 0.6, 5.9, 1.2, 1.5\nHALF = (DU + VAR + GAL) / 2" + SEQ)
s = s.replace("n[0]*t*7.4, cz + u[1]*s*b['len'] + n[1]*t*7.4)", "n[0]*t*2*HALF, cz + u[1]*s*b['len'] + n[1]*t*2*HALF)")
s = s.replace("sN = d.S(c[0] - n[0]*3.7, c[1] - n[1]*3.7); sSd = d.S(c[0] + n[0]*3.7, c[1] + n[1]*3.7)",
              "sN = d.S(c[0] - n[0]*HALF, c[1] - n[1]*HALF); sSd = d.S(c[0] + n[0]*HALF, c[1] + n[1]*HALF)")
s = s.replace("half = 3.7 + 0.6;", "half = HALF + 0.8;")
# coupe : bande varangue (dalle + garde-corps bois) côté extérieur, logement en retrait de VAR
s = s.replace("""                    d.poly([(sU_out, yk), (sG_in, yk), (sG_in, yk + HN), (sU_out, yk + HN)], fill='#fbf8f2', stroke='#222', stroke_width=0.9)""",
"""                    sV = sU_out + dirG*VAR   # nu du logement (fond de varangue)
                    d.poly([(sV, yk), (sG_in, yk), (sG_in, yk + HN), (sV, yk + HN)], fill='#fbf8f2', stroke='#222', stroke_width=0.9)
                    if k2 > 0 or not b['name'].endswith('A'):
                        d.line([(sU_out, yk + 0.05), (sU_out, yk + 1.05)], stroke='#8a5f38', stroke_width=1.1)   # garde-corps bois
                    d.line([(sU_out, yk + HN - 0.25), (sU_out, yk + HN)], stroke='#222', stroke_width=0.6)""")
# élévation : écriture rythmée (murs bardés + baies verticales / varangues jumelées) si la façade logements est vue
s = s.replace("""                # rythme des T1 (3,40 m) projeté
                cosang = abs(b['u'][0]*d.right[0] + b['u'][1]*d.right[1]); step = 3.4*cosang
                if step > 1.2:
                    sv = s0 + 4.0*cosang
                    while sv < s1 - 0.5:
                        for k2 in range(b['nlev']):
                            yk = y0 + k2*HN; d.poly([(sv + step*0.3, yk + 0.9), (sv + step*0.7, yk + 0.9), (sv + step*0.7, yk + 2.3), (sv + step*0.3, yk + 2.3)], fill='#e3e0d8', stroke='#555', stroke_width=0.4)
                        sv += step""",
"""                # écriture de façade : côté logements vu (normale extérieure = -gs*n) ou côté coursive
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
                                dx = S_(t); d.poly([(dx - 0.45*cosang, yk), (dx + 0.45*cosang, yk), (dx + 0.45*cosang, yk + 2.15), (dx - 0.45*cosang, yk + 2.15)], fill='#b3814f', stroke='#555', stroke_width=0.3); t += 3.4""")
s = s.replace("""'<defs><pattern id="hatch\"""", """'<defs><pattern id="lames" width="2.2" height="10" patternUnits="userSpaceOnUse"><rect width="2.2" height="10" fill="#c9a27a"/><line x1="0" y1="0" x2="0" y2="10" stroke="#8a5f38" stroke-width="0.35"/></pattern><pattern id="hatch\"""")
open('sections.py', 'w', encoding='utf-8').write(s)

# ── build_report.py ──
r = open('build_report.py', encoding='utf-8').read()
r = r.replace("A_len, B_len, DEPTH, DU = 50.2, 35.6, 7.4, 5.9", "A_len, B_len, DEPTH, DU = 50.2, 35.6, 8.6, 5.9")
r = r.replace("<p class=note>Trames : T1 3,40 × 5,90 m ; T2 7,80 × 5,90 m ; noyau escalier + ascenseur 4,00 m ; lame 7,40 m (logements 5,90 + coursive 1,50).</p>",
              "<p class=note>Trames : T1 3,40 × 5,90 m + varangue intégrée 1,90 × 1,20 m (≈ 2,3 m²) ; T2 7,80 × 5,90 m + varangue 3,00 × 1,20 m ; noyau escalier + ascenseur 4,00 m ; lame 8,60 m (logement 5,90 + varangue 1,20 + coursive 1,50).</p>")
r = r.replace("<li>Façades principales nord / sud, faciles à protéger (brise-soleil filants).</li>",
              "<li><b>Varangues intégrées</b> jumelées deux à deux entre des trumeaux en <b>bardage bois</b> à lames verticales : écriture rythmée A-B-B-A, baies verticales ≈ 1,05 × 1,55 m (composition houseg-speech).</li><li>Façades principales nord / sud, faciles à protéger.</li>")
r = r.replace("écart minimal entre lames passe à ≈ 11 m", "écart minimal entre lames passe à ≈ 9 m")
r = r.replace("jardin central</b> de ≈ 12 m de large", "jardin central</b> de ≈ 10 m de large")
r = r.replace("<figure><img src=\"3d_V1_rue.png\"><figcaption>Depuis le chemin Mille Roches</figcaption></figure>",
              "<figure><img src=\"3d_V1_proche.png\"><figcaption>Bâtiment B depuis le chemin Mille Roches — varangues intégrées, bardage</figcaption></figure>")
r = r.replace("<figure><img src=\"3d_V1_ne.png\"><figcaption>Vue aérienne depuis le nord-est (lot SIDR au premier plan, non projeté)</figcaption></figure>",
              "<figure><img src=\"3d_V1_nord.png\"><figcaption>Bâtiment A, façade nord — RDC des espaces communs</figcaption></figure>")
r = r.replace("projet : RDC surélevé de 0,60 m, niveaux de 3,00 m, coursives 1,50 m, toiture tôle deux pans 12°.",
              "projet : RDC surélevé de 0,60 m, niveaux de 3,00 m, varangues intégrées 1,20 m, coursives 1,50 m, toiture tôle deux pans 12°.")
open('build_report.py', 'w', encoding='utf-8').write(r)
print('ok')
