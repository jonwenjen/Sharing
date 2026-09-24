// 幣別、金額格式化與分攤計算（前後端共用，純函式、無相依）
export const FUND_ID = '__fund';

export const CURRENCIES = {
  TWD: { name: '新台幣', symbol: 'NT$', decimals: 0 },
  JPY: { name: '日圓', symbol: '¥', decimals: 0 },
  USD: { name: '美元', symbol: 'US$', decimals: 2 },
  EUR: { name: '歐元', symbol: '€', decimals: 2 },
  KRW: { name: '韓圓', symbol: '₩', decimals: 0 },
  HKD: { name: '港幣', symbol: 'HK$', decimals: 2 },
  CNY: { name: '人民幣', symbol: 'CN¥', decimals: 2 },
  THB: { name: '泰銖', symbol: '฿', decimals: 2 },
  SGD: { name: '新加坡幣', symbol: 'S$', decimals: 2 },
  GBP: { name: '英鎊', symbol: '£', decimals: 2 },
  AUD: { name: '澳幣', symbol: 'A$', decimals: 2 },
  CAD: { name: '加幣', symbol: 'C$', decimals: 2 },
  MYR: { name: '馬幣', symbol: 'RM', decimals: 2 },
  VND: { name: '越南盾', symbol: '₫', decimals: 0 },
  PHP: { name: '披索', symbol: '₱', decimals: 2 },
};

export const CATEGORIES = [
  { id: 'brunch', name: '早午餐', icon: '🥐' },
  { id: 'dinner', name: '晚餐', icon: '🍽️' },
  { id: 'food', name: '餐飲', icon: '🍜' },
  { id: 'drink', name: '飲料', icon: '🧋' },
  { id: 'dessert', name: '甜點', icon: '🍰' },
  { id: 'transport', name: '交通', icon: '🚃' },
  { id: 'stay', name: '住宿', icon: '🏨' },
  { id: 'ticket', name: '門票活動', icon: '🎟️' },
  { id: 'shopping', name: '購物', icon: '🛍️' },
  { id: 'fun', name: '娛樂', icon: '🎤' },
  { id: 'daily', name: '日用品', icon: '🧴' },
  { id: 'other', name: '其他', icon: '📦' },
];
// 由項目名稱猜分類（LINE 訊息記帳用；順序＝優先度）
const CAT_WORDS = [
  ['brunch', /早午餐|早餐|brunch|早點|早午/i],
  ['dinner', /晚餐|晚飯|宵夜|dinner|居酒屋|燒肉|火鍋/i],
  ['dessert', /甜點|蛋糕|冰淇淋|霜淇淋|布丁|鬆餅|甜食|dessert/i],
  ['drink', /飲料|咖啡|奶茶|手搖|果汁|啤酒|酒|coffee|tea|星巴克/i],
  ['food', /午餐|餐|飯|麵|拉麵|壽司|便當|小吃|吃/i],
  ['transport', /車|捷運|地鐵|電車|計程|uber|taxi|油|停車|機票|高鐵|新幹線|巴士|公車/i],
  ['stay', /住|飯店|旅館|民宿|hotel|airbnb/i],
  ['ticket', /門票|票|樂園|纜車|雪票|lift|體驗|入場/i],
  ['shopping', /買|購物|藥妝|伴手禮|紀念品|超市|唐吉/i],
  ['fun', /唱歌|ktv|遊戲|娛樂|按摩|溫泉/i],
  ['daily', /日用|衛生紙|牙|洗/i],
];
export const guessCategory = (title) => (CAT_WORDS.find(([, re]) => re.test(title || '')) || ['other'])[0];

export const categoryOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

export const decimalsOf = (cur) => (CURRENCIES[cur] ? CURRENCIES[cur].decimals : 2);
export const toMinor = (amount, cur) => Math.round(Number(amount) * 10 ** decimalsOf(cur));
export const fromMinor = (minor, cur) => minor / 10 ** decimalsOf(cur);

export function formatMoney(amount, cur, { sign = false } = {}) {
  const d = decimalsOf(cur);
  const c = CURRENCIES[cur];
  const abs = Math.abs(amount).toLocaleString('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d });
  const s = amount < 0 ? '-' : sign && amount > 0 ? '+' : '';
  return `${s}${c ? c.symbol : cur + ' '}${abs}`;
}
export const formatMinor = (minor, cur, opt) => formatMoney(fromMinor(minor, cur), cur, opt);

/** 依權重以最大餘數法分配整數（總和必等於 total），同分時依輸入順序 */
export function allocate(total, weights) {
  const entries = Object.entries(weights).filter(([, w]) => Number(w) > 0);
  const sumW = entries.reduce((s, [, w]) => s + Number(w), 0);
  const out = {};
  if (!entries.length || sumW <= 0) return out;
  const sign = total < 0 ? -1 : 1;
  const T = Math.abs(total);
  let used = 0;
  const rema = entries.map(([id, w], i) => {
    const exact = (T * Number(w)) / sumW;
    const floor = Math.floor(exact + 1e-9);
    used += floor;
    out[id] = floor;
    return { id, r: exact - floor, i };
  });
  rema.sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; k < T - used; k++) out[rema[k % rema.length].id] += 1;
  if (sign < 0) for (const id in out) out[id] = -out[id];
  return out;
}

/** 單筆紀錄換算為基準幣別的最小單位總額 */
export const recordBaseMinor = (rec, base) =>
  toMinor(Number(rec.amount) * (rec.currency === base ? 1 : Number(rec.rate || 0)), base);

/** 回傳 { total, shares: {memberId: minor} }（基準幣別最小單位） */
const isBlank = (v) => v === '' || v === null || v === undefined;

/**
 * 自訂金額模式的分配：有填金額的人照填的算；勾選但沒填的人，平分剩下的金額。
 * 回傳 { weights, fixedSum, remainder, blanks, error }
 */
/**
 * 自訂金額分攤。fill 決定「填的金額不足總額」時差額怎麼分：
 *   'all'   ＝ 由所有勾選的人平均分攤差額（新紀錄預設）
 *   'blank' ＝ 只由勾選但沒填金額的人平分（舊紀錄沒有 fill 時沿用這個）
 */
export function amountSplit(parts, amount, currency, fill = 'blank') {
  const fixed = Object.entries(parts || {}).filter(([, v]) => !isBlank(v) && v !== true);
  const blanks = Object.entries(parts || {}).filter(([, v]) => isBlank(v) || v === true).map(([id]) => id);
  const fixedSum = fixed.reduce((a, [, v]) => a + (Number(v) || 0), 0);
  const total = Number(amount) || 0;
  const diff = toMinor(total, currency) - toMinor(fixedSum, currency);
  const remainder = fromMinor(diff, currency);
  let error = null;
  if (fixed.some(([, v]) => !(Number(v) >= 0))) error = '自訂金額要是數字';
  else if (diff < 0) error = `自訂金額超出總金額 ${formatMoney(-remainder, currency)}`;
  else if (diff > 0 && fill !== 'all' && !blanks.length) error = `還差 ${formatMoney(remainder, currency)}，請補上金額或留空讓其他人平分`;
  const weights = {};
  for (const [id, v] of fixed) weights[id] = Number(v) || 0;
  for (const id of blanks) weights[id] = 0;
  const targets = fill === 'all' ? Object.keys(weights) : blanks;
  if (targets.length && diff > 0) for (const id of targets) weights[id] += remainder / targets.length;
  return { weights, fixedSum, remainder, blanks, targets, fill, error };
}

/** 回傳 { total, shares: {memberId: minor} }（基準幣別最小單位） */
export function recordShares(rec, base) {
  const total = recordBaseMinor(rec, base);
  const parts = (rec.split && rec.split.parts) || {};
  const mode = (rec.split && rec.split.mode) || 'equal';
  let weights = {};
  if (mode === 'amount') weights = amountSplit(parts, rec.amount, rec.currency, rec.split.fill).weights;
  else for (const [id, v] of Object.entries(parts)) weights[id] = mode === 'equal' ? (v ? 1 : 0) : Number(v) || 0;
  return { total, shares: allocate(total, weights) };
}

/** 驗證紀錄，回傳錯誤訊息陣列 */
export function validateRecord(rec) {
  const errs = [];
  if (!['expense', 'transfer', 'fund_in'].includes(rec.type)) errs.push('類型不正確');
  if (!(Number(rec.amount) > 0)) errs.push('請輸入大於 0 的金額');
  if (!CURRENCIES[rec.currency]) errs.push('不支援的幣別');
  if (!rec.payerId) errs.push('請選擇付款人');
  const parts = (rec.split && rec.split.parts) || {};
  const isAmount = rec.split && rec.split.mode === 'amount';
  const ids = isAmount
    ? Object.entries(amountSplit(parts, rec.amount, rec.currency, rec.split.fill).weights).filter(([, w]) => w > 0).map(([k]) => k)
    : Object.keys(parts).filter((k) => Number(parts[k]) > 0 || parts[k] === true);
  if (!ids.length) errs.push('至少選一位分攤成員');
  if (isAmount && CURRENCIES[rec.currency]) {
    const r = amountSplit(parts, rec.amount, rec.currency, rec.split.fill);
    if (r.error) errs.push(r.error);
  }
  if (rec.type === 'transfer' && ids.includes(rec.payerId)) errs.push('轉帳對象不能是自己');
  return errs;
}

/**
 * 依帳本設定切成「結算群組」。
 * 合併結算（預設）→ 一組，全部換算成帳本幣別；
 * 分開結算 → 每個幣別各一組，不換匯、各自結算。
 */
export function currencyGroups(records, ledger) {
  const base = ledger.baseCurrency;
  if (ledger.mergeCurrencies == null || ledger.mergeCurrencies) return [{ currency: base, records, merged: true }];
  const map = {};
  for (const r of records) (map[r.currency] = map[r.currency] || []).push(r);
  if (!map[base]) map[base] = [];
  return Object.entries(map)
    .map(([currency, rs]) => ({ currency, records: rs, merged: false, total: stats(rs, currency).total }))
    .sort((a, b) => b.total - a.total || (a.currency === base ? -1 : 1));
}

/** 計算每位成員（含公費）淨額：正數＝應收，負數＝應付 */
export function computeBalances(records, base) {
  const net = {};
  const add = (id, v) => (net[id] = (net[id] || 0) + v);
  for (const r of records) {
    if (r.deleted) continue;
    const { total, shares } = recordShares(r, base);
    add(r.payerId, total);
    for (const [id, s] of Object.entries(shares)) add(id, -s);
  }
  return net;
}

/** 公費併入保管人後的結算用淨額 */
export function settlementBalances(records, base, custodianId) {
  const net = computeBalances(records, base);
  const fund = net[FUND_ID] || 0;
  delete net[FUND_ID];
  if (fund && custodianId) net[custodianId] = (net[custodianId] || 0) + fund;
  return { net, fundUnassigned: fund && !custodianId ? fund : 0 };
}

/** 公費現金餘額（存入 − 公費支出） */
export const fundCash = (records, base) => -(computeBalances(records, base)[FUND_ID] || 0);

/** 統計：分類支出、個人已付/應分攤/公費存入 */
export function stats(records, base) {
  const byCategory = {};
  const people = {};
  const p = (id) => (people[id] = people[id] || { paid: 0, share: 0, fundIn: 0 });
  let total = 0;
  for (const r of records) {
    if (r.deleted) continue;
    const { total: t, shares } = recordShares(r, base);
    if (r.type === 'expense') {
      total += t;
      byCategory[r.category || 'other'] = (byCategory[r.category || 'other'] || 0) + t;
      p(r.payerId).paid += t;
      for (const [id, s] of Object.entries(shares)) p(id).share += s;
    } else if (r.type === 'fund_in') p(r.payerId).fundIn += t;
  }
  return { total, byCategory, people };
}

/**
 * 合併成員：把紀錄裡的 from 換成 to，金額分配維持不變。
 * 回傳 { rec, changed, drop }；drop=true 表示這筆變成「自己轉給自己」，應刪除。
 */
export function mergeMemberInRecord(rec, from, to) {
  const parts = { ...((rec.split && rec.split.parts) || {}) };
  const inPayer = rec.payerId === from;
  const inParts = Object.prototype.hasOwnProperty.call(parts, from);
  if (!inPayer && !inParts) return { rec, changed: false, drop: false };
  const out = { ...rec, split: { ...rec.split } };
  if (inPayer) out.payerId = to;
  if (inParts) {
    const mode = out.split.mode || 'equal';
    const a = parts[from];
    delete parts[from];
    if (Object.prototype.hasOwnProperty.call(parts, to)) {
      const b = parts[to];
      if (mode === 'equal') {
        // 兩人都有參與平分 → 改成份數，讓其他人的金額不變
        const on = (v) => v === true || Number(v) > 0;
        const np = {};
        for (const [k, v] of Object.entries(parts)) if (on(v)) np[k] = 1;
        np[to] = (on(a) ? 1 : 0) + (on(b) ? 1 : 0);
        out.split = { ...out.split, mode: 'shares', parts: np };
      } else if (mode === 'amount') {
        const blankA = a === '' || a == null, blankB = b === '' || b == null;
        parts[to] = blankA && blankB ? '' : (Number(blankA ? 0 : a) || 0) + (Number(blankB ? 0 : b) || 0);
        out.split.parts = parts;
      } else {
        parts[to] = (Number(a) || 0) + (Number(b) || 0);
        out.split.parts = parts;
      }
    } else {
      parts[to] = a;
      out.split.parts = parts;
    }
  }
  const ids = Object.keys(out.split.parts || {});
  const drop = out.type === 'transfer' && ids.length === 1 && ids[0] === out.payerId;
  return { rec: out, changed: true, drop };
}

/** 安全計算金額算式（只允許數字與 + - * / 括號），失敗回傳 null */
export function evalAmount(text) {
  const t = String(text || '').replace(/[，,\s]/g, '').replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/＋/g, '+').replace(/－/g, '-');
  if (!t) return null;
  if (!/^[0-9.+\-*/()]+$/.test(t)) return null;
  let i = 0;
  const num = () => { const m = /^\d+(\.\d+)?|^\.\d+/.exec(t.slice(i)); if (!m) throw 0; i += m[0].length; return parseFloat(m[0]); };
  const factor = () => {
    if (t[i] === '-') { i++; return -factor(); }
    if (t[i] === '(') { i++; const v = expr(); if (t[i] !== ')') throw 0; i++; return v; }
    return num();
  };
  const term = () => { let v = factor(); while (t[i] === '*' || t[i] === '/') { const op = t[i++]; const r = factor(); v = op === '*' ? v * r : v / r; } return v; };
  const expr = () => { let v = term(); while (t[i] === '+' || t[i] === '-') { const op = t[i++]; const r = term(); v = op === '+' ? v + r : v - r; } return v; };
  try { const v = expr(); if (i !== t.length || !Number.isFinite(v)) return null; return Math.round(v * 100) / 100; } catch { return null; }
}
