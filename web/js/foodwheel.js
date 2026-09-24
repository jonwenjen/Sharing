// 吃什麼轉盤：選好候選清單 → 大轉盤 → 揭曉，可以直接「就吃這個」記一筆
import { h, mount, icon, toast, sheet } from './ui.js';

export const DEFAULT_FOODS = [
  ['牛肉麵', '🍜'], ['滷肉飯', '🍚'], ['雞排', '🍗'], ['鹽酥雞', '🍢'], ['小籠包', '🥟'],
  ['水煎包', '🥯'], ['蚵仔煎', '🍳'], ['蚵仔麵線', '🍝'], ['臭豆腐', '🧆'], ['肉圓', '🍡'],
  ['刈包', '🥙'], ['蔥油餅', '🫓'], ['鍋貼', '🥠'], ['麻辣鍋', '🍲'], ['薑母鴨', '🦆'],
  ['滷味', '🍢'], ['便當', '🍱'], ['炒飯', '🥘'], ['咖哩飯', '🍛'], ['拉麵', '🍜'],
  ['壽司', '🍣'], ['天丼', '🍤'], ['燒肉', '🥓'], ['牛排', '🥩'], ['披薩', '🍕'],
  ['漢堡', '🍔'], ['炸雞', '🍗'], ['義大利麵', '🍝'], ['韓式炸雞', '🐔'], ['石鍋拌飯', '🥗'],
  ['泰式打拋', '🌶️'], ['越南河粉', '🥣'], ['鐵板燒', '🔥'], ['早午餐', '🥞'], ['三明治', '🥪'],
  ['關東煮', '🍥'], ['豆花', '🍮'], ['剉冰', '🍧'], ['珍珠奶茶', '🧋'], ['鬆餅', '🧇'],
];
const SLICE_COLORS = ['#FF5C7A', '#FF9F43', '#FFD23F', '#3DDC97', '#4DABF7', '#9775FA', '#FF8CC6', '#20C997'];
const FOOD_KEY = 'sharing-food-v1';
const fwReduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const fwRand = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 2 ** 32; };

function loadFoodPrefs() { try { return JSON.parse(localStorage.getItem(FOOD_KEY)) || { off: [], custom: [] }; } catch { return { off: [], custom: [] }; } }
function saveFoodPrefs(p) { try { localStorage.setItem(FOOD_KEY, JSON.stringify(p)); } catch { /* 無痕模式 */ } }

/**
 * @param {{ onPick?: (name:string) => void }} ctx onPick：按「就吃這個」時呼叫（例如開啟記一筆）
 */
export function foodSetup(ctx = {}) {
  const prefs = loadFoodPrefs();
  const all = () => [...DEFAULT_FOODS, ...prefs.custom.map((n) => [n, '🍽️'])];
  const off = new Set(prefs.off);
  const body = h('div', { class: 'form food-setup' });
  const addInput = h('input', { class: 'input', placeholder: '加入自己的選項，例如：巷口麵店', maxlength: 12, onkeydown: (e) => e.key === 'Enter' && addCustom() });
  const persist = () => { prefs.off = [...off]; saveFoodPrefs(prefs); };
  function addCustom() {
    const v = addInput.value.trim();
    if (!v) return;
    if (all().some(([n]) => n === v)) { toast('已經有這個選項了'); return; }
    prefs.custom.push(v); off.delete(v); persist(); addInput.value = ''; draw(); addInput.focus();
  }
  function draw() {
    const items = all();
    const onCount = items.filter(([n]) => !off.has(n)).length;
    mount(body,
      h('div', { class: 'food-top' },
        h('span', { class: 'food-count' }, h('strong', {}, onCount), ` / ${items.length} 個候選`),
        h('div', { class: 'row gap' },
          h('button', { class: 'chip', onclick: () => { off.clear(); persist(); draw(); } }, '✅ 全選'),
          h('button', { class: 'chip', onclick: () => { items.forEach(([n]) => off.add(n)); persist(); draw(); } }, '⬜ 全部取消'))),
      h('div', { class: 'food-grid', role: 'group', 'aria-label': '候選餐點' }, items.map(([n, e]) => {
        const on = !off.has(n);
        const isCustom = prefs.custom.includes(n);
        return h('button', {
          class: `food-card ${on ? 'on' : ''}`, 'aria-pressed': String(on), 'aria-label': n,
          onclick: () => { on ? off.add(n) : off.delete(n); persist(); draw(); },
        }, h('span', { class: 'food-emoji' }, e), h('span', { class: 'food-name' }, n),
        isCustom ? h('span', { class: 'food-del', role: 'button', 'aria-label': `刪除 ${n}`, onclick: (ev) => { ev.stopPropagation(); prefs.custom = prefs.custom.filter((x) => x !== n); off.delete(n); persist(); draw(); } }, '×') : null);
      })),
      h('div', { class: 'row gap' }, addInput, h('button', { class: 'btn ghost', onclick: addCustom }, icon('plus', 18), '加入')),
      onCount < 2 ? h('p', { class: 'hint neg' }, '至少要選 2 個才能轉喔') : null,
      h('button', { class: 'btn primary block food-go', disabled: onCount < 2, onclick: () => { close(); foodStage(items.filter(([n]) => !off.has(n)), ctx); } }, '🎡 轉起來！'));
  }
  draw();
  const close = sheet('吃什麼轉盤', body, { tall: true });
}

/** 全螢幕轉盤 */
export function foodStage(items, ctx = {}) {
  let list = items.slice();
  let rotation = 0;
  let spinning = false;
  const size = Math.min(window.innerWidth - 40, 360);
  const R = size / 2;
  const svgNS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => { const e = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
  const wheelWrap = h('div', { class: 'fw-wheel-wrap', style: `width:${size}px;height:${size}px` });
  const face = h('div', { class: 'fw-pointer', 'aria-hidden': 'true' }, h('span', { class: 'fw-face' }, '😋'));
  const hub = h('button', { class: 'fw-hub', 'aria-label': '轉動轉盤', onclick: () => spin() }, '轉！');
  const resultBox = h('div', { class: 'fw-result', 'aria-live': 'polite' });
  const tip = h('p', { class: 'fw-tip' }, `${list.length} 個候選，按中間的「轉！」`);
  let g;

  function drawWheel() {
    const n = list.length;
    const a = (Math.PI * 2) / n;
    const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'fw-svg', role: 'img', 'aria-label': '吃什麼轉盤' });
    g = el('g', { class: 'fw-rot', style: `transform-origin:${R}px ${R}px;transform:rotate(${rotation}deg)` });
    const showNames = n <= 14;
    list.forEach(([name, emoji], i) => {
      const s = -Math.PI / 2 + i * a, e = s + a;
      const r = R - 6;
      const x1 = R + r * Math.cos(s), y1 = R + r * Math.sin(s), x2 = R + r * Math.cos(e), y2 = R + r * Math.sin(e);
      // 最後一片若和第一片同色就換一個顏色
      const color = i === n - 1 && n % SLICE_COLORS.length === 1 ? SLICE_COLORS[3] : SLICE_COLORS[i % SLICE_COLORS.length];
      g.append(el('path', { d: `M${R},${R} L${x1},${y1} A${r},${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x2},${y2} Z`, fill: color, stroke: '#fff', 'stroke-width': 2 }));
      const mid = s + a / 2;
      const deg = (mid * 180) / Math.PI + 90;
      const er = r * (showNames ? 0.78 : 0.84);
      const t = el('text', { x: R + er * Math.cos(mid), y: R + er * Math.sin(mid), 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'fw-emoji', transform: `rotate(${deg} ${R + er * Math.cos(mid)} ${R + er * Math.sin(mid)})`, 'font-size': Math.max(13, Math.min(30, (r * a) * 0.55)) });
      t.textContent = emoji;
      g.append(t);
      if (showNames) {
        const nr = r * 0.52;
        const tx = el('text', { x: R + nr * Math.cos(mid), y: R + nr * Math.sin(mid), 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'fw-label', transform: `rotate(${deg} ${R + nr * Math.cos(mid)} ${R + nr * Math.sin(mid)})` });
        tx.textContent = name.length > 5 ? name.slice(0, 5) + '…' : name;
        g.append(tx);
      }
    });
    svg.append(el('circle', { cx: R, cy: R, r: R - 3, fill: 'none', stroke: '#fff', 'stroke-width': 6 }), g);
    // 外圈小燈
    const lights = el('g', { class: 'fw-lights' });
    for (let i = 0; i < 24; i++) { const ang = (i / 24) * Math.PI * 2; lights.append(el('circle', { cx: R + (R - 3) * Math.cos(ang), cy: R + (R - 3) * Math.sin(ang), r: 3.5, class: i % 2 ? 'odd' : 'even' })); }
    svg.append(lights);
    mount(wheelWrap, svg, face, hub);
  }

  function spin() {
    if (spinning || list.length < 2) return;
    spinning = true;
    stage.classList.add('spinning');
    resultBox.classList.remove('show');
    face.firstChild.textContent = '🤤';
    tip.textContent = '轉呀轉～';
    const n = list.length;
    const a = 360 / n;
    const pick = Math.floor(fwRand() * n);
    const jitter = (fwRand() - 0.5) * a * 0.6;
    const current = ((rotation % 360) + 360) % 360;
    const target = (360 - (pick + 0.5) * a + jitter + 360) % 360;
    const turns = fwReduced() ? 1 : 6 + Math.floor(fwRand() * 2);
    rotation += turns * 360 + ((target - current + 360) % 360);
    const dur = fwReduced() ? 600 : 4200;
    g.style.transition = `transform ${dur}ms cubic-bezier(.12,.72,.14,1)`;
    g.style.transform = `rotate(${rotation}deg)`;
    setTimeout(() => done(list[pick]), dur + 80);
  }

  function done([name, emoji]) {
    spinning = false;
    stage.classList.remove('spinning');
    face.firstChild.textContent = '😍';
    tip.textContent = '';
    burst();
    mount(resultBox, h('div', { class: 'fw-card' },
      h('span', { class: 'fw-big' }, emoji),
      h('p', { class: 'fw-say' }, '今天就吃'),
      h('p', { class: 'fw-name' }, `${name}！`),
      h('div', { class: 'fw-actions' },
        ctx.onPick ? h('button', { class: 'btn primary grow', onclick: () => { finish(); ctx.onPick(name); } }, '✅ 就吃這個，記一筆') : null,
        h('button', { class: 'btn ghost grow', onclick: spin }, '🔁 再轉一次'),
        list.length > 2 ? h('button', { class: 'btn ghost grow', onclick: () => { list = list.filter(([n]) => n !== name); rotation = 0; drawWheel(); resultBox.classList.remove('show'); tip.textContent = `已拿掉「${name}」，剩 ${list.length} 個`; setTimeout(spin, 250); } }, `🙅 不要${name}`) : null,
        h('button', { class: 'btn text block', onclick: finish }, '完成'))));
    resultBox.classList.add('show');
  }

  function burst() {
    if (fwReduced()) return;
    const box = h('div', { class: 'fw-confetti', 'aria-hidden': 'true' });
    for (let i = 0; i < 28; i++) {
      const x = (fwRand() - 0.5) * 320, y = -120 - fwRand() * 180;
      box.append(h('i', { style: `--x:${x}px;--y:${y}px;--r:${fwRand() * 720}deg;background:${SLICE_COLORS[i % SLICE_COLORS.length]};animation-delay:${fwRand() * 120}ms` }));
    }
    stage.append(box);
    setTimeout(() => box.remove(), 1400);
  }

  function finish() {
    stage.classList.remove('open');
    document.body.classList.remove('lad-open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => stage.remove(), 250);
  }
  const onKey = (e) => { if (e.key === 'Escape') finish(); };

  const stage = h('div', { class: 'food-stage', role: 'dialog', 'aria-modal': 'true', 'aria-label': '吃什麼轉盤' },
    h('header', { class: 'fw-head' },
      h('div', {}, h('strong', {}, '🍱 今天吃什麼？'), h('small', {}, '交給命運決定！')),
      h('button', { class: 'icon-btn fw-close', 'aria-label': '關閉', onclick: finish }, icon('x'))),
    wheelWrap, tip, resultBox);
  drawWheel();
  document.body.append(stage);
  document.body.classList.add('lad-open');
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => stage.classList.add('open'));
  return { spin };
}
