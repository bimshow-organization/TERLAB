import json, math
from pyproj import Transformer
lon0, lat0 = 55.64997, -20.97108
kx = 111320 * math.cos(math.radians(lat0)); ky = 110540
T = Transformer.from_crs('EPSG:4326', 'EPSG:2975', always_xy=True)
E0, N0 = 359656, 7680461
def L(pts):  # local (x est, y nord) -> repere maquette (x = E-E0, z = -(N-N0))
    out = []
    for x, y in pts:
        e, n = T.transform(lon0 + x / kx, lat0 + y / ky); out.append([round(e - E0, 2), round(-(n - N0), 2)])
    return out
B = json.load(open('fjt_base.json')); V = json.load(open('fjt_variants.json'))
P = {'parcel': L(B['par']), 'sidr': L(B['sidr']), 'fjt': L(B['fjt']), 'env': L(B['env']), 'serv': L(B['serv']) if B['serv'] else [],
     'b2u': [L(b) for b in B['b2u']], 'variants': []}
for v in V:
    P['variants'].append({'key': v['key'], 'label': v['label'], 'parking': L(v['parking']) if v.get('parking') else None,
        'blocks': [{'name': b['name'], 'poly': L(b['poly']), 'az': b['az'], 'len': b['len'], 'nlev': b['nlev'],
                    'gallery': 'S' if b['name'].endswith('A') else 'N'} for b in v['blocks']]})
# galerie cote jardin : A (nord) -> galerie au sud ; B (sud) -> galerie au nord
open('C:/GITHUB/code-runner/data/cities/millerochesbh513/fjt-project.js', 'w').write('window.FJT_PROJECT = ' + json.dumps(P) + ';\n')
json.dump(P, open('fjt_project_city.json', 'w'))
print('ok', P['variants'][0]['blocks'][0]['poly'][:2])

# parking : rangées du générateur code-runner (tools/city/parking-layout.mjs, NF P 91-100) sur la poche ouest
import os
if os.path.exists('parking_layout.json'):
    PL = json.load(open('parking_layout.json')); Z = json.load(open('parking_zones.json'))
    for v in P['variants']:
        if v['key'] in PL:
            v['parkingLayout'] = {'rows': PL[v['key']]['rows'], 'aisles': PL[v['key']].get('aisles', []), 'stalls': PL[v['key']]['stalls'], 'pmr': PL[v['key']]['pmr'], 'zone': Z[v['key']]}
            v['parking'] = Z[v['key']]
    open('C:/GITHUB/code-runner/data/cities/millerochesbh513/fjt-project.js', 'w').write('window.FJT_PROJECT = ' + json.dumps(P) + ';\n')
    json.dump(P, open('fjt_project_city.json', 'w'))
    print('parking layout', {v['key']: v.get('parkingLayout', {}).get('stalls') for v in P['variants']})
