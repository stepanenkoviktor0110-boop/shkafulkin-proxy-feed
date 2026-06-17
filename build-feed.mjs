// Proxy-feed для B24U — Шкафулькин «Готовая мебель».
// Читает export_ready.xml клиента и дописывает в <description> каждой карточки
// кумулятивные ценовые зоны («до N тысяч») и синонимы по типу мебели.
// Зачем: B24U RAG-поиск семантический по тексту name+description; числовые
// сравнения («до 30 тысяч») не понимает → без price-зон бюджетные запросы
// возвращают пусто. Подробности — references/04-feeds-and-widgets.md §17/§21.
//
// Запуск: SOURCE_FEED_URL=<url> node build-feed.mjs → public/feed.xml

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { writeFileSync, mkdirSync } from 'node:fs';

const SOURCE_FEED_URL = process.env.SOURCE_FEED_URL;
if (!SOURCE_FEED_URL) { console.error('SOURCE_FEED_URL is required (env var).'); process.exit(1); }
const OUT_PATH = 'public/feed.xml';

// ───── Ценовые зоны: КУМУЛЯТИВНО ─────────────────────────────────────────────
// Для запроса «до N тысяч» нужно, чтобы карточку дешевле N содержала фразу «до N».
// Поэтому для цены p дописываем ВСЕ пороги выше p (не один бакет, как в шаблоне).
const PRICE_CEILINGS = [
  [15000,  'до 15000 руб до пятнадцати тысяч'],
  [20000,  'до 20000 руб до двадцати тысяч'],
  [30000,  'до 30000 руб до тридцати тысяч'],
  [50000,  'до 50000 руб до пятидесяти тысяч'],
  [80000,  'до 80000 руб до восьмидесяти тысяч'],
  [100000, 'до 100000 руб до ста тысяч'],
  [120000, 'до 120000 руб до ста двадцати тысяч'],
  [200000, 'до 200000 руб'],
];
function priceZoneSyn(p) {
  if (!p) return '';
  const zones = PRICE_CEILINGS.filter(([t]) => p < t).map(([, txt]) => txt);
  let adj;
  if (p < 20000) adj = 'дешёвый недорогой бюджетный самый доступный эконом';
  else if (p < 50000) adj = 'недорогой бюджетный доступный';
  else if (p < 100000) adj = 'средний бюджет';
  else adj = 'премиум дорогой';
  return `В бюджете: ${[...zones, adj].join(' ')}.`;
}

// ───── Синонимы по типу мебели (из первого слова <name>) ─────────────────────
const TYPE_SYN = {
  'шкаф':      'шкаф готовый шкаф корпусный шкаф',
  'шкаф-купе': 'шкаф-купе купе',
  'стенка':    'стенка горка модульная стенка гостиная мебель для гостиной',
  'тумба':     'тумба тумбочка',
  'комод':     'комод',
  'гардероб':  'гардероб гардеробная',
  'гардеробная':'гардеробная гардероб',
  'прихожая':  'прихожая мебель в прихожую',
  'кухня':     'кухня кухонный гарнитур',
  'кровать':   'кровать',
  'стеллаж':   'стеллаж',
};
function typeSyn(name) {
  const n = String(name || '').toLowerCase().trim();
  const first = n.split(/[\s-]/)[0];
  return TYPE_SYN[first] || '';
}

function appendUnique(description, addition) {
  if (!addition) return description;
  const desc = String(description ?? '').trim();
  if (desc.toLowerCase().includes(addition.slice(0, 30).toLowerCase())) return desc;
  return desc ? `${desc} ${addition}` : addition;
}

function enrichDescription(offer) {
  let desc = String(offer['description'] ?? '').trim();

  // Дедуп: Bitrix-выгрузка иногда дублирует первый блок дважды подряд.
  const firstSentence = desc.split(/[.!?\n]/)[0];
  if (firstSentence && firstSentence.length > 20) {
    const second = desc.indexOf(firstSentence, firstSentence.length);
    if (second > 0) desc = desc.slice(0, second).trim().replace(/[.,;]\s*$/, '');
  }

  // Все позиции фида — готовая мебель в наличии.
  desc = appendUnique(desc, 'Готовая мебель в наличии, можно купить готовый вариант.');
  desc = appendUnique(desc, typeSyn(offer['name']));
  const price = parseInt(String(offer['price'] ?? '0').replace(/[^\d]/g, ''), 10);
  desc = appendUnique(desc, priceZoneSyn(price));
  return desc;
}

// ───── Основной поток ────────────────────────────────────────────────────────
const res = await fetch(SOURCE_FEED_URL);
if (!res.ok) throw new Error(`Source feed fetch failed: ${res.status}`);
const xml = await res.text();

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: false, parseTagValue: false, trimValues: true, isArray: (name) => name === 'offer' || name === 'category' });
const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true, suppressBooleanAttributes: false });

const feed = parser.parse(xml);
const offers = feed?.yml_catalog?.shop?.offers?.offer ?? [];

let touched = 0;
for (const offer of offers) {
  const before = offer['description'];
  const after = enrichDescription(offer);
  if (after !== before) { offer['description'] = after; touched++; }
}

mkdirSync('public', { recursive: true });
writeFileSync(OUT_PATH, builder.build(feed), 'utf-8');
console.log(`Done. Offers: ${offers.length}, enriched: ${touched}. Written to ${OUT_PATH}`);
