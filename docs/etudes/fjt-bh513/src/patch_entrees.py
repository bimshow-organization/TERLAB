# Entrées piétonnes / véhicules sur le plan masse (convention des faisas MGA : triangle rouge = véhicules, bleu = piétons)
s = open('plan.py', encoding='utf-8').read()
anchor = "    # contour parcelle BH 513"
add = r'''    if V:
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
            pk = Polygon(V['parking']); _, pv = nearest_points(pk, front)
            marker(pv, inward_of(pv), '#c0392b', 'ACCÈS VÉHICULES', 'end', -6, 10)
        # entrée piétonne principale : prolongement du jardin (axe de la noue) jusqu'à la limite est/sud-est
        far = LineString([(mx, mz), (mx + u[0] * 120, mz + u[1] * 120)]).intersection(front)
        if not far.is_empty:
            pe = far if far.geom_type == 'Point' else min(far.geoms, key=lambda g: g.distance(Point(mx, mz)))
            marker(pe, (-u[0], -u[1]), '#1f5fa8', 'ENTRÉE PIÉTONS — accueil par le jardin', 'end', -8, -8)
            add('<polyline points="%s" fill="none" stroke="#1f5fa8" stroke-width="1.1" stroke-dasharray="4 3"/>' % pts([(pe.x, pe.y), (mx + u[0] * 21, mz + u[1] * 21)], K, ox, oz))
        # entrée piétonne secondaire : depuis le chemin sud, entre le parking et le bâtiment B
        bw = Polygon(B['poly']); pkc = Polygon(V['parking']).centroid if V['parking'] else bw.centroid
        tgt = Point((pkc.x + bw.centroid.x) / 2, (pkc.y + bw.centroid.y) / 2)
        _, ps = nearest_points(tgt, front)
        marker(ps, inward_of(ps), '#1f5fa8', 'entrée piétons', 'start', 6, 12)
'''
assert anchor in s and 'ACCÈS VÉHICULES' not in s
s = s.replace(anchor, add + anchor, 1)
open('plan.py', 'w', encoding='utf-8').write(s)
print('ok')
