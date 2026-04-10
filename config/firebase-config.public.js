// config/firebase-config.public.js
// ───────────────────────────────────────────────────────────
// Configuration Firebase BIMSHOW pour TERLAB (PUBLIQUE)
// ───────────────────────────────────────────────────────────
// Ce fichier est COMMITTÉ et déployé sur GitHub Pages.
//
// La clé API web Firebase n'est PAS un secret — c'est un
// identifiant client public destiné au navigateur. La sécurité
// est assurée par :
//   1. Firebase Security Rules (RTDB / Firestore / Storage)
//   2. Firebase Auth → Authorized Domains
//   3. Firebase App Check (optionnel)
//
// Pour override en local (ex. tester contre dev1), créer
// `config/firebase-config.js` (gitignored) qui exporte
// `firebaseConfig`. Le loader préfère le fichier local
// s'il existe, sinon il prend ce fichier public.
// ───────────────────────────────────────────────────────────

export const firebaseConfig = {
  apiKey:        'AIzaSyBMlyLJh_k8axrvqK8NIh9CFAoezWVE98I',
  authDomain:    'bimshow-preprod1.firebaseapp.com',
  databaseURL:   'https://bimshow-preprod1-default-rtdb.firebaseio.com',
  projectId:     'bimshow-preprod1',
  storageBucket: 'bimshow-preprod1.appspot.com',
};
