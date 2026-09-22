import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLadder, trace, makeSlots, runLadder, summarize } from '../web/js/ladder.js';

test('梯子一定一對一（2~12 人各 300 次）', () => {
  for (let n = 2; n <= 12; n++) for (let k = 0; k < 300; k++) {
    const l = makeLadder(n);
    const ends = Array.from({ length: n }, (_, i) => trace(l, i).end);
    assert.equal(new Set(ends).size, n, `n=${n}`);
    // 同一列不會有相鄰橫線
    for (const r of l.rungs) assert.ok(!l.rungs.some((x) => x.row === r.row && Math.abs(x.col - r.col) === 1));
    // 每兩條線之間至少一條橫線
    for (let c = 0; c < n - 1; c++) assert.ok(l.rungs.some((r) => r.col === c));
  }
});

test('命運／配對／優先權的終點內容', () => {
  const f = makeSlots('fate', 6, 2);
  assert.equal(f.filter((s) => s.kind === 'hit').length, 2);
  assert.equal(makeSlots('fate', 3, 9).filter((s) => s.kind === 'hit').length, 2, '最多 n-1 位');
  const p = makeSlots('pair', 7, 3).map((s) => s.group);
  const sizes = [1, 2, 3].map((g) => p.filter((x) => x === g).length).sort();
  assert.deepEqual(sizes, [2, 2, 3], '分組人數平均');
  assert.deepEqual(makeSlots('priority', 4).map((s) => s.rank), [1, 2, 3, 4]);
});

test('runLadder + summarize', () => {
  const g = runLadder({ participants: ['a', 'b', 'c', 'd', 'e'], mode: 'priority' });
  const s = summarize(g);
  assert.equal(s.lines.length, 5);
  assert.deepEqual(s.rows.map((r) => r.slot.rank).sort(), [1, 2, 3, 4, 5]);
  const fate = summarize(runLadder({ participants: ['a', 'b', 'c'], mode: 'fate', count: 1 }));
  assert.equal(fate.rows.filter((r) => r.slot.kind === 'hit').length, 1);
  assert.throws(() => runLadder({ participants: ['a'], mode: 'fate' }));
});

test('公平性：每個人被選中的機率接近', () => {
  const hits = { a: 0, b: 0, c: 0, d: 0 };
  for (let i = 0; i < 4000; i++) {
    const g = runLadder({ participants: ['a', 'b', 'c', 'd'], mode: 'fate', count: 1 });
    summarize(g).rows.filter((r) => r.slot.kind === 'hit').forEach((r) => hits[r.id]++);
  }
  for (const v of Object.values(hits)) assert.ok(v > 850 && v < 1150, JSON.stringify(hits));
});
