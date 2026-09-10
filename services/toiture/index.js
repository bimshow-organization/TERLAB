// ═══════════════════════════════════════════════════════════════════════════
// NOYAU TOITURE — baril de réexports (services/toiture)
//
// Porté depuis bimshow-vision (POC ciriani-santillana). Le baril ne contient
// QUE des réexports : le graphe de dépendances est acyclique (voir le
// commentaire d'en-tête de build-roof.js).
//
// JS pur — aucun import Three.js ici. Le rendu est dans roof-mesh.js,
// volontairement HORS du baril pour que le noyau reste testable en Node.
// ═══════════════════════════════════════════════════════════════════════════

export * from './geom2d.js';
export * from './triangulate.js';
export * from './pan-frame.js';
export * from './edge-modes.js';
export * from './validate.js';
export * from './weighted-skeleton.js';
export * from './audit.js';
export * from './breaks.js';
export * from './model.js';
export * from './build-roof.js';
export * from './tiers.js';
export * from './overhang.js';
export * from './assembly.js';
export * from './shapes.js';
