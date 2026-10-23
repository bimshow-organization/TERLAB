# Recadre une carte de chaleur des circulations de la sonde BVE (circulations-chaleur-*.svg) sur le dessin et sa légende :
# supprime le cadre et le cartouche interne (le rapport met sa propre légende de page), remonte la légende contre le dessin.
import re, fitz

Z = 2.0   # px par unité du viewBox pour la mesure de l'emprise du dessin

def crop(src, dst, pad=10):
    s = open(src, encoding='utf-8').read()
    vb = [float(v) for v in re.search(r'viewBox="([^"]+)"', s).group(1).split()]
    fr = re.search(r'<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="#fcfcfa" stroke="#111" stroke-width="1"/>', s)
    fx, fy, fw, fh = (float(fr.group(i)) for i in (1, 2, 3, 4))
    # 1. emprise du dessin : pixels différents du fond, dans l'intérieur du cadre (le cadre lui-même exclu)
    d = fitz.open('svg', s.encode('utf-8')) if False else fitz.open(src)
    pm = d[0].get_pixmap(matrix=fitz.Matrix(Z, Z), alpha=False); W, H, n = pm.width, pm.height, pm.n; b = pm.samples
    x0, y0, x1, y1 = W, H, 0, 0
    ix0, iy0, ix1, iy1 = int((fx + 3) * Z), int((fy + 3) * Z), int((fx + fw - 3) * Z), int((fy + fh - 3) * Z)
    for y in range(iy0, iy1, 2):
        row = y * W * n
        for x in range(ix0, ix1, 2):
            o = row + x * n
            r, g, bl = b[o], b[o + 1], b[o + 2]
            if r >= g + 6 and abs(bl - g) <= 14 and g >= 140: continue   # trait rose clair de la limite du lot : ne compte pas dans l'emprise
            if abs(r - 252) + abs(g - 252) + abs(bl - 250) > 12: x0 = min(x0, x); y0 = min(y0, y); x1 = max(x1, x); y1 = max(y1, y)
    dx0, dy0, dx1, dy1 = x0 / Z - pad, y0 / Z - pad, x1 / Z + pad, y1 / Z + pad
    # 2. légende : de l'élément « legende-degrade » (moins son titre) jusqu'au cartouche, qui est supprimé
    m = re.search(r'<rect class="legende-degrade"[^>]*? y="([\d.]+)"', s) or re.search(r'<rect[^>]*? y="([\d.]+)"[^>]*class="legende-degrade"', s)
    ry = float(m.group(1)); i_leg = m.start()
    i_tit = s.rfind('<rect ', 0, s.rindex('</svg>'))      # cartouche interne (dernier rectangle) : supprimé
    assert ('Carte de chaleur' in s[i_tit:i_tit + 500] or 'Parcours PMR' in s[i_tit:i_tit + 500])
    head, legend = s[:i_leg], s[i_leg:i_tit]
    head = head.replace(fr.group(0), '')
    ly0, ly1 = ry - 16, ry + 52                      # bande de la légende : titre du dégradé → dernière ligne
    dy = ly0 - dy1 + 0                               # remontée de la légende contre le dessin
    X0 = min(dx0, fx + 4); X1 = max(dx1, fx + 640); Hh = dy1 - dy0 + (ly1 - ly0) + 4
    out = head + '<g transform="translate(0,%.2f)">%s</g></svg>' % (-dy, legend)
    out = re.sub(r'viewBox="[^"]+" width="[^"]+" height="[^"]+"', 'viewBox="%.1f %.1f %.1f %.1f"' % (X0, dy0, X1 - X0, Hh), out, 1)
    open(dst, 'w', encoding='utf-8').write(out)
    return (X1 - X0) / Hh

if __name__ == '__main__':
    import sys
    print(crop(sys.argv[1], sys.argv[2]))
