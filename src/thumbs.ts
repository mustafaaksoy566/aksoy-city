import * as THREE from 'three';

// Menüler için küçük resimler: her aracın 3D modelini bir kere çizip resme çeviriyoruz.
export function renderThumbs(items: [string, THREE.Object3D][], size = 160): Map<string, string> {
  const out = new Map<string, string>();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return out; // resim çizilemezse menüler emoji ile kalır
  }
  renderer.setSize(size, size);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#8aa0b0', 2.2));
  const sun = new THREE.DirectionalLight('#ffffff', 1.6);
  sun.position.set(-3, 6, 4);
  scene.add(sun);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const dir = new THREE.Vector3(1, 0.85, 1).normalize();

  for (const [tool, obj] of items) {
    scene.add(obj);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3();
    obj.traverseVisible(o => {
      if ((o as THREE.Mesh).isMesh) box.expandByObject(o, false);
    });
    const center = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2;
    Object.assign(cam, { left: -r, right: r, top: r, bottom: -r });
    cam.updateProjectionMatrix();
    cam.position.copy(center).addScaledVector(dir, 20);
    cam.lookAt(center);
    renderer.render(scene, cam);
    out.set(tool, renderer.domElement.toDataURL('image/png'));
    scene.remove(obj);
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
