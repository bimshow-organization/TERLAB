s = open('plan.py', encoding='utf-8').read()
i = s.index("        # parking\n        if V['parking']:")
j = s.index("        # bâtiments : logements + coursive + noyau")
new = '''        # parking : rangées du générateur code-runner (parking-layout.mjs) — allées enrobé, places marquées, PMR bleue
        PLY = V.get('parkingLayout')
        if PLY:
            for ax0, az0, ax1, az1, w in PLY['aisles']:
                add('<polyline points="%s" fill="none" stroke="#c9c6c0" stroke-width="%.1f" stroke-linecap="butt"/>' % (pts([(ax0, az0), (ax1, az1)], K, ox, oz), w*K))
            for ox_, oz_, ax_, az_, sx, sz, n, pitch, ln, typ, closed in PLY['rows']:
                for i in range(n):
                    x0, z0 = ox_ + ax_*i*pitch, oz_ + az_*i*pitch
                    q = [(x0, z0), (x0 + ax_*pitch, z0 + az_*pitch), (x0 + ax_*pitch + sx*ln, z0 + az_*pitch + sz*ln), (x0 + sx*ln, z0 + sz*ln)]
                    add('<polygon points="%s" fill="%s" stroke="#fff" stroke-width="0.8"/>' % (pts(q, K, ox, oz), '#7fa6cf' if typ == 3 else '#d6d3cc'))
            pc = Polygon(PLY['zone']).centroid
            add('<text x="%.1f" y="%.1f" font-size="8" text-anchor="middle" fill="#444" style="paint-order:stroke;stroke:#fbfaf7;stroke-width:3px">P · %d pl. dont %d PMR</text>' % ((pc.x-ox)*K, (pc.y-oz)*K + 3, PLY['stalls'], PLY['pmr']))
'''
s = s[:i] + new + s[j:]
open('plan.py', 'w', encoding='utf-8').write(s)
print('ok')
