// Sharing API — Cloudflare Worker + D1
// 路由：/api/*（前端 LIFF 呼叫，需 LINE ID Token）與 /webhook（LINE Messaging API）
import { settlementBalances, CURRENCIES, validateRecord, formatMinor, guessCategory, categoryOf } from '../../web/js/money.js';
import { parseQuickEntry, QUICK_HELP } from '../../web/js/parse.js';
import { recordFlex } from '../../web/js/messages.js';
import { minTransfers } from '../../web/js/settle.js';

const id16 = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const now = () => Date.now();

// ---------- HTTP 工具 ----------
class HttpError extends Error { constructor(status, msg, code) { super(msg); this.status = status; this.code = code; } }
function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
  const allow = allowed.includes('*') ? '*' : allowed.includes(origin) ? origin : allowed[0];
  return { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
}
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

// ---------- 身分驗證（LIFF ID Token）----------
const tokenCache = new Map();
export async function authenticate(req, env) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token || token === 'null') throw new HttpError(401, '請先登入 LINE');
  if (env.DEV_MODE === '1' && token.startsWith('dev:')) {
    const [, sub, name] = token.split(':');
    return { sub, name: name || sub, picture: '' };
  }
  const hit = tokenCache.get(token);
  if (hit && hit.exp * 1000 > now()) return hit;
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: token, client_id: env.LINE_LOGIN_CHANNEL_ID }),
  });
  if (!res.ok) throw new HttpError(401, 'LINE 登入已過期，請重新開啟');
  const p = await res.json();
  const user = { sub: p.sub, name: p.name || '', picture: p.picture || '', exp: p.exp };
  if (tokenCache.size > 500) tokenCache.clear();
  tokenCache.set(token, user);
  return user;
}

// ---------- 資料列轉換 ----------
const ledgerOut = (r) => r && ({ id: r.id, name: r.name, baseCurrency: r.base_currency, groupId: r.group_id, createdBy: r.created_by, fundEnabled: r.fund_enabled, fundCustodian: r.fund_custodian, shareDefault: r.share_default, archived: r.archived, fixedRates: JSON.parse(r.fixed_rates || '{}'), inviteCode: r.invite_code || null, groupName: r.group_name || null, creatorName: r.creator_name || null, createdAt: r.created_at, updatedAt: r.updated_at });
const memberOut = (r) => r && ({ id: r.id, ledgerId: r.ledger_id, name: r.name, lineUserId: r.line_user_id, avatar: r.avatar || '', payInfo: JSON.parse(r.pay_info || '{}'), active: r.active });
const recordOut = (r) => r && ({ id: r.id, ledgerId: r.ledger_id, type: r.type, title: r.title, category: r.category, amount: r.amount, currency: r.currency, rate: r.rate, payerId: r.payer_id, split: JSON.parse(r.split), date: r.date, note: r.note || '', createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at });

async function getLedgerRow(env, id) {
  const l = await env.DB.prepare('SELECT * FROM ledgers WHERE id = ? AND deleted = 0').bind(id).first();
  if (!l) throw new HttpError(404, '找不到這本帳本');
  return l;
}
async function loadLedger(env, id) {
  const l = await getLedgerRow(env, id);
  const [m, r] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM members WHERE ledger_id = ? ORDER BY created_at').bind(id),
    env.DB.prepare('SELECT * FROM records WHERE ledger_id = ? AND deleted = 0 ORDER BY date, created_at').bind(id),
  ]);
  return { ledger: ledgerOut(l), members: m.results.map(memberOut), records: r.results.map(recordOut) };
}
function assertWritable(l) { if (l.archived) throw new HttpError(409, '帳本已封存，請先取消封存'); }

async function cleanRecord(env, ledgerId, body) {
  const r = {
    type: body.type, title: String(body.title || '').slice(0, 40), category: String(body.category || 'other').slice(0, 20),
    amount: Number(body.amount), currency: String(body.currency || ''), rate: Number(body.rate || 1),
    payerId: String(body.payerId || ''), split: body.split || {}, date: String(body.date || '').slice(0, 10), note: String(body.note || '').slice(0, 120),
  };
  const l = await getLedgerRow(env, ledgerId);
  if (r.currency === l.base_currency) r.rate = 1;
  const errs = validateRecord(r);
  if (!(r.rate > 0)) errs.push('匯率需大於 0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) errs.push('日期格式不正確');
  if (!['equal', 'amount', 'shares'].includes(r.split.mode)) errs.push('分攤方式不正確');
  const { results } = await env.DB.prepare('SELECT id FROM members WHERE ledger_id = ?').bind(ledgerId).all();
  const valid = new Set(results.map((x) => x.id).concat('__fund'));
  const ids = [r.payerId, ...Object.keys(r.split.parts || {})];
  if (ids.some((x) => !valid.has(x))) errs.push('包含不屬於這本帳本的成員');
  if (errs.length) throw new HttpError(400, errs[0]);
  return { r, l };
}

// ---------- 匯率 ----------
export const todayTW = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const RATE_SOURCES = (b, d) => [
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${d}/v1/currencies/${b}.json`,
  `https://${d}.currency-api.pages.dev/v1/currencies/${b}.json`,
];
async function fetchRateTable(base, date) {
  const b = base.toLowerCase();
  for (const url of RATE_SOURCES(b, date)) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (!data[b]) continue;
      const out = {};
      for (const c of Object.keys(CURRENCIES)) { const v = data[b][c.toLowerCase()]; if (v) out[c] = 1 / v; }
      return { date: data.date || date, rates: out };
    } catch { /* 換下一個來源 */ }
  }
  if (date === 'latest') {
    const res = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    if (res.ok) {
      const data = await res.json();
      const out = {};
      for (const c of Object.keys(CURRENCIES)) if (data.rates && data.rates[c]) out[c] = 1 / data.rates[c];
      return { date: todayTW(), rates: out };
    }
  }
  return null;
}
/** 回傳 { date, rates: {幣別: 1 單位等於多少基準幣} }；指定日期取不到時退回最新匯率 */
export async function rates(env, base, date) {
  if (!CURRENCIES[base]) throw new HttpError(400, '不支援的幣別');
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date || '') && date < todayTW() ? date : 'latest';
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`https://rates.cache/${base}/${d}`);
  const hit = cache && (await cache.match(key));
  if (hit) return hit.json();
  let out = await fetchRateTable(base, d);
  if (!out && d !== 'latest') out = await fetchRateTable(base, 'latest');
  if (!out) throw new HttpError(502, '暫時取不到匯率，請手動輸入');
  if (cache) await cache.put(key, json(out, 200, { 'Cache-Control': `public, max-age=${d === 'latest' ? 21600 : 2592000}` }));
  return out;
}

// ---------- LINE Messaging ----------
async function verifySignature(env, body, sig) {
  if (!sig || !env.LINE_CHANNEL_SECRET) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.LINE_CHANNEL_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (b64.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < b64.length; i++) diff |= b64.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
async function lineApi(env, path, payload) {
  const res = await fetch(`https://api.line.me/v2/bot/message/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` }, body: JSON.stringify(payload),
  });
  if (!res.ok) console.error('[LINE API 失敗]', path, res.status, await res.text());
  return res.ok;
}
const LIFF_RE = /^\d{6,}-[A-Za-z0-9]+$/;
const liffOk = (env) => LIFF_RE.test(env.LIFF_ID || '');
const liffUrl = (env, q) => `https://liff.line.me/${env.LIFF_ID}${q}`;
const openButtonMsg = (text, label, uri) => ({
  type: 'template', altText: text,
  template: { type: 'buttons', text: text.slice(0, 160), actions: [{ type: 'uri', label, uri }] },
});
/** 回覆帶按鈕的訊息；LIFF_ID 沒設好或按鈕被 LINE 拒絕時，改回純文字，至少讓使用者看得到回應 */
async function replyOpen(env, replyToken, text, label, q) {
  if (liffOk(env) && (await lineApi(env, 'reply', { replyToken, messages: [openButtonMsg(text, label, liffUrl(env, q))] }))) return;
  const fallback = liffOk(env) ? `${text}\n${liffUrl(env, q)}` : `${text}\n（管理員注意：Worker 的 LIFF_ID 尚未正確設定，請到 wrangler.toml 填入後重新部署）`;
  await lineApi(env, 'reply', { replyToken, messages: [{ type: 'text', text: fallback }] });
}

export async function handleWebhook(req, env) {
  const body = await req.text();
  if (!(await verifySignature(env, body, req.headers.get('x-line-signature')))) {
    console.error('[Webhook] 簽章驗證失敗：LINE_CHANNEL_SECRET 應該是「Messaging API channel」的 Channel secret，不是 LINE Login 的');
    return new Response('bad signature', { status: 401 });
  }
  const { events = [] } = JSON.parse(body);
  console.log('[Webhook] 收到事件', events.map((e) => `${e.type}/${(e.source || {}).type}`).join(', ') || '（驗證請求）');
  for (const ev of events) {
    try {
      const src = ev.source || {};
      const gid = src.groupId || src.roomId || null;
      const q = gid ? `?g=${encodeURIComponent(gid)}` : '';
      if (ev.type === 'join' && gid) {
        const n = await groupName(env, gid);
        if (n) await env.DB.prepare('UPDATE ledgers SET group_name = ? WHERE group_id = ?').bind(n, gid).run();
      }
      if (ev.type === 'join') {
        await replyOpen(env, ev.replyToken, '大家好！我是 Sharing 記帳小幫手。點下面按鈕建立帳本，之後輸入「記帳」或「結算」都可以叫我。', '開始記帳', q);
      } else if (ev.type === 'message' && ev.message.type === 'text') {
        const t = ev.message.text.trim();
        if (/^(記帳|帳本|分帳|sharing)$/i.test(t)) {
          await replyOpen(env, ev.replyToken, '點下面按鈕開啟這個群組的帳本。', '開啟帳本', q);
        } else if (/^結算$/.test(t)) {
          let text = '請在群組裡輸入「結算」。';
          if (gid) {
            const l = await env.DB.prepare('SELECT id FROM ledgers WHERE group_id = ? AND deleted = 0 AND archived = 0 ORDER BY updated_at DESC LIMIT 1').bind(gid).first();
            text = l ? await settleSummary(env, l.id) : '這個群組還沒有帳本，輸入「記帳」建立一本。';
          }
          await lineApi(env, 'reply', { replyToken: ev.replyToken, messages: [{ type: 'text', text }] });
        } else if (/^(說明|help|\?|？)$/i.test(t)) {
          await lineApi(env, 'reply', { replyToken: ev.replyToken, messages: [{ type: 'text', text: QUICK_HELP }] });
        } else if (/^[+＋]/.test(t)) {
          await quickEntry(env, ev, gid);
        }
      } else if (ev.type === 'postback' && /^undo:/.test(ev.postback.data || '')) {
        await undoEntry(env, ev);
      }
    } catch (e) {
      console.error('[Webhook] 處理事件失敗', ev.type, e && e.stack || e);
    }
  }
  return new Response('ok');
}

/** 設定健檢：不回傳任何密鑰，只回報每一項是否正常 */
export async function health(env, origin) {
  const checks = [];
  const add = (name, ok, hint) => checks.push({ name, ok, ...(ok ? {} : { hint }) });
  add('LINE_CHANNEL_SECRET 已設定', !!env.LINE_CHANNEL_SECRET, '執行 npx wrangler secret put LINE_CHANNEL_SECRET（Messaging API channel 的 Channel secret）');
  add('LINE_CHANNEL_ACCESS_TOKEN 已設定', !!env.LINE_CHANNEL_ACCESS_TOKEN, '執行 npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN');
  add('LIFF_ID 格式正確', liffOk(env), `wrangler.toml 的 LIFF_ID 目前是「${env.LIFF_ID || ''}」，應像 2001234567-AbCdEfGh`);
  add('LINE_LOGIN_CHANNEL_ID 已設定', /^\d+$/.test(env.LINE_LOGIN_CHANNEL_ID || ''), 'wrangler.toml 填入 LINE Login channel 的 Channel ID（純數字）');
  try { await env.DB.prepare('SELECT COUNT(*) AS n FROM ledgers').first(); add('D1 資料表已建立', true); }
  catch (e) { add('D1 資料表已建立', false, '執行 npm run db:init'); }
  let bot = null;
  if (env.LINE_CHANNEL_ACCESS_TOKEN) {
    const auth = { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` };
    const info = await fetch('https://api.line.me/v2/bot/info', { headers: auth });
    add('Access token 有效', info.ok, '重新發行 Messaging API 的 Channel access token (long-lived) 並重設 secret');
    if (info.ok) {
      const b = await info.json();
      bot = { displayName: b.displayName, basicId: b.basicId };
      const wh = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', { headers: auth });
      if (wh.ok) {
        const w = await wh.json();
        const expected = `${origin}/webhook`;
        add('Webhook URL 指向這個 Worker', w.endpoint === expected, `LINE Developers → Messaging API → Webhook URL 應填 ${expected}（目前是 ${w.endpoint || '空白'}）`);
        add('Use webhook 已開啟', !!w.active, 'LINE Developers → Messaging API → 打開 Use webhook');
      }
    }
  }
  return { ok: checks.every((c) => c.ok), bot, checks };
}

const replyText = (env, ev, text) => lineApi(env, 'reply', { replyToken: ev.replyToken, messages: [{ type: 'text', text }] });

/** 群組訊息快速記帳：+金額 [幣別] 項目 [@成員] */
export async function quickEntry(env, ev, gid) {
  const src = ev.source || {};
  if (!gid) return replyText(env, ev, '請在已加入記帳機器人的群組裡使用快速記帳。');
  // 先移除 LINE「提及」的文字（顯示名稱可能含空白），改用 userId 對應成員
  let text = ev.message.text;
  const mentionIds = [];
  const ms = ((ev.message.mention || {}).mentionees || []).slice().sort((a, b) => b.index - a.index);
  for (const mt of ms) {
    if (mt.type === 'all') { text = text.slice(0, mt.index) + text.slice(mt.index + mt.length); continue; }
    if (mt.userId) mentionIds.push(mt.userId);
    text = text.slice(0, mt.index) + text.slice(mt.index + mt.length);
  }
  const p = parseQuickEntry(text);
  if (!p) return;
  if (p.error) return replyText(env, ev, `${p.error}\n\n${QUICK_HELP}`);
  const lrow = await env.DB.prepare('SELECT * FROM ledgers WHERE group_id = ? AND deleted = 0 AND archived = 0 ORDER BY updated_at DESC LIMIT 1').bind(gid).first();
  if (!lrow) return replyOpen(env, ev.replyToken, '這個群組還沒有帳本，先建立一本再用訊息記帳。', '建立帳本', `?g=${encodeURIComponent(gid)}`);
  const { ledger, members } = await loadLedger(env, lrow.id);
  const active = members.filter((m) => m.active);
  const me = active.find((m) => src.userId && m.lineUserId === src.userId);
  if (!me) return replyOpen(env, ev.replyToken, `要用訊息記帳，請先開啟「${ledger.name}」選擇你是哪一位成員。`, '選擇我的身分', `?l=${ledger.id}`);
  const parts = new Set();
  const unknown = [];
  for (const uid of mentionIds) { const m = active.find((x) => x.lineUserId === uid); if (m) parts.add(m.id); else unknown.push('（被提及但尚未綁定的人）'); }
  for (const name of p.mentions) {
    const n = name.toLowerCase();
    const exact = active.filter((x) => x.name.toLowerCase() === n);
    const pre = exact.length ? exact : active.filter((x) => x.name.toLowerCase().startsWith(n));
    if (pre.length === 1) parts.add(pre[0].id); else unknown.push(name);
  }
  if (unknown.length) return replyText(env, ev, `找不到成員：${unknown.join('、')}\n帳本成員：${active.map((m) => m.name).join('、')}`);
  if (p.includeMe) parts.add(me.id);
  if (!parts.size) active.forEach((m) => parts.add(m.id));
  const base = ledger.baseCurrency;
  const currency = p.currency && CURRENCIES[p.currency] ? p.currency : base;
  const date = todayTW();
  let rate = 1;
  if (currency !== base) {
    rate = (ledger.fixedRates || {})[currency] || ((await rates(env, base, date).catch(() => ({ rates: {} }))).rates || {})[currency];
    if (!rate) return replyText(env, ev, `暫時取不到 ${currency} 匯率，請改用網頁記這筆。`);
    rate = Number(Number(rate).toPrecision(6));
  }
  const category = guessCategory(p.title);
  const r = { type: 'expense', title: p.title || categoryOf(category).name, category, amount: p.amount, currency, rate, payerId: me.id, split: { mode: 'equal', parts: Object.fromEntries([...parts].map((id) => [id, true])) }, date, note: 'LINE 訊息記帳' };
  const errs = validateRecord(r);
  if (errs.length) return replyText(env, ev, errs[0]);
  if (ledger.archived) return replyText(env, ev, '帳本已封存，無法新增。');
  const saved = await insertRecord(env, ledger.id, r, src.userId);
  const flex = recordFlex('create', saved, ledger, members, liffUrl(env, `?l=${ledger.id}`));
  flex.contents.footer = { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
    { type: 'button', style: 'secondary', height: 'sm', action: { type: 'uri', label: '修改', uri: liffUrl(env, `?l=${ledger.id}&r=${saved.id}`) } },
    { type: 'button', style: 'secondary', height: 'sm', action: { type: 'postback', label: '取消這筆', data: `undo:${saved.id}`, displayText: '取消這筆' } },
  ] };
  return lineApi(env, 'reply', { replyToken: ev.replyToken, messages: [flex] });
}

export async function undoEntry(env, ev) {
  const rid = ev.postback.data.slice(5);
  const rec = await env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(rid).first();
  if (!rec) return replyText(env, ev, '找不到這筆紀錄。');
  if (rec.deleted) return replyText(env, ev, `「${rec.title}」已經取消了。`);
  if (rec.created_by !== (ev.source || {}).userId) return replyText(env, ev, '只有記這筆帳的人可以取消，其他人請到網頁修改。');
  await env.DB.prepare('UPDATE records SET deleted = 1, updated_at = ? WHERE id = ?').bind(now(), rid).run();
  await touch(env, rec.ledger_id);
  return replyText(env, ev, `已取消「${rec.title}」。`);
}

export async function settleSummary(env, ledgerId) {
  const { ledger, members, records } = await loadLedger(env, ledgerId);
  const { net } = settlementBalances(records, ledger.baseCurrency, ledger.fundEnabled ? ledger.fundCustodian : null);
  const tx = minTransfers(net);
  const name = (id) => (members.find((m) => m.id === id) || {}).name || '？';
  if (!tx.length) return `【${ledger.name}】目前已經結清。`;
  return [`【${ledger.name}】最少 ${tx.length} 筆轉帳即可結清：`, ...tx.map((t) => `・${name(t.from)} → ${name(t.to)}　${formatMinor(t.amount, ledger.baseCurrency)}`)].join('\n');
}

// ---------- 權限控管 ----------
// 可進入帳本的人：建立者、已綁定成員、曾用有效邀請連結加入者、所連結 LINE 群組的成員
const newInviteCode = () => crypto.randomUUID().replace(/-/g, '').slice(0, 20);
const safeEq = (a, b) => { a = String(a || ''); b = String(b || ''); let d = a.length ^ b.length; for (let i = 0; i < Math.min(a.length, b.length); i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0 && a.length > 0; };
const gmCache = new Map();
export async function isGroupMember(env, gid, sub) {
  if (!gid || !sub || !env.LINE_CHANNEL_ACCESS_TOKEN) return false;
  const k = `${gid}|${sub}`;
  const c = gmCache.get(k);
  if (c && c.exp > now()) return c.ok;
  let ok = false;
  try {
    const kind = gid.startsWith('R') ? 'room' : 'group';
    const res = await fetch(`https://api.line.me/v2/bot/${kind}/${encodeURIComponent(gid)}/member/${encodeURIComponent(sub)}`, { headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` } });
    ok = res.ok;
  } catch { ok = false; }
  if (gmCache.size > 2000) gmCache.clear();
  gmCache.set(k, { ok, exp: now() + (ok ? 10 : 1) * 60e3 });
  return ok;
}
const grant = (env, lid, sub, via) => env.DB.prepare('INSERT OR IGNORE INTO ledger_access (ledger_id, user_id, via, created_at) VALUES (?,?,?,?)').bind(lid, sub, via, now()).run();
export const isAdmin = (env, sub) => String(env.ADMIN_USER_IDS || '').split(',').map((x) => x.trim()).filter(Boolean).includes(sub);
async function groupName(env, gid) {
  if (!gid || !env.LINE_CHANNEL_ACCESS_TOKEN) return null;
  try {
    const kind = gid.startsWith('R') ? null : 'group';
    if (!kind) return '多人聊天室';
    const res = await fetch(`https://api.line.me/v2/bot/group/${encodeURIComponent(gid)}/summary`, { headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` } });
    return res.ok ? (await res.json()).groupName || null : null;
  } catch { return null; }
}
/** 補齊列表需要的群組名稱（存回資料庫，只查一次）與建立者名稱 */
async function decorate(env, rows) {
  for (const r of rows) {
    if (r.group_id && !r.group_name) {
      const n = await groupName(env, r.group_id);
      if (n) { r.group_name = n; await env.DB.prepare('UPDATE ledgers SET group_name = ? WHERE id = ?').bind(n, r.id).run(); }
    }
    if (!r.creator_name && r.created_by) {
      const m = await env.DB.prepare('SELECT name FROM members WHERE ledger_id = ? AND line_user_id = ?').bind(r.id, r.created_by).first();
      r.creator_name = m ? m.name : null;
    }
  }
  return rows;
}
// ---------- 個人匯款資訊（跨帳本共用）----------
const PAY_KEYS = ['bank', 'bankCode', 'account', 'linePay', 'jko', 'note'];
const cleanPay = (p) => Object.fromEntries(PAY_KEYS.map((k) => [k, String((p || {})[k] || '').trim().slice(0, 60)]));
const hasPay = (p) => PAY_KEYS.some((k) => (p || {})[k]);
async function getProfilePay(env, sub) {
  const r = await env.DB.prepare('SELECT pay_info FROM user_profiles WHERE user_id = ?').bind(sub).first();
  return r ? JSON.parse(r.pay_info || '{}') : {};
}
/** 存成個人預設，並同步到這個人在所有帳本綁定的成員 */
async function savePayEverywhere(env, sub, pay) {
  const json = JSON.stringify(cleanPay(pay));
  await env.DB.batch([
    env.DB.prepare('INSERT INTO user_profiles (user_id, pay_info, updated_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET pay_info = excluded.pay_info, updated_at = excluded.updated_at').bind(sub, json, now()),
    env.DB.prepare('UPDATE members SET pay_info = ? WHERE line_user_id = ?').bind(json, sub),
  ]);
}
/** 剛綁定的成員若還沒填匯款資訊，自動帶入個人預設 */
async function fillPayFromProfile(env, memberId, sub) {
  const pay = await getProfilePay(env, sub);
  if (!hasPay(pay)) return;
  const m = await env.DB.prepare('SELECT pay_info FROM members WHERE id = ?').bind(memberId).first();
  if (m && hasPay(JSON.parse(m.pay_info || '{}'))) return;
  await env.DB.prepare('UPDATE members SET pay_info = ? WHERE id = ?').bind(JSON.stringify(cleanPay(pay)), memberId).run();
}

export async function ensureAccess(env, l, user, join) {
  if (l.created_by === user.sub || isAdmin(env, user.sub)) return;
  const hit = await env.DB.prepare('SELECT 1 AS ok FROM members WHERE ledger_id = ?1 AND line_user_id = ?2 UNION SELECT 1 FROM ledger_access WHERE ledger_id = ?1 AND user_id = ?2 LIMIT 1').bind(l.id, user.sub).first();
  if (hit) return;
  if (join && safeEq(join, l.invite_code)) return grant(env, l.id, user.sub, 'invite');
  if (l.group_id && (await isGroupMember(env, l.group_id, user.sub))) return grant(env, l.id, user.sub, 'group');
  throw new HttpError(403, join ? '邀請連結已失效，請向帳本成員索取新的連結' : '你沒有這本帳本的權限，請向帳本成員索取邀請連結', 'NO_ACCESS');
}
async function withInvite(env, l) {
  if (l.invite_code) return l;
  const code = newInviteCode();
  await env.DB.prepare('UPDATE ledgers SET invite_code = ? WHERE id = ? AND invite_code IS NULL').bind(code, l.id).run();
  return getLedgerRow(env, l.id);
}

// ---------- API 路由 ----------
async function api(req, env, url) {
  const p = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  const seg = p.split('/').slice(2); // ['ledgers', id, ...]
  const body = ['POST', 'PATCH'].includes(m) ? await req.json().catch(() => ({})) : {};

  if (p === '/api/rates' && m === 'GET') return rates(env, url.searchParams.get('base') || 'TWD', url.searchParams.get('date'));
  const user = await authenticate(req, env);

  if (p === '/api/me' && m === 'GET') return { userId: user.sub, name: user.name, isAdmin: isAdmin(env, user.sub), payInfo: await getProfilePay(env, user.sub) };
  if (p === '/api/me' && m === 'PATCH') {
    if (body.payInfo) await savePayEverywhere(env, user.sub, body.payInfo);
    return { userId: user.sub, name: user.name, isAdmin: isAdmin(env, user.sub), payInfo: await getProfilePay(env, user.sub) };
  }
  if (p === '/api/me/ledgers' && m === 'GET') {
    const admin = isAdmin(env, user.sub);
    const { results } = await env.DB.prepare(admin ? `
      SELECT l.*, (SELECT COUNT(*) FROM members x WHERE x.ledger_id = l.id AND x.active = 1) AS member_count,
             (SELECT id FROM members y WHERE y.ledger_id = l.id AND y.line_user_id = ?1) AS my_member_id,
             (l.created_by = ?1 OR EXISTS (SELECT 1 FROM members z WHERE z.ledger_id = l.id AND z.line_user_id = ?1) OR EXISTS (SELECT 1 FROM ledger_access a WHERE a.ledger_id = l.id AND a.user_id = ?1)) AS has_access
      FROM ledgers l WHERE l.deleted = 0 ORDER BY l.archived, l.updated_at DESC` : `
      SELECT l.*, (SELECT COUNT(*) FROM members x WHERE x.ledger_id = l.id AND x.active = 1) AS member_count,
             (SELECT id FROM members y WHERE y.ledger_id = l.id AND y.line_user_id = ?1) AS my_member_id
      FROM ledgers l WHERE l.deleted = 0 AND (l.created_by = ?1 OR EXISTS (SELECT 1 FROM members z WHERE z.ledger_id = l.id AND z.line_user_id = ?1) OR EXISTS (SELECT 1 FROM ledger_access a WHERE a.ledger_id = l.id AND a.user_id = ?1))
      ORDER BY l.archived, l.updated_at DESC`).bind(user.sub).all();
    await decorate(env, results);
    return results.map((r) => ({ ...ledgerOut(r), memberCount: r.member_count, myMemberId: r.my_member_id, isCreator: r.created_by === user.sub, viaAdmin: admin && !r.has_access }));
  }
  if (seg[0] === 'groups' && seg[2] === 'ledgers' && m === 'GET') {
    if (!(await isGroupMember(env, decodeURIComponent(seg[1]), user.sub))) return [];
    const { results } = await env.DB.prepare(`SELECT l.*, (SELECT COUNT(*) FROM members x WHERE x.ledger_id = l.id AND x.active = 1) AS member_count FROM ledgers l WHERE l.group_id = ? AND l.deleted = 0 ORDER BY l.archived, l.updated_at DESC`).bind(decodeURIComponent(seg[1])).all();
    await decorate(env, results);
    return results.map((r) => ({ ...ledgerOut(r), memberCount: r.member_count, isCreator: r.created_by === user.sub }));
  }
  if (p === '/api/ledgers' && m === 'POST') {
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) throw new HttpError(400, '請輸入帳本名稱');
    const cur = CURRENCIES[body.baseCurrency] ? body.baseCurrency : 'TWD';
    const lid = id16(); const t = now();
    const names = [...new Set((body.members || []).map((s) => String(s).trim().slice(0, 20)).filter(Boolean))].slice(0, 50);
    const gid = body.groupId && (await isGroupMember(env, body.groupId, user.sub)) ? body.groupId : null;
    const gname = gid ? await groupName(env, gid) : null;
    const stmts = [env.DB.prepare('INSERT INTO ledgers (id,name,base_currency,group_id,group_name,created_by,creator_name,invite_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(lid, name, cur, gid, gname, user.sub, user.name || null, newInviteCode(), t, t)];
    names.forEach((n, i) => {
      const claim = i === 0 && body.claimFirst;
      stmts.push(env.DB.prepare('INSERT INTO members (id,ledger_id,name,line_user_id,avatar,created_at) VALUES (?,?,?,?,?,?)').bind(id16(), lid, n, claim ? user.sub : null, claim ? user.picture : '', t + i));
    });
    await env.DB.batch(stmts);
    if (body.claimFirst) {
      const first = await env.DB.prepare('SELECT id FROM members WHERE ledger_id = ? AND line_user_id = ?').bind(lid, user.sub).first();
      if (first) await fillPayFromProfile(env, first.id, user.sub);
    }
    return ledgerOut(await getLedgerRow(env, lid));
  }
  if (seg[0] === 'ledgers' && seg[1]) {
    const lid = seg[1];
    const lrow = await getLedgerRow(env, lid);
    await ensureAccess(env, lrow, user, m === 'GET' && seg.length === 2 ? url.searchParams.get('join') : null);
    if (seg.length === 2 && m === 'GET') {
      await withInvite(env, lrow);
      const data = await loadLedger(env, lid);
      const [row] = await decorate(env, [await getLedgerRow(env, lid)]);
      data.ledger = ledgerOut(row);
      data.viewer = { isAdmin: isAdmin(env, user.sub), isCreator: row.created_by === user.sub };
      return data;
    }
    if (seg[2] === 'invite' && seg[3] === 'reset' && m === 'POST') {
      const isMember = lrow.created_by === user.sub || (await env.DB.prepare('SELECT 1 FROM members WHERE ledger_id = ? AND line_user_id = ?').bind(lid, user.sub).first());
      if (!isMember) throw new HttpError(403, '只有帳本成員可以重設邀請連結');
      await env.DB.prepare('UPDATE ledgers SET invite_code = ?, updated_at = ? WHERE id = ?').bind(newInviteCode(), now(), lid).run();
      return ledgerOut(await getLedgerRow(env, lid));
    }
    if (seg.length === 2 && m === 'PATCH') {
      const l = await getLedgerRow(env, lid);
      const f = {};
      if (body.name != null) f.name = String(body.name).trim().slice(0, 40) || l.name;
      if (body.baseCurrency && body.baseCurrency !== l.base_currency) {
        const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM records WHERE ledger_id = ? AND deleted = 0').bind(lid).first();
        if (c.n) throw new HttpError(409, '已有紀錄，無法更改結算幣別');
        if (!CURRENCIES[body.baseCurrency]) throw new HttpError(400, '不支援的幣別');
        f.base_currency = body.baseCurrency;
      }
      for (const [k, col] of [['fundEnabled', 'fund_enabled'], ['shareDefault', 'share_default'], ['archived', 'archived']]) if (body[k] != null) f[col] = body[k] ? 1 : 0;
      if (body.fundCustodian !== undefined) f.fund_custodian = body.fundCustodian || null;
      if (body.fixedRates && typeof body.fixedRates === 'object') {
        const fr = {};
        for (const [c, v] of Object.entries(body.fixedRates)) if (CURRENCIES[c] && c !== l.base_currency && Number(v) > 0) fr[c] = Number(v);
        f.fixed_rates = JSON.stringify(fr);
      }
      f.updated_at = now();
      const cols = Object.keys(f);
      await env.DB.prepare(`UPDATE ledgers SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map((c) => f[c]), lid).run();
      return ledgerOut(await getLedgerRow(env, lid));
    }
    if (seg.length === 2 && m === 'DELETE') {
      const l = await getLedgerRow(env, lid);
      if (l.created_by !== user.sub) throw new HttpError(403, '只有建立者可以刪除帳本');
      await env.DB.prepare('UPDATE ledgers SET deleted = 1, updated_at = ? WHERE id = ?').bind(now(), lid).run();
      return { ok: true };
    }
    if (seg[2] === 'members' && m === 'POST') {
      await getLedgerRow(env, lid);
      const name = String(body.name || '').trim().slice(0, 20);
      if (!name) throw new HttpError(400, '請輸入名字');
      const mid = id16();
      if (body.claim) await env.DB.prepare('UPDATE members SET line_user_id = NULL, avatar = \'\' WHERE ledger_id = ? AND line_user_id = ?').bind(lid, user.sub).run();
      await env.DB.prepare('INSERT INTO members (id,ledger_id,name,line_user_id,avatar,created_at) VALUES (?,?,?,?,?,?)').bind(mid, lid, name, body.claim ? user.sub : null, body.claim ? user.picture : '', now()).run();
      if (body.claim) await fillPayFromProfile(env, mid, user.sub);
      await touch(env, lid);
      return memberOut(await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(mid).first());
    }
    if (seg[2] === 'records' && m === 'POST') {
      const { r, l } = await cleanRecord(env, lid, body);
      assertWritable(l);
      return insertRecord(env, lid, r, user.sub);
    }
    if (seg[2] === 'notify' && m === 'POST') {
      const l = await getLedgerRow(env, lid);
      if (!l.group_id) throw new HttpError(400, '這本帳本沒有連結 LINE 群組');
      const messages = (body.messages || []).slice(0, 2);
      const ok = await lineApi(env, 'push', { to: l.group_id, messages });
      return { ok };
    }
  }
  if (seg[0] === 'members' && seg[1]) {
    const mem = await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(seg[1]).first();
    if (!mem) throw new HttpError(404, '找不到這位成員');
    await ensureAccess(env, await getLedgerRow(env, mem.ledger_id), user);
    if (seg.length === 2 && m === 'PATCH') {
      const f = {};
      if (body.name != null) f.name = String(body.name).trim().slice(0, 20) || mem.name;
      if (body.active != null) f.active = body.active ? 1 : 0;
      if (body.payInfo) {
        if (mem.line_user_id && mem.line_user_id !== user.sub) throw new HttpError(403, '只能修改自己的匯款資訊');
        f.pay_info = JSON.stringify(cleanPay(body.payInfo));
        // 本人修改時，預設同步成個人預設與其他帳本
        if (mem.line_user_id === user.sub && body.syncAll !== false) await savePayEverywhere(env, user.sub, body.payInfo);
      }
      const cols = Object.keys(f);
      if (cols.length) await env.DB.prepare(`UPDATE members SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map((c) => f[c]), mem.id).run();
      await touch(env, mem.ledger_id);
      return memberOut(await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(mem.id).first());
    }
    if (seg[2] === 'claim' && m === 'POST') {
      if (mem.line_user_id && mem.line_user_id !== user.sub) throw new HttpError(409, '這位成員已被其他人認領');
      await env.DB.batch([
        env.DB.prepare('UPDATE members SET line_user_id = NULL, avatar = \'\' WHERE ledger_id = ? AND line_user_id = ?').bind(mem.ledger_id, user.sub),
        env.DB.prepare('UPDATE members SET line_user_id = ?, avatar = ? WHERE id = ?').bind(user.sub, user.picture || '', mem.id),
      ]);
      await fillPayFromProfile(env, mem.id, user.sub);
      return memberOut(await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(mem.id).first());
    }
    if (seg.length === 2 && m === 'DELETE') {
      const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM records WHERE ledger_id = ?1 AND deleted = 0 AND (payer_id = ?2 OR split LIKE ?3)').bind(mem.ledger_id, mem.id, `%"${mem.id}"%`).first();
      if (used.n) { await env.DB.prepare('UPDATE members SET active = 0 WHERE id = ?').bind(mem.id).run(); return { archived: true }; }
      await env.DB.prepare('DELETE FROM members WHERE id = ?').bind(mem.id).run();
      await env.DB.prepare('UPDATE ledgers SET fund_custodian = NULL WHERE id = ? AND fund_custodian = ?').bind(mem.ledger_id, mem.id).run();
      return { removed: true };
    }
  }
  if (seg[0] === 'records' && seg[1]) {
    const rec = await env.DB.prepare('SELECT * FROM records WHERE id = ? AND deleted = 0').bind(seg[1]).first();
    if (!rec) throw new HttpError(404, '找不到這筆紀錄');
    await ensureAccess(env, await getLedgerRow(env, rec.ledger_id), user);
    if (m === 'PATCH') {
      const { r, l } = await cleanRecord(env, rec.ledger_id, { ...recordOut(rec), ...body });
      assertWritable(l);
      await env.DB.prepare('UPDATE records SET type=?,title=?,category=?,amount=?,currency=?,rate=?,payer_id=?,split=?,date=?,note=?,updated_at=? WHERE id=?')
        .bind(r.type, r.title, r.category, r.amount, r.currency, r.rate, r.payerId, JSON.stringify(r.split), r.date, r.note, now(), rec.id).run();
      await touch(env, rec.ledger_id);
      return recordOut(await env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(rec.id).first());
    }
    if (m === 'DELETE') {
      assertWritable(await getLedgerRow(env, rec.ledger_id));
      await env.DB.prepare('UPDATE records SET deleted = 1, updated_at = ? WHERE id = ?').bind(now(), rec.id).run();
      await touch(env, rec.ledger_id);
      return { ok: true };
    }
  }
  throw new HttpError(404, '找不到這個 API');
}
async function insertRecord(env, lid, r, sub) {
  const rid = id16(); const t = now();
  await env.DB.prepare('INSERT INTO records (id,ledger_id,type,title,category,amount,currency,rate,payer_id,split,date,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(rid, lid, r.type, r.title, r.category, r.amount, r.currency, r.rate, r.payerId, JSON.stringify(r.split), r.date, r.note, sub, t, t).run();
  await touch(env, lid);
  return recordOut(await env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(rid).first());
}
const touch = (env, lid) => env.DB.prepare('UPDATE ledgers SET updated_at = ? WHERE id = ?').bind(now(), lid).run();

// 自動補齊舊版資料庫缺少的欄位（每個執行個體只檢查一次，免手動 migrate）
let schemaChecked = false;
const MIGRATIONS = [
  ['fixed_rates', "ALTER TABLE ledgers ADD COLUMN fixed_rates TEXT DEFAULT '{}'"],
  ['invite_code', 'ALTER TABLE ledgers ADD COLUMN invite_code TEXT'],
  ['group_name', 'ALTER TABLE ledgers ADD COLUMN group_name TEXT'],
  ['creator_name', 'ALTER TABLE ledgers ADD COLUMN creator_name TEXT'],
];
export async function ensureSchema(env) {
  if (schemaChecked || !env.DB) return;
  try {
    const { results } = await env.DB.prepare('PRAGMA table_info(ledgers)').all();
    const cols = new Set(results.map((c) => c.name));
    for (const [col, sql] of MIGRATIONS) if (!cols.has(col)) { await env.DB.prepare(sql).run(); console.log(`[schema] 已新增 ledgers.${col}`); }
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS user_profiles (user_id TEXT PRIMARY KEY, pay_info TEXT DEFAULT '{}', updated_at INTEGER)").run();
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS ledger_access (ledger_id TEXT NOT NULL, user_id TEXT NOT NULL, via TEXT, created_at INTEGER NOT NULL, PRIMARY KEY (ledger_id, user_id))').run();
    schemaChecked = true;
  } catch (e) { console.error('[schema] 自動更新失敗', e); }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    await ensureSchema(env);
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    try {
      if (url.pathname === '/webhook' && req.method === 'POST') return await handleWebhook(req, env);
      if (url.pathname.startsWith('/api/')) return json(await api(req, env, url), 200, h);
      if (url.pathname === '/health') return json(await health(env, url.origin), 200, h);
      if (url.pathname === '/') return json({ name: 'sharing-api', ok: true, health: `${url.origin}/health` }, 200, h);
      return json({ error: `找不到路徑 ${url.pathname}（前端 API_BASE 應只填 ${url.origin}）` }, 404, h);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      return json({ error: e instanceof HttpError ? e.message : '伺服器錯誤', code: e.code || undefined }, e.status || 500, h);
    }
  },
};
