'use strict';
/**
 * TERLAB × BPF — VegetationExport service
 * GeoJSON + tableau plantation HTML + téléchargement navigateur
 * Port Vanilla JS de terlab-vegetation/services/vegetation-export.service.ts
 */

import VegetationSpecies from './vegetation-species.js';

const VegetationExport = {

  toGeoJSON(state) {
    const fc = {
      type: 'FeatureCollection',
      crs: { type: 'name', properties: { name: 'EPSG:4326' } },
      metadata: {
        generated: new Date().toISOString(),
        source: 'TERLAB × BPF · MGA Architecture',
        sessionId: state.sessionId,
        stats: state.stats,
      },
      features: state.features.map(f => {
        const sp = f.speciesKey ? VegetationSpecies.get(f.speciesKey) : null;
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [...f.position, f.heightMeasured || 0] },
          properties: {
            id:                 f.id,
            status:             f.status,
            speciesKey:         f.speciesKey || null,
            commonName:         sp ? sp.commonName : null,
            scientificName:     sp ? sp.scientificName : null,
            family:             sp ? sp.family : null,
            origin:             sp ? sp.origin : null,
            category:           sp ? sp.category : null,
            canopyRadius_m:     f.canopyRadiusMeasured,
            canopyArea_m2:      f.canopyArea || Math.round(Math.PI * f.canopyRadiusMeasured**2),
            height_m:           f.heightMeasured || null,
            color2D:            sp ? sp.color2D : null,
            distanceFoundation_m: sp ? sp.distanceFoundation_m : null,
            matureHeight_m:     sp ? sp.matureHeight_m : null,
            positionLocal_x_m:  f.positionLocal ? f.positionLocal.x : null,
            positionLocal_y_m:  f.positionLocal ? f.positionLocal.y : null,
            source:             f.source,
            confidence_pct:     Math.round((f.speciesConfidence || 0) * 100),
            cutJustification:   f.cutJustification || null,
            newJustification:   f.newJustification || null,
            timestamp:          f.timestamp,
          },
        };
      }),
    };
    return JSON.stringify(fc, null, 2);
  },

  toPlantingTableHTML(state, projectName = 'Projet') {
    const newTrees = state.features.filter(f => f.status && f.status.startsWith('new'));

    const bySpecies = new Map();
    for (const f of newTrees) {
      const key = f.speciesKey || 'inconnue';
      if (!bySpecies.has(key)) bySpecies.set(key, []);
      bySpecies.get(key).push(f);
    }

    const rows = Array.from(bySpecies.entries()).map(([key, feats], i) => {
      const sp = VegetationSpecies.get(key);
      const avgR = feats.reduce((s, f) => s + f.canopyRadiusMeasured, 0) / feats.length;
      const dist = sp ? sp.distanceFoundation_m : null;
      const distWarn = dist && dist >= 8
        ? `<span style="color:#e05030">⚠ ${dist}m</span>`
        : dist != null ? `${dist}m` : '—';
      return `<tr>
        <td>${i+1}</td>
        <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${sp ? sp.color2D : '#888'};margin-right:6px"></span>${sp ? sp.commonName : key}</td>
        <td><em>${sp ? sp.scientificName : '—'}</em></td>
        <td>${sp ? sp.family : '—'}</td>
        <td><strong>${feats.length}</strong></td>
        <td>Ø ${(avgR*2).toFixed(1)}m</td>
        <td>${sp ? sp.matureHeight_m : '—'}m</td>
        <td>${distWarn}</td>
        <td style="font-size:10px;max-width:200px">${sp ? (sp.note || '') : ''}</td>
      </tr>`;
    });

    const s = state.stats || {
      totalKeep: 0, totalCut: 0, totalNew: 0, endemicCountAfter: 0,
      canopyCoverBefore_m2: 0, canopyCoverAfter_m2: 0, canopyCoverDelta_pct: 0,
      permeabilityAfter_pct: 0, permeabilityPLU_min_pct: 25, warnings: [],
    };

    return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Tableau de plantation — ${projectName}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a1a;margin:20px}
  h1{font-size:16px;margin-bottom:4px}
  .meta{font-size:10px;color:#666;margin-bottom:16px}
  table{border-collapse:collapse;width:100%}
  th{background:#1e1810;color:#c9a84c;padding:6px 8px;text-align:left;font-size:10px;letter-spacing:.05em;text-transform:uppercase}
  td{padding:5px 8px;border-bottom:1px solid #e0d8c4;vertical-align:top}
  tr:nth-child(even) td{background:#f8f4ec}
  .bilan{margin-top:20px;padding:12px;background:#f0ebe0;border-left:3px solid #c9a84c}
  .bilan h3{font-size:12px;margin:0 0 8px;color:#7a5810}
  .bilan-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
  .bilan-item{text-align:center}
  .bilan-val{font-size:18px;font-weight:700;color:#1a1a1a}
  .bilan-lbl{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.05em}
  @media print{body{margin:0}h1{font-size:14px}}
</style>
</head>
<body>
<h1>TABLEAU DE PLANTATION — ${projectName.toUpperCase()}</h1>
<div class="meta">
  Généré par TERLAB × BPF · MGA Architecture · ${new Date().toLocaleDateString('fr-FR')}
  &nbsp;·&nbsp; Session ${(state.sessionId || '').slice(0,8)}
</div>

<table>
  <thead>
    <tr>
      <th>N°</th><th>Espèce</th><th>Nom scientifique</th><th>Famille</th>
      <th>Qté</th><th>Couronne</th><th>H. maturité</th><th>Dist. fond.</th><th>Notes plantation</th>
    </tr>
  </thead>
  <tbody>
    ${rows.join('\n')}
    <tr style="background:#f0ebe0;font-weight:700">
      <td colspan="4">TOTAL PLANTATIONS</td>
      <td>${newTrees.length}</td>
      <td colspan="4"></td>
    </tr>
  </tbody>
</table>

<div class="bilan">
  <h3>BILAN VÉGÉTAL</h3>
  <div class="bilan-grid">
    <div class="bilan-item"><div class="bilan-val">${s.totalKeep}</div><div class="bilan-lbl">Arbres conservés</div></div>
    <div class="bilan-item"><div class="bilan-val" style="color:#e05030">${s.totalCut}</div><div class="bilan-lbl">Arbres abattus</div></div>
    <div class="bilan-item"><div class="bilan-val" style="color:#2a8850">${s.totalNew}</div><div class="bilan-lbl">Nouveaux arbres</div></div>
    <div class="bilan-item"><div class="bilan-val">${s.endemicCountAfter}</div><div class="bilan-lbl">Esp. endémiques</div></div>
    <div class="bilan-item"><div class="bilan-val">${s.canopyCoverBefore_m2} m²</div><div class="bilan-lbl">Canopée initiale</div></div>
    <div class="bilan-item"><div class="bilan-val">${s.canopyCoverAfter_m2} m²</div><div class="bilan-lbl">Canopée finale</div></div>
    <div class="bilan-item"><div class="bilan-val"${s.canopyCoverDelta_pct < 0 ? ' style="color:#e05030"' : ''}>${s.canopyCoverDelta_pct>0?'+':''}${s.canopyCoverDelta_pct}%</div><div class="bilan-lbl">Variation canopée</div></div>
    <div class="bilan-item"><div class="bilan-val"${s.permeabilityAfter_pct < s.permeabilityPLU_min_pct ? ' style="color:#e05030"' : ''}>${s.permeabilityAfter_pct}%</div><div class="bilan-lbl">Perméabilité (min ${s.permeabilityPLU_min_pct}%)</div></div>
  </div>
  ${(s.warnings && s.warnings.length) ? `<div style="margin-top:10px;font-size:10px;color:#c83818"><strong>Avertissements :</strong><br>${s.warnings.map(w=>`⚠ ${w.message}`).join('<br>')}</div>` : ''}
</div>
</body>
</html>`;
  },

  downloadGeoJSON(state, filename = 'vegetation.geojson') {
    const blob = new Blob([this.toGeoJSON(state)], { type: 'application/geo+json' });
    this._download(blob, filename);
  },

  downloadPlantingTable(state, projectName, filename = 'plantation.html') {
    const blob = new Blob([this.toPlantingTableHTML(state, projectName)], { type: 'text/html;charset=utf-8' });
    this._download(blob, filename);
  },

  _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

export default VegetationExport;

if (typeof window !== 'undefined') {
  window.VegetationExport = VegetationExport;
}
