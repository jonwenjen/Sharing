import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createD1 } from './d1-shim.mjs';
import worker from '../worker/src/index.js';

const env = { DB: createD1(new URL('../worker/schema.sql', import.meta.url)), DEV_MODE: '1', ALLOWED_ORIGINS: '*', LIFF_ID: '2001234567-AbCd', LINE_LOGIN_CHANNEL_ID: '2001234567', LINE_CHANNEL_SECRET: 'secret', LINE_CHANNEL_ACCESS_TOKEN: 'tok' };
const sent = [];
const rateCalls = [];
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async (url, opt) => {
  if (String(url).endsWith('/v2/bot/info')) return new Response(JSON.stringify({ displayName: '記帳小幫手', basicId: '@abc' }));
  if (String(url).endsWith('/webhook/endpoint')) return new Response(JSON.stringify({ endpoint: 'https://api.test/webhook', active: true }));
  if (String(url).includes('api.line.me/v2/bot')) { sent.push({ url: String(url), body: JSON.parse(opt.body) }); return new Response('{}'); }
  if (String(url).includes('currency-api')) {
    const m = String(url).match(/currency-api@([\w-]+)/);
    rateCalls.push(m ? m[1] : url);
    return new Response(JSON.stringify({ date: m && m[1] !== 'latest' ? m[1] : '2026-09-18', twd: { jpy: m && m[1] === '2026-01-05' ? 5 : 4.7, usd: 0.031 } }));
  }
  throw new Error('unexpected fetch ' + url);
};
async function call(user, method, path, body) {
  const res = await worker.fetch(new Request('https://api.test' + path, { method, headers: { Authorization: user ? `Bearer dev:${user}:${user}` : '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env);
  return { status: res.status, data: await res.json() };
}

let L, M;
test('建立帳本並自動綁定建立者', async () => {
  const r = await call('robin', 'POST', '/api/ledgers', { name: '東京', baseCurrency: 'TWD', groupId: 'Cgroup1', members: ['Robin', '阿哲', '米米'], claimFirst: true });
  assert.equal(r.status, 200);
  L = r.data.id;
  const g = await call('robin', 'GET', `/api/ledgers/${L}`);
  M = Object.fromEntries(g.data.members.map((m) => [m.name, m]));
  assert.equal(M.Robin.lineUserId, 'robin');
  assert.equal(g.data.members.length, 3);
});

test('未登入被拒', async () => {
  const r = await call(null, 'GET', `/api/ledgers/${L}`);
  assert.equal(r.status, 401);
});

test('朋友認領成員、不能搶別人已認領的', async () => {
  assert.equal((await call('zhe', 'POST', `/api/members/${M['阿哲'].id}/claim`)).status, 200);
  assert.equal((await call('mimi', 'POST', `/api/members/${M['阿哲'].id}/claim`)).status, 409);
  const list = await call('zhe', 'GET', '/api/me/ledgers');
  assert.equal(list.data[0].myMemberId, M['阿哲'].id);
});

test('匯款資訊只能本人修改', async () => {
  assert.equal((await call('robin', 'PATCH', `/api/members/${M['阿哲'].id}`, { payInfo: { account: '999' } })).status, 403);
  const ok = await call('zhe', 'PATCH', `/api/members/${M['阿哲'].id}`, { payInfo: { bank: '國泰', account: '0123' } });
  assert.equal(ok.data.payInfo.account, '0123');
});

let R;
test('新增、修改、驗證紀錄', async () => {
  const bad = await call('robin', 'POST', `/api/ledgers/${L}/records`, { type: 'expense', amount: -1, currency: 'TWD', payerId: M.Robin.id, split: { mode: 'equal', parts: { [M.Robin.id]: true } }, date: '2026-12-01' });
  assert.equal(bad.status, 400);
  const outsider = await call('robin', 'POST', `/api/ledgers/${L}/records`, { type: 'expense', amount: 100, currency: 'TWD', payerId: 'hacker', split: { mode: 'equal', parts: { hacker: true } }, date: '2026-12-01' });
  assert.equal(outsider.status, 400);
  const r = await call('robin', 'POST', `/api/ledgers/${L}/records`, { type: 'expense', title: '拉麵', category: 'food', amount: 3000, currency: 'JPY', rate: 0.2, payerId: M.Robin.id, split: { mode: 'equal', parts: { [M.Robin.id]: true, [M['阿哲'].id]: true, [M['米米'].id]: true } }, date: '2026-12-01' });
  assert.equal(r.status, 200);
  R = r.data;
  const up = await call('zhe', 'PATCH', `/api/records/${R.id}`, { amount: 6000 });
  assert.equal(up.data.amount, 6000);
});

test('有紀錄後不能改結算幣別；成員移除變停用', async () => {
  assert.equal((await call('robin', 'PATCH', `/api/ledgers/${L}`, { baseCurrency: 'USD' })).status, 409);
  const rm = await call('robin', 'DELETE', `/api/members/${M['米米'].id}`);
  assert.deepEqual(rm.data, { archived: true });
  const add = await call('robin', 'POST', `/api/ledgers/${L}/members`, { name: 'Kai' });
  const rm2 = await call('robin', 'DELETE', `/api/members/${add.data.id}`);
  assert.deepEqual(rm2.data, { removed: true });
});

test('公費：啟用、存入、由公費付款', async () => {
  await call('robin', 'PATCH', `/api/ledgers/${L}`, { fundEnabled: 1, fundCustodian: M.Robin.id });
  const fi = await call('zhe', 'POST', `/api/ledgers/${L}/records`, { type: 'fund_in', amount: 2000, currency: 'TWD', payerId: M['阿哲'].id, split: { mode: 'equal', parts: { __fund: true } }, date: '2026-12-02' });
  assert.equal(fi.status, 200);
  const ex = await call('zhe', 'POST', `/api/ledgers/${L}/records`, { type: 'expense', title: '車票', amount: 900, currency: 'TWD', payerId: '__fund', split: { mode: 'equal', parts: { [M.Robin.id]: true, [M['阿哲'].id]: true, [M['米米'].id]: true } }, date: '2026-12-02' });
  assert.equal(ex.status, 200);
});

test('封存後不能新增、刪除會軟刪除', async () => {
  await call('robin', 'PATCH', `/api/ledgers/${L}`, { archived: 1 });
  assert.equal((await call('robin', 'DELETE', `/api/records/${R.id}`)).status, 409);
  await call('robin', 'PATCH', `/api/ledgers/${L}`, { archived: 0 });
  assert.equal((await call('robin', 'DELETE', `/api/records/${R.id}`)).status, 200);
  const g = await call('robin', 'GET', `/api/ledgers/${L}`);
  assert.equal(g.data.records.length, 2);
});

test('群組帳本列表與推播通知', async () => {
  const g = await call('mimi', 'GET', '/api/groups/Cgroup1/ledgers');
  assert.equal(g.data[0].id, L);
  const n = await call('robin', 'POST', `/api/ledgers/${L}/notify`, { messages: [{ type: 'text', text: 'hi' }] });
  assert.equal(n.data.ok, true);
  assert.equal(sent.at(-1).body.to, 'Cgroup1');
});

test('匯率 API 換算成「1 外幣 = ? 基準幣」', async () => {
  const r = await call(null, 'GET', '/api/rates?base=TWD');
  assert.ok(Math.abs(r.data.rates.JPY - 1 / 4.7) < 1e-9);
  const h = await call(null, 'GET', '/api/rates?base=TWD&date=2026-01-05');
  assert.equal(h.data.date, '2026-01-05');
  assert.ok(Math.abs(h.data.rates.JPY - 0.2) < 1e-9);
  const f = await call(null, 'GET', '/api/rates?base=TWD&date=2099-01-01');
  assert.equal(rateCalls.at(-1), 'latest', '未來日期要用最新匯率');
  void f;
});

async function hook(events, secret = 'secret') {
  const body = JSON.stringify({ events });
  const sig = createHmac('sha256', secret).update(body).digest('base64');
  return worker.fetch(new Request('https://api.test/webhook', { method: 'POST', headers: { 'x-line-signature': sig }, body }), env);
}
test('Webhook：簽章錯誤拒絕、加入群組歡迎、「結算」回覆最少轉帳', async () => {
  assert.equal((await hook([], 'wrong')).status, 401);
  await hook([{ type: 'join', replyToken: 'r1', source: { type: 'group', groupId: 'Cgroup1' } }]);
  assert.match(sent.at(-1).body.messages[0].template.actions[0].uri, /liff\.line\.me\/2001234567-AbCd\?g=Cgroup1/);
  await hook([{ type: 'message', replyToken: 'r2', message: { type: 'text', text: '結算' }, source: { type: 'group', groupId: 'Cgroup1' } }]);
  const text = sent.at(-1).body.messages[0].text;
  assert.match(text, /最少 \d 筆轉帳/);
  // 公費 2000−900=1100 在 Robin 手上；每人分攤 300 → Robin -1400、阿哲 +1700、米米 -300 → 2 筆
  assert.match(text, /最少 2 筆/);
});

test('LIFF_ID 未設定時，仍以純文字回覆（不會完全沒反應）', async () => {
  const keep = env.LIFF_ID; env.LIFF_ID = '請填入 LIFF ID';
  await hook([{ type: 'message', replyToken: 'r3', message: { type: 'text', text: '記帳' }, source: { type: 'group', groupId: 'Cgroup1' } }]);
  assert.equal(sent.at(-1).body.messages[0].type, 'text');
  assert.match(sent.at(-1).body.messages[0].text, /LIFF_ID 尚未正確設定/);
  const hc = await (await worker.fetch(new Request('https://api.test/health'), env)).json();
  assert.equal(hc.ok, false);
  assert.ok(hc.checks.find((c) => c.name.startsWith('LIFF_ID')).hint);
  env.LIFF_ID = keep;
});

test('/health 全部通過且不外洩密鑰', async () => {
  const res = await worker.fetch(new Request('https://api.test/health'), env);
  const text = await res.text();
  const hc = JSON.parse(text);
  assert.equal(hc.ok, true, text);
  assert.equal(hc.bot.basicId, '@abc');
  assert.ok(!text.includes('secret') || !text.includes(env.LINE_CHANNEL_SECRET + '"'));
  assert.ok(!text.includes(env.LINE_CHANNEL_ACCESS_TOKEN + '"'));
});

const msg = (text, userId, extra = {}) => ({ type: 'message', replyToken: 'rq', message: { type: 'text', text, ...extra }, source: { type: 'group', groupId: 'Cgroup1', userId } });
test('LINE 訊息記帳：全員平分、指定成員與幣別、未綁定者被引導', async () => {
  await hook([msg('+1200 晚餐', 'robin')]);
  let rep = sent.at(-1).body.messages[0];
  assert.equal(rep.type, 'flex');
  assert.match(rep.altText, /晚餐/);
  assert.equal(rep.contents.footer.contents[1].action.type, 'postback');
  let g = await call('robin', 'GET', `/api/ledgers/${L}`);
  let rec = g.data.records.find((r) => r.title === '晚餐');
  assert.equal(rec.category, 'dinner');
  assert.equal(rec.payerId, M.Robin.id);
  assert.equal(Object.keys(rec.split.parts).length, 2, '停用的米米不應被分攤');

  await hook([msg('+3000 JPY 拉麵 @阿哲 @我', 'robin')]);
  g = await call('robin', 'GET', `/api/ledgers/${L}`);
  rec = g.data.records.find((r) => r.title === '拉麵');
  assert.equal(rec.currency, 'JPY');
  assert.ok(Math.abs(rec.rate - 1 / 4.7) < 1e-4);
  assert.deepEqual(Object.keys(rec.split.parts).sort(), [M.Robin.id, M['阿哲'].id].sort());

  // LINE 提及（顯示名稱含空白）用 userId 對應
  await hook([msg('+500 飲料 @Zhe Chen', 'robin', { mention: { mentionees: [{ index: 8, length: 9, userId: 'zhe', type: 'user' }] } })]);
  g = await call('robin', 'GET', `/api/ledgers/${L}`);
  rec = g.data.records.find((r) => r.title === '飲料');
  assert.deepEqual(Object.keys(rec.split.parts), [M['阿哲'].id]);
  assert.equal(rec.category, 'drink');

  await hook([msg('+100 糖果 @不存在', 'robin')]);
  assert.match(sent.at(-1).body.messages[0].text, /找不到成員：不存在/);
  await hook([msg('+100 糖果', 'stranger')]);
  assert.match(JSON.stringify(sent.at(-1).body.messages[0]), /選擇/);
  await hook([msg('說明', 'robin')]);
  assert.match(sent.at(-1).body.messages[0].text, /快速記帳格式/);
});

test('LINE 訊息記帳：只有本人能按「取消這筆」', async () => {
  let g = await call('robin', 'GET', `/api/ledgers/${L}`);
  const rec = g.data.records.find((r) => r.title === '晚餐');
  const pb = (userId) => ({ type: 'postback', replyToken: 'rp', postback: { data: `undo:${rec.id}` }, source: { type: 'group', groupId: 'Cgroup1', userId } });
  await hook([pb('zhe')]);
  assert.match(sent.at(-1).body.messages[0].text, /只有記這筆帳的人/);
  await hook([pb('robin')]);
  assert.match(sent.at(-1).body.messages[0].text, /已取消/);
  g = await call('robin', 'GET', `/api/ledgers/${L}`);
  assert.ok(!g.data.records.find((r) => r.id === rec.id));
  await hook([pb('robin')]);
  assert.match(sent.at(-1).body.messages[0].text, /已經取消/);
});

test('帳本固定匯率：只接受有效幣別，並用於訊息記帳', async () => {
  const r = await call('robin', 'PATCH', `/api/ledgers/${L}`, { fixedRates: { JPY: 0.21, XXX: 3, TWD: 1, USD: -1 } });
  assert.deepEqual(r.data.fixedRates, { JPY: 0.21 });
  await hook([msg('+1000円 咖啡', 'robin')]);
  const g = await call('robin', 'GET', `/api/ledgers/${L}`);
  const rec = g.data.records.find((x) => x.title === '咖啡');
  assert.equal(rec.rate, 0.21);
  assert.equal(rec.currency, 'JPY');
});
