import os
HERE = os.path.dirname(os.path.abspath(__file__))
p = r'C:\GITHUB\code-runner\tools\city\fjt-bh513.html'
L = open(p, encoding='utf-8').read().split('\n')
i0 = next(i for i, l in enumerate(L) if l.startswith('  const HN = 3.0'))
i1 = next(i for i, l in enumerate(L) if l.strip() == 'return { y0, g0, Htot };')
assert L[i1 + 1].strip() == '}'
new = open(os.path.join(HERE, 'block_new.js'), encoding='utf-8').read().rstrip('\n').split('\n')
L = L[:i0] + new + L[i1 + 2:]
s = '\n'.join(L)
s = s.replace('<script src="../../data/cities/millerochesbh513/fjt-project.js"></script>\n<script>',
              '<script src="../../data/cities/millerochesbh513/fjt-project.js"></script>\n'
              '<script type="module">import * as B from "../../vendor/speech/baies-composition.mjs"; window.SpeechBaies = B; window.dispatchEvent(new Event("speech-baies"));</script>\n<script>')
s = s.replace("(function () {\n  'use strict';\n  const Q = new URLSearchParams",
              "(function boot() {\n  'use strict';\n  if (!window.SpeechBaies) { window.addEventListener('speech-baies', boot, { once: true }); return; }\n  const Q = new URLSearchParams")
open(p, 'w', encoding='utf-8').write(s)
print('ok', 'boot' in s, 'SpeechBaies = B' in s)
