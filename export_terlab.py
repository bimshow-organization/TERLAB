#!/usr/bin/env python3
"""
TERLAB · Exporteur de projet — v1.0
=====================================
Application pédagogique d'analyse de terrain — ÉARL Réunion
Hébergé par BIMSHOW · MGA Architecture · Saint-Leu, La Réunion

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  GUIDE AGENTS — COMMENT UTILISER CE SCRIPT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✅ WORKFLOWS RECOMMANDÉS :

  1. AUDIT GÉNÉRAL → Claude.ai (uploader le fichier exporté)
     python export_terlab.py --mode audit
     → Uploader TERLAB_export_audit_*.txt sur claude.ai
     → Claude analyse la structure complète et propose un plan

  2. PHASE SPÉCIFIQUE → Claude Code (cibler une phase HTML)
     python export_terlab.py --mode phase --phase p03
     → Export phase 3 (risques) + composants partagés + JSON data
     → Soumettre à Claude Code pour travailler sur cette phase

  3. COMPOSANT → Claude Code (cibler un composant JS)
     python export_terlab.py --mode composant --composant map-viewer
     → Export map-viewer.js + phases qui l'utilisent + session-manager

  4. DATA → JSON uniquement
     python export_terlab.py --mode data
     → Tous les JSON de data/ (phases-meta, acteurs, risques, demos…)

  5. INTEGRATION BIMSHOW → Bridge + IFC + shell
     python export_terlab.py --mode bimshow
     → index.js + bimshow-bridge.js + ifc-worker.js + index.html

  6. FULL → Export complet (attention à la taille)
     python export_terlab.py --mode full
     → Tous les fichiers TERLAB (~400Ko texte brut)

  7. REVIEW → Fichiers modifiés récemment
     python export_terlab.py --mode changes --days 3

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MODULES TERLAB :
  phases      → 14 fichiers HTML p00-p13 (phases pédagogiques)
  components  → 8 composants JS partagés (session, map, export…)
  data        → 7 fichiers JSON (meta, acteurs, risques, demos…)
  assets      → 3 CSS (shell, map, print)
  workers     → ifc-worker.js (export IFC 2x3)
  stubs       → georisques-proxy.js (Firebase Function)
  shell       → index.html + index.js (SPA router)
  docs        → README.md + CLAUDE_CODE_INTEGRATION_PROMPT.md

Usage :
  python export_terlab.py --mode audit
  python export_terlab.py --mode phase --phase p03
  python export_terlab.py --mode phase --phase p07
  python export_terlab.py --mode composant --composant map-viewer
  python export_terlab.py --mode composant --composant session-manager
  python export_terlab.py --mode data
  python export_terlab.py --mode bimshow
  python export_terlab.py --mode full
  python export_terlab.py --mode changes --days 3
  python export_terlab.py --mode full --gzip
"""

import os, re, sys, gzip, argparse
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict

# ─── Configuration ────────────────────────────────────────────────

TERLAB_MODULES = {
    'phases'     : '14 phases HTML pédagogiques (p00 → p13)',
    'components' : '8 composants JS partagés (session, map, export, bridge…)',
    'data'       : '7 JSON de configuration (phases-meta, acteurs, risques, demos…)',
    'assets'     : '3 CSS (shell design system · map Mapbox · print PDF)',
    'workers'    : 'Workers JS (ifc-worker — export IFC 2x3)',
    'stubs'      : 'Stubs à implémenter (georisques-proxy Firebase Function)',
    'shell'      : 'Shell SPA : index.html + index.js (router, injection phases)',
    'docs'       : 'Documentation : README.md + CLAUDE_CODE_INTEGRATION_PROMPT.md',
}

PHASE_MAP = {
    'p00': ('identification',  'dark',  'Cadastre IGN WFS + WMTS · Bloquante'),
    'p01': ('topographie',     'dark',  'DEM 3D + profil Chart.js + ravines · Bloquante'),
    'p02': ('geologie',        'earth', 'BRGM stub + séisme Eurocode 8 · Bloquante'),
    'p03': ('risques',         'risk',  'PPRN + slider inondation + cyclones · Bloquante'),
    'p04': ('plu',             'dark',  'PLU + RTAA DOM + reculs canvas'),
    'p05': ('voisinage',       'dark',  'Bâtiments 3D Mapbox + réseaux'),
    'p06': ('biodiversite',    'ivory', 'Parc National + espèces protégées + TVB'),
    'p07': ('esquisse',        'dark',  'Three.js gabarit + checks PLU auto + BIMSHOW bridge'),
    'p08': ('chantier',        'site',  'Risques sanitaires tropicaux + saison cyclonique'),
    'p09': ('carbone',         'green', 'ACV matériaux + Chart.js comparatif'),
    'p10': ('entretien',       'earth', 'Durabilité tropicale + termites + corrosion'),
    'p11': ('fin-de-vie',      'green', 'Économie circulaire + ILEVA + réemploi'),
    'p12': ('synthese',        'dark',  'Exports PDF A3/DXF/GLB/IFC + QR code Firebase'),
    'p13': ('world',           'world', 'Globe Köppen rotatif + partenariats ÉARL'),
}

COMPOSANT_MAP = {
    'session-manager' : 'UUID anonyme + localStorage + Firebase RTDB sync',
    'map-viewer'      : 'Wrapper Mapbox GL v3 — 10 modes carte + profil + mesure',
    'bimshow-bridge'  : 'postMessage BIMSHOW — envoi GLB + réception snapshot',
    'export-engine'   : 'PDF jsPDF A3 + DXF ASCII + GLB + JSON session',
    'source-modal'    : 'Modal références bibliographiques par phase',
    'demo-loader'     : 'Chargeur scénarios démo (ville/village/isolé)',
    'qr-code'         : 'QR code session TERLAB (3 méthodes + fallback)',
}

IGNORE_DIRS = {'node_modules', '.git', '__pycache__', '.angular', 'dist', 'build'}

ALL_EXT  = {'.js', '.html', '.css', '.json', '.md', '.py'}
JS_EXT   = {'.js'}
CSS_EXT  = {'.css'}
HTML_EXT = {'.html'}
JSON_EXT = {'.json'}
DOC_EXT  = {'.md'}

MAX_FILE_MB   = 2.0
TOKEN_BUDGET  = 180_000
CHARS_PER_TOK = 4

SEP  = '─' * 100
SEP2 = '═' * 100


# ─── Helpers ──────────────────────────────────────────────────────

def estimate_tokens(text: str) -> int:
    return len(text) // CHARS_PER_TOK

def fmt_size(n: int) -> str:
    if n < 1024:        return f'{n}o'
    if n < 1024**2:     return f'{n//1024}Ko'
    return f'{n//1024**2:.1f}Mo'

def get_mtime(path: Path) -> datetime:
    return datetime.fromtimestamp(path.stat().st_mtime)

def is_recent(path: Path, days: int) -> bool:
    return get_mtime(path) > datetime.now() - timedelta(days=days)

def collect_files(root: Path, exts: set, days: int = None) -> list[Path]:
    files = []
    for p in sorted(root.rglob('*')):
        if p.is_dir(): continue
        if any(part in IGNORE_DIRS for part in p.parts): continue
        if p.suffix.lower() not in exts: continue
        if p.stat().st_size > MAX_FILE_MB * 1024 * 1024: continue
        if days and not is_recent(p, days): continue
        files.append(p)
    return files

def read_file(path: Path) -> str:
    try:
        return path.read_text(encoding='utf-8', errors='replace')
    except Exception as e:
        return f'[ERREUR LECTURE : {e}]'

def file_header(path: Path, root: Path) -> str:
    rel     = path.relative_to(root)
    mtime   = get_mtime(path).strftime('%Y-%m-%d %H:%M')
    size    = fmt_size(path.stat().st_size)
    return f'\n{SEP}\n📄 {rel}\n   Modifié : {mtime} · Taille : {size}\n{SEP}\n'

def count_stubs(content: str) -> int:
    return content.count('⚠️ STUB') + content.count('// ⚠️ STUB')

def extract_phase_info(html: str) -> dict:
    """Extrait les métadonnées d'un fichier de phase HTML."""
    info = {}
    m = re.search(r'Phase\s+(\d+)\s*·\s*(.*?)\n', html)
    if m:
        info['phase'] = m.group(1)
        info['desc']  = m.group(2).strip()
    stubs = count_stubs(html)
    if stubs: info['stubs'] = stubs
    # Compter les check-items
    checks = len(re.findall(r'class="check-item', html))
    if checks: info['validations'] = checks
    return info


# ─── Sections de contexte ─────────────────────────────────────────

def build_project_context(root: Path) -> str:
    lines = [SEP2,
             'TERLAB · Laboratoire d\'Analyse de Terrain · ÉARL — Île de La Réunion',
             'MGA Architecture · Mathias Giraud · Saint-Leu, La Réunion (UTC+4)',
             SEP2, '']

    lines += [
        '🏗 STACK TECHNIQUE',
        '  Frontend    : Vanilla JS ES2022+ · Aucun framework · Modules natifs',
        '  Cartographie: Mapbox GL JS v3.7 (token requis)',
        '  3D          : Three.js r182 (partagé avec BIMSHOW)',
        '  Graphiques  : Chart.js v4',
        '  Export PDF  : jsPDF v2.5 + html2canvas v1.4',
        '  Persistence : Firebase RTDB v10 (sessions anonymes UUID)',
        '  Hébergement : bimshow.io/terlab (fichiers statiques depuis BIMSHOW)',
        '  Design      : 7 thèmes CSS (dark/ivory/risk/earth/site/green/world)',
        '',
        '⚠️ RÈGLES IMPÉRATIVES',
        '  1. Vanilla JS uniquement — jamais de npm/bundler côté client',
        '  2. Three.js partagé : toujours vérifier window.THREE en premier',
        '  3. Communication BIMSHOW via postMessage uniquement',
        '  4. Session anonyme : UUID aléatoire, jamais de données nominatives',
        '  5. Thème CSS via document.documentElement.dataset.theme = \'xxx\'',
        '  6. Tout stub = .stub-warning dans l\'UI + commentaire // ⚠️ STUB',
        '',
        '🗂 MODULES',
    ]
    for name, desc in TERLAB_MODULES.items():
        lines.append(f'  {name:<14} {desc}')

    lines += ['',
              '📋 14 PHASES (0–13)',
              '  BLOQUANTES (0-3) : complétude obligatoire avant accès phases suivantes']
    for slug, (name, theme, desc) in PHASE_MAP.items():
        blocking = '🔒 ' if slug in ('p00','p01','p02','p03') else '   '
        lines.append(f'  {blocking}{slug} · {name:<18} [{theme}] {desc}')

    lines += ['',
              '🔌 APIs UTILISÉES',
              '  data.geopf.fr/wfs           Géométrie parcelles IGN (gratuite)',
              '  data.geopf.fr/wmts           Tuiles cadastre + ortho (gratuite)',
              '  data.geopf.fr/geocodage      Géocodage adresses (gratuite)',
              '  georisques.gouv.fr/api/v1    Risques multi-aléas (proxy requis DOM)',
              '  api.mapbox.com               Terrain 3D, satellite, globe (token requis)',
              '  Firebase RTDB                Sessions étudiantes anonymes',
              '',
              '⚠️ STUBS PRIORITAIRES',
              '  P0 georisques-proxy.js        Firebase Function prête (code fourni)',
              '  P0 Config Firebase réelle     Remplacer stub dans index.html',
              '  P0 Token Mapbox BIMSHOW       Ajouter bimshow.io dans URLs autorisées',
              '  S  Météo-France API Hub        Token gratuit portail-api.meteofrance.fr',
              '  M  BRGM InfoTerre WMS          data.geopf.fr couche BRGM.GEOL1M',
              '  XS QR code librairie           qrcode-generator CDN (3 méthodes codées)',
              '  S  Köppen topojson 1:10M       Générer depuis données Beck 2018',
              '',
              '📡 COMMUNICATION BIMSHOW ↔ TERLAB',
              '  TERLAB → BIMSHOW : postMessage(TERLAB_BIMSHOW_LOAD, { glb, sessionId })',
              '  BIMSHOW → TERLAB : postMessage(BIMSHOW_SNAPSHOT, { imageDataUrl })',
              '  TERLAB → BIMSHOW : postMessage(TERLAB_IFC_EXPORT_REQUEST, { gabarit })',
              '  BIMSHOW → TERLAB : postMessage(BIMSHOW_IFC_EXPORT_RESULT, { ifc })',
              '']

    # Index des fichiers présents
    lines += ['📁 FICHIERS DU PROJET', '']
    for module, desc in TERLAB_MODULES.items():
        lines.append(f'  [{module}] {desc}')

    lines.append('')
    return '\n'.join(lines)


def build_stubs_index(root: Path) -> str:
    """Scan tous les fichiers et liste les stubs trouvés."""
    lines = ['\n' + SEP2, '⚠️  INDEX DES STUBS', SEP2, '']
    stubs_found = []

    for p in collect_files(root, ALL_EXT):
        content = read_file(p)
        if '⚠️ STUB' in content or '// ⚠️ STUB' in content:
            rel = p.relative_to(root)
            count = count_stubs(content)
            # Extraire contexte du stub
            for i, line in enumerate(content.splitlines()):
                if 'STUB' in line and ('⚠' in line or '//' in line):
                    stubs_found.append((str(rel), i+1, line.strip()[:80]))

    if not stubs_found:
        lines.append('  Aucun stub détecté.')
    else:
        by_file = defaultdict(list)
        for f, lineno, ctx in stubs_found:
            by_file[f].append((lineno, ctx))
        for fname, items in sorted(by_file.items()):
            lines.append(f'  📄 {fname}')
            for lineno, ctx in items[:3]:
                lines.append(f'     L{lineno}: {ctx}')
            if len(items) > 3:
                lines.append(f'     … +{len(items)-3} autres')
            lines.append('')

    return '\n'.join(lines)


# ─── Modes d'export ───────────────────────────────────────────────

def export_audit(root: Path, args) -> str:
    """Export audit complet — pour analyse architecture globale."""
    out = [build_project_context(root)]

    # Documentation en premier
    docs = list((root / '.github').rglob('*.md')) if (root / '.github').exists() else []
    docs += list(root.glob('*.md'))
    if docs:
        out.append(f'\n{SEP2}\n📚 DOCUMENTATION\n{SEP2}')
        for p in sorted(set(docs)):
            out.append(file_header(p, root))
            out.append(read_file(p))

    # Shell
    out.append(f'\n{SEP2}\n🏠 SHELL SPA\n{SEP2}')
    for fname in ['index.html', 'index.js']:
        p = root / fname
        if p.exists():
            out.append(file_header(p, root))
            out.append(read_file(p))

    # Composants JS
    out.append(f'\n{SEP2}\n⚙ COMPOSANTS JS\n{SEP2}')
    comp_dir = root / 'components'
    if comp_dir.exists():
        for p in sorted(comp_dir.glob('*.js')):
            if p.name == 'all-components.js': continue  # doublon
            out.append(file_header(p, root))
            out.append(read_file(p))

    # Workers
    workers_dir = root / 'workers'
    if workers_dir.exists():
        out.append(f'\n{SEP2}\n🔧 WORKERS\n{SEP2}')
        for p in sorted(workers_dir.glob('*.js')):
            out.append(file_header(p, root))
            out.append(read_file(p))

    # CSS Design system (résumé)
    out.append(f'\n{SEP2}\n🎨 ASSETS CSS (design system)\n{SEP2}')
    assets_dir = root / 'assets'
    if assets_dir.exists():
        for p in sorted(assets_dir.glob('*.css')):
            out.append(file_header(p, root))
            content = read_file(p)
            # Résumé des thèmes uniquement pour l'audit
            lines = content.splitlines()
            themes = [l for l in lines if '[data-theme' in l or ':root' in l or '--bg:' in l or '--accent:' in l]
            out.append('\n'.join(themes[:60]))
            out.append(f'\n[... {len(lines)} lignes totales — utiliser --mode composant pour le CSS complet]')

    # JSON Data (condensé)
    out.append(f'\n{SEP2}\n📊 DATA JSON (résumés)\n{SEP2}')
    data_dir = root / 'data'
    if data_dir.exists():
        for p in sorted(data_dir.glob('*.json')):
            out.append(file_header(p, root))
            import json
            try:
                data = json.loads(read_file(p))
                # Résumé structurel
                if isinstance(data, dict):
                    keys = list(data.keys())
                    out.append(f'Clés : {", ".join(str(k) for k in keys[:10])}')
                    if 'phases' in data:
                        out.append(f'Phases : {len(data["phases"])} entrées')
                    if 'acteurs' in data:
                        total = sum(len(v) for v in data['acteurs'].values() if isinstance(v, list))
                        out.append(f'Acteurs : {total} au total')
                    if 'risques' in data:
                        out.append(f'Risques : {len(data["risques"])} entrées')
                    if 'demos' in data:
                        out.append(f'Démos : {len(data["demos"])} scénarios')
                    if 'zones_similaires' in data:
                        out.append(f'Zones mondiales : {len(data["zones_similaires"])} zones')
            except Exception:
                out.append(read_file(p)[:300])

    # Phases — liste avec infos
    out.append(f'\n{SEP2}\n📋 PHASES HTML — INVENTAIRE\n{SEP2}')
    phases_dir = root / 'phases'
    if phases_dir.exists():
        for slug, (name, theme, desc) in PHASE_MAP.items():
            p = phases_dir / f'{slug}-{name}.html'
            if p.exists():
                content = read_file(p)
                info    = extract_phase_info(content)
                lines   = len(content.splitlines())
                stubs   = count_stubs(content)
                stub_tag = f' · ⚠️ {stubs} STUB(s)' if stubs else ''
                out.append(f'  {slug} [{theme}] {name} — {lines}L{stub_tag}')
                out.append(f'       {desc}')
            else:
                out.append(f'  {slug} ❌ MANQUANT — {name}')

    # Stubs index
    out.append(build_stubs_index(root))

    return '\n'.join(out)


def export_phase(root: Path, phase_slug: str) -> str:
    """Export ciblé sur une phase + dépendances."""
    if phase_slug not in PHASE_MAP:
        print(f'❌ Phase inconnue : {phase_slug}')
        print(f'Phases valides : {", ".join(PHASE_MAP.keys())}')
        sys.exit(1)

    name, theme, desc = PHASE_MAP[phase_slug]
    out = [build_project_context(root)]
    out.append(f'\n{SEP2}\n🎯 MODE : Phase {phase_slug} — {name}\n{SEP2}')
    out.append(f'Thème : {theme} · {desc}\n')

    # La phase elle-même
    p = root / 'phases' / f'{phase_slug}-{name}.html'
    if not p.exists():
        out.append(f'❌ FICHIER MANQUANT : {p}')
    else:
        out.append(file_header(p, root))
        content = read_file(p)
        out.append(content)
        stubs = count_stubs(content)
        if stubs:
            out.append(f'\n⚠️  {stubs} STUB(s) détecté(s) dans cette phase')

    # Shell (routing, injection)
    out.append(f'\n{SEP2}\n🏠 SHELL (pour contexte routing)\n{SEP2}')
    for fname in ['index.js']:
        p2 = root / fname
        if p2.exists():
            out.append(file_header(p2, root))
            out.append(read_file(p2))

    # Composants utilisés
    out.append(f'\n{SEP2}\n⚙ COMPOSANTS PARTAGÉS\n{SEP2}')
    comp_dir = root / 'components'
    if comp_dir.exists():
        for p2 in sorted(comp_dir.glob('*.js')):
            if p2.name == 'all-components.js': continue
            out.append(file_header(p2, root))
            out.append(read_file(p2))

    # Workers si Phase 7
    if phase_slug == 'p07':
        workers_dir = root / 'workers'
        if workers_dir.exists():
            out.append(f'\n{SEP2}\n🔧 WORKERS (Phase 7 — IFC export)\n{SEP2}')
            for p2 in sorted(workers_dir.glob('*.js')):
                out.append(file_header(p2, root))
                out.append(read_file(p2))

    # JSON pertinents
    out.append(f'\n{SEP2}\n📊 DATA JSON\n{SEP2}')
    data_dir = root / 'data'
    if data_dir.exists():
        priority = ['phases-meta.json', 'acteurs.json', 'risques-phases.json', 'references-biblio.json']
        if phase_slug in ('p13',):
            priority += ['climat-koppen.json', 'partenariats-earl.json']
        if phase_slug in ('p00',):
            priority += ['demos.json']
        for fname in priority:
            p2 = data_dir / fname
            if p2.exists():
                out.append(file_header(p2, root))
                out.append(read_file(p2))

    # Stubs
    out.append(build_stubs_index(root))

    # Prompt agent
    slug_num = phase_slug.upper()
    out.append(f'\n{SEP2}\n🤖 PROMPT AGENT CLAUDE CODE\n{SEP2}')
    out.append(f'''Tu travailles sur TERLAB Phase {phase_slug} — {name}.

TÂCHE PRINCIPALE : Corriger, améliorer ou étendre le fichier phases/{phase_slug}-{name}.html.

RÈGLES :
1. La phase HTML n'est PAS une page complète (pas de <html>/<head>/<body>)
2. Toujours utiliser data-session-key="" sur les champs pour l'hydratation auto
3. Importer SessionManager et MapViewer depuis ../components/
4. Exposer l'objet de phase globalement : window.{slug_num} = {slug_num}
5. Les zones id="actors-zone" et id="risks-zone" sont peuplées automatiquement
6. Le bloc .val-block doit être présent avec les check-items

CONTEXTE RÉGLEMENTAIRE Réunion :
- RTAA DOM 2016 : Zone 1 (<400m) 22% porosité séjour, 18% chambres
- Séisme Zone 2 : Eurocode 8, chaînage H+V obligatoire
- SDIS 974 : voie ≥3m, hydrant ≤150m, portance ≥13t
- NGR ≠ NGF : différence ~+0.48m (erreur fréquente)
''')

    return '\n'.join(out)


def export_composant(root: Path, composant_name: str) -> str:
    """Export ciblé sur un composant + phases qui l'utilisent."""
    if composant_name not in COMPOSANT_MAP:
        print(f'❌ Composant inconnu : {composant_name}')
        print(f'Composants valides : {", ".join(COMPOSANT_MAP.keys())}')
        sys.exit(1)

    out = [build_project_context(root)]
    desc = COMPOSANT_MAP[composant_name]
    out.append(f'\n{SEP2}\n🎯 MODE : Composant {composant_name}\n{SEP2}')
    out.append(f'{desc}\n')

    # Le composant lui-même
    p = root / 'components' / f'{composant_name}.js'
    if p.exists():
        out.append(file_header(p, root))
        out.append(read_file(p))
    else:
        out.append(f'❌ FICHIER MANQUANT : {p}')

    # Composants liés
    out.append(f'\n{SEP2}\n⚙ COMPOSANTS LIÉS\n{SEP2}')
    comp_dir = root / 'components'
    if comp_dir.exists():
        for p2 in sorted(comp_dir.glob('*.js')):
            if p2.stem == composant_name: continue
            if p2.name == 'all-components.js': continue
            out.append(file_header(p2, root))
            out.append(read_file(p2))

    # Workers si map-viewer ou export-engine
    if composant_name in ('map-viewer', 'export-engine', 'bimshow-bridge'):
        workers_dir = root / 'workers'
        if workers_dir.exists():
            out.append(f'\n{SEP2}\n🔧 WORKERS\n{SEP2}')
            for p2 in sorted(workers_dir.glob('*.js')):
                out.append(file_header(p2, root))
                out.append(read_file(p2))

    # Shell pour contexte intégration
    out.append(f'\n{SEP2}\n🏠 SHELL (intégration)\n{SEP2}')
    for fname in ['index.js', 'index.html']:
        p2 = root / fname
        if p2.exists():
            out.append(file_header(p2, root))
            content = read_file(p2)
            # index.html : juste les scripts et la structure
            if fname == 'index.html':
                lines = content.splitlines()
                relevant = [l for l in lines if composant_name in l or 'modal' in l.lower() or '<script' in l or '</script' in l or 'import' in l]
                out.append('\n'.join(relevant[:40]))
                out.append(f'[... {len(lines)} lignes totales]')
            else:
                out.append(content)

    # Phases qui utilisent ce composant
    out.append(f'\n{SEP2}\n📋 PHASES UTILISANT CE COMPOSANT\n{SEP2}')
    phases_dir = root / 'phases'
    if phases_dir.exists():
        for p2 in sorted(phases_dir.glob('*.html')):
            content = read_file(p2)
            if composant_name in content or composant_name.replace('-','_').upper() in content:
                out.append(f'  ✓ {p2.name}')

    out.append(build_stubs_index(root))
    return '\n'.join(out)


def export_data(root: Path) -> str:
    """Export tous les JSON de data/."""
    out = [build_project_context(root)]
    out.append(f'\n{SEP2}\n📊 MODE : Data JSON — Tous les fichiers\n{SEP2}')

    data_dir = root / 'data'
    if not data_dir.exists():
        out.append('❌ Dossier data/ introuvable')
        return '\n'.join(out)

    for p in sorted(data_dir.glob('*.json')):
        out.append(file_header(p, root))
        out.append(read_file(p))

    return '\n'.join(out)


def export_bimshow(root: Path) -> str:
    """Export ciblé sur l'intégration BIMSHOW."""
    out = [build_project_context(root)]
    out.append(f'\n{SEP2}\n🎯 MODE : Intégration BIMSHOW\n{SEP2}')
    out.append('''Fichiers concernant la communication TERLAB ↔ BIMSHOW :
  - index.html  : shell + Firebase init + postMessage listener
  - index.js    : router + BIMSHOWBridge exposure
  - bimshow-bridge.js : protocole postMessage complet
  - ifc-worker.js     : export IFC hybride (Option A bridge + Option C ASCII)
  - phases/p07-esquisse.html : gabarit Three.js + BIMSHOW send/receive
''')

    # Fichiers ciblés
    targets = [
        root / 'index.html',
        root / 'index.js',
        root / 'components' / 'bimshow-bridge.js',
        root / 'workers' / 'ifc-worker.js',
        root / 'phases' / 'p07-esquisse.html',
    ]
    for p in targets:
        if p.exists():
            out.append(file_header(p, root))
            out.append(read_file(p))
        else:
            out.append(f'❌ MANQUANT : {p}')

    out.append(f'\n{SEP2}\n📋 PROTOCOLE postMessage\n{SEP2}')
    out.append('''
TERLAB → BIMSHOW :
  { source: 'TERLAB', type: 'TERLAB_BIMSHOW_LOAD',
    payload: { glb: base64, sessionId, phase: 7, cameraPreset: 'aerial_southwest' } }

  { source: 'TERLAB', type: 'TERLAB_IFC_EXPORT_REQUEST',
    payload: { gabarit: {L,W,H}, terrain, sessionId, ifcVersion: 'IFC2X3' } }

BIMSHOW → TERLAB :
  { type: 'BIMSHOW_SNAPSHOT',          payload: { imageDataUrl: 'data:image/png...' } }
  { type: 'BIMSHOW_READY' }
  { type: 'BIMSHOW_IFC_EXPORT_RESULT', payload: { ifc: string, filename } }

À AJOUTER DANS BIMSHOW (handler postMessage existant) :
  case 'TERLAB_BIMSHOW_LOAD':
    this.loadGLBFromBase64(payload.glb);
    // Après rendu : envoyer snapshot
    const snap = await this.snapshotService.capture();
    event.source.postMessage({ type: 'BIMSHOW_SNAPSHOT',
      payload: { imageDataUrl: snap } }, 'https://bimshow.io');
    break;

  case 'TERLAB_IFC_EXPORT_REQUEST':
    const ifc = await this.exportService.exportIFCFromGabarit(payload);
    event.source.postMessage({ type: 'BIMSHOW_IFC_EXPORT_RESULT',
      payload: { ifc } }, 'https://bimshow.io');
    break;
''')

    return '\n'.join(out)


def export_full(root: Path) -> str:
    """Export complet de tous les fichiers."""
    out = [build_project_context(root)]
    out.append(f'\n{SEP2}\n📦 MODE : Full — Export complet\n{SEP2}')
    out.append('⚠️  Ce mode est volumineux. Préférer un mode ciblé pour Claude Code.\n')

    all_files = collect_files(root, ALL_EXT)
    for p in all_files:
        if 'all-components.js' in p.name: continue  # doublon
        out.append(file_header(p, root))
        out.append(read_file(p))

    out.append(build_stubs_index(root))
    return '\n'.join(out)


def export_changes(root: Path, days: int) -> str:
    """Export des fichiers modifiés récemment."""
    out = [build_project_context(root)]
    out.append(f'\n{SEP2}\n🔄 MODE : Changes — Modifiés dans les {days} dernier(s) jour(s)\n{SEP2}')

    recent = collect_files(root, ALL_EXT, days=days)
    if not recent:
        out.append(f'Aucun fichier modifié dans les {days} dernier(s) jour(s).')
        return '\n'.join(out)

    out.append(f'{len(recent)} fichier(s) modifié(s) :\n')
    for p in recent:
        out.append(f'  {get_mtime(p).strftime("%Y-%m-%d %H:%M")}  {p.relative_to(root)}')
    out.append('')

    for p in recent:
        if 'all-components.js' in p.name: continue
        out.append(file_header(p, root))
        out.append(read_file(p))

    return '\n'.join(out)


# ─── Main ─────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='TERLAB — Exporteur de projet pour Claude Code',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--mode', default='audit',
        choices=['audit', 'phase', 'composant', 'data', 'bimshow', 'full', 'changes'],
        help='Mode d\'export')
    parser.add_argument('--phase',      default='p00',
        help='Phase à exporter (p00-p13) — utilisé avec --mode phase')
    parser.add_argument('--composant',  default='map-viewer',
        help='Composant à exporter — utilisé avec --mode composant')
    parser.add_argument('--days',       type=int, default=3,
        help='Jours en arrière pour --mode changes')
    parser.add_argument('--root',       default='.',
        help='Racine du projet TERLAB (défaut : répertoire courant)')
    parser.add_argument('--gzip',       action='store_true',
        help='Compresser la sortie en .gz')
    parser.add_argument('--output',     default=None,
        help='Fichier de sortie (défaut : auto)')
    args = parser.parse_args()

    root = Path(args.root).resolve()

    # Vérification basique
    if not (root / 'index.html').exists() and not (root / 'phases').exists():
        print(f'⚠️  Racine TERLAB introuvable : {root}')
        print('   Vérifiez que vous êtes dans le dossier terlab/ ou passez --root chemin/')
        sys.exit(1)

    print(f'TERLAB Exporter v1.0')
    print(f'Racine : {root}')
    print(f'Mode   : {args.mode}')

    # Génération du contenu
    if args.mode == 'audit':
        content = export_audit(root, args)
    elif args.mode == 'phase':
        content = export_phase(root, args.phase)
        print(f'Phase  : {args.phase}')
    elif args.mode == 'composant':
        content = export_composant(root, args.composant)
        print(f'Compo  : {args.composant}')
    elif args.mode == 'data':
        content = export_data(root)
    elif args.mode == 'bimshow':
        content = export_bimshow(root)
    elif args.mode == 'full':
        content = export_full(root)
    elif args.mode == 'changes':
        content = export_changes(root, args.days)
        print(f'Jours  : {args.days}')

    # Fichier de sortie
    ts = datetime.now().strftime('%Y%m%d_%H%M')
    if args.output:
        outfile = Path(args.output)
    else:
        suffix = args.phase if args.mode == 'phase' else \
                 args.composant if args.mode == 'composant' else args.mode
        outfile = Path(f'TERLAB_export_{suffix}_{ts}.txt')

    if args.gzip:
        outfile = outfile.with_suffix('.txt.gz')
        with gzip.open(outfile, 'wt', encoding='utf-8') as f:
            f.write(content)
    else:
        outfile.write_text(content, encoding='utf-8')

    # Rapport
    size_bytes = outfile.stat().st_size
    tokens     = estimate_tokens(content)
    lines      = content.count('\n')

    print(f'\n✅ Export généré : {outfile}')
    print(f'   Taille   : {fmt_size(size_bytes)}')
    print(f'   Lignes   : {lines:,}')
    print(f'   Tokens ≈ : {tokens:,}')

    if tokens > TOKEN_BUDGET:
        print(f'\n⚠️  ATTENTION : {tokens:,} tokens > budget {TOKEN_BUDGET:,}')
        print('   Claude.ai accepte ~200K tokens. Utiliser un mode plus ciblé.')
        print('   Suggestions :')
        print('     python export_terlab.py --mode phase --phase p03')
        print('     python export_terlab.py --mode composant --composant map-viewer')
    else:
        pct = tokens * 100 // TOKEN_BUDGET
        bar = '█' * (pct // 5) + '░' * (20 - pct // 5)
        print(f'   Budget    : [{bar}] {pct}% utilisé')

    print(f'\n📋 USAGE CLAUDE :')
    if args.mode == 'audit':
        print(f'   1. Uploader {outfile} dans claude.ai')
        print(f'   2. "Analyse la structure de TERLAB et propose les priorités"')
    elif args.mode == 'phase':
        print(f'   1. Dans Claude Code : claude --file {outfile}')
        print(f'   2. "Améliore/corrige la phase {args.phase} de TERLAB"')
    elif args.mode == 'composant':
        print(f'   1. Dans Claude Code : claude --file {outfile}')
        print(f'   2. "Améliore le composant {args.composant}"')
    elif args.mode == 'bimshow':
        print(f'   1. Uploader dans claude.ai avec le code BIMSHOW concerné')
        print(f'   2. "Implémente le bridge TERLAB_IFC_EXPORT_REQUEST dans BIMSHOW"')


if __name__ == '__main__':
    main()
