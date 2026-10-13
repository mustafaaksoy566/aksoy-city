import * as THREE from 'three';

// Kamera kontrolü (harita uygulamaları gibi):
// - Tek parmak: haritayı tutup sürükle (tutulan yer parmağın altında kalır)
// - İki parmak: sıkıştırıp aç = yakınlaştır, çevir = döndür, yana kaydır = kaydır,
//   ikisini birlikte yukarı/aşağı kaydır = eğ (yukarı: kuşbakışı, aşağı: yandan 3 boyutlu görünüm)
// - Fare: sol tuş (gez modunda) ya da sağ tuş (her zaman) ile kaydır, tekerlek yakınlaştır,
//   orta tuş ya da Alt + sol tuş: sağa-sola döndür, yukarı-aşağı eğ.
//   Klavye: oklar/WASD kaydır, Q/E döndür, R/F eğ, +/- yakınlaştır
const ZOOM_POWER = 1.35; // sıkıştırma ne kadar hızlı yakınlaştırsın (1 = parmaklarla birebir)
const TILT_SPEED = 0.0055; // parmak/fare her piksel kaydığında ne kadar eğilsin (radyan)
const TILT_MIN = -0.5; // en yatık (3 boyutlu) görünüm
const TILT_MAX = 0.8; // en dik (kuşbakışı) görünüm

export class CameraRig {
  readonly target = new THREE.Vector3();
  distance = 16;
  yaw = Math.PI / 4; // kameranın şehre baktığı yatay açı
  tilt = 0; // kullanıcının eğmesi: artı = kuşbakışına doğru, eksi = yandan görünüşe doğru
  minDistance = 6;
  maxDistance = 60;
  // Tek parmakla kaydırma açık mı? (inşa modunda tek parmak çizim yapar)
  singlePan: () => boolean = () => true;
  // Kameranın yakınındaki en yüksek binanın tepesi: kamera ondan aşağı inmez
  // (yoksa yakınlaşınca kulenin çatısı kesilir ve içi boş/şeffaf görünür)
  clearance: ((x: number, z: number) => number) | null = null;
  // Şehir dışındaki arazinin yüksekliği: kamera ile baktığı yer arasında tepe ya da dağ varsa kamera daha
  // yukarıdan bakar (dağın içine girmez, yamaca da yapışmaz)
  terrain: ((x: number, z: number) => number) | null = null;
  private lift = 0; // binaların üstünde kalmak için kameranın yumuşakça yükseldiği miktar

  private pointers = new Map<number, { x: number; y: number }>();
  private grab: THREE.Vector3 | null = null; // tek parmakla tutulan zemin noktası
  private two: { x: number; y: number; dist: number; angle: number } | null = null;
  // İki parmak hareketinin ne olduğu ilk birkaç pikselde anlaşılır: eğme mi, yoksa yakınlaştır/döndür/kaydır mı
  private twoMode: 'tilt' | 'move' | null = null;
  private twoStart = { x: 0, y: 0, dist: 0, angle: 0 }; // iki parmağın başladığı yer (kararı net harekete göre ver)
  private rotating: { x: number; y: number } | null = null; // farenin orta tuşuyla döndürme ve eğme
  private velocity = new THREE.Vector2(); // bırakınca kayma hızı (x, z)
  private lastMove = 0;
  private turn: { from: number; to: number; t: number; tiltFrom: number; tiltTo: number } | null = null;
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ndc = new THREE.Vector2();
  private keys = new Set<string>();

  // bounds: hedefin gezebileceği alan (dünya koordinatında)
  constructor(
    private camera: THREE.PerspectiveCamera,
    private el: HTMLElement,
    public bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  ) {
    el.addEventListener('pointerdown', e => this.down(e));
    el.addEventListener('pointermove', e => this.move(e));
    el.addEventListener('pointerup', e => this.up(e));
    el.addEventListener('pointercancel', e => this.up(e));
    el.addEventListener('wheel', e => this.wheel(e), { passive: false });
    el.addEventListener('contextmenu', e => e.preventDefault());
    // Safari'nin kendi sayfa yakınlaştırmasını engelle
    document.addEventListener('gesturestart', e => e.preventDefault());
    // Klavyeyle kaydırma (yazı yazılan bir kutu seçiliyse değil)
    window.addEventListener('keydown', e => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // Yakınlaştıkça kamera biraz yatar (yakında şehir daha görkemli, uzakta harita gibi); üstüne kullanıcının eğmesi eklenir
  get pitch() {
    const k = (this.distance - this.minDistance) / (this.maxDistance - this.minDistance);
    return THREE.MathUtils.clamp(THREE.MathUtils.lerp(0.62, 0.98, THREE.MathUtils.clamp(k, 0, 1)) + this.tilt, 0.34, 1.48);
  }

  // Bu uzaklıkta istenen bakış açısı (pitch) için gereken eğim
  tiltFor(pitch: number, distance = this.distance) {
    const k = THREE.MathUtils.clamp((distance - this.minDistance) / (this.maxDistance - this.minDistance), 0, 1);
    return pitch - THREE.MathUtils.lerp(0.62, 0.98, k);
  }

  private tiltBy(amount: number) {
    this.tilt = THREE.MathUtils.clamp(this.tilt + amount, TILT_MIN, TILT_MAX);
  }

  // Bakış çizgisi (hedeften kameraya) arazinin içinden geçiyorsa açı yükselir
  private viewPitch() {
    let p = this.pitch;
    const ground = this.terrain;
    if (!ground) return p;
    const step = Math.max(0.5, this.distance / 40);
    const blocked = (q: number) => {
      const c = Math.cos(q), sx = Math.sin(this.yaw) * c, sz = Math.cos(this.yaw) * c, sy = Math.sin(q);
      // Hedefin yanında küçük, uzakta biraz daha büyük pay
      for (let s = step; s <= this.distance + 1e-6; s += step) {
        if (this.target.y + sy * s < ground(this.target.x + sx * s, this.target.z + sz * s) + Math.min(0.6, 0.05 + s * 0.1)) return true;
      }
      return false;
    };
    while (p < 1.45 && blocked(p)) p += 0.04;
    return p;
  }

  apply() {
    const p = this.viewPitch();
    const h = Math.cos(p) * this.distance;
    this.camera.position.set(this.target.x + Math.sin(this.yaw) * h, this.target.y + Math.sin(p) * this.distance + this.lift, this.target.z + Math.cos(this.yaw) * h);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

  // Kamera bir kulenin tepesine çok yaklaştıysa yumuşakça yukarı çık; uzaklaşınca geri in
  private keepAbove(dt: number) {
    if (!this.clearance) return;
    const p = this.viewPitch();
    const h = Math.cos(p) * this.distance;
    const x = this.target.x + Math.sin(this.yaw) * h, z = this.target.z + Math.cos(this.yaw) * h;
    const y = this.target.y + Math.sin(p) * this.distance;
    const top = this.clearance(x, z);
    const need = top > 0 ? Math.max(0, top + 0.8 - y) : 0;
    if (Math.abs(need - this.lift) < 1e-3) return;
    // Yukarı hızlı (kulenin içine girmesin), aşağı yavaş
    this.lift += (need - this.lift) * Math.min(1, dt * (need > this.lift ? 12 : 4));
    this.apply();
  }

  private clamp() {
    this.target.x = THREE.MathUtils.clamp(this.target.x, this.bounds.minX, this.bounds.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, this.bounds.minZ, this.bounds.maxZ);
    this.distance = THREE.MathUtils.clamp(this.distance, this.minDistance, this.maxDistance);
  }

  // Ekrandaki bir noktanın altındaki zemin noktası
  private groundAt(x: number, y: number): THREE.Vector3 | null {
    const r = this.el.getBoundingClientRect();
    this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.ray.intersectPlane(this.ground, new THREE.Vector3());
  }

  // Bir değişiklikten sonra, ekrandaki (x, y) noktasının altında yine aynı zemin noktası olsun
  private keepUnder(before: THREE.Vector3 | null, x: number, y: number) {
    this.clamp();
    this.apply();
    if (!before) return;
    const after = this.groundAt(x, y);
    if (!after) return;
    this.target.x += before.x - after.x;
    this.target.z += before.z - after.z;
    this.clamp();
    this.apply();
  }

  private down(e: PointerEvent) {
    this.turn = null;
    this.velocity.set(0, 0);
    if (e.pointerType === 'mouse') {
      try {
        this.el.setPointerCapture(e.pointerId);
      } catch {
        // bazı tarayıcılarda dokunuş yakalanamayabilir; sorun değil
      }
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        this.rotating = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.button === 2 || (e.button === 0 && this.singlePan())) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.grab = this.groundAt(e.clientX, e.clientY);
      }
      return;
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) this.grab = this.singlePan() ? this.groundAt(e.clientX, e.clientY) : null;
    else this.startTwo();
  }

  // Bu parmak artık haritayı kaydırmasın (ör. bina taşınırken)
  releaseGrab() {
    this.grab = null;
    this.velocity.set(0, 0);
  }

  private startTwo() {
    this.grab = null;
    const [a, b] = [...this.pointers.values()];
    this.two = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
    this.twoMode = null;
    this.twoStart = { ...this.two };
  }

  private move(e: PointerEvent) {
    if (this.rotating) {
      this.yaw -= (e.clientX - this.rotating.x) * 0.008;
      this.tiltBy((e.clientY - this.rotating.y) * TILT_SPEED);
      this.rotating.x = e.clientX;
      this.rotating.y = e.clientY;
      this.apply();
      return;
    }
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size >= 2) return this.moveTwo();
    if (!this.grab) return;
    const now = this.groundAt(p.x, p.y);
    if (!now) return;
    const dx = this.grab.x - now.x, dz = this.grab.z - now.z;
    this.target.x += dx;
    this.target.z += dz;
    this.clamp();
    this.apply();
    // Bırakınca biraz kaysın diye hızı hatırla
    const t = performance.now();
    const dt = Math.max(8, t - this.lastMove) / 1000;
    this.lastMove = t;
    this.velocity.lerp(new THREE.Vector2(dx / dt, dz / dt), 0.5);
  }

  private moveTwo() {
    const [a, b] = [...this.pointers.values()];
    const prev = this.two;
    if (!prev) return this.startTwo();
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    let da = angle - prev.angle;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    // Hareketin türüne karar ver: iki parmak birlikte yukarı/aşağı gidiyorsa (açılıp kapanmadan, dönmeden) eğme
    if (!this.twoMode) {
      // Parmakların olayları sırayla gelir; tek tek değil, başlangıçtan bu yana toplam harekete bakılır
      const s = this.twoStart;
      let turn = angle - s.angle;
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      const acc = { vert: y - s.y, side: Math.abs(x - s.x), spread: Math.abs(dist - s.dist), twist: Math.abs(turn) * dist * 0.5 };
      const moved = Math.abs(acc.vert) + acc.side + acc.spread + acc.twist;
      if (moved > 14) {
        const v = Math.abs(acc.vert);
        this.twoMode = v > acc.side * 1.3 && v > acc.spread * 1.6 && v > acc.twist * 1.6 ? 'tilt' : 'move';
      }
      this.two = { x, y, dist, angle };
      return;
    }
    if (this.twoMode === 'tilt') {
      // iPhone Haritalar gibi: iki parmak yukarı kayınca harita yatar (yandan görünüm), aşağı kayınca kuşbakışına döner
      this.tiltBy((y - prev.y) * TILT_SPEED);
      this.two = { x, y, dist, angle };
      this.apply();
      return;
    }
    const before = this.groundAt(prev.x, prev.y);
    // Yakınlaştır (parmaklar açılırsa yaklaş)
    if (prev.dist > 20 && dist > 20) this.distance *= Math.pow(prev.dist / dist, ZOOM_POWER);
    // Döndür (parmaklar çevrilince harita da döner)
    this.yaw += da;
    this.two = { x, y, dist, angle };
    // Parmakların ortasındaki yer parmakların altında kalsın (kaydırma da bununla olur)
    this.keepUnder(before, x, y);
  }

  private up(e: PointerEvent) {
    if (this.rotating) {
      this.rotating = null;
      return;
    }
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size === 1) {
      // İki parmaktan biri kalktı: kalan parmakla kaydırmaya devam
      const [p] = [...this.pointers.values()];
      this.two = null;
      this.twoMode = null;
      this.grab = this.singlePan() ? this.groundAt(p.x, p.y) : null;
      this.velocity.set(0, 0);
    } else if (this.pointers.size === 0) {
      this.grab = null;
      this.two = null;
      // Son hareket eskiyse kayma olmasın
      if (performance.now() - this.lastMove > 90) this.velocity.set(0, 0);
    }
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const before = this.groundAt(e.clientX, e.clientY);
    this.distance *= Math.pow(1.0018, e.deltaY);
    this.keepUnder(before, e.clientX, e.clientY);
  }

  // Klavye: oklar/WASD ile bakılan yöne göre kaydır, +/- ile yakınlaştır
  private keyMove(dt: number) {
    if (!this.keys.size) return;
    const k = this.keys;
    const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const side = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    const zoom = (k.has('-') || k.has('_') ? 1 : 0) - (k.has('+') || k.has('=') ? 1 : 0);
    const tilt = (k.has('r') ? 1 : 0) - (k.has('f') ? 1 : 0);
    if (!fwd && !side && !zoom && !tilt) return;
    this.tiltBy(tilt * dt * 0.9);
    const speed = this.distance * 0.9 * dt;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.target.x += (-s * fwd + c * side) * speed;
    this.target.z += (-c * fwd - s * side) * speed;
    this.distance *= Math.pow(1.8, zoom * dt);
    this.clamp();
    this.apply();
  }

  // Haritayı bırakılan yerde biraz kaydır, döndürme animasyonunu ilerlet
  update(dt: number) {
    this.keyMove(dt);
    this.keepAbove(dt);
    if (this.turn) {
      this.turn.t = Math.min(1, this.turn.t + dt / 0.5);
      const k = 1 - Math.pow(1 - this.turn.t, 3);
      this.yaw = this.turn.from + (this.turn.to - this.turn.from) * k;
      this.tilt = this.turn.tiltFrom + (this.turn.tiltTo - this.turn.tiltFrom) * k;
      if (this.turn.t >= 1) this.turn = null;
      this.apply();
    }
    if (this.pointers.size === 0 && this.velocity.lengthSq() > 0.0004) {
      this.target.x += this.velocity.x * dt;
      this.target.z += this.velocity.y * dt;
      this.velocity.multiplyScalar(Math.exp(-dt * 6));
      this.clamp();
      this.apply();
    }
  }

  // Yumuşakça döndür (klavye ve pusula için)
  rotateBy(angle: number) {
    const from = this.turn ? this.turn.to : this.yaw;
    this.turn = { from: this.yaw, to: from + angle, t: 0, tiltFrom: this.tilt, tiltTo: this.tilt };
  }

  // Başlangıç açısına ve eğimine dön (en kısa yoldan)
  resetRotation() {
    const home = Math.PI / 4;
    let d = (home - this.yaw) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    this.turn = { from: this.yaw, to: this.yaw + d, t: 0, tiltFrom: this.tilt, tiltTo: 0 };
  }

  // Tek parmak hareketi iptal (araç değişince)
  stop() {
    this.grab = null;
    this.velocity.set(0, 0);
  }
}
