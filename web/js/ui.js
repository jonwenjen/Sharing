// 輕量 DOM 工具：h()、底部抽屜、提示、確認框、圖示
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

/** 清空後放入子節點（會攤平陣列並略過 null/false） */
export function mount(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

/** 數字太長時自動縮小字級，避免斷行 */
export function fitText(root, selector, min = 16) {
  root.querySelectorAll(selector).forEach((el) => {
    el.style.fontSize = '';
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (el.scrollWidth > el.clientWidth + 1 && size > min) { size -= 1; el.style.fontSize = `${size}px`; }
  });
}

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
  share: '<path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  down: '<path d="M12 4v12M6 10l6 6 6-6M5 20h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M12 17h.01"/>',
};
export const icon = (name, size = 22) =>
  h('span', { class: 'ic', 'aria-hidden': 'true', html: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>` });

export function avatar(member, size = 36) {
  const name = member ? member.name : '?';
  const hue = [...name].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  if (member && member.avatar) return h('img', { class: 'av', src: member.avatar, alt: '', style: `width:${size}px;height:${size}px` });
  return h('span', { class: 'av', style: `width:${size}px;height:${size}px;font-size:${size * 0.42}px;--h:${hue}` }, [...name][0] || '?');
}

let toastTimer;
/** 提示訊息；可帶一個動作按鈕（例如「復原」） */
export function toast(msg, kind = '', { action, duration } = {}) {
  let t = document.querySelector('.toast');
  if (!t) { t = h('div', { class: 'toast', role: 'status' }); document.body.append(t); }
  t.replaceChildren(h('span', {}, msg), action ? h('button', { class: 'toast-act', onclick: () => { t.classList.remove('show'); action.onClick(); } }, action.label) : null);
  if (!action) t.replaceChildren(msg);
  t.className = `toast show ${kind} ${action ? 'has-act' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), duration || (action ? 5000 : 2400));
}

/** 空狀態插圖：一張線條小車票 */
export const emptyArt = () => h('span', { class: 'empty-art', 'aria-hidden': 'true', html: '<svg viewBox="0 0 120 64" width="120" height="64" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 10h74v8a6 6 0 000 12v4a6 6 0 000 12v8H8a4 4 0 01-4-4V14a4 4 0 014-4z"/><path d="M82 10h30a4 4 0 014 4v36a4 4 0 01-4 4H82"/><path d="M82 18v36" stroke-dasharray="3 4"/><path d="M18 26h40M18 36h26"/><circle cx="99" cy="32" r="7"/></svg>' });

/** 載入中的骨架畫面 */
export const skeleton = () => h('div', { class: 'skel-wrap', 'aria-busy': 'true', 'aria-label': '載入中' },
  h('div', { class: 'skel skel-ticket' }), h('div', { class: 'skel skel-tabs' }),
  [0, 1, 2].map(() => h('div', { class: 'skel skel-row' })));

/** 由下往上的抽屜；回傳 close() */
export function sheet(title, body, { onClose, tall = false, required = false } = {}) {
  const prevFocus = document.activeElement;
  const close = () => {
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 220);
    document.removeEventListener('keydown', onKey);
    prevFocus && prevFocus.focus && prevFocus.focus();
    onClose && onClose();
  };
  const onKey = (e) => !required && e.key === 'Escape' && close();
  const panel = h('div', { class: `sheet ${tall ? 'tall' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-grip' }),
    h('header', { class: 'sheet-head' }, h('h2', {}, title), required ? null : h('button', { class: 'icon-btn', 'aria-label': '關閉', onclick: close }, icon('x'))),
    h('div', { class: 'sheet-body' }, body));
  const wrap = h('div', { class: 'sheet-wrap', onclick: (e) => !required && e.target === wrap && close() }, panel);
  document.body.append(wrap);
  document.addEventListener('keydown', onKey);
  requestAnimationFrame(() => { wrap.classList.add('open'); const f = panel.querySelector('input,select,textarea'); (f || panel.querySelector('button')).focus({ preventScroll: true }); });
  return close;
}

export function confirmBox(message, okText = '確定', { danger = false, extra } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const close = sheet('請確認', h('div', {},
      h('p', { class: 'confirm-msg' }, message),
      extra || null,
      h('div', { class: 'row gap' },
        h('button', { class: 'btn ghost grow', onclick: () => { done = true; close(); resolve(false); } }, '取消'),
        h('button', { class: `btn grow ${danger ? 'danger' : 'primary'}`, onclick: () => { done = true; close(); resolve(true); } }, okText))),
    { onClose: () => !done && resolve(false) });
  });
}

export async function copyText(text, label = '已複製') {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  toast(label);
}

export function download(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\ufeff' + text], { type: mime });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
