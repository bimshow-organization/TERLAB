# Projection des triangles du GLB détaillé du projet sur un plan de façade (algorithme du peintre : tri par profondeur, une teinte par matériau, contours).
# Repère GLB : x est, y haut, z sud. Plan de façade : abscisse = S(x,z) (droite de l'observateur), ordonnée = y, profondeur = T(x,z).
import base64, json, math, struct, re, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ind1_data as D

DETAIL_RE = re.compile(r'baie|coursive|varangue|garde|toit|menuiserie|fenetre|fenêtre|porte', re.I)
ROLE_COL = [  # nom de matériau ou de nœud → teinte (si le GLB détaillé nomme les rôles)
    (re.compile(r'baie|vitr|fenetre|fenêtre', re.I), '#4f6f85'), (re.compile(r'garde', re.I), '#8a5f38'), (re.compile(r'coursive|dalle|plancher', re.I), '#e4dccb'),
    (re.compile(r'toit|couverture', re.I), '#8e9ea8'), (re.compile(r'menuiserie|porte|cadre', re.I), '#3a3a3a'), (re.compile(r'bardage|bois', re.I), '#c9a27a'),
    (re.compile(r'mur|facade|façade|enduit', re.I), '#f1e6d0')]

_CACHE = {}
def _glb():
    if 'g' in _CACHE: return _CACHE['g']
    M = D.jload('maquette.json'); b = base64.b64decode(M['b64'])
    L, = struct.unpack('<I', b[12:16]); j = json.loads(b[20:20 + L]); off = 20 + L
    cl, = struct.unpack('<I', b[off:off + 4]); _CACHE['g'] = (j, b[off + 8:off + 8 + cl]); return _CACHE['g']

def _acc(j, bn, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    dt = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1'}[a['componentType']]
    return np.frombuffer(bn, dt, a['count'] * n, bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], n)

def projet_triangles():
    """triangles (N,3,3) du projet, couleurs de sommet (N,3) ou None, nom de rôle par triangle, et drapeau « détail »"""
    j, bn = _glb()
    from shapely.geometry import box
    lb = D.Polygon_bounds() if hasattr(D, 'Polygon_bounds') else None
    xs = [p[0] for p in D.LOT]; zs = [p[1] for p in D.LOT]; x0, x1, z0, z1 = min(xs) - 4, max(xs) + 4, min(zs) - 4, max(zs) + 4
    T, C, ROLES = [], [], []; detail = False
    for n in j['nodes']:
        if 'mesh' not in n or not ((n.get('name') or '').startswith('projet') or n.get('name') == 'maillage'): continue   # « projet » ou « projet · Bât. X · <matériau> » (GLB détaillé du 22/10)
        mesh = j['meshes'][n['mesh']]
        for pr in mesh['primitives']:
            pos = _acc(j, bn, pr['attributes']['POSITION']).astype(float)
            if not (pos[:, 0].min() >= x0 and pos[:, 0].max() <= x1 and pos[:, 2].min() >= z0 and pos[:, 2].max() <= z1): continue   # bâtiment voisin, route ou arbre : hors projet
            idx = _acc(j, bn, pr['indices']).reshape(-1) if 'indices' in pr else np.arange(len(pos))
            tri = pos[idx].reshape(-1, 3, 3); T.append(tri)
            col = _acc(j, bn, pr['attributes']['COLOR_0'])[:, :3].astype(float)[idx].reshape(-1, 3, 3).mean(1) if 'COLOR_0' in pr['attributes'] else None
            mat = j['materials'][pr['material']] if 'material' in pr else {}
            role = '%s %s %s' % (n.get('name', ''), mat.get('name', ''), mesh.get('name', ''))
            C.append(col if col is not None else np.full((len(tri), 3), np.nan)); ROLES += [role] * len(tri)
            if DETAIL_RE.search(role) or len(tri) > 4000: detail = True
    # le GLB détaillé peut aussi marquer le détail par des nœuds nommés
    if any(DETAIL_RE.search(n.get('name', '') or '') for n in j['nodes']): detail = True
    if not T: return None
    return np.vstack(T), np.vstack(C), np.array(ROLES), detail

def has_detail():
    r = projet_triangles(); return bool(r and r[3])

def srgb(c): return np.clip(c, 0, 1) ** (1 / 2.2)

def render(d, flat_role_colors=True, light=(-0.45, 0.8, -0.4)):
    """retourne les éléments SVG (liste) d'un plan de façade `d` (objet Dr de sections_ind1) ; d.P convertit (s, y) en pixels"""
    r = projet_triangles()
    if not r: return []
    tri, col, roles, _ = r
    v = np.array([d.v[0], 0, d.v[1]]); right = np.array([d.right[0], 0, d.right[1]])
    # normales géométriques
    nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); ln = np.linalg.norm(nrm, axis=1); ln[ln == 0] = 1; nrm = nrm / ln[:, None]
    # cohérence d'orientation : si le maillage est orienté vers l'intérieur, on inverse (test sur le centre de masse)
    cen = tri.mean(1); gc = cen.mean(0)
    if np.mean(np.einsum('ij,ij->i', nrm, cen - gc)) < 0: nrm = -nrm
    vis = np.einsum('ij,j->i', nrm, v) < 0.02          # la face regarde l'observateur
    tri, col, roles, nrm, cen = tri[vis], col[vis], roles[vis], nrm[vis], cen[vis]
    depth = (cen[:, 0] - d.O[0]) * d.v[0] + (cen[:, 2] - d.O[1]) * d.v[1]
    keep = depth > -1; tri, col, roles, nrm, depth = tri[keep], col[keep], roles[keep], nrm[keep], depth[keep]
    order = np.argsort(-depth); tri, col, roles, nrm = tri[order], col[order], roles[order], nrm[order]
    L = np.array(light); L = L / np.linalg.norm(L); sh = 0.62 + 0.38 * np.clip(nrm @ L, 0, 1)
    out = []; cache = {}
    for i in range(len(tri)):
        t = tri[i]; pts = []
        for q in t:
            s = (q[0] - d.O[0]) * d.right[0] + (q[2] - d.O[1]) * d.right[1]; px, py = d.P(s, q[1]); pts.append('%.1f,%.1f' % (px, py))
        if len(set(pts)) < 3: continue
        rc = None
        if flat_role_colors:
            for rx, hexc in ROLE_COL:
                if rx.search(roles[i]) and DETAIL_RE.search(roles[i]): rc = hexc; break
        if rc: base = np.array([int(rc[k:k + 2], 16) for k in (1, 3, 5)]) / 255.0
        elif not np.isnan(col[i][0]): base = srgb(col[i])
        else: base = np.array([0.8, 0.8, 0.8])
        c = np.clip(base * sh[i], 0, 1); hx = '#%02x%02x%02x' % tuple(int(x * 255) for x in c)
        out.append('<polygon points="%s" fill="%s" stroke="%s" stroke-width="0.25" stroke-linejoin="round"/>' % (' '.join(pts), hx, hx))
    return out
