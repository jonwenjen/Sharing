import test from 'node:test';
import assert from 'node:assert/strict';
import { minTransfers } from '../web/js/settle.js';

// 獨立的暴力解：列舉所有集合分割，找最多零和組 → 最少轉帳 = n − 組數
function bruteMin(vals) {
  const n = vals.length;
  let best = 0;
  const groups = [];
  (function rec(i) {
    if (i === n) { if (groups.every((g) => g.s === 0)) best = Math.max(best, groups.length); return; }
    for (const g of groups) { g.s += vals[i]; rec(i + 1); g.s -= vals[i]; }
    groups.push({ s: vals[i] }); rec(i + 1); groups.pop();
  })(0);
  return n - best;
}
function randomBalances(n, max = 50) {
  const b = {};
  let sum = 0;
  for (let i = 0; i < n - 1; i++) { const v = Math.floor(Math.random() * max * 2) - max; b['p' + i] = v; sum += v; }
  b['p' + (n - 1)] = -sum;
  return b;
}
function apply(bal, tx) {
  const b = { ...bal };
  for (const t of tx) { assert.ok(t.amount > 0); b[t.from] += t.amount; b[t.to] -= t.amount; }
  return Object.values(b).every((v) => v === 0);
}

test('經典案例：A+30 B+30 C-30 D-30 → 2 筆', () => {
  assert.equal(minTransfers({ A: 30, B: 30, C: -30, D: -30 }).length, 2);
});

test('需要分組才是最佳', () => {
  const bal = { a: 5, b: 5, c: 5, d: -7, e: -8 };
  assert.equal(minTransfers(bal).length, bruteMin(Object.values(bal)));
  const bal2 = { a: 10, b: 7, c: -7, d: -4, e: -6 };
  const tx = minTransfers(bal2);
  assert.equal(tx.length, 3);
  assert.ok(apply(bal2, tx));
});

test('隨機 600 組（n≤8）與暴力解比對：筆數最少且全部結清', () => {
  for (let k = 0; k < 600; k++) {
    const n = 2 + Math.floor(Math.random() * 7);
    const bal = randomBalances(n, k % 2 ? 5 : 60);
    const tx = minTransfers(bal);
    assert.ok(apply(bal, tx), JSON.stringify(bal));
    const nonzero = Object.values(bal).filter((v) => v !== 0);
    assert.equal(tx.length, bruteMin(nonzero), JSON.stringify(bal));
  }
});

test('n=18 在合理時間內完成、n=40 退回貪婪仍正確', () => {
  const b18 = randomBalances(18, 1000);
  const t = Date.now();
  const tx = minTransfers(b18);
  assert.ok(apply(b18, tx));
  assert.ok(Date.now() - t < 1500, `花了 ${Date.now() - t}ms`);
  const b40 = randomBalances(40, 1000);
  const tx40 = minTransfers(b40);
  assert.ok(apply(b40, tx40));
  assert.ok(tx40.length <= 39);
});

test('全部為 0 → 不需轉帳；總和不為 0 → 拋出錯誤', () => {
  assert.deepEqual(minTransfers({ a: 0, b: 0 }), []);
  assert.throws(() => minTransfers({ a: 1, b: 0 }));
});
