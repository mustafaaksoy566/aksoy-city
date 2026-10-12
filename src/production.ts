import { MATERIALS, MAT_IDS, MAKER_LEVELS, TOOL_INFO, type MatId, type MakerKind } from './config';
import type { City, Job } from './city';

// Üretim ekranı (SimCity BuildIt'teki gibi): fabrikaya ya da dükkana dokununca kamera binaya yaklaşır,
// şehrin geri kalanı kararır, binanın iki yanında altıgen ürün düğmeleri çıkar. Ürünü binanın üstüne sürükle
// (ya da dokun) üretim başlasın. Altta üretim yerleri: süre halkası, hazır olanlar ✓ (dokununca depoya gelir),
// boş yerler ve parayla yeni yer açan "+" düğmesi. Üstte ◀ ▶ ile diğer fabrika ve dükkanlara geçilir.

// --- Ürün resimleri (3D modelden çizilir; yoksa emoji) ---
const PICS = new Map<string, string>();
export function setProductPics(pics: Map<string, string>) {
  for (const [k, v] of pics) PICS.set(k, v);
}
export function productPic(id: MatId, cls = 'ipic') {
  const src = PICS.get(id);
  return src ? `<img class="${cls}" src="${src}" alt="">` : `<span class="${cls} emo">${MATERIALS[id].icon}</span>`;
}

const fmt = (n: number) => n.toLocaleString('tr-TR');
// Kalan süre: 45 sn, 1:30, 1 sa 05
const clock = (sec: number) => {
  sec = Math.max(0, Math.ceil(sec));
  if (sec < 60) return `${sec} sn`;
  if (sec < 3600) return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  return `${Math.floor(sec / 3600)} sa ${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`;
};

export interface ProdHandlers {
  city(): City;
  thumb(kind: string): string | undefined;
  anchor(i: number): { x: number; y: number } | null; // binanın ekrandaki yeri
  make(i: number, mat: MatId): string | null; // null: üretim başladı
  collect(i: number): MatId[];
  speedUp(i: number, k: number): string | null;
  cancel(i: number, k: number): string | null;
  buySlot(i: number): void;
  upgrade(i: number): void;
  info(i: number): void;
  cycle(d: number): void;
  close(): void;
  sound(name: 'click' | 'place' | 'error' | 'grow'): void;
  toast(text: string, error?: boolean): void;
}

type Hex = { mat: MatId; el: HTMLButtonElement; x: number; y: number };

export class ProductionPanel {
  i: number | null = null;
  private root: HTMLElement;
  private head: HTMLElement;
  private hexBox: HTMLElement;
  private slotBox: HTMLElement;
  private tip: HTMLElement;
  private ring: HTMLElement;
  private upBtn: HTMLButtonElement;
  private hexes: Hex[] = [];
  private anchor = { x: 0, y: 0 };
  private tipFor: { kind: 'hex'; mat: MatId } | { kind: 'slot'; k: number } | null = null;
  private slotTimer = 0;
  private sig = '';

  constructor(private h: ProdHandlers) {
    const root = document.createElement('div');
    root.id = 'prod';
    root.hidden = true;
    root.innerHTML = `
      <div class="pv"></div>
      <div class="ph">
        <button class="pa" data-d="-1" aria-label="Önceki">‹</button>
        <div class="pt">
          <span class="pp"></span>
          <span class="pn"><b></b><small></small></span>
          <button class="pi" aria-label="Bilgi">i</button>
          <button class="px" aria-label="Kapat">✕</button>
        </div>
        <button class="pa" data-d="1" aria-label="Sonraki">›</button>
      </div>
      <button class="pu"></button>
      <div class="ptg"></div>
      <div class="phx"></div>
      <div class="ptip" hidden></div>
      <div class="pslots"></div>`;
    document.body.appendChild(root);
    this.root = root;
    this.head = root.querySelector('.ph')!;
    this.hexBox = root.querySelector('.phx')!;
    this.slotBox = root.querySelector('.pslots')!;
    this.tip = root.querySelector('.ptip')!;
    this.ring = root.querySelector('.ptg')!;
    this.upBtn = root.querySelector('.pu')!;
    root.querySelectorAll<HTMLButtonElement>('.pa').forEach(b =>
      b.addEventListener('click', () => {
        this.hideTip();
        this.h.cycle(+b.dataset.d!);
      }),
    );
    root.querySelector('.px')!.addEventListener('click', () => this.h.close());
    root.querySelector('.pi')!.addEventListener('click', () => this.i !== null && this.h.info(this.i));
    this.upBtn.addEventListener('click', () => this.i !== null && this.h.upgrade(this.i));
    // İpucu balonunun dışına dokununca kapansın
    root.addEventListener('pointerdown', e => {
      const t = e.target as HTMLElement;
      if (!t.closest('.ptip') && !t.closest('.hx') && !t.closest('.sl')) this.hideTip();
    });
  }

  get isOpen() {
    return this.i !== null;
  }

  open(i: number) {
    const was = this.i;
    this.i = i;
    this.root.hidden = false;
    document.body.classList.add('prod-on');
    this.hideTip();
    if (was !== i) this.sig = '';
    this.refresh();
    this.place(true);
  }

  close() {
    if (this.i === null) return;
    this.i = null;
    this.root.hidden = true;
    document.body.classList.remove('prod-on');
    this.hideTip();
  }

  private get kind(): MakerKind {
    return this.h.city().tiles[this.i!]!.kind as MakerKind;
  }

  // Durum değişince (üretim, depo, seviye) her şeyi yeniden çiz
  refresh() {
    if (this.i === null) return;
    const city = this.h.city();
    const t = city.tiles[this.i];
    if (!t || !MAT_IDS.some(m => MATERIALS[m].maker === t.kind)) return this.h.close();
    this.renderHead();
    this.renderHexes();
    this.renderSlots();
    if (this.tipFor) this.tipFor.kind === 'hex' ? this.showHexTip(this.tipFor.mat) : this.showSlotTip(this.tipFor.k);
  }

  private renderHead() {
    const city = this.h.city();
    const i = this.i!;
    const t = city.tiles[i]!;
    const kind = this.kind;
    const src = this.h.thumb(kind);
    const pp = this.head.querySelector('.pp')!;
    const want = src ? `<img src="${src}" alt="">` : `<span class="emo">${TOOL_INFO[kind].icon}</span>`;
    if (pp.innerHTML !== want) pp.innerHTML = want;
    this.head.querySelector('.pn b')!.textContent = TOOL_INFO[kind].label;
    const stars = '★'.repeat(t.level + 1) + '☆'.repeat(MAKER_LEVELS.length - t.level - 1);
    this.head.querySelector('.pn small')!.textContent = `${stars}  ·  📦 ${fmt(city.storageUsed)}/${fmt(city.storageCap)}`;
    // Yükseltme düğmesi: bir sonraki seviye, fiyatı ve faydası
    const next = MAKER_LEVELS[t.level + 1];
    if (!next) {
      this.upBtn.hidden = true;
      return;
    }
    const block = city.makerUpgradeBlocker(i);
    const faster = Math.round((1 - next.speed / MAKER_LEVELS[t.level].speed) * 100);
    this.upBtn.hidden = false;
    this.upBtn.disabled = block !== null && block !== 'Yeterli para yok';
    this.upBtn.classList.toggle('poor', block === 'Yeterli para yok');
    this.upBtn.innerHTML =
      block && block !== 'Yeterli para yok'
        ? `⭐ ${t.level + 2}. seviye <small>${block}</small>`
        : `⭐ Yükselt <b>💰${fmt(next.money)}</b><small>%${faster} hızlı, +1 yer</small>`;
  }

  // Altıgen ürün düğmeleri: binanın iki yanında
  private renderHexes() {
    const city = this.h.city();
    const i = this.i!;
    const mats = MAT_IDS.filter(m => MATERIALS[m].maker === this.kind);
    const sig = mats.join(',') + '|' + i;
    if (sig !== this.sig) {
      this.sig = sig;
      this.hexBox.innerHTML = '';
      this.hexes = mats.map(mat => {
        const el = document.createElement('button');
        el.className = 'hx';
        el.dataset.m = mat;
        el.innerHTML = `<span class="hxi">${productPic(mat)}</span><i class="dot"></i><em class="lk"></em>`;
        this.hexBox.appendChild(el);
        this.bindHex(el, mat);
        return { mat, el, x: 0, y: 0 };
      });
    }
    for (const hx of this.hexes) {
      const locked = !city.isUnlocked(hx.mat);
      hx.el.classList.toggle('lock', locked);
      hx.el.classList.toggle('can', !locked && city.canMake(i, hx.mat) === null);
      hx.el.querySelector('.lk')!.textContent = locked ? `🔒${MATERIALS[hx.mat].unlock}` : '';
      // Resim sonradan geldiyse (3D çizim bitince) emojinin yerine koy
      const pic = hx.el.querySelector('.hxi')!;
      if (pic.querySelector('.emo') && PICS.has(hx.mat)) pic.innerHTML = productPic(hx.mat);
    }
  }

  // Düğme: dokun = üret; basılı tut = bilgi; binanın üstüne sürükle = üret
  private bindHex(el: HTMLButtonElement, mat: MatId) {
    let start: { id: number; x: number; y: number } | null = null;
    let held = false;
    let ghost: HTMLElement | null = null;
    let timer = 0;
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // bazı tarayıcılarda parmak çoktan kalkmış olabilir
      }
      start = { id: e.pointerId, x: e.clientX, y: e.clientY };
      held = false;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        held = true;
        this.showHexTip(mat);
        this.h.sound('click');
      }, 380);
    });
    el.addEventListener('pointermove', e => {
      if (!start || e.pointerId !== start.id) return;
      if (!ghost && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) {
        clearTimeout(timer);
        this.hideTip();
        ghost = document.createElement('div');
        ghost.className = 'pghost';
        ghost.innerHTML = productPic(mat);
        this.root.appendChild(ghost);
        this.ring.classList.add('on');
      }
      if (ghost) {
        ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        this.ring.classList.toggle('hot', Math.hypot(e.clientX - this.anchor.x, e.clientY - this.anchor.y) < 95);
      }
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      if (!start || e.pointerId !== start.id) return;
      clearTimeout(timer);
      start = null;
      this.ring.classList.remove('on', 'hot');
      if (ghost) {
        const g = ghost;
        ghost = null;
        const onBuilding = !cancelled && Math.hypot(e.clientX - this.anchor.x, e.clientY - this.anchor.y) < 95;
        if (onBuilding && this.tryMake(mat, el)) {
          this.flyInto(g);
        } else {
          // Geri dön ve kaybol
          const r = el.getBoundingClientRect();
          g.classList.add('back');
          g.style.transform = `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px)`;
          setTimeout(() => g.remove(), 260);
        }
        return;
      }
      if (cancelled || held) return;
      // Kısa dokunuş: üret (olmazsa nedenini göster)
      if (this.tryMake(mat, el)) {
        const r = el.getBoundingClientRect();
        const g = document.createElement('div');
        g.className = 'pghost';
        g.innerHTML = productPic(mat);
        g.style.transform = `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px)`;
        this.root.appendChild(g);
        requestAnimationFrame(() => this.flyInto(g));
      }
    };
    el.addEventListener('pointerup', e => end(e, false));
    el.addEventListener('pointercancel', e => end(e, true));
  }

  // Üretimi başlat; olmazsa düğme sallanır ve neden yazılı balon çıkar
  private tryMake(mat: MatId, el: HTMLElement) {
    const err = this.h.make(this.i!, mat);
    if (err) {
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      this.showHexTip(mat, err);
      this.h.sound('error');
      return false;
    }
    this.h.sound('click');
    this.hideTip();
    this.refresh();
    return true;
  }

  // Ürün resmi binanın içine uçar
  private flyInto(g: HTMLElement) {
    g.classList.add('into');
    g.style.transform = `translate(${this.anchor.x}px, ${this.anchor.y}px) scale(0.3)`;
    setTimeout(() => g.remove(), 380);
  }

  // Hazır ürünler depo düğmesine uçar
  flyToStorage(mats: MatId[], from: { x: number; y: number }) {
    const target = document.getElementById('storage')?.getBoundingClientRect();
    if (!target) return;
    mats.slice(0, 6).forEach((m, n) => {
      const g = document.createElement('div');
      g.className = 'pghost';
      g.innerHTML = productPic(m);
      g.style.transform = `translate(${from.x}px, ${from.y}px)`;
      document.body.appendChild(g);
      setTimeout(() => {
        g.classList.add('away');
        g.style.transform = `translate(${target.left + target.width / 2}px, ${target.top + target.height / 2}px) scale(0.4)`;
      }, 30 + n * 90);
      setTimeout(() => g.remove(), 750 + n * 90);
    });
  }

  // --- Alttaki üretim yerleri ---
  private renderSlots() {
    const city = this.h.city();
    const i = this.i!;
    const now = Date.now();
    const list: Job[] = city.jobs.get(i) ?? [];
    const slots = city.makerSlots(i);
    const factory = this.kind === 'factory';
    let html = '';
    let shape = '';
    const live: { p: number; label: string }[] = [];
    let activeShown = false;
    list.forEach((job, k) => {
      const start = city.jobStart(i, job);
      const ready = job.end <= now;
      const running = !ready && start <= now;
      const big = !factory && running && !activeShown;
      if (big) activeShown = true;
      const p = running ? Math.min(1, Math.max(0, (now - start) / Math.max(1, job.end - start))) : 0;
      const cls = ready ? 'ready' : running ? 'run' : 'wait';
      const label = ready ? '✓' : running ? clock((job.end - now) / 1000) : 'Sırada';
      live.push({ p, label });
      shape += `${k}${cls}${big}${job.mat};`;
      html += `<button class="sl ${cls}${big ? ' big' : ''}" data-k="${k}" style="--p:${p.toFixed(3)}"><span class="slp">${productPic(job.mat)}</span><small>${label}</small></button>`;
    });
    for (let n = list.length; n < slots; n++) html += `<button class="sl empty" data-k="-1"><small>Boş</small></button>`;
    const price = city.slotPrice(i);
    if (price !== null) html += `<button class="sl plus" data-k="-2"><b>+</b><small>💰${fmt(price)}</small></button>`;
    shape += `${slots}|${price}|${PICS.size}`;
    // Düzen aynıysa sadece süre yazısı ve halka güncellenir (dokunurken düğme yerinden oynamasın)
    if (this.slotBox.dataset.shape === shape) {
      this.slotBox.querySelectorAll<HTMLElement>('.sl').forEach((b, n) => {
        const v = live[n];
        if (!v) return;
        b.style.setProperty('--p', v.p.toFixed(3));
        const s = b.querySelector('small');
        if (s && s.textContent !== v.label) s.textContent = v.label;
      });
      return;
    }
    this.slotBox.dataset.shape = shape;
    this.slotBox.innerHTML = html;
    this.slotBox.querySelectorAll<HTMLButtonElement>('.sl').forEach(b => b.addEventListener('click', () => this.tapSlot(+b.dataset.k!, b)));
  }

  private tapSlot(k: number, el: HTMLElement) {
    const i = this.i!;
    const city = this.h.city();
    if (k === -2) {
      this.hideTip();
      this.h.buySlot(i);
      return;
    }
    if (k === -1) {
      this.h.toast(this.kind === 'factory' ? 'Bir malzemeyi fabrikanın üstüne sürükle ya da dokun' : 'Bir ürünü dükkanın üstüne sürükle ya da dokun');
      return;
    }
    const job = city.jobs.get(i)?.[k];
    if (!job) return;
    if (job.end <= Date.now()) {
      // Hazır: hepsini depoya al
      const r = el.getBoundingClientRect();
      const got = this.h.collect(i);
      if (got.length) this.flyToStorage(got, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      this.hideTip();
      this.refresh();
      return;
    }
    this.showSlotTip(k);
    this.h.sound('click');
  }

  // --- Bilgi balonu ---
  private showHexTip(mat: MatId, error?: string) {
    const city = this.h.city();
    const i = this.i!;
    const m = MATERIALS[mat];
    this.tipFor = { kind: 'hex', mat };
    const locked = !city.isUnlocked(mat);
    const needs = (Object.entries(m.needs ?? {}) as [MatId, number][])
      .map(([id, n]) => `<span class="nd${city.storage[id] >= n ? '' : ' miss'}">${productPic(id)}<b>${Math.min(city.storage[id], 99)}/${n}</b></span>`)
      .join('');
    const status = error ?? (locked ? `Şehir seviyesi ${m.unlock}'te açılır` : city.canMake(i, mat));
    this.tip.innerHTML = `
      <div class="tt">${productPic(mat)}<span><b>${m.name}</b><small>⏱ ${clock(city.makerTime(i, mat))} · 💰${fmt(m.price)} değer</small></span></div>
      ${needs ? `<div class="tn">${needs}</div>` : '<div class="tn none">Ham madde: malzeme gerekmez</div>'}
      ${status ? `<div class="te">${status}</div>` : '<div class="tk">Binanın üstüne sürükle ya da dokun</div>'}`;
    const hx = this.hexes.find(x => x.mat === mat);
    this.tip.hidden = false;
    this.tip.classList.toggle('err', !!status);
    if (hx) this.placeTip(hx.el.getBoundingClientRect());
  }

  private showSlotTip(k: number) {
    const city = this.h.city();
    const i = this.i!;
    const job = city.jobs.get(i)?.[k];
    if (!job) return this.hideTip();
    const now = Date.now();
    this.tipFor = { kind: 'slot', k };
    const m = MATERIALS[job.mat];
    const start = city.jobStart(i, job);
    const cost = city.speedUpCost(i, k, now);
    const running = start <= now && job.end > now;
    this.tip.innerHTML = `
      <div class="tt">${productPic(job.mat)}<span><b>${m.name}</b><small>${running ? `⏱ ${clock((job.end - now) / 1000)} kaldı` : `Sırada · ${clock((start - now) / 1000)} sonra başlar`}</small></span></div>
      ${cost !== null ? `<button class="tb speed">⚡ Hemen bitir <b>💰${fmt(cost)}</b></button>` : ''}
      ${!running && job.end > now ? `<button class="tb cancel">↩ Sıradan çıkar <small>malzemeler geri gelir</small></button>` : ''}`;
    this.tip.hidden = false;
    this.tip.classList.remove('err');
    this.tip.querySelector('.speed')?.addEventListener('click', () => {
      const err = this.h.speedUp(i, k);
      if (err) {
        this.h.toast(err, true);
        this.h.sound('error');
      } else {
        this.h.sound('grow');
        this.hideTip();
      }
      this.refresh();
    });
    this.tip.querySelector('.cancel')?.addEventListener('click', () => {
      const err = this.h.cancel(i, k);
      if (err) this.h.toast(err, true);
      else this.h.sound('click');
      this.hideTip();
      this.refresh();
    });
    const el = this.slotBox.querySelector<HTMLElement>(`.sl[data-k="${k}"]`);
    if (el) this.placeTip(el.getBoundingClientRect());
  }

  // Balonu düğmenin yanına (ekranın içinde kalacak şekilde) koy
  private placeTip(r: DOMRect) {
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    const W = window.innerWidth, H = window.innerHeight;
    let x = r.left + r.width / 2 - tw / 2;
    let y = r.top - th - 10;
    if (y < 70) y = r.bottom + 10;
    x = Math.max(8, Math.min(W - tw - 8, x));
    y = Math.max(8, Math.min(H - th - 8, y));
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${y}px`;
  }

  private hideTip() {
    this.tipFor = null;
    this.tip.hidden = true;
  }

  // Her karede: altıgenler binanın ekrandaki yerini izler, süreler akar
  update(dt: number) {
    if (this.i === null) return;
    this.place(false);
    this.slotTimer -= dt;
    if (this.slotTimer <= 0) {
      this.slotTimer = 0.25;
      this.renderSlots();
      // Açık balondaki kalan süre ve hızlandırma fiyatı da aksın (düğmeler yerinde kalır)
      if (this.tipFor?.kind === 'slot') {
        const city = this.h.city();
        const k = this.tipFor.k;
        const job = city.jobs.get(this.i)?.[k];
        const now = Date.now();
        if (!job || job.end <= now) this.hideTip();
        else {
          const start = city.jobStart(this.i, job);
          const small = this.tip.querySelector('.tt small');
          if (small) small.textContent = start <= now ? `⏱ ${clock((job.end - now) / 1000)} kaldı` : `Sırada · ${clock((start - now) / 1000)} sonra başlar`;
          const cost = city.speedUpCost(this.i, k, now);
          const b = this.tip.querySelector('.speed b');
          if (b && cost !== null) b.textContent = `💰${fmt(cost)}`;
        }
      }
    }
  }

  private place(force: boolean) {
    const a = this.h.anchor(this.i!);
    if (!a) return;
    if (!force && Math.abs(a.x - this.anchor.x) < 0.5 && Math.abs(a.y - this.anchor.y) < 0.5) return;
    this.anchor = a;
    this.root.style.setProperty('--ax', `${a.x}px`);
    this.root.style.setProperty('--ay', `${a.y}px`);
    const W = window.innerWidth, H = window.innerHeight;
    const n = this.hexes.length;
    const left = Math.ceil(n / 2), right = n - left;
    const rows = Math.max(left, right);
    // Ekranda kullanılabilecek yükseklik: üstte başlık, altta üretim yerleri
    const top = 150, bottom = H - 190;
    let dy = 76;
    if ((rows - 1) * dy > bottom - top) dy = Math.max(52, (bottom - top) / Math.max(1, rows - 1));
    const span = (rows - 1) * dy;
    const cy = Math.max(top + span / 2, Math.min(bottom - span / 2, a.y));
    const R = Math.max(104, Math.min(190, W * 0.3));
    this.hexes.forEach((hx, k) => {
      const onLeft = k < left;
      const row = onLeft ? k : k - left;
      const count = onLeft ? left : right;
      const y = cy + (row - (count - 1) / 2) * dy;
      // Zikzak: araya giren düğmeler binaya biraz yaklaşır
      const zig = row % 2 ? 26 : 0;
      let x = onLeft ? a.x - R + zig : a.x + R - zig;
      x = Math.max(40, Math.min(W - 40, x));
      hx.x = x;
      hx.y = y;
      hx.el.style.transform = `translate(${x}px, ${y}px)`;
    });
  }
}
