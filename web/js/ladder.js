// 爬梯子（阿彌陀籤）：純函式，前後端共用
// 每條直線從上走到下，遇到橫線就換到隔壁；同一列不會有相鄰橫線，所以起點與終點一定一對一。

export const LADDER_MODES = {
  fate: { name: '命運', desc: '從參加的人裡選出幾位' },
  pair: { name: '配對', desc: '把大家分成幾組' },
  priority: { name: '優先權', desc: '排出第 1 到最後的順序' },
};

/** 以 crypto 產生 [0,1) 亂數（前後端都有 crypto.getRandomValues） */
export function cryptoRand() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

/** 產生梯子：n 條直線、rows 列；回傳 rungs = [{ row, col }]（col 與 col+1 之間的橫線） */
export function makeLadder(n, rand = cryptoRand, baseRows = Math.max(9, n * 2 + 5)) {
  let rows = baseRows;
  const rungs = [];
  for (let row = 0; row < rows; row++) {
    let prev = false;
    for (let col = 0; col < n - 1; col++) {
      if (!prev && rand() < 0.45) { rungs.push({ row, col }); prev = true; } else prev = false;
    }
  }
  // 保證每個相鄰的兩條線之間至少有一條橫線，避免有人一路直下
  for (let col = 0; col < n - 1; col++) {
    if (rungs.some((r) => r.col === col)) continue;
    const free = [];
    for (let row = 0; row < rows; row++) if (!rungs.some((r) => r.row === row && Math.abs(r.col - col) <= 1)) free.push(row);
    if (free.length) rungs.push({ row: free[Math.floor(rand() * free.length)], col });
    else rungs.push({ row: rows++, col }); // 沒有空位時多加一列
  }
  return { n, rows, rungs };
}

/** 從第 start 條線出發，回傳走過的點 [{col,row}] 與終點 end、經過的橫線索引 */
export function trace(ladder, start) {
  const { rows, rungs } = ladder;
  const at = (row, col) => rungs.findIndex((r) => r.row === row && r.col === col);
  let col = start;
  const pts = [{ col, row: -0.5 }];
  const crossed = [];
  for (let row = 0; row < rows; row++) {
    const right = at(row, col);
    const left = col > 0 ? at(row, col - 1) : -1;
    if (right >= 0) { pts.push({ col, row }); col += 1; pts.push({ col, row }); crossed.push(right); }
    else if (left >= 0) { pts.push({ col, row }); col -= 1; pts.push({ col, row }); crossed.push(left); }
  }
  pts.push({ col, row: rows - 0.5 });
  return { pts, end: col, crossed };
}

/** 依模式產生終點的格子內容（長度 n） */
export function makeSlots(mode, n, count, rand = cryptoRand) {
  let slots;
  if (mode === 'fate') {
    const k = Math.min(Math.max(1, count | 0), n - 1);
    slots = Array.from({ length: n }, (_, i) => ({ kind: i < k ? 'hit' : 'safe' }));
  } else if (mode === 'pair') {
    const g = Math.min(Math.max(2, count | 0), n);
    slots = Array.from({ length: n }, (_, i) => ({ kind: 'group', group: (i % g) + 1 }));
  } else {
    slots = Array.from({ length: n }, (_, i) => ({ kind: 'rank', rank: i + 1 }));
  }
  if (mode !== 'priority') {
    for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  }
  return slots;
}

/** 一次完成：產生梯子與終點，算出每個人的結果 */
export function runLadder({ participants, mode, count }, rand = cryptoRand) {
  const n = participants.length;
  if (n < 2) throw new Error('至少要 2 個人才能爬梯子');
  if (!LADDER_MODES[mode]) throw new Error('不支援的模式');
  const order = [...participants];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const ladder = makeLadder(n, rand);
  const slots = makeSlots(mode, n, count, rand);
  const ends = order.map((_, i) => trace(ladder, i).end);
  return { mode, count, order, ladder, slots, ends };
}

/** 手指抽籤：n 根手指各拿到一格結果（命運＝中/沒中、配對＝組別、優先權＝名次），全部隨機 */
export function fingerDraw(mode, n, count, rand = cryptoRand) {
  if (n < 2) throw new Error('至少要 2 根手指');
  if (!LADDER_MODES[mode]) throw new Error('不支援的模式');
  const slots = makeSlots(mode, n, count, rand);
  if (mode === 'priority') for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  return slots;
}

/** 整理成結果（給畫面與 LINE 訊息用） */
export function summarize(game, nameOf = (x) => x) {
  const rows = game.order.map((p, i) => ({ id: p, name: nameOf(p), slot: game.slots[game.ends[i]] }));
  if (game.mode === 'fate') {
    const hit = rows.filter((r) => r.slot.kind === 'hit');
    return { title: `命運選中 ${hit.length} 位`, lines: [`🎯 ${hit.map((r) => r.name).join('、')}`], rows };
  }
  if (game.mode === 'pair') {
    const groups = {};
    rows.forEach((r) => (groups[r.slot.group] = groups[r.slot.group] || []).push(r.name));
    return { title: `分成 ${Object.keys(groups).length} 組`, lines: Object.keys(groups).sort((a, b) => a - b).map((g) => `第 ${g} 組：${groups[g].join('、')}`), rows };
  }
  const sorted = [...rows].sort((a, b) => a.slot.rank - b.slot.rank);
  return { title: '優先順序', lines: sorted.map((r) => `${r.slot.rank}. ${r.name}`), rows };
}

export function ladderText(game, nameOf, ledgerName) {
  const s = summarize(game, nameOf);
  return [`🪜【${ledgerName}】爬梯子：${LADDER_MODES[game.mode].name}`, s.title, ...s.lines].join('\n');
}
