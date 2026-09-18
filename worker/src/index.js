// Sharing API — Cloudflare Worker + D1
// 路由：/api/*（前端 LIFF 呼叫，需 LINE ID Token）與 /webhook（LINE Messaging API）
import { settlementBalances, CURRENCIES, validateRecord, formatMinor } from '../../web/js/money.js';
import { minTransfers } from '../../web/js/settle.js';

const id16 = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const now = () => Date.now();

// ---------- HTTP 工具 ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
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
const ledgerOut = (r) => r && ({ id: r.id, name: r.name, baseCurrency: r.base_currency, groupId: r.group_id, createdBy: r.created_by, fundEnabled: r.fund_enabled, fundCustodian: r.fund_custodian, shareDefault: r.share_default, archived: r.archived, createdAt: r.created_at, updatedAt: r.updated_at });
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
async function rates(env, base) {
  if (!CURRENCIES[base]) throw new HttpError(400, '不支援的幣別');
  const cache = caches.default;
  const key = new Request(`https://rates.cache/${base}`);
  let hit = await cache.match(key);
  if (!hit) {
    const res = await fetch(`${env.RATES_URL || 'https://open.er-api.com/v6/latest/'}${base}`);
    if (!res.ok) throw new HttpError(502, '暫時取不到匯率，請手動輸入');
    const data = await res.json();
    const out = {};
    for (const c of Object.keys(CURRENCIES)) if (data.rates && data.rates[c]) out[c] = 1 / data.rates[c];
    hit = json(out, 200, { 'Cache-Control': 'public, max-age=21600' });
    await cache.put(key, hit.clone());
  }
  return hit.json();
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
  if (!res.ok) console.warn('LINE API', path, res.status, await res.text());
  return res.ok;
}
const liffUrl = (env, q) => `https://liff.line.me/${env.LIFF_ID}${q}`;
const openButtonMsg = (text, label, uri) => ({
  type: 'template', altText: text,
  template: { type: 'buttons', text: text.slice(0, 160), actions: [{ type: 'uri', label, uri }] },
});

export async function handleWebhook(req, env) {
  const body = await req.text();
  if (!(await verifySignature(env, body, req.headers.get('x-line-signature')))) return new Response('bad signature', { status: 401 });
  const { events = [] } = JSON.parse(body);
  for (const ev of events) {
    const src = ev.source || {};
    const gid = src.groupId || src.roomId || null;
    const q = gid ? `?g=${encodeURIComponent(gid)}` : '';
    if (ev.type === 'join') {
      await lineApi(env, 'reply', { replyToken: ev.replyToken, messages: [openButtonMsg('大家好！我是 Sharing 記帳小幫手。點下面按鈕建立帳本，之後輸入「記帳」或「結算」都可以叫我。', '開始記帳', liffUrl(env, q))] });
    } else if (ev.type === 'message' && ev.message.type === 'text') {
      const t = ev.message.text.trim();
      if (/^(記帳|帳本|分帳|sharing)$/i.test(t)) {
        await lineApi(env, 'reply', { replyToken: ev.replyToken, messages: [openButtonMsg('點下面按鈕開啟這個群組的帳本。', '開啟帳本', liffUrl(env, q))] });
      } else if (/^結算$/.test(t) && gid) {
        const l = await env.DB.prepare('SELECT id FROM ledgers WHERE group_id = ? AND deleted = 0 AND archived = 0 ORDER BY updated_at DESC LIMIT 1').bind(gid).first();
        const text = l ? await settleSummary(env, l.id) : '這個群組還沒有帳本，輸入「記帳」建立一本。';
        await lineApi(env, 'reply', { replyToken: ev.replyToken, messages: [{ type: 'text', text }] });
      }
    }
  }
  return new Response('ok');
}

export async function settleSummary(env, ledgerId) {
  const { ledger, members, records } = await loadLedger(env, ledgerId);
  const { net } = settlementBalances(records, ledger.baseCurrency, ledger.fundEnabled ? ledger.fundCustodian : null);
  const tx = minTransfers(net);
  const name = (id) => (members.find((m) => m.id === id) || {}).name || '？';
  if (!tx.length) return `【${ledger.name}】目前已經結清。`;
  return [`【${ledger.name}】最少 ${tx.length} 筆轉帳即可結清：`, ...tx.map((t) => `・${name(t.from)} → ${name(t.to)}　${formatMinor(t.amount, ledger.baseCurrency)}`)].join('\n');
}

// ---------- API 路由 ----------
async function api(req, env, url) {
  const p = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  const seg = p.split('/').slice(2); // ['ledgers', id, ...]
  const body = ['POST', 'PATCH'].includes(m) ? await req.json().catch(() => ({})) : {};

  if (p === '/api/rates' && m === 'GET') return rates(env, url.searchParams.get('base') || 'TWD');
  const user = await authenticate(req, env);

  if (p === '/api/me/ledgers' && m === 'GET') {
    const { results } = await env.DB.prepare(`
      SELECT l.*, (SELECT COUNT(*) FROM members x WHERE x.ledger_id = l.id AND x.active = 1) AS member_count,
             (SELECT id FROM members y WHERE y.ledger_id = l.id AND y.line_user_id = ?1) AS my_member_id
      FROM ledgers l WHERE l.deleted = 0 AND (l.created_by = ?1 OR EXISTS (SELECT 1 FROM members z WHERE z.ledger_id = l.id AND z.line_user_id = ?1))
      ORDER BY l.archived, l.updated_at DESC`).bind(user.sub).all();
    return results.map((r) => ({ ...ledgerOut(r), memberCount: r.member_count, myMemberId: r.my_member_id }));
  }
  if (seg[0] === 'groups' && seg[2] === 'ledgers' && m === 'GET') {
    const { results } = await env.DB.prepare(`SELECT l.*, (SELECT COUNT(*) FROM members x WHERE x.ledger_id = l.id AND x.active = 1) AS member_count FROM ledgers l WHERE l.group_id = ? AND l.deleted = 0 ORDER BY l.archived, l.updated_at DESC`).bind(decodeURIComponent(seg[1])).all();
    return results.map((r) => ({ ...ledgerOut(r), memberCount: r.member_count }));
  }
  if (p === '/api/ledgers' && m === 'POST') {
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) throw new HttpError(400, '請輸入帳本名稱');
    const cur = CURRENCIES[body.baseCurrency] ? body.baseCurrency : 'TWD';
    const lid = id16(); const t = now();
    const names = [...new Set((body.members || []).map((s) => String(s).trim().slice(0, 20)).filter(Boolean))].slice(0, 50);
    const stmts = [env.DB.prepare('INSERT INTO ledgers (id,name,base_currency,group_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(lid, name, cur, body.groupId || null, user.sub, t, t)];
    names.forEach((n, i) => {
      const claim = i === 0 && body.claimFirst;
      stmts.push(env.DB.prepare('INSERT INTO members (id,ledger_id,name,line_user_id,avatar,created_at) VALUES (?,?,?,?,?,?)').bind(id16(), lid, n, claim ? user.sub : null, claim ? user.picture : '', t + i));
    });
    await env.DB.batch(stmts);
    return ledgerOut(await getLedgerRow(env, lid));
  }
  if (seg[0] === 'ledgers' && seg[1]) {
    const lid = seg[1];
    if (seg.length === 2 && m === 'GET') return loadLedger(env, lid);
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
      await touch(env, lid);
      return memberOut(await env.DB.prepare('SELECT * FROM members WHERE id = ?').bind(mid).first());
    }
    if (seg[2] === 'records' && m === 'POST') {
      const { r, l } = await cleanRecord(env, lid, body);
      assertWritable(l);
      const rid = id16(); const t = now();
      await env.DB.prepare('INSERT INTO records (id,ledger_id,type,title,category,amount,currency,rate,payer_id,split,date,note,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(rid, lid, r.type, r.title, r.category, r.amount, r.currency, r.rate, r.payerId, JSON.stringify(r.split), r.date, r.note, user.sub, t, t).run();
      await touch(env, lid);
      return recordOut(await env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(rid).first());
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
    await getLedgerRow(env, mem.ledger_id);
    if (seg.length === 2 && m === 'PATCH') {
      const f = {};
      if (body.name != null) f.name = String(body.name).trim().slice(0, 20) || mem.name;
      if (body.active != null) f.active = body.active ? 1 : 0;
      if (body.payInfo) {
        if (mem.line_user_id && mem.line_user_id !== user.sub) throw new HttpError(403, '只能修改自己的匯款資訊');
        const pi = {};
        for (const k of ['bank', 'bankCode', 'account', 'linePay', 'jko', 'note']) pi[k] = String(body.payInfo[k] || '').slice(0, 60);
        f.pay_info = JSON.stringify(pi);
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
const touch = (env, lid) => env.DB.prepare('UPDATE ledgers SET updated_at = ? WHERE id = ?').bind(now(), lid).run();

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const h = cors(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    try {
      if (url.pathname === '/webhook' && req.method === 'POST') return await handleWebhook(req, env);
      if (url.pathname.startsWith('/api/')) return json(await api(req, env, url), 200, h);
      if (url.pathname === '/') return json({ name: 'sharing-api', ok: true }, 200, h);
      return json({ error: 'not found' }, 404, h);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      return json({ error: e instanceof HttpError ? e.message : '伺服器錯誤' }, e.status || 500, h);
    }
  },
};
