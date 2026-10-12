import * as THREE from 'three';
import { SIZE, type Tool } from './config';
import { idx, isService, isUtility, isIndustry, isDecor } from './city';

interface Handlers {
  tool(): Tool;
  preview(cells: number[]): void;
  commit(cells: number[]): void;
  cancel(): void;
  tap(cell: number | null): void; // Gez modunda kısa dokunuş (bilgi kartı için)
}

// Ekrana dokunma / fare ile harita karelerini seçme
export class TileInput {
  private pointers = new Set<number>();
  private drag: { id: number; sx: number; sz: number; cells: number[] } | null = null;
  private tapStart: { id: number; x: number; y: number; t: number } | null = null;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(private el: HTMLElement, private camera: THREE.Camera, private h: Handlers) {
    el.addEventListener('pointerdown', e => this.down(e));
    el.addEventListener('pointermove', e => this.move(e));
    el.addEventListener('pointerup', e => this.up(e));
    el.addEventListener('pointercancel', e => this.up(e, true));
    el.addEventListener('pointerleave', e => {
      if (e.pointerType === 'mouse' && !this.drag) this.h.preview([]);
    });
  }

  private tileAt(e: PointerEvent, clamp: boolean): [number, number] | null {
    const r = this.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const p = this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
    if (!p) return null;
    let x = Math.floor(p.x + SIZE / 2), z = Math.floor(p.z + SIZE / 2);
    if (clamp) {
      x = Math.min(SIZE - 1, Math.max(0, x));
      z = Math.min(SIZE - 1, Math.max(0, z));
    } else if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) return null;
    return [x, z];
  }

  // Yol düz bir çizgi, diğer araçlar dikdörtgen alan seçer
  private cellsBetween(sx: number, sz: number, ex: number, ez: number): number[] {
    const out: number[] = [];
    const tool = this.h.tool();
    // Hizmet ve altyapı binaları tek tek yerleşir
    if (isService(tool) || isUtility(tool) || isIndustry(tool) || isDecor(tool)) return [idx(ex, ez)];
    if (tool === 'road') {
      if (Math.abs(ex - sx) >= Math.abs(ez - sz)) {
        const step = ex >= sx ? 1 : -1;
        for (let x = sx; x !== ex + step; x += step) out.push(idx(x, sz));
      } else {
        const step = ez >= sz ? 1 : -1;
        for (let z = sz; z !== ez + step; z += step) out.push(idx(sx, z));
      }
      return out;
    }
    for (let z = Math.min(sz, ez); z <= Math.max(sz, ez); z++) {
      for (let x = Math.min(sx, ex); x <= Math.max(sx, ex); x++) out.push(idx(x, z));
    }
    return out;
  }

  private down(e: PointerEvent) {
    this.pointers.add(e.pointerId);
    this.tapStart = this.pointers.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() } : null;
    if (this.h.tool() === 'pan') return;
    // İkinci parmak gelirse çizimi bırak, kullanıcı kaydırıyor/yakınlaştırıyor
    if (this.pointers.size > 1) return this.cancelDrag();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const t = this.tileAt(e, false);
    if (!t) return;
    const cells = [idx(t[0], t[1])];
    this.drag = { id: e.pointerId, sx: t[0], sz: t[1], cells };
    this.h.preview(cells);
  }

  private move(e: PointerEvent) {
    if (this.h.tool() === 'pan') return;
    if (this.drag && e.pointerId === this.drag.id) {
      const t = this.tileAt(e, true);
      if (!t) return;
      this.drag.cells = this.cellsBetween(this.drag.sx, this.drag.sz, t[0], t[1]);
      this.h.preview(this.drag.cells);
    } else if (!this.drag && e.pointerType === 'mouse') {
      const t = this.tileAt(e, false);
      this.h.preview(t ? [idx(t[0], t[1])] : []);
    }
  }

  private up(e: PointerEvent, cancelled = false) {
    this.pointers.delete(e.pointerId);
    const tap = this.tapStart;
    this.tapStart = null;
    if (!cancelled && this.h.tool() === 'pan' && tap && tap.id === e.pointerId) {
      const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
      if (moved < 10 && performance.now() - tap.t < 500) {
        const t = this.tileAt(e, false);
        this.h.tap(t ? idx(t[0], t[1]) : null);
      }
    }
    if (!this.drag || e.pointerId !== this.drag.id) return;
    const cells = this.drag.cells;
    this.drag = null;
    if (cancelled) this.h.cancel();
    else this.h.commit(cells);
  }

  cancelDrag() {
    if (!this.drag) return;
    this.drag = null;
    this.h.cancel();
  }
}
