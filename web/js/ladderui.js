// 爬梯子畫面：設定（選人、選模式）＋ 盲盒模式動畫（橫線與終點全程遮蔽，沿路徑即時點亮）
import { h, mount, icon, avatar, toast, sheet, copyText } from './ui.js';
import { LADDER_MODES, trace, summarize, ladderText } from './ladder.js';
import { sfx, buzz, sfxUnlock, sfxToggle } from './sfx.js';

const COLORS = ['#FF4D6D', '#FFB020', '#38D9A9', '#4DABF7', '#B197FC', '#FF8CC6', '#63E6BE', '#FFD43B', '#FF922B', '#74C0FC', '#DA77F2', '#A9E34B'];
const GROUP_COLORS = ['#FF4D6D', '#4DABF7', '#38D9A9', '#FFB020', '#B197FC', '#FF8CC6'];
const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 開啟設定抽屜
 * @param {{members:any[], meId:string|null, run:(p)=>Promise<any>, share:(game)=>Promise<boolean>|null, ledgerName:string}} ctx
 */
export function ladderSetup(ctx) {
  const members = ctx.members;
  const picked = new Set(members.map((m) => m.id));
  let mode = 'fate';
  let count = 1;
  const body = h('div', { class: 'form ladder-setup' });
  const clamp = () => {
    const k = picked.size;
    if (mode === 'fate') count = Math.min(Math.max(1, count), Math.max(1, k - 1));
    if (mode === 'pair') count = Math.min(Math.max(2, count), Math.max(2, k));
  };
  const draw = () => {
    clamp();
    const k = picked.size;
    const allOn = k === members.length;
    const startBtn = h('button', { class: 'btn primary block lad-start', disabled: k < 2, onclick: start }, '🪜 開始爬梯子！');
    mount(body,
      h('div', { class: 'row between' }, h('span', { class: 'field-label' }, `參加的人（${k}/${members.length}）`),
        h('button', { class: 'link', onclick: () => { if (allOn) picked.clear(); else members.forEach((m) => picked.add(m.id)); draw(); } }, allOn ? '全部取消' : '全選')),
      h('div', { class: 'chips' }, members.map((m) => h('button', {
        class: `chip person ${picked.has(m.id) ? 'on' : ''}`, 'aria-pressed': String(picked.has(m.id)),
        onclick: () => { picked.has(m.id) ? picked.delete(m.id) : picked.add(m.id); draw(); },
      }, avatar(m, 24), m.name))),
      h('span', { class: 'field-label' }, '模式'),
      h('div', { class: 'seg' }, Object.entries(LADDER_MODES).map(([k2, v]) => h('button', { class: mode === k2 ? 'on' : '', 'aria-pressed': String(mode === k2), onclick: () => { mode = k2; count = k2 === 'pair' ? 2 : 1; draw(); } }, v.name))),
      h('p', { class: 'hint' }, LADDER_MODES[mode].desc),
      mode === 'priority' ? null : h('div', { class: 'stepper' },
        h('span', {}, mode === 'fate' ? '選出' : '分成'),
        h('button', { class: 'icon-btn step', 'aria-label': '減少', disabled: count <= (mode === 'fate' ? 1 : 2), onclick: () => { count--; draw(); } }, '−'),
        h('strong', { 'aria-live': 'polite' }, count),
        h('button', { class: 'icon-btn step', 'aria-label': '增加', disabled: count >= (mode === 'fate' ? k - 1 : k), onclick: () => { count++; draw(); } }, '+'),
        h('span', {}, mode === 'fate' ? '位' : '組')),
      k < 2 ? h('p', { class: 'hint neg' }, '至少要選 2 位') : null,
      startBtn);
  };
  let close;
  async function start() {
    sfxUnlock();
    const participants = members.filter((m) => picked.has(m.id)).map((m) => m.id);
    let game;
    try { game = await ctx.run({ participants, mode, count }); } catch (e) { toast(e.message || '無法開始', 'err'); return; }
    close();
    ladderStage(game, { ...ctx, again: () => ctx.run({ participants, mode, count }) });
  }
  draw();
  close = sheet('爬梯子', body);
}

/** 全螢幕遊戲畫面 */
export function ladderStage(game, ctx) {
  const byId = Object.fromEntries(ctx.members.map((m) => [m.id, m]));
  const nameOf = (id) => (byId[id] || {}).name || '？';
  const n = game.order.length;
  const { rows, rungs } = game.ladder;
  const W = Math.min(window.innerWidth - 32, 520);
  const H = Math.max(260, Math.min(window.innerHeight * 0.46, 440));
  const colW = W / n;
  const X = (c) => colW * (c + 0.5);
  const Y = (r) => ((r + 0.5) / rows) * H;
  const svgNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const e = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'lad-svg', 'aria-hidden': 'true' });
  for (let c = 0; c < n; c++) svg.append(el('line', { x1: X(c), x2: X(c), y1: 0, y2: H, class: 'lad-rail' }));
  // 盲盒：橫線一開始全部看不到，路徑經過才出現
  const fog = el('rect', { x: 0, y: 0, width: W, height: H, class: 'lad-fog' });
  svg.append(fog);
  const rungEls = rungs.map((r) => { const e = el('line', { x1: X(r.col), x2: X(r.col + 1), y1: Y(r.row), y2: Y(r.row), class: 'lad-rung' }); svg.append(e); return e; });

  const players = game.order.map((id, i) => {
    const color = COLORS[i % COLORS.length];
    const t = trace(game.ladder, i);
    const pts = t.pts.map((p) => [X(p.col), Y(p.row)]);
    const d = pts.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const path = el('path', { d, class: 'lad-path', stroke: color, fill: 'none' });
    const head = el('circle', { r: 7, class: 'lad-head', fill: color, cx: pts[0][0], cy: pts[0][1] });
    svg.append(path, head);
    // 每段累積長度 → 算出經過橫線的時間點
    const cum = [0];
    for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    const events = [];
    let ci = 0;
    for (let k = 1; k < pts.length; k++) if (pts[k][1] === pts[k - 1][1]) events.push({ len: cum[k - 1], rung: t.crossed[ci++] });
    return { id, color, path, head, total: cum.at(-1), events, end: t.end, arrived: false };
  });

  const topRow = h('div', { class: 'lad-top', style: `width:${W}px;grid-template-columns:repeat(${n},1fr)` },
    players.map((p) => h('div', { class: 'lad-player', style: `--c:${p.color}` }, avatar(byId[p.id] || { name: '?' }, n > 8 ? 24 : 32), h('span', {}, nameOf(p.id)))));
  const slotEls = game.slots.map((s) => h('div', { class: 'lad-slot masked' }, h('span', { class: 'lad-q' }, '?')));
  const bottomRow = h('div', { class: 'lad-bottom', style: `width:${W}px;grid-template-columns:repeat(${n},1fr)` }, slotEls);
  const counter = h('div', { class: 'lad-count', 'aria-live': 'assertive' });
  const resultBox = h('div', { class: 'lad-result', 'aria-live': 'polite' });
  const titleIcon = { fate: '🎯', pair: '🤝', priority: '🏁' }[game.mode];
  const stage = h('div', { class: 'ladder-stage', role: 'dialog', 'aria-modal': 'true', 'aria-label': '爬梯子' },
    h('header', { class: 'lad-head-bar' },
      h('div', {}, h('strong', {}, `${titleIcon} ${LADDER_MODES[game.mode].name}爬梯子`),
        h('small', {}, game.mode === 'fate' ? `選出 ${game.slots.filter((s) => s.kind === 'hit').length} 位` : game.mode === 'pair' ? `分成 ${new Set(game.slots.map((s) => s.group)).size} 組` : `${n} 人排順序`)),
      h('div', { class: 'row' }, sfxToggle(), h('button', { class: 'icon-btn lad-close', 'aria-label': '關閉', onclick: () => finish(true) }, icon('x')))),
    h('div', { class: 'lad-board' }, topRow, h('div', { class: 'lad-svg-wrap' }, svg), bottomRow),
    counter, resultBox);
  document.body.append(stage);
  document.body.classList.add('lad-open');
  requestAnimationFrame(() => stage.classList.add('open'));

  let raf = 0, timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  function finish(closeIt) {
    cancelAnimationFrame(raf); timers.forEach(clearTimeout); timers = [];
    if (closeIt) { stage.classList.remove('open'); document.body.classList.remove('lad-open'); setTimeout(() => stage.remove(), 250); }
  }

  const slotLabel = (s) => s.kind === 'hit' ? ['🎯', '命中！'] : s.kind === 'safe' ? ['😌', '安全'] : s.kind === 'group' ? ['🤝', `第 ${s.group} 組`] : [s.rank === 1 ? '👑' : `#${s.rank}`, s.rank === 1 ? '第 1' : `第 ${s.rank}`];
  function reveal(p) {
    const s = game.slots[p.end];
    const box = slotEls[p.end];
    const [big, small] = slotLabel(s);
    box.classList.remove('masked');
    box.classList.add('open', s.kind);
    box.style.setProperty('--c', s.kind === 'group' ? GROUP_COLORS[(s.group - 1) % GROUP_COLORS.length] : p.color);
    mount(box, h('span', { class: 'lad-big' }, big), h('span', { class: 'lad-small' }, small), h('span', { class: 'lad-who' }, nameOf(p.id)));
    if (s.kind === 'hit' || (s.kind === 'rank' && s.rank === 1)) { burst(box, p.color); sfx.hit(); buzz([80, 40, 120]); }
    else { sfx.pop(revealed); buzz(20); }
    revealed++;
  }
  let revealed = 0;
  function burst(box, color) {
    if (reduced()) return;
    for (let i = 0; i < 14; i++) {
      const a = (Math.PI * 2 * i) / 14, d = 40 + Math.random() * 30;
      const sp = h('i', { class: 'lad-spark', style: `--x:${Math.cos(a) * d}px;--y:${Math.sin(a) * d - 20}px;background:${i % 2 ? color : '#FFD43B'}` });
      box.append(sp); setTimeout(() => sp.remove(), 900);
    }
  }
  function showResult() {
    const s = summarize(game, nameOf);
    const shareBtn = ctx.share ? h('button', { class: 'btn primary grow', onclick: async (e) => { e.currentTarget.disabled = true; if (await ctx.share(game)) e.currentTarget.textContent = '已分享'; else e.currentTarget.disabled = false; } }, icon('share', 18), '分享到群組') : null;
    mount(resultBox,
      h('div', { class: 'lad-card' },
        h('p', { class: 'lad-card-title' }, s.title),
        h('ul', {}, s.lines.map((l) => h('li', {}, l))),
        h('div', { class: 'row gap wrap' },
          shareBtn,
          h('button', { class: 'btn ghost grow', onclick: () => copyText(ladderText(game, nameOf, ctx.ledgerName), '已複製結果') }, icon('copy', 18), '複製'),
          h('button', { class: 'btn ghost grow', onclick: async () => { let g; try { g = await ctx.again(); } catch (e) { toast(e.message, 'err'); return; } finish(true); ladderStage(g, ctx); } }, '🔁 再來一次'),
          h('button', { class: 'btn text block', onclick: () => finish(true) }, '完成'))));
    resultBox.classList.add('show');
    sfx.win();
    buzz([40, 60, 40, 60, 120]);
  }

  // ---- 動畫：倒數 → 同時出發 → 依序抵達揭曉（全程約 5 秒）
  const RM = reduced();
  const COUNT_MS = RM ? 0 : 1100;
  const firstArrive = RM ? 400 : 2900, lastArrive = RM ? 600 : 3900;
  const arriveAt = players.map((_, i) => (n === 1 ? firstArrive : firstArrive + ((lastArrive - firstArrive) * i) / (n - 1)));
  // 抵達順序隨機，讓揭曉一格一格來
  const seq = players.map((_, i) => i).sort(() => Math.random() - 0.5);
  seq.forEach((pi, k) => (players[pi].dur = arriveAt[k]));
  players.forEach((p) => { p.path.style.strokeDasharray = `${p.total} ${p.total}`; p.path.style.strokeDashoffset = `${p.total}`; });

  const beats = RM ? [] : ['3', '2', '1', 'GO!'];
  beats.forEach((b, i) => later(() => {
    counter.textContent = b; counter.classList.remove('pop'); void counter.offsetWidth; counter.classList.add('pop');
    if (b === 'GO!') { sfx.go(); buzz([60, 40, 60]); } else { sfx.beep(); buzz(25); }
  }, i * (COUNT_MS / beats.length)));
  later(() => { counter.textContent = ''; stage.classList.add('running'); if (!RM) sfx.riser(lastArrive / 1000); run(); }, COUNT_MS);

  function run() {
    const t0 = performance.now();
    const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2) * 0.35 + x * 0.65;
    let lastTick = 0;
    const frame = (now) => {
      let done = 0;
      for (const p of players) {
        const t = Math.min(1, (now - t0) / p.dur);
        const len = p.total * ease(t);
        p.path.style.strokeDashoffset = `${p.total - len}`;
        const pt = p.path.getPointAtLength(len);
        p.head.setAttribute('cx', pt.x); p.head.setAttribute('cy', pt.y);
        for (const ev of p.events) if (!ev.done && len >= ev.len) {
          ev.done = true; rungEls[ev.rung].classList.add('on'); rungEls[ev.rung].style.stroke = p.color;
          if (now - lastTick > 45) { lastTick = now; sfx.tick(ev.rung); buzz(8); }
        }
        if (t >= 1) { done++; if (!p.arrived) { p.arrived = true; p.head.classList.add('arrived'); reveal(p); } }
      }
      fog.style.opacity = String(Math.max(0, 1 - (now - t0) / lastArrive));
      if (done < players.length) raf = requestAnimationFrame(frame);
      else { stage.classList.remove('running'); stage.classList.add('done'); rungEls.forEach((e) => e.classList.add('dim')); later(showResult, 500); }
    };
    raf = requestAnimationFrame(frame);
  }
}
