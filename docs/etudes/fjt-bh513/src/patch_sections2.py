# Coupes / façades : calques (contexte | masque sol | projet coloré | premier plan), cotes de niveaux
s = open('sections.py', encoding='utf-8').read()

# 1) calques : on aiguille d.el selon l'élément
s = s.replace("""    items.sort(key=lambda it: -it[0])   # du fond vers l'avant
    for t, k, a in items:
        col = fade(t, depth); sw = 0.6 if t > 5 else 0.9""",
"""    items.sort(key=lambda it: -it[0])   # du fond vers l'avant
    tP = min([t for t, k, _ in items if k == 'prj'] or [0])
    CTX, PRJL, FG, MARK = [], [], [], []
    for t, k, a in items:
        fg = (k == 'tree' and t < tP - 1)
        d.el = PRJL if k == 'prj' else FG if fg else CTX
        col = fade(t, depth); sw = 0.6 if t > 5 else 0.9""")
# arbres de premier plan : contour seul (le projet reste lisible)
s = s.replace("""fill="#ffffff" fill-opacity="0.85" stroke="%s" stroke-width="0.7"/>' % (*d.P(s0, cy), r*d.K, r*0.85*d.K, tc))""",
              """fill="%s" fill-opacity="0.85" stroke="%s" stroke-width="0.7"/>' % (*d.P(s0, cy), r*d.K, r*0.85*d.K, 'none' if fg else '#ffffff', tc))""")
# 2) couleurs projet
s = s.replace("fill='#8a8a8a', stroke='#222', stroke_width=1)", "fill='#d9c7a8', stroke='#222', stroke_width=1)")
s = s.replace("d.poly([(sV, yk), (sG_in, yk), (sG_in, yk + HN), (sV, yk + HN)], fill='#fbf8f2'", "d.poly([(sV, yk), (sG_in, yk), (sG_in, yk + HN), (sV, yk + HN)], fill='#f6e9d3'")
s = s.replace("fill='#2b2b2b', stroke='none')  # dalle coupée", "fill='#b5452a', stroke='none')  # dalle coupée (projet en rouge brique)")
s = s.replace("d.poly([(s0, b['g0']), (s1, b['g0']), (s1, y0 + H), (s0, y0 + H)], fill='#fbf8f2', stroke='#222', stroke_width=1.1)",
              "d.poly([(s0, b['g0']), (s1, b['g0']), (s1, y0 + H), (s0, y0 + H)], fill='#f6e9d3', stroke='#1f1f1f', stroke_width=1.2)")
s = s.replace("fill='#cfc8bb', stroke='#555', stroke_width=0.4)", "fill='#e6c9a0', stroke='#555', stroke_width=0.4)")
s = s.replace("fill='#3a444c', stroke='#222', stroke_width=0.4)", "fill='#4f6f85', stroke='#222', stroke_width=0.4)")
s = s.replace("fill='#d9dde0', stroke='#555', stroke_width=0.4)", "fill='#9fb6c4', stroke='#555', stroke_width=0.4)")
# toiture projet : pans pleins gris acier
s = s.replace("d.line([(sU_out - dirG*0.6, yR), (mid, yR + math.tan(math.radians(12))*half), (sG_out + dirG*0.6, yR)], stroke='#222', stroke_width=1.4)",
              "d.poly([(sU_out - dirG*0.8, yR), (mid, yR + math.tan(math.radians(12))*half), (sG_out + dirG*0.8, yR)], fill='#8e9ea8', stroke='#222', stroke_width=1.2)")
s = s.replace("d.line([(s0 - 0.6, yR), (s1 + 0.6, yR), (s1 + 0.6, yR + 0.9), (s0 - 0.6, yR + 0.9), (s0 - 0.6, yR)], stroke='#222', stroke_width=0.9)",
              "d.poly([(s0 - 0.8, yR), (s1 + 0.8, yR), (s1 + 0.8, yR + 0.95), (s0 - 0.8, yR + 0.95)], fill='#8e9ea8', stroke='#222', stroke_width=0.9)")
# 3) cotes de niveaux projet (coupe) : RDC, égout, faîtage en NGR, côté extérieur
s = s.replace("""                d.text(mid, yR + 3.2, b['name']""",
"""                d.el = MARK; xs = max(sU_out, sG_out) + 2.2
                for yv, lab in ((y0, 'RDC'), (y0 + H, 'égout'), (yR + math.tan(math.radians(12))*half, 'faîtage')):
                    d.line([(xs - 1.2, yv), (xs + 0.6, yv)], stroke='#b5452a', stroke_width=0.6)
                    d.text(xs + 0.9, yv - 0.35, '%s %.2f' % (lab, yv + ALT0), 6, anchor='start', fill='#b5452a')
                d.el = PRJL
                d.text(mid, yR + 3.2, b['name']""")
# 4) montage final : grille NGR (fond) | contexte | masque sol opaque hachuré | projet | premier plan | trait TN | cotes
s = s.replace("""    # terrain naturel : trait fort + sol hachuré
    gp = ground + [(span[1], d.ylo), (span[0], d.ylo)]
    d.poly(gp, fill='url(#hatch)', stroke='none')
    d.line(ground, stroke='#1d1d1d', stroke_width=1.6)""",
"""    # terrain naturel : ce qui est sous le TN (hors projet) est masqué par le sol opaque hachuré
    GRID = []
    for yy in range(int(math.ceil(d.ylo + 3)), int(d.yhi), 5):
        x, y = d.P(span[0], yy)
        GRID.append('<line x1="0" x2="%.1f" y1="%.1f" y2="%.1f" stroke="#e4e4e4" stroke-width="0.4" stroke-dasharray="2 4"/>' % ((span[1]-span[0])*d.K, y, y))
    d.el = []
    gp = ground + [(span[1], d.ylo), (span[0], d.ylo)]
    d.poly(gp, fill='#ffffff', stroke='none'); d.poly(gp, fill='url(#hatch)', stroke='none')
    SOL = d.el; d.el = []
    d.line(ground, stroke='#1d1d1d', stroke_width=1.6)
    TN = d.el
    d.el = GRID + CTX + SOL + PRJL + FG + TN + MARK""")
s = s.replace("""    for yy in range(int(math.ceil(d.ylo + 6)), int(d.yhi), 5):
        x, y = d.P(span[0], yy); d.el.append('<text x="4" y="%.1f" font-size="9" fill="#888">%.0f NGR</text>' % (y + 3, yy + ALT0))
        d.el.append('<line x1="0" x2="%.1f" y1="%.1f" y2="%.1f" stroke="#ddd" stroke-width="0.4" stroke-dasharray="2 4"/>' % ((span[1]-span[0])*d.K, y, y))""",
"""    for yy in range(int(math.ceil(d.ylo + 3)), int(d.yhi), 5):
        x, y = d.P(span[0], yy)
        d.el.append('<g font-size="7" fill="#777"><rect x="1" y="%.1f" width="40" height="9" fill="#fff" fill-opacity="0.85"/><text x="3" y="%.1f">%.0f NGR</text></g>' % (y - 5, y + 2.5, yy + ALT0))""")
open('sections.py', 'w', encoding='utf-8').write(s)
for k in ('CTX, PRJL, FG, MARK', "'none' if fg", "d.el = GRID + CTX", "égout", "#b5452a"):
    print(k, k in s)
