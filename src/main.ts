import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';

const GRID = 32; // harita 32 x 32 kare
const container = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#7ec8e3');

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
camera.position.set(30, 34, 30);

const controls = new MapControls(camera, renderer.domElement);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 3;
controls.minDistance = 12;
controls.maxDistance = 90;

scene.add(new THREE.HemisphereLight('#ffffff', '#88aa66', 1.2));
const sun = new THREE.DirectionalLight('#ffffff', 1.5);
sun.position.set(20, 40, 10);
sun.castShadow = true;
sun.shadow.camera.left = sun.shadow.camera.bottom = -GRID / 2;
sun.shadow.camera.right = sun.shadow.camera.top = GRID / 2;
scene.add(sun);

// Çimen zemin ve kare çizgileri
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(GRID, GRID),
  new THREE.MeshStandardMaterial({ color: '#8bc34a' }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(GRID, GRID, '#6a9e35', '#6a9e35');
grid.position.y = 0.01;
scene.add(grid);

// Deneme amaçlı birkaç renkli blok (ileride yerlerini Kenney binaları alacak)
const colors = ['#ef5350', '#ffca28', '#42a5f5', '#ab47bc'];
colors.forEach((c, i) => {
  const h = 1 + i;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, h, 0.9),
    new THREE.MeshStandardMaterial({ color: c }),
  );
  box.position.set(i * 2 - 3 + 0.5, h / 2, 0.5);
  box.castShadow = true;
  scene.add(box);
});

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
