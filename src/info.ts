import {
  RES_LEVELS, COM_LEVELS, UTILITIES, SERVICES, SERVICE_KINDS, TOOL_INFO, POP_PER_COM_LEVEL, PARK_RADIUS,
} from './config';
import { City, isService, isUtility, serviceArea } from './city';

// Bir binaya dokununca çıkan bilgi kartının içeriği
export interface InfoCard {
  title: string;
  lines: { ok?: boolean; text: string }[];
}

const fmt = (n: number) => n.toLocaleString('tr-TR');

export function describeTile(city: City, i: number): InfoCard | null {
  const t = city.tiles[i];
  if (!t || t.kind === 'road') return null;
  const connected = city.isConnected(i);
  const road = { ok: connected, text: connected ? 'Şehrin yollarına bağlı' : 'Yol bağlantısı yok' };

  if (t.kind === 'res' || t.kind === 'com') {
    const isRes = t.kind === 'res';
    const levels = isRes ? RES_LEVELS : COM_LEVELS;
    const name = isRes ? '🏠 Konut' : '🏪 Ticaret';
    if (t.level === 0) {
      return {
        title: `${name} · Boş arsa`,
        lines: [
          road,
          { text: connected ? 'Elektrik ve su yeterliyse yakında bina yapılacak.' : 'Bina yapılması için yolu şehre bağla.' },
        ],
      };
    }
    const lack = city.lacking.get(i);
    const served = connected && !lack;
    const lines: InfoCard['lines'] = [];
    if (isRes) lines.push({ text: `👥 ${served ? fmt(RES_LEVELS[t.level - 1].pop) : 0} kişi yaşıyor` });
    else lines.push({ text: `💼 ${served ? fmt(COM_LEVELS[t.level - 1].jobs) : 0} kişi çalışıyor` });
    lines.push(road);
    lines.push({ ok: !lack?.power, text: lack?.power ? 'Elektrik yok' : 'Elektrik var' });
    lines.push({ ok: !lack?.water, text: lack?.water ? 'Su yok' : 'Su var' });
    if (isRes) {
      lines.push({ ok: city.parkNear(i), text: '3. seviye için: yakında park' });
      lines.push({ ok: city.shopNear(i), text: '4. seviye için: yakında dükkan' });
      const missing = SERVICE_KINDS.filter(k => !city.isCovered(i, k)).map(k => SERVICES[k].name);
      lines.push({
        ok: missing.length === 0,
        text: missing.length ? `5. seviye için eksik: ${missing.join(', ')}` : '5. seviye için: bütün hizmetler var',
      });
    } else if (t.level < COM_LEVELS.length) {
      const needPop = t.level * POP_PER_COM_LEVEL;
      lines.push({ ok: city.population >= needPop, text: `${t.level + 1}. seviye için: ${fmt(needPop)} nüfus` });
    }
    // Şartlar tamam ama şehirde büyümeye yetecek kadar elektrik/su kalmamış olabilir
    if (served && t.level < city.maxLevel(i)) {
      const { power, water } = city.service;
      const spare = Math.min(power.supply - power.demand, water.supply - water.demand);
      const extra = levels[t.level].need - levels[t.level - 1].need;
      if (extra > spare) lines.push({ ok: false, text: 'Büyümek için şehre daha fazla elektrik ve su lazım' });
    }
    return { title: `${name} · Seviye ${t.level}/${levels.length}`, lines };
  }

  if (t.kind === 'park') {
    return {
      title: '🌳 Park',
      lines: [{ text: `Çevresindeki ${PARK_RADIUS} kare içindeki evler 3. seviyeye çıkabilir.` }],
    };
  }

  if (isUtility(t.kind)) {
    const u = UTILITIES[t.kind];
    const info = TOOL_INFO[t.kind];
    return {
      title: `${info.icon} ${info.label}`,
      lines: [
        { text: u.power ? `⚡ ${u.power} elektrik üretir` : `💧 ${u.water} su verir` },
        { text: `🔧 Bakım: ${u.upkeep}/gün` },
        road,
      ],
    };
  }

  if (isService(t.kind)) {
    const s = SERVICES[t.kind];
    const info = TOOL_INFO[t.kind];
    const homes = serviceArea(i, t.kind).filter(c => city.tiles[c]?.kind === 'res' && city.tiles[c]!.level > 0).length;
    return {
      title: `${info.icon} ${info.label}`,
      lines: [
        { text: `📏 Kapsama alanı: ${s.radius} kare` },
        { text: `🏠 ${fmt(homes)} konut binasına hizmet veriyor` },
        { text: `🔧 Bakım: ${s.upkeep}/gün` },
        road,
      ],
    };
  }
  return null;
}
