import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createD1 } from './d1-shim.mjs';
import worker from '../worker/src/index.js';

const env = { DB: createD1(new URL('../worker/schema.sql', import.meta.url)), DEV_MODE: '1', ALLOWED_ORIGINS: '*', LIFF_ID: 'LIFF123', LINE_CHANNEL_SECRET: 'secret', LINE_CHANNEL_ACCESS_TOKEN: 'tok' };
const sent = [];
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
globalThis.fetch = async (url, opt) => {
  if (String(url).includes('api.line.me/v2/bot')) { sent.push({ url: String(url), body: JSON.parse(opt.body) }); return new Response('{}'); }
  if (String(url).includes('er-api')) return new Response(JSON.stringify({ rates: { TWD: 1, JPY: 4.7, USD: 0.031 } }));
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
  assert.ok(Math.abs(r.data.JPY - 1 / 4.7) < 1e-9);
});

async function hook(events, secret = 'secret') {
  const body = JSON.stringify({ events });
  const sig = createHmac('sha256', secret).update(body).digest('base64');
  return worker.fetch(new Request('https://api.test/webhook', { method: 'POST', headers: { 'x-line-signature': sig }, body }), env);
}
test('Webhook：簽章錯誤拒絕、加入群組歡迎、「結算」回覆最少轉帳', async () => {
  assert.equal((await hook([], 'wrong')).status, 401);
  await hook([{ type: 'join', replyToken: 'r1', source: { type: 'group', groupId: 'Cgroup1' } }]);
  assert.match(sent.at(-1).body.messages[0].template.actions[0].uri, /liff\.line\.me\/LIFF123\?g=Cgroup1/);
  await hook([{ type: 'message', replyToken: 'r2', message: { type: 'text', text: '結算' }, source: { type: 'group', groupId: 'Cgroup1' } }]);
  const text = sent.at(-1).body.messages[0].text;
  assert.match(text, /最少 \d 筆轉帳/);
  // 公費 2000−900=1100 在 Robin 手上；每人分攤 300 → Robin -1400、阿哲 +1700、米米 -300 → 2 筆
  assert.match(text, /最少 2 筆/);
});
