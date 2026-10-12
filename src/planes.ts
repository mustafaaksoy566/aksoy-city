import * as THREE from 'three';
import { mat, part } from './utilities';

// Yolcu uçağı: basit şekillerden. Burnu +z yönünde, boyu yaklaşık 3 birim.
// Kuyruk rengi havayolundan havayoluna değişir.
const LIVERIES = ['#d9363e', '#1e6fd9', '#00a3a3', '#f08c00', '#6a3fc9'];

const M = {
  body: mat('#f5f7fa'),
  wing: mat('#c9d1da'),
  engine: mat('#aab4bf'),
  dark: mat('#27303b'),
  glass: mat('#2b3a4d'),
};

// Arkaya doğru eğik (ok başı gibi) kanat: kök genişliği, uç genişliği, açıklık ve geri kayma
function sweptWing(root: number, tip: number, span: number, sweep: number, thick: number, m: THREE.Material, side: 1 | -1) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(side * span, -sweep);
  s.lineTo(side * span, -sweep - tip);
  s.lineTo(0, -root);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  // Şekil x-y düzleminde; yatırıp x-z düzlemine çevir (y ekseni z'ye)
  geo.rotateX(Math.PI / 2);
  return new THREE.Mesh(geo, m);
}

export function makeAirliner(livery = 0): THREE.Group {
  const g = new THREE.Group();
  const tail = mat(LIVERIES[livery % LIVERIES.length]);
  // Gövde: uzun kapsül
  const body = part(new THREE.CapsuleGeometry(0.2, 2.5, 6, 14), M.body, 0, 0, 0);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  // Yanlarda renkli şerit ve pencere çizgisi
  g.add(part(new THREE.BoxGeometry(0.405, 0.045, 2.1), tail, 0, -0.02, -0.05));
  g.add(part(new THREE.BoxGeometry(0.405, 0.035, 1.9), M.glass, 0, 0.07, 0.05));
  // Kokpit camı
  g.add(part(new THREE.BoxGeometry(0.26, 0.06, 0.12), M.glass, 0, 0.1, 1.38));
  // Kanatlar
  for (const side of [1, -1] as const) {
    const w = sweptWing(0.7, 0.22, 1.55, 0.55, 0.05, M.wing, side);
    w.position.set(0, -0.08, 0.45);
    g.add(w);
    // Motor
    const eng = part(new THREE.CylinderGeometry(0.1, 0.09, 0.42, 12), M.engine, side * 0.62, -0.2, 0.32);
    eng.rotation.x = Math.PI / 2;
    g.add(eng);
    g.add(part(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 12).rotateX(Math.PI / 2), M.dark, side * 0.62, -0.2, 0.535));
    // Yatay kuyruk
    const st = sweptWing(0.32, 0.14, 0.55, 0.25, 0.035, M.wing, side);
    st.position.set(0, 0.05, -1.05);
    g.add(st);
  }
  // Dikey kuyruk (renkli)
  const fin = new THREE.Shape();
  fin.moveTo(0, 0);
  fin.lineTo(-0.55, 0);
  fin.lineTo(-0.72, 0.62);
  fin.lineTo(-0.5, 0.62);
  fin.closePath();
  const finGeo = new THREE.ExtrudeGeometry(fin, { depth: 0.04, bevelEnabled: false }).translate(0, 0, -0.02).rotateY(-Math.PI / 2);
  const finMesh = part(finGeo, tail, 0, 0.12, -0.8);
  g.add(finMesh);
  g.traverse(o => ((o as THREE.Mesh).castShadow = false));
  return g;
}
