import { MATERIALS, MAT_IDS, MAKER_LEVELS, TOOL_INFO, type MatId, type MakerKind } from './config';
import type { City, Job } from './city';

// Üretim ekranı: fabrikaya ya da dükkana dokununca kamera binanın önüne iner (yakın plan), altta bir atölye açılır:
// - Üretim bandı: üretilen her ürün bant üstünde bir koliye girer; koli dolarken süre akar, bitince koli açılır,
//   ürün içinden çıkar (dokununca depoya uçar). Dükkanda sıradakiler kapalı koli olarak bekler.
// - Ürün rafı: gerçek resimli ürün kartları (süre ve gereken malzemeler, depoda kaç tane olduğuyla).
//   Karta dokun ya da kartı binanın üstüne sürükle, üretim başlasın.
// Üstteki tabelada ◀ ▶ ile diğer fabrika ve dükkanlara geçilir; kapatınca kamera eski yerine döner.

// --- Ürün resimleri (3D modelden çizilir; yoksa emoji) ---
const PICS = new Map<string, string>();
export function setProductPics(pics: Map<string, string>) {
  for (const [k, v] of pics) PICS.set(k, v);
}
export function productPic(id: MatId, cls = 'ipic') {
  const src = PICS.get(id);
  return src ? `<img class="${cls}" src="${src}" alt="" draggable="false">` : `<span class="${cls} emo">${MATERIALS[id].icon}</span>`;
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

export class ProductionPanel {
  i: number | null = null;
  private root: HTMLElement;
  private head: HTMLElement;
  private belt: HTMLElement;
  private crates: HTMLElement;
  private shelf: HTMLElement;
  private tip: HTMLElement;
  private ring: HTMLElement;
  private upBtn: HTMLButtonElement;
  private count: HTMLElement;
  private anchor = { x: 0, y: 0 };
  private tipFor: number | null = null; // açık balon hangi kolinin
  private timer = 0;
  private shelfSig = '';

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
      <div class="ptg"></div>
      <div class="pbench">
        <div class="pbhead"><span class="pbt">Üretim bandı</span><small class="pbc"></small><button class="pu"></button></div>
        <div class="pline">
          <div class="pcrates"></div>
          <div class="pbelt"><i class="roll l"></i><i class="roll r"></i></div>
        </div>
        <div class="pshelf"></div>
      </div>
      <div class="ptip" hidden></div>`;
    document.body.appendChild(root);
    this.root = root;
    this.head = root.querySelector('.ph')!;
    this.belt = root.querySelector('.pbelt')!;
    this.crates = root.querySelector('.pcrates')!;
    this.shelf = root.querySelector('.pshelf')!;
    this.tip = root.querySelector('.ptip')!;
    this.ring = root.querySelector('.ptg')!;
    this.upBtn = root.querySelector('.pu')!;
    this.count = root.querySelector('.pbc')!;
    root.querySelectorAll<HTMLButtonElement>('.pa').forEach(b =>
      b.addEventListener('click', () => {
        this.hideTip();
        this.h.cycle(+b.dataset.d!);
      }),
    );
    root.querySelector('.px')!.addEventListener('click', () => this.h.close());
    root.querySelector('.pi')!.addEventListener('click', () => this.i !== null && this.h.info(this.i));
    this.upBtn.addEventListener('click', () => this.i !== null && this.h.upgrade(this.i));
    // Balonun dışına dokununca kapansın
    root.addEventListener('pointerdown', e => {
      const t = e.target as HTMLElement;
      if (!t.closest('.ptip') && !t.closest('.cr')) this.hideTip();
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
    if (was !== i) {
      this.shelfSig = '';
      this.crates.dataset.shape = '';
      this.shelf.scrollLeft = 0;
    }
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

  // Durum değişince (üretim, depo, seviye) yeniden çiz
  refresh() {
    if (this.i === null) return;
    const t = this.h.city().tiles[this.i];
    if (!t || !MAT_IDS.some(m => MATERIALS[m].maker === t.kind)) return this.h.close();
    this.renderHead();
    this.renderShelf();
    this.renderBelt();
    if (this.tipFor !== null) this.showCrateTip(this.tipFor);
  }

  // Tabela: bina resmi, adı, yıldızları, depo; bant başlığında yükseltme
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
    this.upBtn.innerHTML = block && block !== 'Yeterli para yok' ? `⭐ ${block}` : `⭐ Yükselt <b>💰${fmt(next.money)}</b><small>%${faster} hızlı</small>`;
  }

  // --- Ürün rafı ---
  private renderShelf() {
    const city = this.h.city();
    const i = this.i!;
    const mats = MAT_IDS.filter(m => MATERIALS[m].maker === this.kind);
    const sig = mats.join(',') + '|' + i + '|' + PICS.size;
    if (sig !== this.shelfSig) {
      this.shelfSig = sig;
      this.shelf.innerHTML = mats
        .map(m => `<button class="pc" data-m="${m}"><span class="pcp">${productPic(m)}</span><b>${MATERIALS[m].name}</b><span class="pct"></span><span class="pcn"></span><em class="pcl"></em></button>`)
        .join('');
      this.shelf.querySelectorAll<HTMLButtonElement>('.pc').forEach(el => this.bindCard(el, el.dataset.m as MatId));
    }
    this.shelf.querySelectorAll<HTMLButtonElement>('.pc').forEach(el => {
      const mat = el.dataset.m as MatId;
      const m = MATERIALS[mat];
      const locked = !city.isUnlocked(mat);
      const err = locked ? null : city.canMake(i, mat);
      el.classList.toggle('lock', locked);
      el.classList.toggle('can', !locked && err === null);
      el.classList.toggle('miss', !locked && err !== null);
      el.querySelector('.pcl')!.textContent = locked ? `🔒 Seviye ${m.unlock}` : '';
      el.querySelector('.pct')!.textContent = `⏱ ${clock(city.makerTime(i, mat))}`;
      const needs = Object.entries(m.needs ?? {}) as [MatId, number][];
      const html = needs.length
        ? needs.map(([id, n]) => `<span class="nd${city.storage[id] >= n ? '' : ' no'}">${productPic(id)}${Math.min(city.storage[id], 99)}/${n}</span>`).join('')
        : `<span class="raw">Ham madde</span>`;
      const pcn = el.querySelector<HTMLElement>('.pcn')!;
      if (pcn.dataset.h !== html) {
        pcn.dataset.h = html;
        pcn.innerHTML = html;
      }
    });
  }

  // Kart: dokun = üret; yukarı, binanın üstüne sürükle = üret; yana kaydırınca raf kayar
  private bindCard(el: HTMLButtonElement, mat: MatId) {
    let start: { id: number; x: number; y: number } | null = null;
    let ghost: HTMLElement | null = null;
    let scrolling = false;
    el.addEventListener('pointerdown', e => {
      start = { id: e.pointerId, x: e.clientX, y: e.clientY };
      scrolling = false;
    });
    el.addEventListener('pointermove', e => {
      if (!start || e.pointerId !== start.id || scrolling) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!ghost) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          scrolling = true; // raf kaydırılıyor
          return;
        }
        if (dy < -14) {
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            // parmak çoktan kalkmış olabilir
          }
          ghost = document.createElement('div');
          ghost.className = 'pghost';
          ghost.innerHTML = productPic(mat);
          this.root.appendChild(ghost);
          this.ring.classList.add('on');
        }
      }
      if (ghost) {
        ghost.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        this.ring.classList.toggle('hot', Math.hypot(e.clientX - this.anchor.x, e.clientY - this.anchor.y) < 110);
      }
    });
    const end = (e: PointerEvent, cancelled: boolean) => {
      if (!start || e.pointerId !== start.id) return;
      start = null;
      this.ring.classList.remove('on', 'hot');
      if (ghost) {
        const g = ghost;
        ghost = null;
        const onBuilding = !cancelled && Math.hypot(e.clientX - this.anchor.x, e.clientY - this.anchor.y) < 110;
        if (onBuilding && this.tryMake(mat, el)) this.flyInto(g);
        else {
          const r = el.getBoundingClientRect();
          g.classList.add('back');
          g.style.transform = `translate(${r.left + r.width / 2}px, ${r.top + 34}px)`;
          setTimeout(() => g.remove(), 260);
        }
        return;
      }
      if (cancelled || scrolling) return;
      if (this.tryMake(mat, el)) {
        const r = el.getBoundingClientRect();
        const g = document.createElement('div');
        g.className = 'pghost';
        g.innerHTML = productPic(mat);
        g.style.transform = `translate(${r.left + r.width / 2}px, ${r.top + 34}px)`;
        this.root.appendChild(g);
        requestAnimationFrame(() => this.flyInto(g));
      }
    };
    el.addEventListener('pointerup', e => end(e, false));
    el.addEventListener('pointercancel', e => end(e, true));
  }

  // Üretimi başlat; olmazsa kart sallanır ve nedeni yazılır
  private tryMake(mat: MatId, el: HTMLElement) {
    const err = this.h.make(this.i!, mat);
    if (err) {
      el.classList.remove('shake');
      void el.offsetWidth;
      el.classList.add('shake');
      this.h.toast(err, true);
      this.h.sound('error');
      return false;
    }
    this.h.sound('click');
    this.hideTip();
    this.refresh();
    return true;
  }

  // Ürün resmi binanın kapısına uçar
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

  // --- Üretim bandı: koliler ---
  private renderBelt() {
    const city = this.h.city();
    const i = this.i!;
    const now = Date.now();
    const list: Job[] = city.jobs.get(i) ?? [];
    const slots = city.makerSlots(i);
    const factory = this.kind === 'factory';
    let html = '';
    let shape = '';
    const live: { p: number; label: string }[] = [];
    let running = 0;
    list.forEach((job, k) => {
      const start = city.jobStart(i, job);
      const ready = job.end <= now;
      const run = !ready && start <= now;
      if (run) running++;
      const p = run ? Math.min(1, Math.max(0, (now - start) / Math.max(1, job.end - start))) : 0;
      const cls = ready ? 'ready' : run ? 'run' : 'wait';
      const label = ready ? '✓ Topla' : run ? clock((job.end - now) / 1000) : 'Sırada';
      live.push({ p, label });
      shape += `${k}${cls}${job.mat};`;
      html += `<button class="cr ${cls}" data-k="${k}" style="--p:${p.toFixed(3)}"><span class="crp">${productPic(job.mat)}</span><i class="lid"></i><i class="box"></i><i class="bar"><b></b></i><small>${label}</small></button>`;
    });
    for (let n = list.length; n < slots; n++) html += `<button class="cr empty" data-k="-1"><i class="box"></i><small>Boş</small></button>`;
    const price = city.slotPrice(i);
    if (price !== null) html += `<button class="cr plus" data-k="-2"><b>+</b><small>💰${fmt(price)}</small></button>`;
    shape += `${slots}|${price}|${PICS.size}`;
    this.belt.classList.toggle('moving', running > 0);
    this.count.textContent = `${list.length}/${slots} ${factory ? 'aynı anda' : 'sırada'}`;
    // Düzen aynıysa sadece süre ve dolum çubuğu güncellenir (dokunurken koli yerinden oynamasın)
    if (this.crates.dataset.shape === shape) {
      this.crates.querySelectorAll<HTMLElement>('.cr').forEach((b, n) => {
        const v = live[n];
        if (!v) return;
        b.style.setProperty('--p', v.p.toFixed(3));
        const s = b.querySelector('small');
        if (s && s.textContent !== v.label) s.textContent = v.label;
      });
      return;
    }
    this.crates.dataset.shape = shape;
    this.crates.innerHTML = html;
    this.crates.querySelectorAll<HTMLButtonElement>('.cr').forEach(b => b.addEventListener('click', () => this.tapCrate(+b.dataset.k!, b)));
  }

  private tapCrate(k: number, el: HTMLElement) {
    const i = this.i!;
    const city = this.h.city();
    if (k === -2) {
      this.hideTip();
      this.h.buySlot(i);
      return;
    }
    if (k === -1) {
      this.h.toast('Aşağıdaki raftan bir ürüne dokun ya da ürünü binanın üstüne sürükle');
      return;
    }
    const job = city.jobs.get(i)?.[k];
    if (!job) return;
    if (job.end <= Date.now()) {
      // Hazır koli: hepsini depoya al
      const r = el.getBoundingClientRect();
      const got = this.h.collect(i);
      if (got.length) this.flyToStorage(got, { x: r.left + r.width / 2, y: r.top + r.height / 3 });
      this.hideTip();
      this.refresh();
      return;
    }
    this.showCrateTip(k);
    this.h.sound('click');
  }

  // Koli balonu: kalan süre, hemen bitir, sıradan çıkar
  private showCrateTip(k: number) {
    const city = this.h.city();
    const i = this.i!;
    const job = city.jobs.get(i)?.[k];
    const now = Date.now();
    if (!job || job.end <= now) return this.hideTip();
    this.tipFor = k;
    const m = MATERIALS[job.mat];
    const start = city.jobStart(i, job);
    const cost = city.speedUpCost(i, k, now);
    const running = start <= now;
    this.tip.innerHTML = `
      <div class="tt">${productPic(job.mat)}<span><b>${m.name}</b><small>${running ? `⏱ ${clock((job.end - now) / 1000)} kaldı` : `Sırada · ${clock((start - now) / 1000)} sonra başlar`}</small></span></div>
      ${cost !== null ? `<button class="tb speed">⚡ Hemen bitir <b>💰${fmt(cost)}</b></button>` : ''}
      ${!running ? `<button class="tb cancel">↩ Sıradan çıkar <small>malzemeler geri gelir</small></button>` : ''}`;
    this.tip.hidden = false;
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
    const el = this.crates.querySelector<HTMLElement>(`.cr[data-k="${k}"]`);
    if (el) this.placeTip(el.getBoundingClientRect());
  }

  // Balonu kolinin üstüne (ekranın içinde kalacak şekilde) koy
  private placeTip(r: DOMRect) {
    const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    const W = window.innerWidth;
    const x = Math.max(8, Math.min(W - tw - 8, r.left + r.width / 2 - tw / 2));
    const y = Math.max(8, r.top - th - 10);
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${y}px`;
  }

  private hideTip() {
    this.tipFor = null;
    this.tip.hidden = true;
  }

  // Her karede: hedef halkası binayı izler, süreler akar
  update(dt: number) {
    if (this.i === null) return;
    this.place(false);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    this.renderBelt();
    // Açık balondaki kalan süre ve hızlandırma fiyatı da aksın (düğmeler yerinde kalır)
    if (this.tipFor !== null) {
      const city = this.h.city();
      const k = this.tipFor;
      const job = city.jobs.get(this.i)?.[k];
      const now = Date.now();
      if (!job || job.end <= now) return this.hideTip();
      const start = city.jobStart(this.i, job);
      const small = this.tip.querySelector('.tt small');
      if (small) small.textContent = start <= now ? `⏱ ${clock((job.end - now) / 1000)} kaldı` : `Sırada · ${clock((start - now) / 1000)} sonra başlar`;
      const cost = city.speedUpCost(this.i, k, now);
      const b = this.tip.querySelector('.speed b');
      if (b && cost !== null) b.textContent = `💰${fmt(cost)}`;
    }
  }

  private place(force: boolean) {
    const a = this.h.anchor(this.i!);
    if (!a) return;
    if (!force && Math.abs(a.x - this.anchor.x) < 0.5 && Math.abs(a.y - this.anchor.y) < 0.5) return;
    this.anchor = a;
    this.root.style.setProperty('--ax', `${a.x}px`);
    this.root.style.setProperty('--ay', `${a.y}px`);
  }
}
