#!/usr/bin/env python3
"""Mini HTTP server avec COOP/COEP headers pour activer cross-origin
isolation requise par SharedArrayBuffer (gaussian-splats-3d perf max).

Routes API custom :
  /api/streetview-thumb?panoid=...&w=900&h=600&pitch=0&yaw=0
      Proxy vers streetviewpixels-pa.googleapis.com (CORS bypass).
  /api/streetview-pano?panoid=...&zoom=4
      Reconstitue un panorama equirectangulaire complet en concatenant
      les tiles 512x512 (lent : 26x13 = 338 tiles a zoom=4).
  /api/save-facade  (POST multipart : image + JSON metadata)
      Sauve dans sota/facades_collection/{slug}/{ts}.jpg + manifest.

Usage : python serve_coop.py [--port 8080] [--root .]
        Open : http://localhost:8080/tools/saintleu-splat-viewer/
"""
import argparse
import http.server
import io
import json
import mimetypes
import socketserver
import time
import urllib.parse
import urllib.request
from pathlib import Path

# Fix Python 3.12 default mimetypes (manque image/webp etc)
mimetypes.add_type('image/webp', '.webp')
mimetypes.add_type('application/octet-stream', '.splat')
mimetypes.add_type('application/octet-stream', '.ksplat')
mimetypes.add_type('application/json', '.json')

STREETVIEW_THUMB = 'https://streetviewpixels-pa.googleapis.com/v1/thumbnail'
STREETVIEW_TILE  = 'https://streetviewpixels-pa.googleapis.com/v1/tile'
USER_AGENT = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')

FACADES_DIR = Path('sota/facades_collection')


class COOPHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.webp':   'image/webp',
        '.splat':  'application/octet-stream',
        '.ksplat': 'application/octet-stream',
        '.js':     'text/javascript',
        '.mjs':    'text/javascript',
        '.json':   'application/json',
    }

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
        super().end_headers()

    def do_GET(self):
        # Routes API custom
        if self.path.startswith('/api/streetview-thumb'):
            return self.handle_streetview_thumb()
        if self.path.startswith('/api/streetview-pano'):
            return self.handle_streetview_pano()
        if self.path.startswith('/api/list-facades'):
            return self.handle_list_facades()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/save-facade'):
            return self.handle_save_facade()
        self.send_error(405, 'POST not allowed on this path')

    # ─── /api/streetview-thumb ─────────────────────────────────────
    def handle_streetview_thumb(self):
        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        panoid = (params.get('panoid', [''])[0] or '').strip()
        if not panoid:
            self.send_error(400, 'missing panoid')
            return
        w = int(params.get('w', ['900'])[0])
        h = int(params.get('h', ['600'])[0])
        pitch = float(params.get('pitch', ['0'])[0])
        yaw = float(params.get('yaw', ['0'])[0])
        upstream_qs = urllib.parse.urlencode({
            'cb_client': 'maps_sv.tactile',
            'w': w, 'h': h,
            'pitch': pitch, 'yaw': yaw,
            'panoid': panoid,
        })
        url = f'{STREETVIEW_THUMB}?{upstream_qs}'
        try:
            req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
            with urllib.request.urlopen(req, timeout=15) as resp:
                ctype = resp.headers.get('Content-Type', 'image/jpeg')
                data = resp.read()
        except Exception as e:
            self.send_error(502, f'upstream: {e}')
            return
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ─── /api/streetview-pano (equirectangulaire complet) ──────────
    def handle_streetview_pano(self):
        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        panoid = (params.get('panoid', [''])[0] or '').strip()
        if not panoid:
            self.send_error(400, 'missing panoid')
            return
        zoom = int(params.get('zoom', ['3'])[0])  # 3 = 6656x3328 (raisonnable)
        # tiles : zoom=3 -> 13x7, zoom=4 -> 26x13, zoom=5 -> 52x26
        nx = 2 ** zoom * (13 // (2 ** max(zoom-3, 0))) if zoom >= 3 else 2 ** zoom
        # En pratique : zoom 3 = 13x7 tiles 512x512 ; zoom 4 = 26x13 ; zoom 5 = 52x26
        layout = {3: (13, 7), 4: (26, 13), 5: (52, 26)}
        if zoom not in layout:
            self.send_error(400, 'zoom must be 3, 4, or 5')
            return
        nx, ny = layout[zoom]
        try:
            from PIL import Image
        except ImportError:
            self.send_error(500, 'Pillow not installed')
            return
        canvas = Image.new('RGB', (nx * 512, ny * 512), (0, 0, 0))
        for y in range(ny):
            for x in range(nx):
                tile_qs = urllib.parse.urlencode({
                    'cb_client': 'maps_sv.tactile',
                    'panoid': panoid,
                    'output': 'tile',
                    'x': x, 'y': y, 'zoom': zoom,
                    'nbt': '1', 'fover': '2',
                })
                url = f'{STREETVIEW_TILE}?{tile_qs}'
                try:
                    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
                    with urllib.request.urlopen(req, timeout=15) as resp:
                        data = resp.read()
                    tile = Image.open(io.BytesIO(data))
                    canvas.paste(tile, (x * 512, y * 512))
                except Exception as e:
                    print(f'  tile {x},{y} FAIL : {e}')
        buf = io.BytesIO()
        canvas.save(buf, format='JPEG', quality=85)
        buf.seek(0)
        data = buf.read()
        self.send_response(200)
        self.send_header('Content-Type', 'image/jpeg')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ─── /api/save-facade (POST multipart) ─────────────────────────
    def handle_save_facade(self):
        ctype = self.headers.get('Content-Type', '')
        clen = int(self.headers.get('Content-Length', '0'))
        if clen <= 0 or clen > 50_000_000:
            self.send_error(400, 'invalid content-length')
            return
        body = self.rfile.read(clen)
        # Format attendu : application/json avec base64 data + metadata
        if 'application/json' not in ctype:
            self.send_error(400, 'Content-Type must be application/json')
            return
        try:
            payload = json.loads(body.decode('utf-8'))
        except Exception as e:
            self.send_error(400, f'json parse: {e}')
            return
        slug = (payload.get('zone') or 'unknown').replace('/', '_')
        panoid = (payload.get('panoid') or 'noid').replace('/', '_')
        meta = payload.get('meta', {})
        img_b64 = payload.get('image_b64', '')
        if not img_b64:
            self.send_error(400, 'missing image_b64')
            return
        import base64
        try:
            img_bytes = base64.b64decode(img_b64.split(',', 1)[-1])
        except Exception as e:
            self.send_error(400, f'b64 decode: {e}')
            return
        zone_dir = FACADES_DIR / slug
        zone_dir.mkdir(parents=True, exist_ok=True)
        ts = time.strftime('%Y%m%d_%H%M%S')
        img_path = zone_dir / f'{ts}_{panoid[:8]}.jpg'
        img_path.write_bytes(img_bytes)
        # Append manifest
        manifest_path = zone_dir / 'manifest.json'
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
        else:
            manifest = {'zone': slug, 'entries': []}
        manifest['entries'].append({
            'file': img_path.name,
            'panoid': panoid,
            'ts': ts,
            **meta,
        })
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2),
                                  encoding='utf-8')
        out = {'ok': True, 'file': str(img_path), 'n_entries': len(manifest['entries'])}
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(out).encode('utf-8'))

    # ─── /api/list-facades ─────────────────────────────────────────
    def handle_list_facades(self):
        qs = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(qs)
        slug = (params.get('zone', [''])[0] or '').replace('/', '_')
        if not slug:
            self.send_error(400, 'missing zone')
            return
        manifest_path = FACADES_DIR / slug / 'manifest.json'
        if not manifest_path.exists():
            data = {'zone': slug, 'entries': []}
        else:
            data = json.loads(manifest_path.read_text(encoding='utf-8'))
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class ReuseTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--root', default='.')
    args = ap.parse_args()

    import os
    os.chdir(args.root)
    FACADES_DIR.mkdir(parents=True, exist_ok=True)

    with ReuseTCPServer(('', args.port), COOPHandler) as httpd:
        print(f'COOP/COEP server on http://localhost:{args.port}/')
        print(f'  serving {Path(args.root).resolve()}')
        print(f'  facades collection -> {FACADES_DIR.resolve()}')
        httpd.serve_forever()


if __name__ == '__main__':
    main()
