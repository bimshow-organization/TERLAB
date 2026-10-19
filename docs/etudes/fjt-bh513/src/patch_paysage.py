# Coupe paysagère : échelle horizontale K, verticale KV (exagération), emprise verticale adaptée au relief
s = open('sections.py', encoding='utf-8').read()
rep = [
 ("def __init__(s, O, v, span, depth, K=4.0, ylo=None, yhi=None, title=''):\n        s.O = O; s.v = v; s.right = (-v[1], v[0]); s.span = span; s.depth = depth; s.K = K; s.title = title",
  "def __init__(s, O, v, span, depth, K=4.0, ylo=None, yhi=None, title='', KV=None):\n        s.O = O; s.v = v; s.right = (-v[1], v[0]); s.span = span; s.depth = depth; s.K = K; s.KV = KV or K; s.title = title"),
 ("def P(s, sv, y): return ((sv - s.span[0])*s.K, (s.yhi - y)*s.K)", "def P(s, sv, y): return ((sv - s.span[0])*s.K, (s.yhi - y)*s.KV)"),
 ("def draw(key, O, v, span, depth, title, fname, labels=(), elev=False):", "def draw(key, O, v, span, depth, title, fname, labels=(), elev=False, K=4.0, KV=None, scale_m=20, grid=5):"),
 ("d = Drawing(O, v, span, depth, title=title)", "d = Drawing(O, v, span, depth, title=title, K=K, KV=KV)"),
 ("gmin = min(g for _, g in ground); d.ylo = gmin - 5; d.yhi = gmin + 27",
  "gmin = min(g for _, g in ground); gmax = max(g for _, g in ground)\n    if KV: d.ylo = gmin - 8; d.yhi = gmax + 28\n    else: d.ylo = gmin - 5; d.yhi = gmin + 27"),
 ("r*d.K, r*0.85*d.K,", "r*d.K, r*0.85*d.KV,"),
 ("for yy in range(int(math.ceil(d.ylo + 3)), int(d.yhi), 5):\n        x, y = d.P(span[0], yy)\n        GRID",
  "for yy in range(int(math.ceil((d.ylo + 3)/grid)*grid), int(d.yhi), grid):\n        x, y = d.P(span[0], yy)\n        GRID"),
 ("    for yy in range(int(math.ceil(d.ylo + 3)), int(d.yhi), 5):\n        x, y = d.P(span[0], yy)\n        d.el.append",
  "    for yy in range(int(math.ceil((d.ylo + 3)/grid)*grid), int(d.yhi), grid):\n        x, y = d.P(span[0], yy)\n        d.el.append"),
 ("Wpx = (span[1]-span[0])*d.K; Hpx = (d.yhi - d.ylo)*d.K", "Wpx = (span[1]-span[0])*d.K; Hpx = (d.yhi - d.ylo)*d.KV"),
 ("x0 = Wpx - 20 - 20*d.K; y0 = Hpx - 12", "SB = scale_m; x0 = Wpx - 20 - SB*d.K; y0 = Hpx - 12"),
]
for a, b in rep:
    assert a in s, a[:60]
    s = s.replace(a, b)
# barre d'échelle paramétrée (SB m) + mention d'exagération
import re
lines = s.split(chr(10))
k = next(n for n, l in enumerate(lines) if l.strip().startswith('sb = '))
ind = lines[k][:len(lines[k]) - len(lines[k].lstrip())]
lines[k] = ind + "exa = (' · hauteurs ×%g' % (d.KV / d.K)) if d.KV != d.K else ''"
lines.insert(k + 1, ind + "sb = ('<g font-size=\"9\" fill=\"#333\"><rect x=\"%.1f\" y=\"%.1f\" width=\"%.1f\" height=\"3\" fill=\"#333\"/><rect x=\"%.1f\" y=\"%.1f\" width=\"%.1f\" height=\"3\" fill=\"#fff\" stroke=\"#333\" stroke-width=\".5\"/><text x=\"%.1f\" y=\"%.1f\">0</text><text x=\"%.1f\" y=\"%.1f\" text-anchor=\"end\">%d m%s</text></g>' % (x0, y0, SB/2*d.K, x0 + SB/2*d.K, y0, SB/2*d.K, x0, y0 - 3, x0 + SB*d.K, y0 - 3, SB, exa))")
s = chr(10).join(lines)
open('sections.py', 'w', encoding='utf-8').write(s)
print('ok')
