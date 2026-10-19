# Carte PPRN (zonage réglementaire PEIGEO / BRGM 2026) sur fond de plan — repère maquette (x est, z sud)
import json, math
from pyproj import Transformer
from shapely.geometry import shape, Polygon, LineString, box, Point
from shapely.ops import transform

D = json.load(open('city_dump.json')); RD = json.load(open('roads_dump.json')); PRJ = json.load(open('fjt_project_city.json'))
E0, N0 = D['origin']['E0'], D['origin']['N0']
T = Transformer.from_crs('EPSG:4326', 'EPSG:2975', always_xy=True)
def loc(x, y, z=None):
    e, n = T.transform(x, y); return (e - E0, -(n - N0))

STY = {  # code : (remplissage, trait, libellé)
 'R1':  ('#d7301f', '#a50f15', 'R1 — inondation, aléa fort : interdiction'),
 'R2':  ('#f16913', '#b8470a', 'R2 — inondation + mouvement de terrain : interdiction'),
 'B2':  ('#6baed6', '#2171b5', 'B2 — inondation + mouvement de terrain : prescriptions'),
 'B2u': ('#9e9ac8', '#6a51a3', 'B2u — inondation + mvt de terrain (urbain) : prescriptions'),
 'B3':  ('#c7e9c0', '#41ab5d', 'B3 — inondation, aléa faible : prescriptions'),
}
ORDER = ['B3', 'B2', 'B2u', 'R2', 'R1']

def carte(fname='ppr_map.svg', W=190, H=135, K=5.0):
    fjt = Polygon(PRJ['fjt']); c = fjt.centroid
    ox, oz = c.x - W/2 + 4, c.y - H/2 + 4
    view = box(ox, oz, ox + W, oz + H)
    P = lambda pts: ' '.join('%.1f,%.1f' % ((x - ox)*K, (z - oz)*K) for x, z in pts)
    E = []
    for r in RD:
        ls = LineString(r['pts'])
        if ls.intersects(view.buffer(20)):
            E.append('<polyline points="%s" fill="none" stroke="#e2dfd9" stroke-width="%.1f" stroke-linecap="round" stroke-linejoin="round"/>' % (P(r['pts']), max(3.0, r['w'])*K))
    zones = json.load(open('ppr_wfs_large.json', encoding='utf-8'))['features']
    present = []
    for code in ORDER:
        for f in zones:
            if f['properties']['code_degre'] != code: continue
            g = transform(loc, shape(f['geometry'])).buffer(0).intersection(view)
            if g.is_empty: continue
            present.append(code)
            for pg in (g.geoms if hasattr(g, 'geoms') else [g]):
                if pg.geom_type != 'Polygon' or pg.area < 1: continue
                d = 'M' + ' L'.join('%.1f,%.1f' % ((x - ox)*K, (z - oz)*K) for x, z in pg.exterior.coords) + ' Z'
                for hole in pg.interiors: d += ' M' + ' L'.join('%.1f,%.1f' % ((x - ox)*K, (z - oz)*K) for x, z in hole.coords) + ' Z'
                fill, stroke, _ = STY[code]
                E.append('<path d="%s" fill="%s" fill-opacity="0.55" fill-rule="evenodd" stroke="%s" stroke-width="0.8"/>' % (d, fill, stroke))
    for b in D['buildings']:
        pg = Polygon(b['fp'])
        if pg.intersects(view): E.append('<polygon points="%s" fill="#f4f2ee" fill-opacity="0.85" stroke="#8d887e" stroke-width="0.5"/>' % P(b['fp']))
    E.append('<polygon points="%s" fill="none" stroke="#4a5f8a" stroke-width="1.2" stroke-dasharray="6 3"/>' % P(PRJ['sidr']))
    E.append('<polygon points="%s" fill="none" stroke="#ff8a1f" stroke-width="2.4"/>' % P(PRJ['fjt']))
    E.append('<polygon points="%s" fill="none" stroke="#111" stroke-width="1.4"/>' % P(PRJ['parcel']))
    fx, fz = (c.x - ox)*K, (c.y - oz)*K
    E.append('<text x="%.1f" y="%.1f" font-size="11" font-weight="700" text-anchor="middle" fill="#7a3b00" style="paint-order:stroke;stroke:#fff;stroke-width:3px">FJT</text>' % (fx, fz))
    s = Polygon(PRJ['sidr']).centroid
    E.append('<text x="%.1f" y="%.1f" font-size="9" text-anchor="middle" fill="#4a5f8a" style="paint-order:stroke;stroke:#fff;stroke-width:3px">lot SIDR</text>' % ((s.x - ox)*K, (s.y - oz)*K))
    # légende
    seen = [c_ for c_ in ORDER[::-1] if c_ in present]
    lx, ly = 10, H*K - 16 - 15*len(seen)
    E.append('<rect x="%d" y="%d" width="300" height="%d" fill="#fff" fill-opacity="0.92" stroke="#bbb" stroke-width="0.5"/>' % (lx - 5, ly - 16, 15*len(seen) + 22))
    E.append('<text x="%d" y="%d" font-size="9" font-weight="700" fill="#333">PPRN Saint-André (BRGM 2026) — zonage réglementaire</text>' % (lx, ly - 4))
    for i, code in enumerate(seen):
        fill, stroke, lab = STY[code]; y = ly + 6 + 15*i
        E.append('<rect x="%d" y="%d" width="16" height="10" fill="%s" fill-opacity="0.55" stroke="%s" stroke-width="0.8"/><text x="%d" y="%d" font-size="8.5" fill="#333">%s</text>' % (lx, y, fill, stroke, lx + 22, y + 9, lab))
    Wp, Hp = W*K, H*K
    E.append('<g transform="translate(%.1f,30)"><path d="M0,-16 L6,8 L0,3 L-6,8 Z" fill="#222"/><text y="20" font-size="10" text-anchor="middle">N</text></g>' % (Wp - 24))
    sx, sy = Wp - 20 - 20*K, Hp - 14
    E.append('<g font-size="8" fill="#333"><rect x="%.1f" y="%.1f" width="%.1f" height="3" fill="#333"/><rect x="%.1f" y="%.1f" width="%.1f" height="3" fill="#fff" stroke="#333" stroke-width=".5"/><text x="%.1f" y="%.1f">0</text><text x="%.1f" y="%.1f" text-anchor="end">20 m</text></g>' % (sx, sy, 10*K, sx + 10*K, sy, 10*K, sx, sy - 3, sx + 20*K, sy - 3))
    open(fname, 'w', encoding='utf-8').write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %.0f %.0f" font-family="Helvetica, Arial, sans-serif"><rect width="100%%" height="100%%" fill="#fbfaf7"/>%s</svg>' % (Wp, Hp, ''.join(E)))
    # surfaces par zone sur la parcelle et sur le lot FJT
    out = {}
    for f in zones:
        code = f['properties']['code_degre']; g = transform(loc, shape(f['geometry'])).buffer(0)
        out[code] = {'parcelle': round(g.intersection(Polygon(PRJ['parcel'])).area), 'fjt': round(g.intersection(fjt).area)}
    print('zones visibles', seen, out)
    json.dump(out, open('ppr_surfaces.json', 'w'))

carte()
