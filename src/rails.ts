import * as THREE from 'three';

// Tren yolu parçaları: balast (çakıl yatak), traversler ve iki ray. Hepsi basit kutulardan.
// Yön maskesi yollardaki gibi: kuzey 1, doğu 2, güney 4, batı 8.

const M = {
  ballast: new THREE.MeshStandardMaterial({ color: '#8f8577', roughness: 1 }),
  sleeper: new THREE.MeshStandardMaterial({ color: '#6b4f3a', roughness: 1 }),
  rail: new THREE.MeshStandardMaterial({ color: '#a7b0ba', metalness: 0.6, roughness: 0.4 }),
};
const GAUGE = 0.08; // rayların merkezden uzaklığı
const Y = 0.02;

function box(g: THREE.Group, w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, rot = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rot;
  mesh.castShadow = m === M.rail;
  mesh.receiveShadow = true;
  g.add(mesh);
}

// Merkezden bir kenara (d yönüne) giden yarım düz parça
function half(g: THREE.Group, d: number, ballast: boolean) {
  const along = d === 0 || d === 2; // kuzey-güney ekseni
  const sign = d === 0 || d === 3 ? -1 : 1;
  const c = sign * 0.25; // yarım parçanın ortası
  if (ballast) along ? box(g, 0.42, 0.03, 0.5, M.ballast, 0, Y, c) : box(g, 0.5, 0.03, 0.42, M.ballast, c, Y, 0);
  for (const k of [0.1, 0.3]) {
    const p = sign * k;
    along ? box(g, 0.3, 0.02, 0.05, M.sleeper, 0, Y + 0.022, p) : box(g, 0.05, 0.02, 0.3, M.sleeper, p, Y + 0.022, 0);
  }
  for (const s of [-GAUGE, GAUGE]) {
    along ? box(g, 0.022, 0.025, 0.5, M.rail, s, Y + 0.04, c) : box(g, 0.5, 0.025, 0.022, M.rail, c, Y + 0.04, s);
  }
}

// Güney ile doğuyu birleştiren kavisli parça (yarıçap 0.5, merkez karenin güneydoğu köşesi)
function corner(g: THREE.Group, ballast: boolean) {
  const steps = 8;
  for (let k = 0; k < steps; k++) {
    const a0 = Math.PI + (k / steps) * (Math.PI / 2);
    const a1 = Math.PI + ((k + 1) / steps) * (Math.PI / 2);
    const am = (a0 + a1) / 2;
    const seg = (r: number) => 2 * r * Math.sin((a1 - a0) / 2) + 0.01;
    const at = (r: number) => [0.5 + r * Math.cos(am), 0.5 + r * Math.sin(am)] as const;
    const rot = -am; // parçanın uzun kenarı kavise teğet
    if (ballast) {
      const [x, z] = at(0.5);
      box(g, 0.42, 0.03, seg(0.5) + 0.02, M.ballast, x, Y, z, rot);
    }
    if (k % 2 === 0) {
      const [x, z] = at(0.5);
      box(g, 0.3, 0.02, 0.05, M.sleeper, x, Y + 0.022, z, rot);
    }
    for (const r of [0.5 - GAUGE, 0.5 + GAUGE]) {
      const [x, z] = at(r);
      box(g, 0.022, 0.025, seg(r), M.rail, x, Y + 0.04, z, rot);
    }
  }
}

// Maskeye göre ray parçası. ballast=false: hemzemin geçitte yolun üstüne sadece ray ve travers
export function railPiece(mask: number, ballast = true): THREE.Group {
  const g = new THREE.Group();
  const dirs = [0, 1, 2, 3].filter(d => mask & (1 << d));
  // Tam olarak iki komşu ve birbirine dik: kavis
  if (dirs.length === 2 && (dirs[1] - dirs[0]) % 2 === 1) {
    const inner = new THREE.Group();
    corner(inner, ballast);
    // Taban kavis güney(2)+doğu(1); diğer köşeler için döndür
    const turns: Record<string, number> = { '1,2': 0, '0,1': 1, '0,3': 2, '2,3': 3 };
    inner.rotation.y = (turns[dirs.join(',')] * Math.PI) / 2;
    g.add(inner);
    return g;
  }
  // Tek komşu ya da hiç komşu yoksa düz devam etsin
  const list = dirs.length === 0 ? [0, 2] : dirs.length === 1 ? [dirs[0], (dirs[0] + 2) % 4] : dirs;
  for (const d of list) half(g, d, ballast);
  return g;
}
