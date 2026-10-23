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

# ── Rendu au trait en noir et blanc (élévation) : murs blancs, vitrages gris clair, toitures hachurées dans le sens de la pente,
# arêtes vives seulement (angle dièdre > 25° ou changement de matériau ou bord libre), épaisseurs hiérarchisées, contour épais.
ANG_COS = math.cos(math.radians(25))
CLS = [(re.compile(r'baie|vitr', re.I), 'glass'), (re.compile(r'toit|couverture', re.I), 'roof'), (re.compile(r'garde', re.I), 'guard'),
       (re.compile(r'jalousie', re.I), 'louvre'), (re.compile(r'menuiserie|porte|cadre|varangue', re.I), 'joinery'),
       (re.compile(r'voiture|marquage|sol-parking|maillage', re.I), 'skip')]
def _cls(role):
    name = role.split('·')[-1].strip() if '·' in role else role.strip()
    for rx, c in CLS:
        if rx.search(name): return c
    return 'wall'
RB = 15   # pas angulaire des hachures de toiture (degrés)
def roof_patterns():
    p = []
    for a in range(0, 180, RB):   # ligne de pente d'angle a (écran, y vers le bas) : motif de traits verticaux tournés de a-90
        p.append('<pattern id="fj-r%d" width="1.7" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(%d)"><rect width="1.7" height="8" fill="#fff"/>'
                 '<line x1="0.85" y1="0" x2="0.85" y2="8" stroke="#000" stroke-width="0.14"/></pattern>' % (a, a - 90))
    return ''.join(p)
STYLE = ('<style>.fjw{fill:#fff;stroke:#fff;stroke-width:.3}.fjg{fill:#d4d4d4;stroke:#d4d4d4;stroke-width:.3}.fjj{fill:#fff;stroke:#fff;stroke-width:.2}'
         '.fe{fill:none;stroke:#000;stroke-linecap:round}.f1{stroke-width:.55}.f2{stroke-width:.35}.f3{stroke-width:.28}.f4{stroke-width:.07}'
         + ''.join('.fjr%d{fill:url(#fj-r%d);stroke:#fff;stroke-width:.2}' % (a, a) for a in range(0, 180, RB)) + '</style>')

def render_bw(d):
    """(éléments SVG, contour épais) d'un plan de façade `d` : peintre trié en profondeur, chaque triangle suivi de ses seules arêtes vives"""
    r = projet_triangles()
    if not r: return [], ''
    tri, col, roles, _ = r
    cl = np.array([_cls(x) for x in roles]); k = cl != 'skip'; tri, cl = tri[k], cl[k]; n = len(tri)
    v = np.array([d.v[0], 0, d.v[1]])
    nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]); ln = np.linalg.norm(nrm, axis=1); ln[ln == 0] = 1; nrm = nrm / ln[:, None]
    cen = tri.mean(1)
    if np.mean(np.einsum('ij,ij->i', nrm, cen - cen.mean(0))) < 0: nrm = -nrm
    # arêtes : sommets soudés au millimètre, puis tri des arêtes par paire
    vid = np.unique(np.round(tri.reshape(-1, 3), 3), axis=0, return_inverse=True)[1].reshape(-1)
    nv = vid.max() + 1; vpos = np.zeros((nv, 3)); vpos[vid] = tri.reshape(-1, 3); vid = vid.reshape(n, 3)
    E = np.stack([vid[:, [0, 1]], vid[:, [1, 2]], vid[:, [2, 0]]], 1).reshape(-1, 2); E.sort(1); T = np.repeat(np.arange(n), 3)
    key = E[:, 0].astype(np.int64) * nv + E[:, 1]; order = np.argsort(key, kind='stable'); key, E, T = key[order], E[order], T[order]
    brk = np.flatnonzero(np.diff(key)) + 1; starts = np.r_[0, brk]; ends = np.r_[brk, len(key)]
    feats = []
    for s0, e0 in zip(starts, ends):
        ts = T[s0:e0]
        if e0 - s0 == 2 and ts[0] != ts[1] and cl[ts[0]] == cl[ts[1]] and nrm[ts[0]] @ nrm[ts[1]] > ANG_COS: continue   # arête de triangulation
        feats.append((E[s0][0], E[s0][1], ts))
    vis = (nrm @ v) < -0.02
    depth = (cen[:, 0] - d.O[0]) * d.v[0] + (cen[:, 2] - d.O[1]) * d.v[1]
    idx = np.flatnonzero(vis & (depth > -1)); idx = idx[np.argsort(-depth[idx], kind='stable')]
    rank = np.full(n, -1); rank[idx] = np.arange(len(idx))
    sx = lambda P: ((P[..., 0] - d.O[0]) * d.right[0] + (P[..., 2] - d.O[1]) * d.right[1] - d.span[0]) * d.K
    px = sx(tri); py = (d.yhi - tri[:, :, 1]) * d.K
    own = {}
    for a, b, ts in feats:
        rk = [(rank[t], t) for t in ts if rank[t] >= 0]
        if rk: own.setdefault(max(rk)[1], []).append((a, b, ts))   # l'arête est tracée avec le dernier triangle dessiné qui la touche
    out, polys = [], []
    for t in idx:
        c = cl[t]
        pts = [(px[t, q], py[t, q]) for q in range(3)]
        if c not in ('guard', 'louvre') and len({(round(x, 1), round(y, 1)) for x, y in pts}) == 3:
            if c == 'roof':
                g = nrm[t]; sxd = (g[0] * g[1]) * d.right[0] + (g[2] * g[1]) * d.right[1]; syd = 1 - g[1] ** 2     # descente de plus grande pente projetée (écran, y vers le bas)
                a = math.degrees(math.atan2(syd, sxd)) % 180; cls = 'fjr%d' % (int(round(a / RB)) * RB % 180)
            else: cls = {'wall': 'fjw', 'glass': 'fjg', 'joinery': 'fjj'}[c]
            out.append('<polygon class="%s" points="%s"/>' % (cls, ' '.join('%.1f,%.1f' % p for p in pts))); polys.append(pts)
        for a, b, ts in own.get(t, ()):
            cs = {cl[x] for x in ts}; A, B = vpos[a], vpos[b]
            xa, xb = sx(A), sx(B); ya, yb = (d.yhi - A[1]) * d.K, (d.yhi - B[1]) * d.K
            if abs(xa - xb) + abs(ya - yb) < 0.05: continue
            w = 'f1' if cs & {'wall', 'roof'} else 'f2' if cs & {'glass', 'joinery'} else ('f3' if np.linalg.norm(A - B) > 0.8 else 'f4')
            out.append('<path class="fe %s" d="M%.1f,%.1fL%.1f,%.1f"/>' % (w, xa, ya, xb, yb))
    outline = ''
    try:
        from shapely.geometry import Polygon as SP
        from shapely.ops import unary_union
        u = unary_union([SP(p).buffer(0.2) for p in polys if SP(p).area > 1e-4]).buffer(-0.15)
        dd = ''.join('M' + 'L'.join('%.1f,%.1f' % q for q in g.exterior.simplify(0.1).coords) + 'Z' for g in (u.geoms if hasattr(u, 'geoms') else [u]))
        outline = '<path d="%s" fill="none" stroke="#000" stroke-width="1.25" stroke-linejoin="round"/>' % dd
    except Exception as e: print('contour:', e)
    return out, outline

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
