import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, recordShares, computeBalances, settlementBalances, fundCash, stats, validateRecord, formatMoney, FUND_ID } from '../web/js/money.js';

const rec = (o) => ({ type: 'expense', currency: 'TWD', rate: 1, category: 'food', date: '2026-01-01', ...o });

test('allocate：總和永遠等於總額、差額最多 1', () => {
  for (let i = 0; i < 2000; i++) {
    const total = Math.floor(Math.random() * 100000) - 20000;
    const n = 1 + Math.floor(Math.random() * 9);
    const w = Object.fromEntries(Array.from({ length: n }, (_, k) => ['p' + k, 1]));
    const out = allocate(total, w);
    const vals = Object.values(out);
    assert.equal(vals.reduce((a, b) => a + b, 0), total);
    assert.ok(Math.max(...vals) - Math.min(...vals) <= 1);
  }
});

test('平分 1000 給 3 人 = 334/333/333', () => {
  const { shares, total } = recordShares(rec({ amount: 1000, payerId: 'a', split: { mode: 'equal', parts: { a: true, b: true, c: true } } }), 'TWD');
  assert.equal(total, 1000);
  assert.deepEqual(Object.values(shares).sort(), [333, 333, 334]);
});

test('自訂金額與份數', () => {
  const a = recordShares(rec({ amount: 900, payerId: 'a', split: { mode: 'amount', parts: { a: 600, b: 300 } } }), 'TWD');
  assert.deepEqual(a.shares, { a: 600, b: 300 });
  const s = recordShares(rec({ amount: 1000, payerId: 'a', split: { mode: 'shares', parts: { a: 1, b: 3 } } }), 'TWD');
  assert.deepEqual(s.shares, { a: 250, b: 750 });
});

test('外幣換算：15200 JPY × 0.213 = 3238 TWD', () => {
  const r = recordShares(rec({ amount: 15200, currency: 'JPY', rate: 0.213, payerId: 'a', split: { mode: 'equal', parts: { a: true, b: true } } }), 'TWD');
  assert.equal(r.total, 3238);
  assert.equal(r.shares.a + r.shares.b, 3238);
});

test('USD 基準幣別以「分」計算', () => {
  const r = recordShares(rec({ amount: 10, currency: 'USD', payerId: 'a', split: { mode: 'equal', parts: { a: true, b: true, c: true } } }), 'USD');
  assert.equal(r.total, 1000);
  assert.deepEqual(Object.values(r.shares).sort(), [333, 333, 334]);
});

test('餘額總和為 0；公費併入保管人', () => {
  const records = [
    rec({ type: 'fund_in', amount: 3000, payerId: 'a', split: { mode: 'equal', parts: { [FUND_ID]: true } } }),
    rec({ type: 'fund_in', amount: 3000, payerId: 'b', split: { mode: 'equal', parts: { [FUND_ID]: true } } }),
    rec({ amount: 4500, payerId: FUND_ID, split: { mode: 'equal', parts: { a: true, b: true, c: true } } }),
    rec({ amount: 999, payerId: 'c', split: { mode: 'equal', parts: { a: true, b: true, c: true } } }),
  ];
  const net = computeBalances(records, 'TWD');
  assert.equal(Object.values(net).reduce((x, y) => x + y, 0), 0);
  assert.equal(fundCash(records, 'TWD'), 1500);
  const s = settlementBalances(records, 'TWD', 'a');
  assert.equal(Object.values(s.net).reduce((x, y) => x + y, 0), 0);
  assert.ok(!(FUND_ID in s.net));
  // a：存 3000、分攤 1500+333、持有公費 1500 → 3000-1833-1500 = -333
  assert.equal(s.net.a, -333);
  const st = stats(records, 'TWD');
  assert.equal(st.total, 5499);
  assert.equal(st.people.a.fundIn, 3000);
});

test('刪除的紀錄不計入', () => {
  const net = computeBalances([rec({ amount: 100, payerId: 'a', deleted: 1, split: { mode: 'equal', parts: { b: true } } })], 'TWD');
  assert.deepEqual(net, {});
});

test('validateRecord 擋下錯誤輸入', () => {
  assert.ok(validateRecord(rec({ amount: 0, payerId: 'a', split: { mode: 'equal', parts: { a: true } } })).length);
  assert.ok(validateRecord(rec({ amount: 100, payerId: 'a', split: { mode: 'amount', parts: { a: 50, b: 40 } } })).length);
  assert.ok(validateRecord({ type: 'transfer', amount: 100, currency: 'TWD', payerId: 'a', split: { mode: 'amount', parts: { a: 100 } } }).length);
  assert.equal(validateRecord(rec({ amount: 100, payerId: 'a', split: { mode: 'amount', parts: { a: 60, b: 40 } } })).length, 0);
});

test('格式化', () => {
  assert.equal(formatMoney(1234, 'TWD'), 'NT$1,234');
  assert.equal(formatMoney(-5.5, 'USD'), '-US$5.50');
  assert.equal(formatMoney(300, 'JPY', { sign: true }), '+¥300');
});
