# Coupes : toiture monopente, cotes de niveaux lisibles (un seul jeu, halo, cote de hauteur), marge gauche pour les NGR
s = open('sections.py', encoding='utf-8').read()
MX = 46   # marge gauche (px) réservée aux cotes NGR
rep = [
 ("    def P(s, sv, y): return ((sv - s.span[0])*s.K, (s.yhi - y)*s.KV)",
  "    def P(s, sv, y): return ((sv - s.span[0])*s.K + %d, (s.yhi - y)*s.KV)" % MX),
 # coupe : monopente — point haut côté logements (sU_out), égout côté coursive (sG_out)
 ("                d.poly([(sU_out - dirG*0.8, yR), (mid, yR + math.tan(math.radians(12))*half), (sG_out + dirG*0.8, yR)], fill='#8e9ea8', stroke='#222', stroke_width=1.2)",
  "                rise = math.tan(math.radians(10))*(2*HALF + 1.6); yT = yR + rise\n"
  "                d.poly([(sU_out - dirG*0.8, yT), (sG_out + dirG*0.8, yR), (sG_out + dirG*0.8, yR + 0.28), (sU_out - dirG*0.8, yT + 0.28)], fill='#8e9ea8', stroke='#222', stroke_width=1.0)\n"
  "                d.poly([(sU_out, yR), (sU_out, yT), (sG_out, yR)], fill='#c98f55', stroke='#222', stroke_width=0.5)   # pignon bardé (en retrait)"),
 # cotes : seulement sur la lame la plus à droite, avec halo + cote de hauteur à l'égout
 ("                d.el = MARK; xs = max(sU_out, sG_out) + 2.2\n                for yv, lab in (() if d.K < 2 else ((y0, 'RDC'), (y0 + H, 'égout'), (yR + math.tan(math.radians(12))*half, 'faîtage'))):\n                    d.line([(xs - 1.2, yv), (xs + 0.6, yv)], stroke='#b5452a', stroke_width=0.6)\n                    d.text(xs + 0.9, yv - 0.35, '%s %.2f' % (lab, yv + ALT0), 6, anchor='start', fill='#b5452a')",
  "                d.el = MARK; xs = max(sU_out, sG_out) + 2.0\n"
  "                if d.K >= 2 and max(sU_out, sG_out) >= max(d.S(*bb['c']) for bb in blocks) - 0.5:\n"
  "                    for yv, lab in ((y0, 'RDC'), (y0 + H, 'égout'), (yT, 'point haut')):\n"
  "                        d.line([(xs - 1.0, yv), (xs + 0.8, yv)], stroke='#b5452a', stroke_width=0.7)\n"
  "                        d.el.append('<text x=\"%.1f\" y=\"%.1f\" font-size=\"7\" fill=\"#b5452a\" style=\"paint-order:stroke;stroke:#fff;stroke-width:2.5px\">%s %.2f NGR</text>' % (d.P(xs + 1.2, yv)[0], d.P(xs, yv)[1] + 2.5, lab, yv + ALT0))\n"
  "                    xd = xs + 11; d.line([(xd, y0), (xd, y0 + H)], stroke='#555', stroke_width=0.6)\n"
  "                    for yy_ in (y0, y0 + H): d.line([(xd - 0.5, yy_ - 0.5), (xd + 0.5, yy_ + 0.5)], stroke='#555', stroke_width=0.6)\n"
  "                    d.el.append('<text x=\"%.1f\" y=\"%.1f\" font-size=\"7\" fill=\"#333\" transform=\"rotate(-90 %.1f %.1f)\" text-anchor=\"middle\" style=\"paint-order:stroke;stroke:#fff;stroke-width:2.5px\">%.2f m</text>' % (d.P(xd, 0)[0] - 2, d.P(0, y0 + H/2)[1], d.P(xd, 0)[0] - 2, d.P(0, y0 + H/2)[1], H))"),
 # élévation : bande de toiture monopente (surface vue)
 ("                d.poly([(s0 - 0.8, yR), (s1 + 0.8, yR), (s1 + 0.8, yR + 0.95), (s0 - 0.8, yR + 0.95)], fill='#8e9ea8', stroke='#222', stroke_width=0.9)",
  "                riseE = math.tan(math.radians(10))*(2*HALF + 1.6)\n"
  "                d.poly([(s0 - 0.8, yR), (s1 + 0.8, yR), (s1 + 0.8, yR + riseE), (s0 - 0.8, yR + riseE)], fill='#8e9ea8', stroke='#222', stroke_width=0.9)"),
 # grille et étiquettes NGR dans la marge
 ("        GRID.append('<line x1=\"0\" x2=\"%.1f\" y1=\"%.1f\" y2=\"%.1f\" stroke=\"#e4e4e4\" stroke-width=\"0.4\" stroke-dasharray=\"2 4\"/>' % ((span[1]-span[0])*d.K, y, y))",
  "        GRID.append('<line x1=\"%d\" x2=\"%%.1f\" y1=\"%%.1f\" y2=\"%%.1f\" stroke=\"#e4e4e4\" stroke-width=\"0.4\" stroke-dasharray=\"2 4\"/>' %% ((span[1]-span[0])*d.K + %d, y, y))" % (MX, MX)),
 ("        d.el.append('<g font-size=\"7\" fill=\"#777\"><rect x=\"1\" y=\"%.1f\" width=\"40\" height=\"9\" fill=\"#fff\" fill-opacity=\"0.85\"/><text x=\"3\" y=\"%.1f\">%.0f NGR</text></g>' % (y - 5, y + 2.5, yy + ALT0))",
  "        d.el.append('<g font-size=\"7\" fill=\"#666\"><line x1=\"%d\" x2=\"%d\" y1=\"%%.1f\" y2=\"%%.1f\" stroke=\"#999\" stroke-width=\"0.6\"/><text x=\"%d\" y=\"%%.1f\" text-anchor=\"end\">%%.0f NGR</text></g>' %% (y, y, y + 2.5, yy + ALT0))" % (MX - 4, MX, MX - 6)),
 ("    Wpx = (span[1]-span[0])*d.K; Hpx = (d.yhi - d.ylo)*d.KV", "    Wpx = (span[1]-span[0])*d.K + %d; Hpx = (d.yhi - d.ylo)*d.KV" % MX),
]
for a, b in rep:
    assert a in s, a[:70]
    s = s.replace(a, b)
open('sections.py', 'w', encoding='utf-8').write(s)
print('ok')
