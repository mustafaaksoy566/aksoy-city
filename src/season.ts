import * as THREE from 'three';

// Mevsimler: bir yıl 28 gün (her mevsim 7 gün). Kışın yağmur yerine kar yağar ve şehrin üstü (çatılar, çimen,
// ağaç tepeleri, arabaların tavanı) yavaş yavaş beyazlar; yollar ve su temizlenmiş kalır. Sonbaharda
// çevredeki ormanların yaprakları sararıp kızarır (trees.ts). Sadece görüntü; oyunu etkilemez.
export const SEASON_DAYS = 7;
export const SEASONS = [
  { name: 'İlkbahar', icon: '🌸' },
  { name: 'Yaz', icon: '☀️' },
  { name: 'Sonbahar', icon: '🍂' },
  { name: 'Kış', icon: '❄️' },
];
// Ekrandaki güne göre mevsim (0 ilkbahar, 1 yaz, 2 sonbahar, 3 kış)
export const seasonOf = (dayNum: number) => Math.floor((((dayNum - 1) % (SEASON_DAYS * 4)) + SEASON_DAYS * 4) % (SEASON_DAYS * 4) / SEASON_DAYS);

// Bütün malzemelerin paylaştığı değerler (0..1): kar örtüsü ve sonbahar
export const SEASON_U = { snow: { value: 0 }, autumn: { value: 0 } };

// Kar: yukarı bakan yüzeyler beyaza döner (dünya normalinin y'si). MeshStandardMaterial'ın hepsine eklenir;
// bütün malzemeler aynı kodu kullandığı için programlar yine paylaşılır.
const SNOW_GLSL = `
  {
    vec3 sN = inverseTransformDirection( normal, viewMatrix );
    float sUp = smoothstep( 0.5, 0.85, sN.y );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.86, 0.89, 0.93 ), uSnow * sUp );
  }`;
function snowPatch(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.uniforms.uSnow = SEASON_U.snow;
  shader.fragmentShader = 'uniform float uSnow;\n' + shader.fragmentShader.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + SNOW_GLSL);
}
// Kar tutmayan malzemeler (yollar, su): kendi boş derleme işlevleri olur; birleştirilirken de ayrı kalırlar
// (batcher.ts noSnow işareti), yoksa köşe renkli ortak malzemeye geçip kar tutarlar
const noPatch = () => {};
export function noSnow(...mats: THREE.Material[]) {
  for (const m of mats) {
    m.onBeforeCompile = noPatch;
    m.userData.noSnow = true;
  }
}
// Kendi derleme işlevi olan malzemeler (ormanın yaprakları) karı da eklesin
export function withSnow(m: THREE.Material, own: (shader: THREE.WebGLProgramParametersWithUniforms) => void) {
  m.onBeforeCompile = shader => {
    own(shader);
    snowPatch(shader);
  };
}
let installed = false;
export function installSnow() {
  if (installed) return;
  installed = true;
  THREE.MeshStandardMaterial.prototype.onBeforeCompile = snowPatch;
}

// Sonbahar: yeşil yapraklar sararır, turuncuya ya da kırmızıya döner (her ağaç kendi tonunda; ağaçlar tek
// parçada birleştirildiği için ton bulunduğu karenin yerinden seçilir). Pembe çiçekler değişmez; çam ve
// servi bu malzemeyi kullanmaz.
const AUTUMN_GLSL = `
  {
    float aG = diffuseColor.g - max( diffuseColor.r, diffuseColor.b );
    float aLeaf = smoothstep( 0.0, 0.08, aG ) * uAutumn;
    float aK = fract( sin( vAutSeed * 91.7 ) * 43758.5453 );
    vec3 aC = aK < 0.4 ? vec3( 0.86, 0.64, 0.16 ) : aK < 0.75 ? vec3( 0.84, 0.43, 0.13 ) : vec3( 0.68, 0.2, 0.12 );
    float aL = dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) );
    diffuseColor.rgb = mix( diffuseColor.rgb, aC * ( 0.55 + aL * 1.3 ), aLeaf );
  }`;
export function autumnPatch(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.uniforms.uAutumn = SEASON_U.autumn;
  shader.vertexShader = 'varying float vAutSeed;\n' + shader.vertexShader.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    #ifdef USE_INSTANCING
      vAutSeed = dot( floor( instanceMatrix[3].xz * 3.0 ), vec2( 0.37, 0.71 ) );
    #else
      vAutSeed = dot( floor( ( modelMatrix * vec4( transformed, 1.0 ) ).xz ), vec2( 0.37, 0.71 ) );
    #endif`,
  );
  shader.fragmentShader = 'uniform float uAutumn;\nvarying float vAutSeed;\n' + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>' + AUTUMN_GLSL);
}
