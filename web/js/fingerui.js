// 手指抽籤：每人一根手指放上螢幕 → 3 秒倒數鎖定 → 5 秒內揭曉（命運／配對／優先權，模式同爬梯子）
import { h, mount, icon, sheet } from './ui.js';
import { LADDER_MODES, fingerDraw } from './ladder.js';
import { sfx, buzz, sfxUnlock, sfxToggle } from './sfx.js';

const FG_COLORS = ['#FF4D6D', '#FFB020', '#38D9A9', '#4DABF7', '#B197FC', '#FF8CC6', '#FFD43B', '#63E6BE', '#74C0FC', '#DA77F2', '#A9E34B', '#FF922B'];
const FG_PETS = [['🐱', '小貓'], ['🐶', '小狗'], ['🐰', '小兔'], ['🐼', '熊貓'], ['🦊', '狐狸'], ['🐸', '青蛙'], ['🐯', '老虎'], ['🐨', '無尾熊'], ['🐷', '小豬'], ['🐵', '猴子'], ['🐧', '企鵝'], ['🐹', '倉鼠']];
const FG_GROUP_COLORS = ['#FF4D6D', '#4DABF7', '#38D9A9', '#FFB020', '#B197FC', '#FF8CC6'];
const FG_MAX = FG_COLORS.length;
const FG_KEY = 'sharing-finger-v1';
const FG_LOCK_MS = 3000;
const fgReduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const fgBounds = (mode) => (mode === 'pair' ? [2, FG_GROUP_COLORS.length] : [1, FG_MAX - 1]);

/** 設定抽屜：選模式與人數／組數（參加的人數以放上來的手指為準） */
export function fingerSetup() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(FG_KEY)) || {}; } catch { /* 無痕模式 */ }
  let mode = LADDER_MODES[saved.mode] ? saved.mode : 'fate';
  let count = Number(saved.count) || (mode === 'pair' ? 2 : 1);
  const body = h('div', { class: 'form finger-setup' });
  const draw = () => {
    const [lo, hi] = fgBounds(mode);
    count = Math.min(Math.max(lo, count), hi);
    mount(body,
      h('div', { class: 'fg-intro' },
        h('span', { class: 'fg-intro-hand', 'aria-hidden': 'true' }, '☝️'),
        h('p', {}, '大家各放 ', h('b', {}, '一根手指'), ' 在螢幕上，', h('b', {}, '3 秒'), '後鎖定，', h('b', {}, '5 秒'), '內揭曉！')),
      h('span', { class: 'field-label' }, '模式'),
      h('div', { class: 'seg' }, Object.entries(LADDER_MODES).map(([k, v]) => h('button', {
        class: mode === k ? 'on' : '', 'aria-pressed': String(mode === k),
        onclick: () => { mode = k; count = k === 'pair' ? 2 : 1; draw(); },
      }, v.name))),
      h('p', { class: 'hint' }, { fate: '從放上來的手指裡選出幾位', pair: '把放上來的手指分成幾組', priority: '替每根手指排出第 1 到最後的順序' }[mode]),
      mode === 'priority' ? null : h('div', { class: 'stepper' },
        h('span', {}, mode === 'fate' ? '選出' : '分成'),
        h('button', { class: 'icon-btn step', 'aria-label': '減少', disabled: count <= lo, onclick: () => { count--; draw(); } }, '−'),
        h('strong', { 'aria-live': 'polite' }, count),
        h('button', { class: 'icon-btn step', 'aria-label': '增加', disabled: count >= hi, onclick: () => { count++; draw(); } }, '+'),
        h('span', {}, mode === 'fate' ? '位' : '組')),
      h('p', { class: 'hint' }, mode === 'priority' ? '至少要 2 根手指。' : `至少要 2 根手指；${mode === 'fate' ? '選出的人數' : '組數'}比手指多時會自動調整。人很多時，有些手機一次只偵測得到約 5 根手指。`),
      h('button', { class: 'btn primary block fg-start', onclick: () => {
        try { localStorage.setItem(FG_KEY, JSON.stringify({ mode, count })); } catch { /* 無痕模式 */ }
        sfxUnlock();
        close();
        fingerStage({ mode, count });
      } }, '☝️ 開始手指抽籤！'));
  };
  draw();
  const close = sheet('手指抽籤', body);
}

/** 全螢幕抽籤畫面 */
export function fingerStage({ mode, count }) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const RM = fgReduced();
  const dots = new Map();
  let state = 'wait'; // wait → count → lock → draw → done
  let needTwo = false;
  let mouseSeq = 0, cdStart = 0, lastBeat = 0, raf = 0, timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  const links = document.createElementNS(svgNS, 'svg');
  links.setAttribute('class', 'fg-links');
  const pad = h('div', { class: 'fg-pad', 'aria-label': '把手指放在這裡' }, links);
  const hero = h('div', { class: 'fg-hero', 'aria-hidden': 'true' }, h('i'), h('i'), h('span', {}, '☝️'));
  const big = h('div', { class: 'fg-big', 'aria-hidden': 'true' });
  const flash = h('div', { class: 'fg-flash', 'aria-hidden': 'true' });
  const bar = h('div', { class: 'fg-bar', 'aria-hidden': 'true' }, h('i'));
  const prompt = h('div', { class: 'fg-prompt', 'aria-live': 'polite' });
  const countChip = h('span', { class: 'fg-count' }, '0 人');
  const result = h('div', { class: 'fg-result', 'aria-live': 'polite' });
  const sub = mode === 'fate' ? `選出 ${count} 位` : mode === 'pair' ? `分成 ${count} 組` : '排出順序';
  const stage = h('div', { class: `finger-stage mode-${mode}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': '手指抽籤' },
    pad, hero, big, flash,
    h('header', { class: 'fg-head' },
      h('div', {}, h('strong', {}, `☝️ ${LADDER_MODES[mode].name}手指抽籤`), h('small', {}, sub)),
      h('div', { class: 'row gap' }, countChip, sfxToggle(), h('button', { class: 'icon-btn fg-close', 'aria-label': '關閉', onclick: () => finish() }, icon('x')))),
    bar, prompt, result);

  // ---- 手指（觸控）與滑鼠（點一下新增、再點一下拿掉）
  const freeIdx = () => { const used = new Set([...dots.values()].map((d) => d.idx)); for (let i = 0; i < FG_MAX; i++) if (!used.has(i)) return i; return -1; };
  const place = (d) => { d.el.style.transform = `translate(${d.x}px,${d.y}px)`; d.el.classList.toggle('flip', d.y < 190); };
  function addDot(key, x, y, sticky) {
    const idx = freeIdx();
    if (idx < 0) return;
    const [emo, name] = FG_PETS[idx];
    const badge = h('span', { class: 'fg-badge' });
    const el = h('div', { class: 'fg-dot', style: `--c:${FG_COLORS[idx]}`, role: 'img', 'aria-label': name },
      h('span', { class: 'fg-ring' }), h('span', { class: 'fg-core' }, emo), h('span', { class: 'fg-tag' }, badge));
    const d = { key, idx, x, y, el, badge, sticky, down: true, color: FG_COLORS[idx], emo, name };
    place(d);
    pad.append(el);
    dots.set(key, d);
    sfx.pop(idx);
    buzz(15);
    changed();
  }
  function removeDot(key) {
    const d = dots.get(key);
    if (!d) return;
    dots.delete(key);
    d.el.classList.add('bye');
    setTimeout(() => d.el.remove(), 200);
    changed();
  }
  const collecting = () => state === 'wait' || state === 'count';
  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    sfxUnlock();
    if (!collecting()) return;
    if (e.pointerType === 'mouse') {
      const hit = [...dots.values()].find((d) => d.sticky && Math.hypot(d.x - e.clientX, d.y - e.clientY) < 50);
      if (hit) removeDot(hit.key); else addDot(`m${++mouseSeq}`, e.clientX, e.clientY, true);
      return;
    }
    addDot(e.pointerId, e.clientX, e.clientY, false);
  });
  pad.addEventListener('pointermove', (e) => {
    const d = dots.get(e.pointerId);
    if (!d || !d.down || d.sticky) return;
    d.x = e.clientX; d.y = e.clientY; place(d);
    if (state === 'done' && mode === 'pair') drawLinks();
  });
  const lift = (e) => {
    const d = dots.get(e.pointerId);
    if (!d || d.sticky) return;
    d.down = false;
    if (collecting()) removeDot(e.pointerId); else d.el.classList.add('lifted');
  };
  pad.addEventListener('pointerup', lift);
  pad.addEventListener('pointercancel', lift);
  pad.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  pad.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---- 狀態
  function say(main, small = '') { mount(prompt, main ? h('strong', {}, main) : null, small ? h('small', {}, small) : null); }
  function changed() {
    const n = dots.size;
    countChip.textContent = `${n} 人`;
    stage.classList.toggle('has-fingers', n > 0);
    if (state === 'wait' && n >= (needTwo ? 2 : 1)) startCount();
    else if (state === 'count' && n === 0) { cancelAnimationFrame(raf); state = 'wait'; needTwo = false; stage.classList.remove('counting'); big.textContent = ''; }
    if (state === 'wait') say(needTwo ? '還差一位！至少要 2 根手指' : '每人一根手指，放上來！', needTwo ? '再放一根手指就會重新倒數' : '放上後 3 秒自動鎖定');
  }
  function beat(text) { big.textContent = text; big.classList.remove('pop'); void big.offsetWidth; big.classList.add('pop'); }
  function startCount() {
    state = 'count';
    stage.classList.add('counting');
    cdStart = performance.now();
    lastBeat = 0;
    say('還可以加入…', '手指按住不要放開');
    const tick = (now) => {
      if (state !== 'count') return;
      const left = Math.max(0, FG_LOCK_MS - (now - cdStart));
      bar.firstChild.style.transform = `scaleX(${left / FG_LOCK_MS})`;
      const sec = Math.ceil(left / 1000);
      if (sec !== lastBeat && sec > 0) { lastBeat = sec; beat(String(sec)); sfx.beep(); buzz(25); }
      if (left > 0) { raf = requestAnimationFrame(tick); return; }
      stage.classList.remove('counting');
      if (dots.size >= 2) lock();
      else { state = 'wait'; needTwo = true; big.textContent = ''; changed(); }
    };
    raf = requestAnimationFrame(tick);
  }

  function lock() {
    state = 'lock';
    const list = [...dots.values()].sort((a, b) => a.idx - b.idx);
    const slots = fingerDraw(mode, list.length, count);
    list.forEach((d, i) => { d.slot = slots[i]; });
    stage.classList.add('locked');
    beat(`鎖定 ${list.length} 人！`);
    say('鎖定！', '接下來加入的手指不算喔');
    sfx.hit();
    sfx.go();
    buzz([60, 40, 60]);
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    later(() => shuffle(list), RM ? 200 : 650);
  }

  // 亮點在手指間亂跳、越跳越慢（約 2.2 秒）
  function shuffle(list) {
    state = 'draw';
    big.textContent = '';
    stage.classList.add('drawing');
    say('抽籤中… 🔥');
    let t = 0;
    if (!RM) sfx.riser(2.2);
    if (!RM) {
      let gap = 60, last = -1;
      while (t < 2200) {
        later(() => {
          let k;
          do k = Math.floor(Math.random() * list.length); while (k === last);
          last = k;
          list.forEach((d, i) => d.el.classList.toggle('hot', i === k));
          sfx.tick(k);
          buzz(8);
        }, t);
        t += gap; gap *= 1.12;
      }
    }
    later(() => { list.forEach((d) => d.el.classList.remove('hot')); stage.classList.remove('drawing'); reveal(list); }, t);
  }

  function reveal(list) {
    const n = list.length;
    let end = 0;
    const step = (i, total, spread) => (RM ? 0 : i * Math.min(spread / Math.max(1, total), 380));
    if (mode === 'fate') {
      const wins = list.filter((d) => d.slot.kind === 'hit');
      wins.forEach((d, i) => later(() => { d.el.classList.add('win'); d.badge.textContent = '🎯 就是你！'; burst(d); sfx.hit(); buzz([80, 40, 120]); }, step(i, wins.length, 1100)));
      end = step(wins.length - 1, wins.length, 1100);
      later(() => list.filter((d) => d.slot.kind !== 'hit').forEach((d) => { d.el.classList.add('lose'); d.badge.textContent = '😌 安全'; }), end + 150);
      end += 150;
    } else if (mode === 'pair') {
      const groups = [...new Set(list.map((d) => d.slot.group))].sort((a, b) => a - b);
      groups.forEach((g, i) => later(() => {
        list.filter((d) => d.slot.group === g).forEach((d) => {
          d.color = FG_GROUP_COLORS[(g - 1) % FG_GROUP_COLORS.length];
          d.el.style.setProperty('--c', d.color);
          d.el.classList.add('grouped');
          d.badge.textContent = `🤝 第 ${g} 組`;
        });
        drawLinks();
        sfx.pop(i * 3);
        buzz([40, 30, 40]);
      }, step(i, groups.length, 1300)));
      end = step(groups.length - 1, groups.length, 1300);
    } else {
      const ranked = [...list].sort((a, b) => a.slot.rank - b.slot.rank);
      ranked.forEach((d, i) => later(() => {
        d.el.classList.add('ranked');
        d.badge.textContent = d.slot.rank === 1 ? '👑 第 1' : `第 ${d.slot.rank}`;
        if (d.slot.rank === 1) { d.el.classList.add('win'); burst(d); sfx.hit(); buzz([80, 40, 120]); } else { sfx.pop(n - d.slot.rank); buzz(20); }
      }, step(i, n, 1400)));
      end = step(n - 1, n, 1400);
    }
    later(() => { state = 'done'; stage.classList.add('done'); say(''); showResult(list); sfx.win(); buzz([40, 60, 40, 60, 120]); }, end + 550);
  }

  function drawLinks() {
    links.replaceChildren();
    const byGroup = {};
    for (const d of dots.values()) if (d.el.classList.contains('grouped')) (byGroup[d.slot.group] = byGroup[d.slot.group] || []).push(d);
    for (const [g, arr] of Object.entries(byGroup)) {
      arr.sort((a, b) => a.idx - b.idx);
      for (let i = 1; i < arr.length; i++) {
        const l = document.createElementNS(svgNS, 'line');
        l.setAttribute('x1', arr[i - 1].x); l.setAttribute('y1', arr[i - 1].y);
        l.setAttribute('x2', arr[i].x); l.setAttribute('y2', arr[i].y);
        l.setAttribute('class', 'fg-link');
        l.setAttribute('stroke', FG_GROUP_COLORS[(g - 1) % FG_GROUP_COLORS.length]);
        links.append(l);
      }
    }
  }

  function burst(d) {
    if (RM) return;
    for (let i = 0; i < 18; i++) {
      const a = (Math.PI * 2 * i) / 18, r = 70 + Math.random() * 50;
      const sp = h('i', { class: 'fg-spark', style: `--x:${Math.cos(a) * r}px;--y:${Math.sin(a) * r}px;background:${i % 3 ? d.color : '#FFD43B'}` });
      d.el.append(sp);
      setTimeout(() => sp.remove(), 950);
    }
  }

  const pet = (d) => h('span', { class: 'fg-pet', style: `--c:${d.color}` }, d.emo, d.name);
  function showResult(list) {
    let title, lines;
    if (mode === 'fate') {
      const wins = list.filter((d) => d.slot.kind === 'hit');
      title = `🎯 選中 ${wins.length} 位`;
      lines = [h('li', { class: 'fg-pets' }, wins.map(pet))];
    } else if (mode === 'pair') {
      const groups = [...new Set(list.map((d) => d.slot.group))].sort((a, b) => a - b);
      title = `🤝 分成 ${groups.length} 組`;
      lines = groups.map((g) => h('li', { class: 'fg-pets' }, h('b', { style: `color:${FG_GROUP_COLORS[(g - 1) % FG_GROUP_COLORS.length]}` }, `第 ${g} 組`), list.filter((d) => d.slot.group === g).map(pet)));
    } else {
      title = '🏁 優先順序';
      lines = [h('li', { class: 'fg-pets' }, [...list].sort((a, b) => a.slot.rank - b.slot.rank).map((d) => h('span', { class: 'fg-rank' }, h('b', {}, d.slot.rank), pet(d))))];
    }
    mount(result, h('div', { class: 'fg-card' },
      h('p', { class: 'fg-card-title' }, title),
      h('ul', {}, lines),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn primary grow', onclick: reset }, '🔁 再來一次'),
        h('button', { class: 'btn ghost grow', onclick: () => finish() }, '完成'))));
    // 結果卡放在上方或下方，看哪邊蓋到的手指（含上方標籤）比較少
    result.classList.add('at-top');
    const top = result.getBoundingClientRect();
    result.classList.remove('at-top');
    const bottom = result.getBoundingClientRect();
    const hidden = (r) => list.filter((d) => {
      const [a, b] = d.y < 190 ? [d.y - 62, d.y + 112] : [d.y - 128, d.y + 62];
      return a < r.bottom - 30 && b > r.top + 30;
    }).length;
    result.classList.toggle('at-top', hidden(top) < hidden(bottom));
    result.classList.add('show');
  }

  function reset() {
    cancelAnimationFrame(raf);
    timers.forEach(clearTimeout); timers = [];
    dots.forEach((d) => d.el.remove()); dots.clear();
    links.replaceChildren();
    result.classList.remove('show', 'at-top'); result.replaceChildren();
    big.textContent = '';
    stage.classList.remove('counting', 'locked', 'drawing', 'done', 'has-fingers');
    state = 'wait'; needTwo = false;
    changed();
  }
  const onKey = (e) => { if (e.key === 'Escape') finish(); };
  function finish() {
    cancelAnimationFrame(raf);
    timers.forEach(clearTimeout); timers = [];
    document.removeEventListener('keydown', onKey);
    stage.classList.remove('open');
    document.body.classList.remove('lad-open');
    setTimeout(() => stage.remove(), 250);
  }

  document.body.append(stage);
  document.body.classList.add('lad-open');
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => stage.classList.add('open'));
  changed();
  return { finish };
}
