# Plan masse coloré 1/500 de l'ind 1 : orthophoto IGN (Géoplateforme, calée en RGR92 UTM 40S) + calque SVG dans le MÊME repère (mètres maquette)
# viewBox = [x0, z0, W·mpp, H·mpp] ; le SVG est affiché à 384 × 249,6 mm pour 192 × 124,8 m → 1/500 exact sur A3.
import math, os, sys, urllib.request, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shapely.geometry import Polygon, LineString, Point, MultiPolygon
from shapely.ops import unary_union, nearest_points
import ind1_data as D

MPP, W, H = 0.08, 2400, 1560

def fetch_ortho(cx, cz, out):
    meta = out + '.json'; want = dict(cx=round(cx, 2), cz=round(cz, 2), mpp=MPP, W=W, H=H)
    if os.path.exists(out) and os.path.exists(meta) and json.load(open(meta)) == want: return True
    o = D.ORIGIN; x0 = o['E0'] + cx - W * MPP / 2; x1 = o['E0'] + cx + W * MPP / 2; y0 = o['N0'] - cz - H * MPP / 2; y1 = o['N0'] - cz + H * MPP / 2
    u = ('https://data.geopf.fr/wms-r/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ORTHOIMAGERY.ORTHOPHOTOS&STYLES=&CRS=EPSG:2975'
         '&BBOX=%f,%f,%f,%f&WIDTH=%d&HEIGHT=%d&FORMAT=image/jpeg') % (x0, y0, x1, y1, W, H)
    try:
        d = urllib.request.urlopen(u, timeout=90).read()
        if d[:2] != b'\xff\xd8': raise ValueError('pas une image')
        open(out, 'wb').write(d); json.dump(want, open(meta, 'w')); return True
    except Exception as e:
        print('  ortho IGN indisponible (%s) : repli sur l\'image existante si présente' % e); return os.path.exists(out)

P = lambda pts: ' '.join('%.2f,%.2f' % (x, z) for x, z in pts)

def txt(x, z, s, size=1.7, anchor='middle', color='#1b1b1b', weight=600, halo='#fff', rot=0, op=1):
    tr = ' transform="rotate(%.1f %.2f %.2f)"' % (rot, x, z) if rot else ''
    return '<text x="%.2f" y="%.2f" font-size="%.2f" font-weight="%d" text-anchor="%s" fill="%s" fill-opacity="%s" style="paint-order:stroke;stroke:%s;stroke-width:%.2fpx;stroke-linejoin:round"%s>%s</text>' % (x, z, size, weight, anchor, color, op, halo, size * 0.3, tr, s)

def _ext(pts, e=0.06):
    (x0, z0), (x1, z1) = pts[0], pts[-1]; L = math.hypot(x1 - x0, z1 - z0) or 1; ux, uz = (x1 - x0) / L, (z1 - z0) / L
    return [(x0 - ux * e, z0 - uz * e), (x1 + ux * e, z1 + uz * e)]

def polys(g):
    if g.is_empty: return []
    return list(g.geoms) if hasattr(g, 'geoms') else [g]

def build(out_svg, ortho_name='plan_ortho.jpg'):
    lot = Polygon(D.LOT); b = lot.bounds; cx, cz = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    ok = fetch_ortho(cx, cz, os.path.join(D.OUT, ortho_name))
    Wm, Hm = W * MPP, H * MPP; X0, Z0 = cx - Wm / 2, cz - Hm / 2; Wv = 150.0; Xv = cx - Wv / 2   # cadrage 150 x 124,8 m = 300 x 249,6 mm au 1/500, légende dans la bande de droite (HTML)
    E = []
    if ok: E.append('<image href="%s" x="%.2f" y="%.2f" width="%.2f" height="%.2f" preserveAspectRatio="none"/>' % (ortho_name, X0, Z0, Wm, Hm))
    else: E.append('<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="#d9dcd0"/>' % (X0, Z0, Wm, Hm))
    E.append('<defs><pattern id="b2u" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.4" stroke="#e23b2e" stroke-width="0.28"/></pattern></defs>')
    # voisins projetés (SIDR) — repères du PC
    for n in D.R.get('neighbours', []):
        fp = n.get('fp');
        if not fp: continue
        E.append('<polygon points="%s" fill="#6f8fd8" fill-opacity="0.45" stroke="#1d3c8c" stroke-width="0.3"/>' % P(fp))
        c = Polygon(fp).centroid; lab = n['name'].replace('SIDR ', 'SIDR · ') + (' · R+%d' % (round(n['h'] / 3) - 1) if n.get('h') else '')
        E.append(txt(c.x, c.y + 0.5, lab, 1.25, color='#17327a'))
    # B2u
    for e in D.R.get('exclusions', []):
        E.append('<polygon points="%s" fill="url(#b2u)" fill-opacity="0.9" stroke="#e23b2e" stroke-width="0.25" stroke-dasharray="1.2 0.8"/>' % P(e['poly']))
    blocks = [Polygon(bl['fp']) for bl in D.BLOCKS]
    parks = [Polygon(p['poly']) for p in D.V.get('parks', []) if p.get('poly')]
    cl = D.Q.get('cloture') or {}
    equip = Polygon(cl['poly']).buffer(0) if cl.get('poly') else None
    # ── espaces extérieurs teintés par fonction (USAGES de bve-cloture.mjs) : faces du lot découpé par les clôtures et les bâtiments ──
    FEN, ESP, fsrc = D.scenario_fences(); used = []; source_fence = bool(FEN)
    faces = {}
    if FEN and ESP:
        from shapely.ops import polygonize
        lines = [lot.boundary] + [bp.boundary for bp in blocks] + [LineString(_ext(f['pts'])) for f in FEN if len(f['pts']) == 2]
        fc = list(polygonize(unary_union(lines)))
        for e in ESP:
            hit = [g for g in fc if g.contains(Point(e['p']))]
            if hit: faces[e['usage']] = (hit[0], e['aire'], e['p'])
    for u, (g, aire, pp) in faces.items():
        col, lab = D.USAGES[u][0], D.USAGES[u][1]; used.append(u)
        E.append('<polygon points="%s" fill="%s" fill-opacity="0.78" stroke="#6a6a6a" stroke-width="0.25" stroke-opacity="0.9"/>' % (P(g.exterior.coords), col))
        if u == 'cour-enfants':
            E.append(txt(pp[0], pp[1] - 0.2, 'COUR-ENFANTS', 0.9, color='#7a3d00', rot=20)); E.append(txt(pp[0], pp[1] + 0.9, '%.0f m²' % aire, 0.9, color='#7a3d00', rot=20))
        else:
            nom = {'cour-residents': 'COUR DES RÉSIDENTS', 'equipement': 'ÉQUIPEMENT'}.get(u, lab.upper())
            E.append(txt(pp[0], pp[1] - 0.4, nom, 1.25, color='#222', rot=20)); E.append(txt(pp[0], pp[1] + 1.3, '%.0f m²' % aire, 1.25, color='#222', rot=20))
    if not faces:
        if equip is not None and not equip.is_empty:
            E.append('<polygon points="%s" fill="#f4bccb" fill-opacity="0.5" stroke="#999" stroke-width="0.25"/>' % P(equip.exterior.coords)); used.append('equipement')
    # limites
    E.append('<polygon points="%s" fill="none" stroke="#ff8a1f" stroke-width="0.8"/>' % P(D.LOT))
    if D.ENV: E.append('<polygon points="%s" fill="none" stroke="#ffe29a" stroke-width="0.3" stroke-dasharray="1.8 1"/>' % P(D.ENV))
    # stationnement
    for p in D.V.get('parks', []):
        E.append('<polygon points="%s" fill="#3d3d3d" fill-opacity="0.5" stroke="#fff" stroke-width="0.25"/>' % P(p['poly']))
        for s in p.get('stalls', []): E.append('<polygon points="%s" fill="%s" fill-opacity="0.55" stroke="#fff" stroke-width="0.12"/>' % (P(s['ring']), '#2f78c8' if s.get('pmr') else '#ffffff'))
    # lames
    for bl in D.BLOCKS:
        sur = 'parking' in bl['name']; A = bl['name'].startswith('Bât. A')
        col = '#d9853b' if A else '#c7663b'
        E.append('<polygon points="%s" fill="%s" fill-opacity="%s" stroke="#2b1a0c" stroke-width="0.4" %s/>' % (P(bl['fp']), col, '0.42' if sur else '0.72', 'stroke-dasharray="1.6 0.8"' if sur else ''))
    # étiquettes de lames (nombre de logements lus dans fit.batiments)
    byname = {x['name']: x for x in D.F['batiments']}
    for bl in D.BLOCKS:
        if 'parking' in bl['name']: continue
        pg = Polygon(bl['fp']); c = pg.centroid; ang = bl['az'] - 90
        nb = byname.get(bl['name'], {}).get('totaux', {}); n = nb.get('nLogts', 0)
        sp = byname.get(bl['name'] + '’ (sur parking)', {}).get('totaux', {}).get('nLogts', 0)
        lab = 'BÂT. %s · R+%d · %d logements' % (bl['name'][-1], bl['nlev'] - 1, n + sp)
        E.append(txt(c.x, c.y, lab, 1.7, rot=ang if abs(ang) < 90 else ang + 180))
    for bl in D.BLOCKS:
        if 'parking' in bl['name']:
            c = Polygon(bl['fp']).centroid; ang = bl['az'] - 90
            E.append(txt(c.x, c.y, bl['name'].replace('Bât. ', 'Bât. ').replace(' (sur parking)', '') + ' sur poteaux', 1.15, weight=500, rot=ang if abs(ang) < 90 else ang + 180))
    for p in D.V.get('parks', []):
        if p.get('places', 0) >= 10:
            c = Polygon(p['poly']).centroid; E.append(txt(c.x, c.y, 'P · %d places' % p['places'], 1.5, color='#fff', halo='#222', rot=0))
    # clôtures par type (grillage-haie, grille-bahut-haie) et ouvertures (portillons, battants)
    STY = {'grillage-haie': ('#7cc96a', '#1f4d1f', 0.30, None), 'grille-bahut-haie': ('#7cc96a', '#3a2f28', 0.75, '0.9 0.7')}
    for f in FEN:
        hc, lc, w, da = STY.get(f['modele'], STY['grillage-haie'])
        E.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="1.5" stroke-opacity="0.55" stroke-linecap="round" stroke-linejoin="round"/>' % (P(f['pts']), hc))
        E.append('<polyline points="%s" fill="none" stroke="%s" stroke-width="%.2f" stroke-linejoin="round"/>' % (P(f['pts']), lc, w))
        if da: E.append('<polyline points="%s" fill="none" stroke="#fff" stroke-width="0.22" stroke-dasharray="%s" stroke-linejoin="round"/>' % (P(f['pts']), da))
        for g in f['gates']:
            x, z, tx, tz = D.point_at(f['pts'], g['s']); h = g['w'] / 2
            col = '#e0662a' if g['kind'] in ('battant', 'double', 'coulissant') else '#c0392b'
            E.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="#fff" stroke-width="1.1"/>' % (x - tx * h, z - tz * h, x + tx * h, z + tz * h))
            E.append('<line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f" stroke="%s" stroke-width="0.45" stroke-linecap="round"/>' % (x - tx * h, z - tz * h, x + tx * h, z + tz * h, col))
    if not FEN:
        if cl.get('poly'): E.append('<polyline points="%s" fill="none" stroke="#2f78c8" stroke-width="0.8" stroke-dasharray="0.01 1.5" stroke-linecap="round"/>' % P(cl['poly']))
        for t in cl.get('traits', []): E.append('<polyline points="%s" fill="none" stroke="#c0392b" stroke-width="0.45"/>' % P(t))
    # arbres abattus
    felled = [t for t in D.Q['trees'] if t.get('felled')]
    for t in felled:
        r = 0.9; E.append('<g stroke="#e23b2e" stroke-width="0.35"><line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f"/><line x1="%.2f" y1="%.2f" x2="%.2f" y2="%.2f"/></g>' % (t['x'] - r, t['z'] - r, t['x'] + r, t['z'] + r, t['x'] - r, t['z'] + r, t['x'] + r, t['z'] - r))
    # accès
    cen = lot.centroid
    def marker(pt, col, lab, dx=0, dz=-3.2, anchor='middle'):
        ix, iz = cen.x - pt[0], cen.y - pt[1]; L = math.hypot(ix, iz) or 1; ix, iz = ix / L, iz / L; px, pz = -iz, ix
        tip = (pt[0] + ix * 1.2, pt[1] + iz * 1.2); b1 = (pt[0] - ix * 2.4 + px * 1.6, pt[1] - iz * 2.4 + pz * 1.6); b2 = (pt[0] - ix * 2.4 - px * 1.6, pt[1] - iz * 2.4 - pz * 1.6)
        E.append('<polygon points="%s" fill="%s" stroke="#fff" stroke-width="0.25"/>' % (P([tip, b1, b2]), col))
        E.append(txt(pt[0] - ix * 4.5 + dx, pt[1] - iz * 4.5 + dz, lab, 1.3, anchor=anchor, color=col, weight=700))
    for a in D.Q.get('acc', []):
        u = a.get('usage'); p = a['p']
        if a['kind'] == 'vehicule': marker(p, '#c0392b', 'ACCÈS VÉHICULES', 0, 0)
        else: marker(p, '#1f5fa8', {'logements': 'entrée résidents', 'FJT': 'entrée FJT', 'crèche': 'entrée crèche', 'public': 'entrée public MLE'}.get(u, 'entrée piétons'), 0, 0)
    # nord, échelle 1/500
    nx, nz = Xv + Wv - 7, Z0 + 9
    E.append('<g transform="translate(%.2f,%.2f)"><path d="M0,-4 L1.6,2 L0,1 L-1.6,2 Z" fill="#fff" stroke="#111" stroke-width="0.2"/>%s</g>' % (nx, nz, txt(0, 5.2, 'N', 1.8)))
    sx, sz = Xv + Wv - 40, Z0 + Hm - 6
    E.append('<rect x="%.2f" y="%.2f" width="36" height="6.4" fill="#fff" fill-opacity="0.88"/>' % (sx - 2, sz - 3.6))
    for i in range(4): E.append('<rect x="%.2f" y="%.2f" width="5" height="0.9" fill="%s" stroke="#111" stroke-width="0.12"/>' % (sx + 5 * i, sz, '#111' if i % 2 == 0 else '#fff'))
    E.append('<g font-size="1.3" fill="#111" font-weight="400"><text x="%.2f" y="%.2f" text-anchor="middle">0</text><text x="%.2f" y="%.2f" text-anchor="middle">10</text><text x="%.2f" y="%.2f" text-anchor="middle">20 m</text><text x="%.2f" y="%.2f" font-weight="700" font-size="1.6">1/500</text></g>' % (sx, sz - 0.7, sx + 10, sz - 0.7, sx + 20, sz - 0.7, sx + 22.5, sz + 0.9))
    nf = {m: sum(D.poly_len(f['pts']) for f in FEN if f['modele'] == m) for m in ('grillage-haie', 'grille-bahut-haie')}
    ng = {k: sum(1 for f in FEN for g in f['gates'] if g['kind'] == k) for k in ('portillon', 'battant')}
    sw = lambda inner: '<svg viewBox="0 0 14 8" width="14mm" height="8mm">%s</svg>' % inner
    rect = lambda fill, extra='': sw('<rect x="2" y="1.5" width="10" height="5" fill="%s" %s/>' % (fill, extra))
    haie = '<line x1="1" y1="4" x2="13" y2="4" stroke="#7cc96a" stroke-width="3" stroke-opacity="0.6"/>'
    L = [('Limites et bâti', [
            (sw('<line x1="1" y1="4" x2="13" y2="4" stroke="#ff8a1f" stroke-width="1.4"/>'), 'assiette FJT (%s m²)' % D.sep(D.R['site']['area'])),
            (sw('<line x1="1" y1="4" x2="13" y2="4" stroke="#ffe29a" stroke-width="0.8" stroke-dasharray="2 1.4"/>'), 'enveloppe constructible'),
            (rect('#d9853b', 'fill-opacity="0.75" stroke="#2b1a0c" stroke-width="0.5"'), 'lames A et B, R+%d, toiture 4 pans' % (D.BLOCKS[0]['nlev'] - 1)),
            (rect('#e9c9a6', 'stroke="#2b1a0c" stroke-width="0.5" stroke-dasharray="1.6 1"'), "prolongements A' et B' sur poteaux"),
            (rect('#3d3d3d', 'fill-opacity="0.6"'), 'stationnement (%d pl.)' % D.V['parkTotal']),
            (rect('#6f8fd8', 'fill-opacity="0.5" stroke="#1d3c8c" stroke-width="0.5"'), 'lot SIDR (PC NKN)'),
            (rect('url(#b2uL)', 'stroke="#e23b2e" stroke-width="0.5"'), 'B2u (+1 m), inconstructible'),
            (sw('<g stroke="#e23b2e" stroke-width="0.9"><line x1="4" y1="1.5" x2="10" y2="6.5"/><line x1="4" y1="6.5" x2="10" y2="1.5"/></g>'), 'arbre abattu (%d)' % len(felled))]),
         ('Espaces extérieurs par fonction', [(rect(D.USAGES[u][0], 'fill-opacity="0.8" stroke="#6a6a6a" stroke-width="0.5"'), D.USAGES[u][1]) for u in ('cour-residents', 'equipement', 'cour-enfants') if u in used]),
         ('Clôtures' + ((' (%s)' % ('sonde des clôtures' if fsrc == 'sonde-clotures' else 'projet BVE')) if FEN else ' — indicatif'), ([
            (sw(haie + '<line x1="1" y1="4" x2="13" y2="4" stroke="#1f4d1f" stroke-width="0.8"/>'), "grillage doublé d'une haie · %s ml" % D.sep(nf['grillage-haie'])),
            (sw(haie + '<line x1="1" y1="4" x2="13" y2="4" stroke="#3a2f28" stroke-width="1.8"/><line x1="1" y1="4" x2="13" y2="4" stroke="#fff" stroke-width="0.6" stroke-dasharray="2 1.6"/>'), "grille sur bahut doublée d'une haie · %s ml" % D.sep(nf['grille-bahut-haie'])),
            (sw('<line x1="3" y1="4" x2="11" y2="4" stroke="#fff" stroke-width="3"/><line x1="4" y1="4" x2="10" y2="4" stroke="#c0392b" stroke-width="1.2" stroke-linecap="round"/>'), 'portillon (%d)' % ng['portillon']),
            (sw('<line x1="2" y1="4" x2="12" y2="4" stroke="#fff" stroke-width="3"/><line x1="2" y1="4" x2="12" y2="4" stroke="#e0662a" stroke-width="1.2" stroke-linecap="round"/>'), 'portail battant, accès véhicules (%d)' % ng['battant'])] if FEN else
            [(sw('<line x1="1" y1="4" x2="13" y2="4" stroke="#2f78c8" stroke-width="1.6" stroke-dasharray="0.1 2.2" stroke-linecap="round"/>'), 'clôture RDC · MLE + services FJT')])),
         ('Accès', [(sw('<polygon points="7,1 12,7 2,7" fill="#c0392b"/>'), 'accès véhicules'), (sw('<polygon points="7,1 12,7 2,7" fill="#1f5fa8"/>'), 'entrées piétonnes : résidents, FJT, crèche, public MLE')])]
    legend = '<div class="leg"><h4>Légende</h4>' + ''.join('<h5>%s</h5>%s' % (t, ''.join('<div class="li">%s<span>%s</span></div>' % (i, l) for i, l in its)) for t, its in L) + \
             '<svg width="0" height="0"><defs><pattern id="b2uL" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="3" stroke="#e23b2e" stroke-width="0.7"/></pattern></defs></svg></div>'
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%.2f %.2f %.2f %.2f" font-family="Helvetica, Arial, sans-serif" style="width:300mm;height:%.1fmm;display:block">%s</svg>' % (Xv, Z0, Wv, Hm, Hm * 2, ''.join(E)))
    open(out_svg, 'w', encoding='utf-8').write(svg)
    return dict(fence_source=source_fence, fence_src_name=fsrc, n_fences=len(FEN), felled=len(felled), ortho=ok, legend=legend, fences=FEN)

if __name__ == '__main__':
    print(build(os.path.join(D.OUT, 'plan_couleur.svg')))
