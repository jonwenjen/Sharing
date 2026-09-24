// 吃什麼轉盤：選大項（餐點／小吃／飲料／甜點）→ 挑細項 → 大轉盤 → 揭曉後回到主畫面，可以直接記一筆
import { h, mount, icon, toast, sheet } from './ui.js';

// 大項：cat＝「記一筆」時預設的記帳分類；sections＝細項分區 [區名, [[名稱, emoji], ...]]
export const FOOD_GROUPS = [
  { id: 'meal', name: '餐點', icon: '🍱', verb: '吃', cat: 'food', sections: [
    ['正餐料理', [
      ['牛肉麵', '🍜'], ['便當', '🍱'], ['自助餐', '🍛'], ['炒飯', '🥘'], ['咖哩飯', '🍛'], ['拉麵', '🍜'],
      ['壽司', '🍣'], ['天丼', '🍤'], ['燒肉', '🥓'], ['牛排', '🥩'], ['麻辣鍋', '🍲'], ['薑母鴨', '🦆'],
      ['義大利麵', '🍝'], ['韓式炸雞', '🐔'], ['石鍋拌飯', '🥗'], ['泰式打拋', '🌶️'], ['越南河粉', '🥣'], ['鐵板燒', '🔥'],
      ['早午餐', '🥞'],
    ]],
    ['速食連鎖', [
      ['麥當勞', '🍔'], ['肯德基', '🍗'], ['摩斯漢堡', '🍔'], ['漢堡王', '👑'], ['頂呱呱', '🍗'], ['丹丹漢堡', '🍔'],
      ['必勝客', '🍕'], ['達美樂', '🍕'], ['拿坡里', '🍕'], ['Subway', '🥖'], ['胖老爹', '🍗'], ['八方雲集', '🥟'],
      ['三商巧福', '🍜'], ['爭鮮', '🍣'],
    ]],
    ['超商', [['7-ELEVEN', '🏪'], ['全家', '🏪'], ['萊爾富', '🏪'], ['OK超商', '🏪']]],
  ] },
  { id: 'snack', name: '小吃', icon: '🍢', verb: '吃', cat: 'food', sections: [
    ['台灣小吃', [
      ['滷肉飯', '🍚'], ['雞排', '🍗'], ['鹽酥雞', '🍢'], ['小籠包', '🥟'], ['水煎包', '🥯'], ['蚵仔煎', '🍳'],
      ['蚵仔麵線', '🍝'], ['臭豆腐', '🧆'], ['肉圓', '🍡'], ['刈包', '🥙'], ['蔥油餅', '🫓'], ['鍋貼', '🥠'],
      ['滷味', '🍢'], ['關東煮', '🍥'], ['炸雞', '🍗'], ['三明治', '🥪'], ['大腸包小腸', '🌭'], ['胡椒餅', '🫓'],
      ['肉粽', '🍙'], ['碗粿', '🥣'], ['米糕', '🍙'], ['擔仔麵', '🍜'], ['牛肉湯', '🥩'], ['虱目魚粥', '🐟'],
    ]],
  ] },
  { id: 'drink', name: '飲料', icon: '🧋', verb: '喝', cat: 'drink', sections: [
    ['南部起家', [
      ['50嵐', '🧋'], ['清心福全', '🧋'], ['迷客夏', '🥛'], ['茶の魔手', '🍵'], ['翰林茶館', '🧋'], ['雙全紅茶', '🥤'], ['樺達奶茶', '🥛'],
    ]],
    ['人氣連鎖', [
      ['可不可熟成紅茶', '🥤'], ['龜記', '🍵'], ['麻古茶坊', '🍹'], ['五桐號', '🧋'], ['得正', '🍵'], ['CoCo都可', '🧋'],
      ['萬波島嶼紅茶', '🥤'], ['星巴克', '☕'], ['路易莎', '☕'], ['85度C', '☕'],
    ]],
    ['常見飲品', [
      ['珍珠奶茶', '🧋'], ['鮮奶茶', '🥛'], ['紅茶', '🥤'], ['綠茶', '🍵'], ['冬瓜茶', '🥤'], ['檸檬綠茶', '🍋'],
      ['多多綠', '🍶'], ['楊桃湯', '🍹'], ['木瓜牛奶', '🥛'], ['青草茶', '🌿'], ['咖啡', '☕'], ['果汁', '🧃'], ['豆漿', '🥛'],
    ]],
  ] },
  { id: 'dessert', name: '甜點', icon: '🍰', verb: '吃', cat: 'dessert', sections: [
    ['甜點', [
      ['豆花', '🍮'], ['剉冰', '🍧'], ['芒果冰', '🥭'], ['雪花冰', '🍧'], ['燒仙草', '🍵'], ['鬆餅', '🧇'],
      ['紅豆餅', '🫘'], ['雞蛋糕', '🥚'], ['鯛魚燒', '🐟'], ['蛋塔', '🥧'], ['麻糬', '🍡'], ['布丁', '🍮'],
      ['蛋糕', '🍰'], ['冰淇淋', '🍦'], ['甜甜圈', '🍩'], ['可麗餅', '🌯'],
    ]],
  ] },
];
// 相容舊版：全部細項攤平
export const DEFAULT_FOODS = FOOD_GROUPS.flatMap((g) => g.sections.flatMap(([, items]) => items));
export const foodGroupOf = (id) => FOOD_GROUPS.find((g) => g.id === id) || FOOD_GROUPS[0];

const SLICE_COLORS = ['#FF5C7A', '#FF9F43', '#FFD23F', '#3DDC97', '#4DABF7', '#9775FA', '#FF8CC6', '#20C997'];
const FOOD_KEY = 'sharing-food-v2';
const FOOD_KEY_V1 = 'sharing-food-v1';
const fwReduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const fwRand = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 2 ** 32; };

// 偏好（存在這支手機）：{ group, off: {大項: [名稱]}, custom: {大項: [名稱]} }
function fwEmptyPrefs() { return { group: FOOD_GROUPS[0].id, off: {}, custom: {} }; }
function loadFoodPrefs() {
  try {
    const v2 = JSON.parse(localStorage.getItem(FOOD_KEY));
    if (v2 && v2.off && v2.custom) return v2;
    // 舊版（一層清單）→ 依名稱歸到各大項，自訂的放到「餐點」
    const v1 = JSON.parse(localStorage.getItem(FOOD_KEY_V1));
    const p = fwEmptyPrefs();
    if (v1) {
      for (const g of FOOD_GROUPS) {
        const names = new Set(g.sections.flatMap(([, items]) => items.map(([n]) => n)));
        const off = (v1.off || []).filter((n) => names.has(n));
        if (off.length) p.off[g.id] = off;
      }
      const custom = (v1.custom || []).filter(Boolean);
      if (custom.length) {
        p.custom.meal = custom;
        const offCustom = (v1.off || []).filter((n) => custom.includes(n));
        if (offCustom.length) p.off.meal = [...(p.off.meal || []), ...offCustom];
      }
    }
    return p;
  } catch { return fwEmptyPrefs(); }
}
function saveFoodPrefs(p) { try { localStorage.setItem(FOOD_KEY, JSON.stringify(p)); } catch { /* 無痕模式 */ } }

/**
 * 轉盤主畫面：上方選大項，下方挑細項；轉完會回到這裡並把結果顯示在最上面
 * @param {{ onPick?: (name:string, group:object) => void }} ctx onPick：按「記一筆」時呼叫
 * @param {{ result?: {name:string, emoji:string, group:string} }} [opt]
 */
export function foodSetup(ctx = {}, { result = null } = {}) {
  const prefs = loadFoodPrefs();
  let gid = result ? result.group : foodGroupOf(prefs.group).id;
  let shown = result;
  const offOf = (id) => new Set(prefs.off[id] || []);
  const customOf = (id) => prefs.custom[id] || [];
  const sectionsOf = (id) => {
    const g = foodGroupOf(id);
    const custom = customOf(id);
    return custom.length ? [...g.sections, ['我的選項', custom.map((n) => [n, g.icon])]] : g.sections;
  };
  const itemsOf = (id) => sectionsOf(id).flatMap(([, items]) => items);
  const onItemsOf = (id) => { const off = offOf(id); return itemsOf(id).filter(([n]) => !off.has(n)); };
  const setOff = (id, set) => { prefs.off[id] = [...set]; saveFoodPrefs(prefs); };

  const body = h('div', { class: 'form food-setup' });
  const addInput = h('input', { class: 'input', placeholder: '加入自己的選項，例如：巷口麵店', maxlength: 12, onkeydown: (e) => e.key === 'Enter' && addCustom() });
  function addCustom() {
    const v = addInput.value.trim();
    if (!v) return;
    if (itemsOf(gid).some(([n]) => n === v)) { toast('已經有這個選項了'); return; }
    prefs.custom[gid] = [...customOf(gid), v];
    const off = offOf(gid); off.delete(v); setOff(gid, off);
    addInput.value = ''; draw(); addInput.focus();
  }
  function pickGroup(id) { gid = id; prefs.group = id; saveFoodPrefs(prefs); draw(); }

  function resultCard() {
    if (!shown) return null;
    const g = foodGroupOf(shown.group);
    return h('div', { class: 'fw-banner', role: 'status' },
      h('div', { class: 'fw-banner-row' },
        h('span', { class: 'fw-banner-emoji' }, shown.emoji),
        h('div', { class: 'fw-banner-text' }, h('small', {}, `轉盤結果・${g.name}`), h('strong', {}, `今天就${g.verb}${shown.name}！`)),
        h('button', { class: 'icon-btn', 'aria-label': '清除結果', onclick: () => { shown = null; draw(); } }, icon('x', 18))),
      ctx.onPick ? h('button', { class: 'btn primary block', onclick: () => { close(); ctx.onPick(shown.name, g); } }, `📝 就${g.verb}這個，記一筆`) : null);
  }

  function draw() {
    const g = foodGroupOf(gid);
    const off = offOf(gid);
    const items = itemsOf(gid);
    const onCount = items.length - items.filter(([n]) => off.has(n)).length;
    const custom = customOf(gid);
    mount(body,
      resultCard(),
      h('div', { class: 'fw-groups', role: 'tablist', 'aria-label': '大項' }, FOOD_GROUPS.map((x) => {
        const n = onItemsOf(x.id).length;
        return h('button', {
          class: `fw-group ${x.id === gid ? 'on' : ''}`, role: 'tab', 'aria-selected': String(x.id === gid), 'aria-label': x.name,
          onclick: () => pickGroup(x.id),
        }, h('span', { class: 'fw-group-icon' }, x.icon), h('span', { class: 'fw-group-name' }, x.name), h('small', {}, `${n} 個`));
      })),
      h('div', { class: 'food-top' },
        h('span', { class: 'food-count' }, h('strong', {}, onCount), ` / ${items.length} 個${g.name}`),
        h('div', { class: 'row gap' },
          h('button', { class: 'chip', onclick: () => { setOff(gid, new Set()); draw(); } }, '✅ 全選'),
          h('button', { class: 'chip', onclick: () => { setOff(gid, new Set(items.map(([n]) => n))); draw(); } }, '⬜ 全部取消'))),
      sectionsOf(gid).map(([title, list]) => {
        const allOn = list.every(([n]) => !off.has(n));
        return h('section', { class: 'food-sec' },
          h('div', { class: 'food-sec-head' },
            h('span', {}, title),
            h('button', { class: 'food-sec-toggle', 'aria-label': `${allOn ? '取消' : '全選'}${title}`, onclick: () => {
              list.forEach(([n]) => (allOn ? off.add(n) : off.delete(n))); setOff(gid, off); draw();
            } }, allOn ? '取消這區' : '全選這區')),
          h('div', { class: 'food-grid', role: 'group', 'aria-label': title }, list.map(([n, e]) => {
            const on = !off.has(n);
            const isCustom = custom.includes(n);
            return h('button', {
              class: `food-card ${on ? 'on' : ''}`, 'aria-pressed': String(on), 'aria-label': n,
              onclick: () => { on ? off.add(n) : off.delete(n); setOff(gid, off); draw(); },
            }, h('span', { class: 'food-emoji' }, e), h('span', { class: 'food-name' }, n),
            isCustom ? h('span', { class: 'food-del', role: 'button', 'aria-label': `刪除 ${n}`, onclick: (ev) => {
              ev.stopPropagation(); prefs.custom[gid] = custom.filter((x) => x !== n); off.delete(n); setOff(gid, off); draw();
            } }, '×') : null);
          })));
      }),
      h('div', { class: 'row gap' }, addInput, h('button', { class: 'btn ghost', onclick: addCustom }, icon('plus', 18), '加入')),
      onCount < 2 ? h('p', { class: 'hint neg' }, '至少要選 2 個才能轉喔') : null,
      h('button', { class: 'btn primary block food-go', disabled: onCount < 2, onclick: () => {
        const list = items.filter(([n]) => !off.has(n));
        close();
        foodStage(list, { ...ctx, group: gid, onDone: (res) => foodSetup(ctx, { result: res }) });
      } }, `🎡 轉${g.name}！`));
  }
  draw();
  const close = sheet('吃什麼轉盤', body, { tall: true });
}

/**
 * 全螢幕轉盤
 * ctx.group：大項 id；ctx.onDone(result|null)：關閉時呼叫（「就選這個」帶結果，直接關閉帶 null）
 */
export function foodStage(items, ctx = {}) {
  const grp = foodGroupOf(ctx.group);
  let list = items.slice();
  let rotation = 0;
  let spinning = false;
  let picked = null;
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
    // 片數少：名字橫寫在內圈；片數多：名字沿半徑方向寫，才放得下（例如速食、飲料品牌）
    const radial = n > 12;
    const showNames = n <= 40;
    list.forEach(([name, emoji], i) => {
      const s = -Math.PI / 2 + i * a, e = s + a;
      const r = R - 6;
      const x1 = R + r * Math.cos(s), y1 = R + r * Math.sin(s), x2 = R + r * Math.cos(e), y2 = R + r * Math.sin(e);
      // 最後一片若和第一片同色就換一個顏色
      const color = i === n - 1 && n % SLICE_COLORS.length === 1 ? SLICE_COLORS[3] : SLICE_COLORS[i % SLICE_COLORS.length];
      g.append(el('path', { d: `M${R},${R} L${x1},${y1} A${r},${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x2},${y2} Z`, fill: color, stroke: '#fff', 'stroke-width': 2 }));
      const mid = s + a / 2;
      const deg = (mid * 180) / Math.PI + 90;
      const er = r * (showNames && !radial ? 0.78 : 0.86);
      const ex = R + er * Math.cos(mid), ey = R + er * Math.sin(mid);
      const t = el('text', { x: ex, y: ey, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'fw-emoji', transform: `rotate(${deg} ${ex} ${ey})`, 'font-size': Math.max(12, Math.min(30, (r * a) * 0.55)) });
      t.textContent = emoji;
      g.append(t);
      if (showNames) {
        if (radial) {
          // 從外往內寫，文字底部朝外，靠近 emoji 那端對齊
          const nr = r * 0.74;
          const nx = R + nr * Math.cos(mid), ny = R + nr * Math.sin(mid);
          const fs = Math.max(9, Math.min(12, r * 0.4 * a * 0.9));
          // 左半邊翻轉 180°，文字才不會倒著
          const flip = Math.cos(mid) < -1e-6;
          const tx = el('text', { x: nx, y: ny, 'text-anchor': flip ? 'start' : 'end', 'dominant-baseline': 'central', class: 'fw-label', 'font-size': fs, transform: `rotate(${(mid * 180) / Math.PI + (flip ? 180 : 0)} ${nx} ${ny})` });
          tx.textContent = name.length > 6 ? name.slice(0, 6) + '…' : name;
          g.append(tx);
        } else {
          const nr = r * 0.52;
          const nx = R + nr * Math.cos(mid), ny = R + nr * Math.sin(mid);
          const tx = el('text', { x: nx, y: ny, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'fw-label', transform: `rotate(${deg} ${nx} ${ny})` });
          tx.textContent = name.length > 5 ? name.slice(0, 5) + '…' : name;
          g.append(tx);
        }
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
    picked = null;
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
    picked = { name, emoji, group: grp.id };
    stage.classList.remove('spinning');
    face.firstChild.textContent = '😍';
    tip.textContent = '';
    burst();
    mount(resultBox, h('div', { class: 'fw-card' },
      h('span', { class: 'fw-big' }, emoji),
      h('p', { class: 'fw-say' }, `今天就${grp.verb}`),
      h('p', { class: 'fw-name' }, `${name}！`),
      h('div', { class: 'fw-actions' },
        h('button', { class: 'btn primary grow', onclick: () => finish(picked) }, '✅ 就選這個'),
        h('button', { class: 'btn ghost grow', onclick: spin }, '🔁 再轉一次'),
        list.length > 2 ? h('button', { class: 'btn ghost grow', onclick: () => { list = list.filter(([n]) => n !== name); picked = null; rotation = 0; drawWheel(); resultBox.classList.remove('show'); tip.textContent = `已拿掉「${name}」，剩 ${list.length} 個`; setTimeout(spin, 250); } }, `🙅 不要${name}`) : null)));
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

  let closed = false;
  function finish(res = null) {
    if (closed) return;
    closed = true;
    stage.classList.remove('open');
    document.body.classList.remove('lad-open');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => stage.remove(), 250);
    // 回到轉盤主畫面（有結果就顯示在最上面）
    if (ctx.onDone) ctx.onDone(res);
  }
  const onKey = (e) => { if (e.key === 'Escape' && !spinning) finish(picked); };

  const titles = { meal: '🍱 今天吃什麼？', snack: '🍢 吃什麼小吃？', drink: '🧋 今天喝什麼？', dessert: '🍰 吃什麼甜點？' };
  const stage = h('div', { class: 'food-stage', role: 'dialog', 'aria-modal': 'true', 'aria-label': '吃什麼轉盤' },
    h('header', { class: 'fw-head' },
      h('div', {}, h('strong', {}, titles[grp.id] || titles.meal), h('small', {}, '交給命運決定！')),
      h('button', { class: 'icon-btn fw-close', 'aria-label': '回到選單', onclick: () => finish(picked) }, icon('back'))),
    wheelWrap, tip, resultBox);
  drawWheel();
  document.body.append(stage);
  document.body.classList.add('lad-open');
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => stage.classList.add('open'));
  return { spin };
}
