// 資料層：遠端（Cloudflare Worker）或示範模式（localStorage），兩者介面相同
import { CONFIG } from './config.js';
import { line } from './line.js';
import { settlementBalances, mergeMemberInRecord } from './money.js';
import { runLadder } from './ladder.js';

const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 16);
const now = () => Date.now();

// ---------- 遠端 ----------
// 只取網域部分，避免 API_BASE 誤填成 …/webhook 或 …/health
const apiOrigin = () => { try { return new URL(CONFIG.API_BASE.trim()).origin; } catch { throw new Error('config.js 的 API_BASE 不是有效網址'); } };
async function call(method, path, body) {
  const res = await fetch(apiOrigin() + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${line.idToken}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.code ? data.error : `${data.error || '連線失敗'}（${res.status}，${method} ${path}）`);
    err.code = data.code; err.status = res.status;
    throw err;
  }
  return data;
}
const remote = {
  listLedgers: () => call('GET', '/api/me/ledgers'),
  groupLedgers: (gid) => call('GET', `/api/groups/${encodeURIComponent(gid)}/ledgers`),
  me: () => call('GET', '/api/me'),
  updateMe: (p) => call('PATCH', '/api/me', p),
  getLedger: (id, join) => call('GET', `/api/ledgers/${id}${join ? `?join=${encodeURIComponent(join)}` : ''}`),
  resetInvite: (id) => call('POST', `/api/ledgers/${id}/invite/reset`),
  createLedger: (d) => call('POST', '/api/ledgers', d),
  updateLedger: (id, p) => call('PATCH', `/api/ledgers/${id}`, p),
  deleteLedger: (id) => call('DELETE', `/api/ledgers/${id}`),
  addMember: (lid, d) => call('POST', `/api/ledgers/${lid}/members`, d),
  updateMember: (mid, p) => call('PATCH', `/api/members/${mid}`, p),
  claimMember: (mid) => call('POST', `/api/members/${mid}/claim`),
  mergeMember: (mid, into) => call('POST', `/api/members/${mid}/merge`, { into }),
  removeMember: (mid) => call('DELETE', `/api/members/${mid}`),
  addRecord: (lid, r) => call('POST', `/api/ledgers/${lid}/records`, r),
  updateRecord: (rid, p) => call('PATCH', `/api/records/${rid}`, p),
  deleteRecord: (rid) => call('DELETE', `/api/records/${rid}`),
  restoreRecord: (rid) => call('POST', `/api/records/${rid}/restore`),
  ladder: (lid, p) => call('POST', `/api/ledgers/${lid}/ladder`, p),
  shareLadder: (id) => call('POST', `/api/ladders/${id}/share`),
  rates: (base, date) => call('GET', `/api/rates?base=${base}${date ? `&date=${date}` : ''}`),
  notifyGroup: (lid, payload) => call('POST', `/api/ledgers/${lid}/notify`, payload),
};

// ---------- 示範模式 ----------
const KEY = 'sharing-demo-v1';
const DEMO_RATES = { TWD: 1, JPY: 0.213, USD: 32.1, EUR: 35.2, KRW: 0.0232, HKD: 4.11, CNY: 4.46, THB: 0.96, SGD: 24.6, GBP: 41.8, AUD: 21.3, CAD: 23.6, MYR: 7.35, VND: 0.00126, PHP: 0.57 };

function seed() {
  const L = 'demoledger000001';
  const m = ['小安', '阿哲', '米米', 'Kai'].map((name, i) => ({
    id: 'm' + i, ledgerId: L, name, lineUserId: i === 1 ? 'demo-other' : null, avatar: '', active: 1,
    payInfo: i === 1 ? { bank: '國泰世華', bankCode: '013', account: '0123-4567-8901', linePay: '', jko: '', note: '' } : {},
  }));
  const parts = (ids) => Object.fromEntries(ids.map((i) => ['m' + i, true]));
  const r = (o) => ({ id: uid(), ledgerId: L, currency: 'TWD', rate: 1, note: '', category: 'other', createdBy: 'demo', createdAt: now(), updatedAt: now(), ...o });
  const records = [
    r({ type: 'fund_in', title: '公費存入', amount: 10000, currency: 'JPY', rate: 0.213, payerId: 'm0', split: { mode: 'equal', parts: { __fund: true } }, date: '2026-12-01' }),
    r({ type: 'fund_in', title: '公費存入', amount: 10000, currency: 'JPY', rate: 0.213, payerId: 'm1', split: { mode: 'equal', parts: { __fund: true } }, date: '2026-12-01' }),
    r({ type: 'expense', title: '成田特快', category: 'transport', amount: 13120, currency: 'JPY', rate: 0.213, payerId: '__fund', split: { mode: 'equal', parts: parts([0, 1, 2, 3]) }, date: '2026-12-01' }),
    r({ type: 'expense', title: '新宿住宿 4 晚', category: 'stay', amount: 28800, payerId: 'm1', split: { mode: 'equal', parts: parts([0, 1, 2, 3]) }, date: '2026-12-01' }),
    r({ type: 'expense', title: '一蘭拉麵', category: 'food', amount: 5960, currency: 'JPY', rate: 0.213, payerId: 'm2', split: { mode: 'equal', parts: parts([0, 1, 2, 3]) }, date: '2026-12-02' }),
    r({ type: 'expense', title: 'teamLab 門票', category: 'ticket', amount: 15200, currency: 'JPY', rate: 0.213, payerId: 'm0', split: { mode: 'shares', parts: { m0: 1, m1: 1, m2: 2 } }, date: '2026-12-02', note: '米米幫朋友多買一張' }),
    r({ type: 'expense', title: '唐吉訶德', category: 'shopping', amount: 8600, currency: 'JPY', rate: 0.213, payerId: 'm3', split: { mode: 'amount', parts: { m3: 5000, m2: 3600 } }, date: '2026-12-03' }),
  ];
  return {
    ledgers: [{ id: L, name: '東京五日遊', baseCurrency: 'TWD', groupId: null, createdBy: 'demo', fundEnabled: 1, fundCustodian: 'm0', shareDefault: 1, mergeCurrencies: 1, archived: 0, fixedRates: {}, inviteCode: 'demoinvite0001', creatorName: '小安', groupName: '東京旅遊團', createdAt: now(), updatedAt: now() }],
    members: m, records,
  };
}
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { return seed(); } };
const save = (db) => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* 無痕模式 */ } };
const wait = (v) => new Promise((r) => setTimeout(() => r(structuredClone(v)), 60));
function mutate(fn) { const db = load(); const out = fn(db); save(db); return wait(out); }
const me = () => line.profile.userId;

const demo = {
  listLedgers: () => mutate((db) => db.ledgers.filter((l) => !l.deleted).map((l) => ({
    ...l,
    memberCount: db.members.filter((x) => x.ledgerId === l.id && x.active).length,
    myMemberId: (db.members.find((x) => x.ledgerId === l.id && x.lineUserId === me()) || {}).id || null,
    isCreator: l.createdBy === me(),
    myNet: (() => {
      const mid = (db.members.find((x) => x.ledgerId === l.id && x.lineUserId === me()) || {}).id;
      if (!mid) return null;
      return settlementBalances(db.records.filter((r) => r.ledgerId === l.id && !r.deleted), l.baseCurrency, l.fundEnabled ? l.fundCustodian : null).net[mid] || 0;
    })(),
  }))),
  groupLedgers: () => wait([]),
  me: () => mutate((db) => ({ userId: me(), name: line.profile.displayName, isAdmin: false, payInfo: (db.profiles || {})[me()] || {} })),
  updateMe: (p) => mutate((db) => {
    db.profiles = db.profiles || {};
    db.profiles[me()] = p.payInfo;
    db.members.forEach((x) => { if (x.lineUserId === me()) x.payInfo = { ...p.payInfo }; });
    return { userId: me(), name: line.profile.displayName, isAdmin: false, payInfo: p.payInfo };
  }),
  resetInvite: (id) => mutate((db) => Object.assign(db.ledgers.find((l) => l.id === id), { inviteCode: uid() })),
  getLedger: (id) => mutate((db) => {
    const ledger = db.ledgers.find((l) => l.id === id && !l.deleted);
    if (!ledger) throw new Error('找不到這本帳本');
    return { ledger, members: db.members.filter((x) => x.ledgerId === id), records: db.records.filter((r) => r.ledgerId === id && !r.deleted), viewer: { isAdmin: false, isCreator: ledger.createdBy === me() } };
  }),
  createLedger: (d) => mutate((db) => {
    const l = { id: uid(), name: d.name, baseCurrency: d.baseCurrency || 'TWD', groupId: d.groupId || null, createdBy: me(), fundEnabled: 0, fundCustodian: null, shareDefault: 1, mergeCurrencies: 1, archived: 0, fixedRates: {}, inviteCode: uid(), creatorName: line.profile.displayName, groupName: null, createdAt: now(), updatedAt: now() };
    db.ledgers.unshift(l);
    (d.members || []).forEach((name, i) => db.members.push({ id: uid(), ledgerId: l.id, name, lineUserId: i === 0 && d.claimFirst ? me() : null, avatar: i === 0 && d.claimFirst ? line.profile.pictureUrl : '', payInfo: {}, active: 1 }));
    return l;
  }),
  updateLedger: (id, p) => mutate((db) => Object.assign(db.ledgers.find((l) => l.id === id), p, { updatedAt: now() })),
  deleteLedger: (id) => mutate((db) => { db.ledgers.find((l) => l.id === id).deleted = 1; return { ok: true }; }),
  addMember: (lid, d) => mutate((db) => { const m = { id: uid(), ledgerId: lid, name: d.name, lineUserId: d.claim ? me() : null, avatar: d.claim ? line.profile.pictureUrl : '', payInfo: {}, active: 1 }; db.members.push(m); return m; }),
  updateMember: (mid, p) => mutate((db) => {
    const m = db.members.find((x) => x.id === mid);
    if (p.payInfo && m.lineUserId && m.lineUserId !== me()) throw new Error('只能修改自己的匯款資訊');
    const { syncAll, ...rest } = p;
    if (p.payInfo && m.lineUserId === me() && syncAll !== false) {
      db.profiles = db.profiles || {};
      db.profiles[me()] = p.payInfo;
      db.members.forEach((x) => { if (x.lineUserId === me()) x.payInfo = { ...p.payInfo }; });
    }
    return Object.assign(m, rest);
  }),
  claimMember: (mid) => mutate((db) => {
    const m = db.members.find((x) => x.id === mid);
    if (m.lineUserId && m.lineUserId !== me()) throw new Error('這位成員已被其他人認領');
    db.members.forEach((x) => { if (x.ledgerId === m.ledgerId && x.lineUserId === me()) { x.lineUserId = null; x.avatar = ''; } });
    m.lineUserId = me(); m.avatar = line.profile.pictureUrl || '';
    const saved = (db.profiles || {})[me()];
    if (saved && !Object.values(m.payInfo || {}).some(Boolean)) m.payInfo = { ...saved };
    return m;
  }),
  mergeMember: (mid, into) => mutate((db) => {
    const src = db.members.find((x) => x.id === mid);
    const dst = db.members.find((x) => x.id === into);
    if (!src || !dst || src.ledgerId !== dst.ledgerId || src.id === dst.id) throw new Error('請選擇同一本帳本裡的另一位成員');
    if (src.lineUserId && dst.lineUserId && src.lineUserId !== dst.lineUserId) throw new Error('這兩位成員綁定了不同的 LINE 帳號，不能合併');
    let moved = 0, dropped = 0;
    db.records.forEach((r, i) => {
      if (r.ledgerId !== src.ledgerId) return;
      const res = mergeMemberInRecord(r, mid, into);
      if (!res.changed) return;
      moved++;
      if (res.drop && !r.deleted) { dropped++; db.records[i] = { ...res.rec, deleted: 1 }; } else db.records[i] = res.rec;
    });
    if (!dst.lineUserId && src.lineUserId) { dst.lineUserId = src.lineUserId; dst.avatar = src.avatar; }
    if (!Object.values(dst.payInfo || {}).some(Boolean) && Object.values(src.payInfo || {}).some(Boolean)) dst.payInfo = { ...src.payInfo };
    db.ledgers.forEach((l) => { if (l.fundCustodian === mid) l.fundCustodian = into; });
    db.members = db.members.filter((x) => x.id !== mid);
    return { merged: true, moved, dropped, into: dst };
  }),
  removeMember: (mid) => mutate((db) => {
    const used = db.records.some((r) => !r.deleted && (r.payerId === mid || (r.split && r.split.parts && mid in r.split.parts)));
    if (used) { db.members.find((x) => x.id === mid).active = 0; return { archived: true }; }
    db.members = db.members.filter((x) => x.id !== mid);
    return { removed: true };
  }),
  addRecord: (lid, r) => mutate((db) => { const x = { ...r, id: uid(), ledgerId: lid, createdBy: me(), createdAt: now(), updatedAt: now() }; db.records.push(x); return x; }),
  updateRecord: (rid, p) => mutate((db) => Object.assign(db.records.find((r) => r.id === rid), p, { updatedAt: now() })),
  deleteRecord: (rid) => mutate((db) => { db.records.find((r) => r.id === rid).deleted = 1; return { ok: true }; }),
  ladder: (lid, p) => wait({ id: uid(), ...runLadder(p) }),
  shareLadder: () => wait({ ok: false }),
  restoreRecord: (rid) => mutate((db) => { const r = db.records.find((x) => x.id === rid); r.deleted = 0; return r; }),
  // 示範模式用固定匯率，並依日期做一點小波動，方便看出「當日匯率」效果
  rates: (base, date) => { const j = date ? 1 + ((Number(date.slice(-2)) % 7) - 3) / 300 : 1; return wait({ date: date || new Date().toISOString().slice(0, 10), rates: Object.fromEntries(Object.entries(DEMO_RATES).map(([k, v]) => [k, k === base ? 1 : (v * j) / DEMO_RATES[base]])) }); },
  notifyGroup: () => wait({ ok: false }),
  reset: () => { localStorage.removeItem(KEY); return wait(true); },
};

export const store = new Proxy({}, { get: (_, k) => (line.demo ? demo : remote)[k] });
