import json, math, sys
from shapely.geometry import Polygon
from shapely.ops import unary_union
M = float(sys.argv[1]) if len(sys.argv) > 1 else 2.0
P = json.load(open('fjt_project_city.json'))
lot = Polygon(P['fjt']); b2u = unary_union([Polygon(b) for b in P['b2u']])
out = {}
a = math.radians(110); u = (math.sin(a), -math.cos(a))
for v in P['variants']:
    blds = [Polygon(b['poly']) for b in v['blocks']]
    west = min(min(x*u[0] + z*u[1] for x, z in b.exterior.coords) for b in blds) - M
    far = 400
    half = Polygon([(u[0]*west - u[1]*far, u[1]*west + u[0]*far), (u[0]*west + u[1]*far, u[1]*west - u[0]*far),
                    (u[0]*(west - far) + u[1]*far, u[1]*(west - far) - u[0]*far), (u[0]*(west - far) - u[1]*far, u[1]*(west - far) + u[0]*far)])
    zone = lot.intersection(half).difference(unary_union(blds).buffer(M)).difference(b2u.buffer(1)).buffer(-0.3)
    if zone.geom_type == 'MultiPolygon': zone = max(zone.geoms, key=lambda g: g.area)
    out[v['key']] = [list(map(lambda q: round(q, 2), c)) for c in zone.exterior.coords]
    print(v['key'], round(zone.area))
json.dump(out, open('parking_zones.json', 'w'))
