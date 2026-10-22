# Données de l'ind 1 : tout est relu depuis la planche BVE (result.json, pcmi.json, pièces SVG, GLB) — aucun chiffre en dur.
# `Scen(planche)` charge UNE planche (scénario retenu ou variante) et expose ses données. Les noms du module (R, Q, V, F, T, LG, LOT, BLOCKS,
# faitage, terrain, scenario_fences…) restent ceux du scénario par défaut (FJT_PLANCHE) pour les modules qui font `import ind1_data as D`.
import json, os, re, base64, struct, math
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__)); ETU = os.path.dirname(HERE)
OUT = os.path.join(ETU, 'report-ind1'); OLD = os.path.join(ETU, 'report')
PL = os.environ.get('FJT_PLANCHE', 'C:/GITHUB/code-runner/docs/bve-pro/planches/standre-bh513-fjt-final')

sep = lambda x: '{:,.0f}'.format(x).replace(',', ' ')
f1 = lambda x: ('%.1f' % x).replace('.', ',')
f2 = lambda x: ('%.2f' % x).replace('.', ',')

# clôtures : si la planche n'en porte pas (anciennes planches), repli sur la sortie de la sonde des clôtures du FJT final (scénario par défaut seulement)
CLOTURE_JSON = os.environ.get('FJT_CLOTURE_JSON', 'C:/GITHUB/code-runner/test/bve-shots/cloture-fjt-resultat.json')

ZONES_SONDE = {'aile ouest': ('cour-residents', 'equipement'), 'aile est': ('cour-enfants', 'equipement'), 'cour de la crèche': ('cour-residents', 'cour-enfants'),
               'cour': ('cour-residents', 'equipement'), 'limites': (None, None), 'voie': (None, None)}
USAGES = {  # teintes et libellés : src/bve/bve-cloture.mjs
    'voie': ('#d3d6da', 'Voie, trottoir'), 'parvis': ('#ecdcb6', 'Accès, parvis'), 'stationnement': ('#c7d0e0', 'Stationnement'), 'cour-residents': ('#cdeab4', 'Cour, jardin commun'),
    'jardin-privatif': ('#b4e3c8', 'Jardin privatif'), 'cour-enfants': ('#fbd4a0', 'Crèche, école (cour)'), 'equipement': ('#f4bccb', 'Équipement, salle collective'),
    'technique': ('#d9cbe8', 'Locaux techniques'), 'espace-vert': ('#a6d8ae', 'Espace vert (non accessible)'), 'servitude': ('#efe6a6', 'Servitude, réserve')}

def fence_geom(x):
    for k in ('pts', 'points', 'poly', 'ring', 'line', 'path'):
        if isinstance(x.get(k), list) and len(x[k]) >= 2: return [tuple(p[:2]) if not isinstance(p, dict) else (p['x'], p.get('z', p.get('y'))) for p in x[k]]
    return None

def fence_usage(x):
    s = ' '.join(str(x.get(k, '')) for k in ('usage', 'zone', 'fonction', 'function', 'kind', 'type', 'label', 'name', 'id')).lower()
    if 'créche' in s or 'crèche' in s or 'creche' in s: return 'creche'
    if any(w in s for w in ('équip', 'equip', 'public', 'mle', 'service')): return 'equip'
    if any(w in s for w in ('résid', 'resid', 'logement', 'cour', 'fjt')): return 'cour'
    return 'autre'

def _norm_fence(x):
    g = fence_geom(x); z = x.get('zone') if isinstance(x.get('zone'), dict) else {}
    gates = []
    for gt in x.get('gates') or []:
        if isinstance(gt, dict): gates.append(dict(kind=gt.get('kind', 'portillon'), w=gt.get('w', 1.0), s=gt.get('s', 0.0)))
        elif isinstance(gt, (list, tuple)) and len(gt) >= 3: gates.append(dict(kind=gt[0], w=gt[1], s=gt[2]))
    return dict(id=x.get('id'), pts=g, modele=x.get('modele', 'grillage-haie'), gates=gates, zone=(z.get('gauche') or z.get('usage'), z.get('droite') or z.get('exterieur')), closed=bool(x.get('closed')), attach=x.get('attach'))

def poly_len(pts): return sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))
def point_at(pts, s):
    """(x, z, tx, tz) à l'abscisse curviligne s le long de la polyligne"""
    for i in range(len(pts) - 1):
        L = math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        if s <= L or i == len(pts) - 2:
            t = min(1, max(0, s / L)) if L else 0; return pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t, (pts[i + 1][0] - pts[i][0]) / L, (pts[i + 1][1] - pts[i][1]) / L
        s -= L

def blk_key(name):
    return {'Bât. A': 'BtA', 'Bât. B': 'BtB'}.get(name) or ('BtAsurparking' if name.startswith('Bât. A') else 'BtBsurparking')

class Scen:
    """Données d'une planche BVE."""
    def __init__(self, pl, repli_clotures=False):
        self.PL = pl; self.PIECES = os.path.join(pl, 'pieces'); self._ter = None; self.repli_clotures = repli_clotures
        self.R = self.jload('sonde', 'result.json'); self.Q = self.jload('pcmi.json'); self.PJ = self.jload('planche.json')
        self.V = self.R['variants'][0]; self.F = self.V['fit']; self.T = self.F['totaux']; self.LG = self.R['logements']
        self.ORIGIN = self.Q['origin']; self.ALT0 = self.Q['alt0']
        self.BLOCKS = self.Q['blocks']            # empreintes, ngfSol, ngfFaitage (= égout), nlev, hEtage, az, len, depth
        self.LOT = self.Q['lot']; self.ENV = self.Q['env']['env']
        for b in self.BLOCKS:
            b['egout'] = b['ngfFaitage']                      # le champ « ngfFaitage » du projet est la cote d'égout (sol + nlev × hEtage)
            b['faitage'] = self.faitage(blk_key(b['name'])) or self.faitage(blk_key(b['name'].replace('’ (sur parking)', '')))
            if b['faitage'] is None: b['faitage'] = round(b['egout'] + (b['depth'] / 2 + 0.8) * 0.4040, 2)   # 22°, débord 0,80 m
            b['rdc'] = b['ngfSol']

    def jload(self, *p):
        with open(os.path.join(self.PL, *p), encoding='utf-8') as f: return json.load(f)

    def piece_text(self, name):
        p = os.path.join(self.PIECES, name + '.svg')
        return open(p, encoding='utf-8').read() if os.path.exists(p) else ''

    def faitage(self, bat_key):
        """Faîtage NGR lu dans la coupe/façade dessinée par la planche (« Faîtage 129,25 m NGR »)."""
        for n in ('dessin-v1-%s-coupe' % bat_key, 'dessin-v1-%s-facade-0' % bat_key):
            m = re.search(r'Faîtage\s+([\d,\.]+)\s*m NGR', self.piece_text(n))
            if m: return float(m.group(1).replace(',', '.'))
        return None

    def terrain(self):
        if self._ter is not None: return self._ter
        from scipy.interpolate import LinearNDInterpolator
        M = self.jload('maquette.json'); b = base64.b64decode(M['b64'])
        L, = struct.unpack('<I', b[12:16]); j = json.loads(b[20:20 + L]); off = 20 + L
        cl, = struct.unpack('<I', b[off:off + 4]); bn = b[off + 8:off + 8 + cl]
        pts = []
        for n in j['nodes']:
            if n.get('name') != 'terrain': continue
            pr = j['meshes'][n['mesh']]['primitives'][0]; a = j['accessors'][pr['attributes']['POSITION']]
            bv = j['bufferViews'][a['bufferView']]
            v = np.frombuffer(bn, '<f4', a['count'] * 3, bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(-1, 3)
            pts.append(v)
        P = np.vstack(pts)
        # Le maillage du GLB est creusé sous les bâtiments (cuvettes) : on masque l'emprise de chaque bâtiment (+1,5 m) et on interpole le terrain depuis le sol alentour.
        from shapely.geometry import Polygon as _Pg
        import shapely
        from scipy.interpolate import LinearNDInterpolator as LNI, NearestNDInterpolator as NNI
        I0 = LNI(P[:, [0, 2]], P[:, 1]); step = 1.0
        gx = np.arange(P[:, 0].min() + 1, P[:, 0].max() - 1, step); gz = np.arange(P[:, 2].min() + 1, P[:, 2].max() - 1, step)
        X, Z = np.meshgrid(gx, gz); Y = I0(X, Z)
        fps = [b['fp'] for b in self.Q['blds'] if b.get('fp')] + [b['fp'] for b in self.BLOCKS]
        mask = np.zeros(X.shape, bool)
        for fp in fps:
            pg = _Pg(fp).buffer(3.0)
            if pg.is_valid and not pg.is_empty: mask |= shapely.contains_xy(pg, X, Z)
        ok = ~mask & np.isfinite(Y)
        I1 = LNI(np.c_[X[ok], Z[ok]], Y[ok]); I2 = NNI(np.c_[X[ok], Z[ok]], Y[ok])
        Yc = I1(X, Z); bad = ~np.isfinite(Yc); Yc[bad] = I2(X[bad], Z[bad])
        Yc = np.where(mask, Yc, Y); Yc[~np.isfinite(Yc)] = P[:, 1].mean()
        from scipy.interpolate import RegularGridInterpolator as RGI
        G = RGI((gz, gx), Yc, bounds_error=False, fill_value=None)
        def th(x, z): return float(G([[z, x]])[0])
        self._ter = th; return th

    def find_fences(self):
        out = []
        for src, lab in ((self.R, 'result'), (self.V, 'variante'), (self.Q, 'pcmi')):
            for k in ('fence', 'fences', 'clotures', 'clôtures', 'cloturesBVE'):
                v = src.get(k)
                if isinstance(v, dict): v = v.get('items') or v.get('list') or [v]
                if isinstance(v, list): out += [(lab, x) for x in v if isinstance(x, dict)]
        return out

    def studios_status(self):
        """Contrôle les plans de cellules (moteur houseg) contre le programme : retourne la liste des écarts (vide = OK)."""
        ecarts = []; ty = self.LG.get('types', {}); cib = self.LG.get('cibles', {})
        t1 = ty.get('T1s'); nT1 = self.T['logements'].get('T1', 0); nT1b = self.T['logements'].get('T1bis', 0); nT2 = self.T['logements'].get('T2', 0)
        if t1 and abs(t1['shabMoy'] - cib.get('T1s', 20)) > 0.05 * cib.get('T1s', 20):
            ecarts.append('studios des plans de cellules : %s m² en moyenne pour une cible de %s m²' % (f1(t1['shabMoy']), f1(cib.get('T1s', 20))))
        if nT1b and not ty.get('T1bis'): ecarts.append('aucun T1 bis dans les plans de cellules (%d au programme)' % nT1b)
        nc = sum(v['n'] for v in ty.values()) if ty else 0
        if nc and nc != self.T['nLogts']: ecarts.append('%d cellules dessinées pour %d logements au programme' % (nc, self.T['nLogts']))
        t2 = ty.get('T2')
        if t2 and nT2 and t2['n'] != nT2: ecarts.append('%d T2 dessinés pour %d au programme' % (t2['n'], nT2))
        return ecarts

    def scenario_fences(self):
        """retourne (liste de clôtures normalisées, espaces [{usage, p, aire}], source)"""
        f = [_norm_fence(x) for _, x in self.find_fences()]
        f = [x for x in f if x['pts']]
        if f:   # espaces extérieurs calculés par BVE.Espaces dans la sonde (result.json → clotures.espaces.liste)
            esp = [dict(usage=e['usage'], p=tuple(e['p']), aire=e['aire']) for e in (((self.R.get('clotures') or {}).get('espaces') or {}).get('liste') or []) if e.get('usage') and e.get('p')]
            return f, esp, 'planche'
        if not self.repli_clotures or not os.path.exists(CLOTURE_JSON): return [], [], None
        J = json.load(open(CLOTURE_JSON, encoding='utf-8')); E = {e[0]: e[1] for e in J['etapes']}; M = J['mesures']
        ops = {o['id']: o for o in E.get('clôtures du scénario', [])}; out = []
        pts = {'op22': M['trace']['pts']}
        for oid, pp in zip(M['ailes']['ids'], M['ailes']['pts']): pts[oid] = pp
        ring = [tuple(p) for p in self.LOT]
        for oid, o in ops.items():
            if oid in pts: g = pts[oid]
            elif o.get('attach') == 'limites': g = ring[:o['nPts']]
            elif o.get('attach') == 'voie': g = (ring[o.get('debut', 6):] + [ring[0]])[:o['nPts']]   # le reste de l'anneau du lot, côté voie (la sonde clôture d'abord les limites : 7 premiers sommets)
            else: continue
            z = ZONES_SONDE.get(o.get('attach') or 'cour', (None, None))
            out.append(dict(id=oid, pts=[tuple(p) for p in g], modele=o['modele'], gates=[dict(kind=k, w=w, s=s) for k, w, s in o.get('gates', [])], zone=z, closed=False, attach=o.get('attach') or 'cour'))
        esp = [dict(usage=e['usage'], p=tuple(e['p']), aire=e['aire']) for e in M.get('espaces', {}).get('espaces', [])]
        return out, esp, 'sonde-clotures'

# ── scénario par défaut (variable FJT_PLANCHE) : noms de module conservés pour sections_ind1, facade_glb, build_report_ind1 ──
_S = Scen(PL, repli_clotures=True)
PIECES, R, Q, PJ, V, F, T, LG = _S.PIECES, _S.R, _S.Q, _S.PJ, _S.V, _S.F, _S.T, _S.LG
ORIGIN, ALT0, BLOCKS, LOT, ENV = _S.ORIGIN, _S.ALT0, _S.BLOCKS, _S.LOT, _S.ENV
jload, piece_text, faitage, terrain = _S.jload, _S.piece_text, _S.faitage, _S.terrain
find_fences, studios_status, scenario_fences = _S.find_fences, _S.studios_status, _S.scenario_fences
