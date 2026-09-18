// 最少轉帳次數結清演算法
// 原理：n 個非零餘額若能切成 k 組「組內加總為 0」的子集合，所需轉帳 = n − k。
// 以位元 DP 找出最多的零和分組（n ≤ EXACT_LIMIT 時保證最佳解），組內再用貪婪配對。
export const EXACT_LIMIT = 18;

function greedy(list) {
  const cred = list.filter((x) => x.v > 0).map((x) => ({ ...x }));
  const debt = list.filter((x) => x.v < 0).map((x) => ({ ...x, v: -x.v }));
  const byAmt = (a, b) => b.v - a.v || (a.id < b.id ? -1 : 1);
  const out = [];
  while (cred.length && debt.length) {
    cred.sort(byAmt);
    debt.sort(byAmt);
    const c = cred[0], d = debt[0];
    const amt = Math.min(c.v, d.v);
    out.push({ from: d.id, to: c.id, amount: amt });
    c.v -= amt;
    d.v -= amt;
    if (!c.v) cred.shift();
    if (!d.v) debt.shift();
  }
  return out;
}

/**
 * @param {Record<string, number>} balances 整數最小單位；正＝應收、負＝應付，總和須為 0
 * @returns {{from:string,to:string,amount:number}[]}
 */
export function minTransfers(balances) {
  const list = Object.entries(balances)
    .map(([id, v]) => ({ id, v: Math.round(v) }))
    .filter((x) => x.v !== 0)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const total = list.reduce((s, x) => s + x.v, 0);
  if (total !== 0) throw new Error('餘額加總不為 0');
  const n = list.length;
  if (n === 0) return [];
  if (n > EXACT_LIMIT) return greedy(list);

  const size = 1 << n;
  const sum = new Float64Array(size);
  const dp = new Int8Array(size);
  for (let m = 1; m < size; m++) {
    const low = m & -m;
    sum[m] = sum[m ^ low] + list[31 - Math.clz32(low)].v;
    let best = 0;
    for (let i = 0; i < n; i++) if (m & (1 << i)) { const v = dp[m ^ (1 << i)]; if (v > best) best = v; }
    dp[m] = best + (sum[m] === 0 ? 1 : 0);
  }
  // 回溯出加入順序，零和前綴即為分組邊界
  const order = [];
  let m = size - 1;
  while (m) {
    const need = dp[m] - (sum[m] === 0 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      if (m & (1 << i) && dp[m ^ (1 << i)] === need) { order.push(i); m ^= 1 << i; break; }
    }
  }
  order.reverse();
  const out = [];
  let group = [], acc = 0;
  for (const i of order) {
    group.push(list[i]);
    acc += list[i].v;
    if (acc === 0) { out.push(...greedy(group)); group = []; }
  }
  return out;
}
