# Coupe territoriale ≈ 10 km des Hauts à l'océan, au droit du site (grille lointaine 20 m de la maquette)
import json, math
L = json.load(open('landscape_dump.json')); PRJ = json.load(open('fjt_project_city.json'))
ALT0 = L['alt0']; SEA = L['seaY']   # y maquette du niveau 0 NGR

def h(x, z):
    fx = (x - L['x0']) / L['step']; fz = (z - L['z0']) / L['step']
    if not (0 <= fx < L['nx'] - 1 and 0 <= fz < L['nz'] - 1): return None
    i, j = int(fx), int(fz); tx, tz = fx - i, fz - j; n = L['nx']; H = L['h']
    return ((H[j*n+i]*(1-tx) + H[j*n+i+1]*tx)*(1-tz) + (H[(j+1)*n+i]*(1-tx) + H[(j+1)*n+i+1]*tx)*tz)

fjt = PRJ['fjt']; cx = sum(q[0] for q in fjt)/len(fjt); cz = sum(q[1] for q in fjt)/len(fjt)
a = math.radians(60); u = (math.sin(a), -math.cos(a))       # vers l'ENE (océan, 4,5 km) ; −u vers les Hauts (OSO)
prof = []
for s in range(-5000, 4801, 20):
    y = h(cx + u[0]*s, cz + u[1]*s)
    if y is not None: prof.append((s, max(y, SEA)))            # sous le niveau de la mer → surface de l'eau
s0, s1 = prof[0][0], prof[-1][0]
K = 0.15; EX = 3.0; KV = K*EX
top = max(y for _, y in prof) + 60; bot = SEA - 12
W = (s1 - s0)*K; Hh = (top - bot)*KV
P = lambda s, y: ((s - s0)*K, (top - y)*KV)
pts = ' '.join('%.1f,%.1f' % P(s, y) for s, y in prof)
sea = [(s, y) for s, y in prof if y <= SEA + 0.01]
E = []
E.append('<rect x="0" y="%.1f" width="%.1f" height="%.1f" fill="#dbe9f2"/>' % (P(s0, SEA)[1], W, Hh - P(s0, SEA)[1]))   # mer
E.append('<polygon points="%s %.1f,%.1f %.1f,%.1f" fill="#fff"/>' % (pts, W, Hh, 0, Hh))
E.append('<polygon points="%s %.1f,%.1f %.1f,%.1f" fill="url(#ht)"/>' % (pts, W, Hh, 0, Hh))
E.append('<polyline points="%s" fill="none" stroke="#1d1d1d" stroke-width="1.4"/>' % pts)
# courbes de niveau horizontales
for z in range(0, int(top + ALT0), 100):
    y = P(s0, z - ALT0)[1]
    E.append('<line x1="0" x2="%.1f" y1="%.1f" y2="%.1f" stroke="#e5e5e5" stroke-width="0.4" stroke-dasharray="2 4"/><text x="3" y="%.1f" font-size="7" fill="#888">%d NGR</text>' % (W, y, y, y - 2, z))
# site
gy = h(cx, cz); x, y = P(0, gy)
E.append('<line x1="%.1f" x2="%.1f" y1="%.1f" y2="%.1f" stroke="#b5452a" stroke-width="1"/><circle cx="%.1f" cy="%.1f" r="3" fill="#b5452a"/>' % (x, x, y - 4, y - 40, x, y - 4))
E.append('<text x="%.1f" y="%.1f" font-size="9" font-weight="700" fill="#b5452a" text-anchor="middle">FJT Mille Roches (%d m NGR)</text>' % (x, y - 44, round(gy + ALT0)))
# repères
hauts = max(prof[:len(prof)//2], key=lambda p: p[1])
xh, yh = P(*hauts); E.append('<text x="%.1f" y="%.1f" font-size="8.5" fill="#555" text-anchor="start">Les Hauts de Saint-André ↑ %d m</text>' % (max(xh, 60), yh - 8, round(hauts[1] + ALT0)))
if sea:
    xs_, ys_ = P(sea[-1][0], SEA); E.append('<text x="%.1f" y="%.1f" font-size="9" fill="#2d6f96" text-anchor="end" font-style="italic">Océan Indien</text>' % (W - 4, ys_ - 16))
    
E.append('<text x="%.1f" y="%.1f" font-size="8" fill="#555">← ouest-sud-ouest (les Hauts)</text><text x="%.1f" y="%.1f" font-size="8" fill="#555" text-anchor="end">est-nord-est (océan) →</text>' % (4, Hh - 4, W - 4, Hh - 4))
# échelle
sb = 1000; bx = W - 20 - sb*K; by = 14
E.append('<g font-size="8" fill="#333"><rect x="%.1f" y="%.1f" width="%.1f" height="3" fill="#333"/><rect x="%.1f" y="%.1f" width="%.1f" height="3" fill="#fff" stroke="#333" stroke-width=".5"/><text x="%.1f" y="%.1f">0</text><text x="%.1f" y="%.1f" text-anchor="end">1 km · hauteurs ×%g</text></g>' % (bx, by, sb/2*K, bx + sb/2*K, by, sb/2*K, bx, by - 3, bx + sb*K, by - 3, EX))
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.0f %.0f" font-family="Helvetica, Arial, sans-serif"><defs><pattern id="ht" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line y2="6" stroke="#c9c1b0" stroke-width="0.6"/></pattern></defs>%s</svg>') % (W, Hh, ''.join(E))
open('coupe_territoire.svg', 'w', encoding='utf-8').write(svg)
print('ok', round(W), round(Hh), 'site', round(gy + ALT0), 'hauts', round(hauts[1] + ALT0), 'sea pts', len(sea))
