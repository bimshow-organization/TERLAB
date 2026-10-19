// node leonardo_persp.mjs — perspectives d'ambiance FJT Mille Roches via le pont Leonardo de la flotte BimShow.
// Entrées : rendus maquette SANS limites (?lim=0). La géométrie est tenue par l'image de référence / ControlNet.
// La clé (LEONARDO_API_KEY) est lue à la volée dans l'.env.local de bimshow-plant-factory-v2, jamais copiée ici.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV = 'C:/GITHUB/bimshow-plant-factory-v2/.env.local';
if (!process.env.LEONARDO_API_KEY && fs.existsSync(ENV)) {
  for (const l of fs.readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const { generer, genererNanoBanana, budget, GUIDES_SDXL } = await import(pathToFileURL('C:/GITHUB/bimshow-vision/fleet/leonardo.mjs').href);

const ARCHI = 'two parallel four-storey social housing bars (young workers hostel) in La Reunion island, tropical Creole contemporary architecture: '
  + 'warm sand-ochre mineral render (no white walls) with vertical natural timber cladding panels, integrated recessed balconies (varangues) paired two by two with slatted wooden railings, '
  + 'tall narrow windows, painted dark grey metal MONO-PITCH (single slope) roofs with deep overhangs, high side on the outer facade, open access galleries, lush tropical garden with palms and flame trees, '
  + 'residential neighbourhood of small Creole houses, green mountains in the background, soft morning light, humid tropical sky with white clouds';
const NEG = 'text, watermark, logo, people close-up, cars in foreground, distorted buildings, extra floors, skyscraper, snow, desert, blurry, cartoon';

const KEEP = 'Keep EXACTLY the same camera, the same buildings, their positions, number of floors, proportions, roofs and the street layout. ';
const jobs = [
  { kind: 'nano', src: '3d_V1_so_lim0.png', out: 'ia_V1_so_nano.png', w: 1536, h: 1024,
    prompt: 'Turn this 3D massing model into a photorealistic architectural aerial photograph. ' + KEEP + ARCHI + '. Photorealistic drone view, natural colours.' },
  { kind: 'nano', src: '3d_V1_proche_lim0.png', out: 'ia_V1_rue_nano.png', w: 1536, h: 1024,
    prompt: 'Turn this 3D model into a photorealistic eye-level street photograph. ' + KEEP + ARCHI + '. The ground floor of the front building has a glazed community room open onto the street. A few pedestrians and young residents, natural light, 35mm lens.' },
  { kind: 'nano', src: '3d_V1_coeur_lim0.png', out: 'ia_V1_jardin_nano.png', w: 1536, h: 1024,
    prompt: 'Turn this 3D model into a photorealistic eye-level photograph of the central garden between the two buildings. ' + KEEP + ARCHI + '. Open access galleries with light perforated railings on both sides, a planted rain garden swale with stones along the middle, benches, young residents chatting, lush tropical planting, soft morning light.' },
];
const only = process.argv[2];
console.log('budget avant :', budget().n + '/' + budget().max);
for (const j of jobs.filter(j => !only || j.out.includes(only))) {
  const src = path.join(HERE, j.src), out = path.join(HERE, j.out);
  try {
    const r = j.kind === 'nano'
      ? await genererNanoBanana({ prompt: j.prompt, out, w: j.w, h: j.h, refImages: [src], strength: 'HIGH' })
      : await generer({ prompt: j.prompt, negative: NEG, out, w: j.w, h: j.h,
          controlnet: { image: src, preprocessorId: GUIDES_SDXL.edge, strengthType: 'High', weight: 0.8 } });
    console.log('OK', path.basename(r.png), '(' + r.meta.budget?.n + ')');
  } catch (e) { console.error('ECHEC', j.out, '-', e.message); }
}
console.log('budget après :', budget().n + '/' + budget().max);
