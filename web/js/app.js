// Sharing 主程式：帳本列表、帳本（明細／結算／統計／成員）、記帳編輯器
import { line, initLine, ledgerUrl, sendToChat, pickAndShare, canSendToChat, inLineApp, openExternal, webUrl } from './line.js';
import { store } from './store.js';
import { h, mount, fitText, icon, avatar, toast, sheet, confirmBox, copyText, download } from './ui.js';
import {
  CURRENCIES, CATEGORIES, FUND_ID, categoryOf, formatMoney, formatMinor, fromMinor, decimalsOf, recordShares,
  settlementBalances, fundCash, stats, validateRecord,
} from './money.js';
import { minTransfers } from './settle.js';
import { recordFlex, inviteFlex, settleText, recordsCsv, summaryCsv, describeRecord } from './messages.js';

const S = { ledger: null, members: [], records: [], meId: null, tab: 'list', rates: {}, scope: 'all', groupId: null };
const app = document.getElementById('app');
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const base = () => S.ledger.baseCurrency;
const memberName = (id) => (id === FUND_ID ? '公費' : (S.members.find((m) => m.id === id) || {}).name || '已移除成員');
const activeMembers = () => S.members.filter((m) => m.active);
const custodian = () => (S.ledger.fundEnabled ? S.ledger.fundCustodian : null);

function busy(on) { document.body.classList.toggle('busy', on); }
async function run(fn, okMsg) {
  busy(true);
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(e.message || '發生錯誤，請再試一次', 'err'); throw e; }
  finally { busy(false); }
}
function setUrl(params) {
  const u = new URL(location.href);
  ['l', 'g', 'r', 'tab', 'join'].forEach((k) => u.searchParams.delete(k));
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  history.replaceState(null, '', u);
}

// ============ 首頁 ============
async function home() {
  S.ledger = null;
  setUrl({ g: S.groupId });
  const list = await run(() => store.listLedgers());
  const groupList = S.groupId ? await store.groupLedgers(S.groupId).catch(() => []) : [];
  const mine = new Set(list.map((l) => l.id));
  const card = (l) => h('button', { class: `ledger-card ${l.viaAdmin ? 'admin-view' : ''}`, onclick: () => openLedger(l.id) },
    h('span', { class: 'lc-cur' }, l.baseCurrency),
    h('span', { class: 'lc-main' },
      h('strong', {}, l.name),
      h('span', { class: 'lc-tags' },
        l.isCreator ? h('em', { class: 'tag mine' }, '我建立的') : null,
        l.viaAdmin ? h('em', { class: 'tag admin' }, '管理員檢視') : null,
        l.archived ? h('em', { class: 'tag' }, '已封存') : null),
      h('small', { class: 'lc-meta' },
        h('span', {}, l.groupId ? `👥 ${l.groupName || 'LINE 群組'}` : '未連結群組'),
        h('span', {}, `建立者 ${l.creatorName || '—'}`),
        h('span', {}, `${l.memberCount ?? '–'} 位成員`))),
    icon('arrow', 18));
  const groupOnly = groupList.filter((l) => !mine.has(l.id));
  const own = list.filter((l) => !l.viaAdmin);
  const adminOnly = list.filter((l) => l.viaAdmin);
  const sortA = (arr) => [...arr.filter((l) => !l.archived), ...arr.filter((l) => l.archived)];
  mount(app,
    h('header', { class: 'top home-top' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'S'), 'Sharing'),
      h('button', { class: 'me-chip', 'aria-label': '我的帳號', onclick: accountSheet }, S.me && S.me.isAdmin ? h('em', { class: 'tag admin' }, '管理員') : null, avatar({ name: line.profile.displayName, avatar: line.profile.pictureUrl }, 30))),
    line.demo ? h('p', { class: 'demo-note' }, '示範模式：資料只存在這支手機的瀏覽器。', h('button', { class: 'link', onclick: async () => { await store.reset(); home(); } }, '重設示範資料')) : null,
    h('main', { class: 'home' },
      h('h1', { class: 'home-title' }, '帳本'),
      groupOnly.length ? h('section', {}, h('h3', { class: 'sec-title' }, '這個 LINE 群組的帳本'), h('div', { class: 'stack' }, groupOnly.map(card))) : null,
      own.length
        ? h('div', { class: 'stack' }, sortA(own).map(card))
        : adminOnly.length ? h('p', { class: 'hint' }, '你還沒有自己的帳本。')
          : h('div', { class: 'empty' }, h('p', {}, '還沒有帳本。建立一本，或請朋友傳邀請連結給你。')),
      adminOnly.length ? h('section', {}, h('h3', { class: 'sec-title' }, `其他帳本（管理員可檢視，共 ${adminOnly.length} 本）`), h('div', { class: 'stack' }, sortA(adminOnly).map(card))) : null,
      h('button', { class: 'btn primary block', onclick: createLedgerSheet }, icon('plus', 18), '建立帳本')));
}

/** 匯款資訊欄位；回傳 { el, value() } */
function payFields(pi = {}, disabled = false) {
  const f = {};
  const inp = (k, ph, mode) => (f[k] = h('input', { class: 'input', value: pi[k] || '', placeholder: ph, disabled, inputmode: mode || 'text', 'aria-label': ph }));
  const el = h('div', { class: 'form' },
    h('div', { class: 'grid2' }, field('銀行', inp('bank', '國泰世華')), field('銀行代碼', inp('bankCode', '013', 'numeric'))),
    field('帳號', inp('account', '帳號', 'numeric')),
    h('div', { class: 'grid2' }, field('LINE Pay', inp('linePay', '手機或 ID')), field('街口', inp('jko', '街口帳號'))),
    field('備註', inp('note', '例如：請備註名字')));
  return { el, value: () => Object.fromEntries(Object.entries(f).map(([k, x]) => [k, x.value.trim()])) };
}

async function accountSheet() {
  if (!S.me) S.me = await store.me().catch(() => null);
  const me = S.me || { userId: line.profile.userId, isAdmin: false, payInfo: {} };
  const pay = payFields(me.payInfo || {});
  const close = sheet('我的帳號', h('div', { class: 'form' },
    h('div', { class: 'row gap' }, avatar({ name: line.profile.displayName, avatar: line.profile.pictureUrl }, 48),
      h('div', {}, h('strong', {}, line.profile.displayName), h('small', { class: 'hint block' }, me.isAdmin ? '管理員：可看到並進入所有帳本' : '一般使用者'))),
    h('h3', { class: 'sec-title' }, '我的匯款資訊'),
    h('p', { class: 'hint' }, '只要填一次。儲存後會同步到你所有的帳本，加入新帳本時也會自動帶入。'),
    pay.el,
    h('button', { class: 'btn primary block', onclick: async () => {
      S.me = await run(() => store.updateMe({ payInfo: pay.value() }), '已儲存，所有帳本已同步');
      close();
      if (S.ledger) reload();
    } }, '儲存匯款資訊'),
    field('LINE 使用者 ID', h('div', { class: 'row gap' }, h('code', { class: 'uid grow' }, me.userId), h('button', { class: 'btn ghost sm', onclick: () => copyText(me.userId, '已複製 ID') }, icon('copy', 16), '複製')),
      '要設為管理員，請把這個 ID 填入後端 wrangler.toml 的 ADMIN_USER_IDS。')), { tall: true });
}

function noAccess(message) {
  S.ledger = null;
  setUrl({});
  mount(app,
    h('header', { class: 'top' }, h('button', { class: 'icon-btn', 'aria-label': '回帳本列表', onclick: home }, icon('back')), h('h1', { class: 'top-title' }, '沒有權限')),
    h('div', { class: 'empty fatal-lite' },
      h('p', { class: 'big' }, '🔒'),
      h('p', { class: 'big' }, '無法開啟這本帳本'),
      h('p', {}, message),
      h('p', { class: 'hint' }, '只有帳本成員、LINE 群組成員，或收到邀請連結的人才能進入。'),
      h('button', { class: 'btn primary', onclick: home }, '回帳本列表')));
}

function createLedgerSheet() {
  const name = h('input', { class: 'input', placeholder: '例如：東京五日遊', maxlength: 40 });
  const cur = currencySelect('TWD');
  const names = [line.profile.displayName];
  const chipsBox = h('div', { class: 'chips' });
  const drawChips = () => chipsBox.replaceChildren(...names.map((n, i) => h('span', { class: 'chip on' }, n, i === 0 ? h('em', {}, '（我）') : h('button', { class: 'chip-x', 'aria-label': `移除 ${n}`, onclick: () => { names.splice(i, 1); drawChips(); } }, '×'))));
  drawChips();
  const add = h('input', { class: 'input', placeholder: '輸入名字後按「加入」', maxlength: 20, onkeydown: (e) => e.key === 'Enter' && addName() });
  const addName = () => { const v = add.value.trim(); if (v && !names.includes(v)) { names.push(v); drawChips(); } add.value = ''; add.focus(); };
  const close = sheet('建立帳本', h('div', { class: 'form' },
    field('帳本名稱', name),
    field('預設幣別', cur, '記帳時仍可選其他幣別，結算一律換算成這個幣別。'),
    field('成員', h('div', {}, chipsBox, h('div', { class: 'row gap' }, add, h('button', { class: 'btn ghost', onclick: addName }, '加入'))), '朋友之後也能自己點連結加入。'),
    S.groupId ? h('p', { class: 'hint' }, '這本帳本會連結到目前的 LINE 群組。') : null,
    h('button', { class: 'btn primary block', onclick: async () => {
      if (!name.value.trim()) return toast('請輸入帳本名稱', 'err');
      const l = await run(() => store.createLedger({ name: name.value.trim(), baseCurrency: cur.value, groupId: S.groupId, members: names, claimFirst: true }), '已建立帳本');
      close(); openLedger(l.id);
    } }, '建立帳本')));
}

// ============ 帳本 ============
async function openLedger(id, { keepScroll = false, join = null } = {}) {
  const y = window.scrollY;
  let data = null;
  busy(true);
  try { data = await store.getLedger(id, join); }
  catch (e) { busy(false); if (e.code === 'NO_ACCESS') return noAccess(e.message); toast(e.message || '無法開啟帳本', 'err'); return home(); }
  busy(false);
  if (join) toast('已加入帳本');
  Object.assign(S, { ledger: data.ledger, members: data.members, records: data.records, viewer: data.viewer || {} });
  S.meId = (S.members.find((m) => m.lineUserId === line.profile.userId) || {}).id || null;
  setUrl({ l: id });
  renderLedger();
  if (keepScroll) window.scrollTo(0, y);
  const adminOnly = S.viewer.isAdmin && !S.meId && !S.viewer.isCreator;
  if (!S.meId && !S._askedIdentity && !adminOnly) { S._askedIdentity = true; identitySheet(); }
}
const reload = () => openLedger(S.ledger.id, { keepScroll: true });

function renderLedger() {
  const b = base();
  const { net, fundUnassigned } = settlementBalances(S.records, b, custodian());
  const st = stats(S.records, b);
  const mine = S.meId ? net[S.meId] || 0 : null;
  const tabs = [['list', '明細'], ['settle', '結算'], ['stats', '統計'], ['members', '成員']];
  const ticket = h('section', { class: 'ticket', 'aria-label': '我的結算' },
    h('div', { class: 'ticket-main' },
      S.meId
        ? [h('span', { class: 't-label' }, mine > 0 ? '結清後你會收到' : mine < 0 ? '結清時你需要付' : '你目前沒有欠款'),
          h('strong', { class: `t-amount ${mine > 0 ? 'pos' : mine < 0 ? 'neg' : ''}` }, formatMinor(Math.abs(mine), b)),
          h('span', { class: 't-who' }, avatar(S.members.find((m) => m.id === S.meId), 22), `你是 ${memberName(S.meId)}`, h('button', { class: 'link', onclick: identitySheet }, '更換'))]
        : [h('span', { class: 't-label' }, '先告訴我們你是誰'), h('button', { class: 'btn primary', onclick: identitySheet }, '選擇我的身分')]),
    h('div', { class: 'ticket-stub' },
      h('span', { class: 't-label' }, '總支出'),
      h('strong', {}, formatMinor(st.total, b)),
      h('span', { class: 't-label' }, `${S.records.length} 筆紀錄`)));
  const body = { list: listTab, settle: () => settleTab(net, fundUnassigned), stats: () => statsTab(st, net), members: membersTab }[S.tab]();
  mount(app,
    h('header', { class: 'top' },
      h('button', { class: 'icon-btn', 'aria-label': '回帳本列表', onclick: home }, icon('back')),
      h('h1', { class: 'top-title' }, S.ledger.name),
      h('button', { class: 'icon-btn', 'aria-label': '帳本設定', onclick: settingsSheet }, icon('gear'))),
    h('main', { class: 'ledger' },
      S.viewer && S.viewer.isAdmin && !S.meId ? h('p', { class: 'admin-banner' }, '🔑 管理員檢視：你不是這本帳本的成員') : null,
      h('p', { class: 'ledger-meta' }, S.ledger.groupId ? `👥 ${S.ledger.groupName || 'LINE 群組'}` : '未連結群組', `　建立者 ${S.ledger.creatorName || '—'}`),
      ticket,
      h('nav', { class: 'tabs', role: 'tablist' }, tabs.map(([k, label]) => h('button', {
        role: 'tab', 'aria-selected': String(S.tab === k), class: S.tab === k ? 'on' : '',
        onclick: () => { S.tab = k; renderLedger(); },
      }, label))),
      h('div', { class: 'tab-body', role: 'tabpanel' }, body)),
    S.ledger.archived || S.tab !== 'list' ? null : h('button', { class: 'fab', onclick: () => editor(), 'aria-label': '記一筆' }, icon('plus', 22), h('span', {}, '記一筆')));
  fitText(app, '.t-amount, .ticket-stub strong, .stat-total strong', 14);
}

// ---- 明細 ----
function listTab() {
  if (!S.records.length) return h('div', { class: 'empty' }, h('p', {}, '還沒有任何紀錄。'), h('p', { class: 'hint' }, '按右下角「記一筆」，誰先付、幾個人分，一次填好。'));
  const b = base();
  const sorted = [...S.records].sort((x, y) => (x.date === y.date ? y.createdAt - x.createdAt : x.date < y.date ? 1 : -1));
  const groups = {};
  sorted.forEach((r) => (groups[r.date] = groups[r.date] || []).push(r));
  const wd = '日一二三四五六';
  return Object.entries(groups).map(([date, rs]) => {
    const d = new Date(date + 'T00:00:00');
    return h('section', { class: 'day' },
      h('h3', { class: 'day-head' }, `${d.getMonth() + 1} 月 ${d.getDate()} 日（${wd[d.getDay()]}）`),
      h('ul', { class: 'rec-list' }, rs.map((r) => {
        const { total, shares } = recordShares(r, b);
        const effect = S.meId ? (r.payerId === S.meId ? total : 0) - (shares[S.meId] || 0) : 0;
        const glyph = r.type === 'expense' ? categoryOf(r.category).icon : r.type === 'transfer' ? '⇄' : '🏦';
        return h('li', {}, h('button', { class: 'rec', onclick: () => editor(r) },
          h('span', { class: `rec-ic t-${r.type}` }, glyph),
          h('span', { class: 'rec-main' }, h('strong', {}, r.title || describeRecord(r, S.members)), h('small', {}, describeRecord(r, S.members))),
          h('span', { class: 'rec-amt' },
            h('strong', {}, formatMoney(Number(r.amount), r.currency)),
            r.currency !== b ? h('small', {}, `≈ ${formatMinor(total, b)}`) : null,
            effect ? h('small', { class: effect > 0 ? 'pos' : 'neg' }, `你 ${formatMinor(effect, b, { sign: true })}`) : null)));
      })));
  });
}

// ---- 結算 ----
function settleTab(net, fundUnassigned) {
  const b = base();
  let transfers = [];
  try { transfers = minTransfers(net); } catch (e) { return h('p', { class: 'warn' }, e.message); }
  const out = [];
  if (S.ledger.fundEnabled) {
    out.push(h('div', { class: 'fund-card' },
      h('div', {}, h('span', { class: 't-label' }, '公費餘額'), h('strong', {}, formatMinor(fundCash(S.records, b), b))),
      h('p', {}, S.ledger.fundCustodian ? `由 ${memberName(S.ledger.fundCustodian)} 保管，結算時已併入他的帳。` : '尚未指定保管人，請到「成員」設定。')));
  }
  if (fundUnassigned) out.push(h('p', { class: 'warn' }, `公費有 ${formatMinor(fundUnassigned, b)} 尚未指定保管人，結算結果暫不含這筆。`));
  if (!transfers.length) {
    out.push(h('div', { class: 'empty done' }, h('p', { class: 'big' }, '已經結清'), h('p', { class: 'hint' }, '目前沒有人需要轉帳。')));
    return out;
  }
  const dc = S.settleCur || b;
  const lr = S.rates[`${b}|latest`];
  if (dc !== b && !lr) store.rates(b).then((t) => { S.rates[`${b}|latest`] = t; renderLedger(); }).catch(() => toast('暫時取不到匯率', 'err'));
  const rateOf = (c) => lr && (lr.rates || lr)[c];
  const show = (minor) => {
    if (dc === b || !rateOf(dc)) return formatMinor(minor, b);
    const d = decimalsOf(dc);
    return formatMoney(Math.round((fromMinor(minor, b) / rateOf(dc)) * 10 ** d) / 10 ** d, dc);
  };
  const curSel = h('select', { class: 'input cur compact', 'aria-label': '顯示幣別', onchange: (e) => { S.settleCur = e.target.value; renderLedger(); } },
    Object.keys(CURRENCIES).map((k) => h('option', { value: k, selected: k === dc }, k)));
  out.push(h('div', { class: 'row between settle-head' }, h('p', { class: 'settle-sum' }, `只要 ${transfers.length} 筆轉帳就能全部結清`), curSel));
  if (dc !== b) out.push(h('p', { class: 'hint' }, lr ? `以 ${lr.date || '今日'} 匯率從 ${b} 換算，僅供參考；「記為已付款」仍以 ${b} 記錄。` : '載入匯率中…'));
  out.push(h('ul', { class: 'xfer-list' }, transfers.map((t) => {
    const to = S.members.find((m) => m.id === t.to) || { name: memberName(t.to), payInfo: {} };
    const from = S.members.find((m) => m.id === t.from) || { name: memberName(t.from) };
    const pi = to.payInfo || {};
    const payRows = [
      pi.account && ['帳號', `${pi.bank || ''}${pi.bankCode ? `（${pi.bankCode}）` : ''} ${pi.account}`.trim(), pi.account],
      pi.linePay && ['LINE Pay', pi.linePay, pi.linePay],
      pi.jko && ['街口', pi.jko, pi.jko],
      pi.note && ['備註', pi.note, null],
    ].filter(Boolean);
    const involvesMe = S.meId && (t.from === S.meId || t.to === S.meId);
    return h('li', { class: `xfer ${involvesMe ? 'mine' : ''}` },
      h('div', { class: 'xfer-row' },
        h('span', { class: 'xfer-p' }, avatar(from, 34), h('span', {}, from.name)),
        h('span', { class: 'xfer-mid' }, h('strong', {}, show(t.amount)), dc !== b && rateOf(dc) ? h('small', { class: 'hint' }, formatMinor(t.amount, b)) : null, h('span', { class: 'xfer-line' }, icon('arrow', 16))),
        h('span', { class: 'xfer-p' }, avatar(to, 34), h('span', {}, to.name))),
      payRows.length
        ? h('dl', { class: 'payinfo' }, payRows.map(([k, v, c]) => [h('dt', {}, k), h('dd', {}, h('span', {}, v), c ? h('button', { class: 'icon-btn sm', 'aria-label': `複製${k}`, onclick: () => copyText(c) }, icon('copy', 16)) : null)]))
        : h('p', { class: 'hint' }, `${to.name} 還沒有填匯款資訊。`),
      h('button', { class: 'btn ghost sm', onclick: () => markPaid(t) }, icon('check', 16), '記為已付款'));
  })));
  out.push(h('button', { class: 'btn ghost block', onclick: async () => {
    const msg = { type: 'text', text: settleText(S.ledger, S.members, transfers, show) };
    if (await sendToChat([msg])) return toast('已分享到 LINE');
    if (await pickAndShare([msg])) return toast('已分享到 LINE');
    copyText(msg.text, '已複製結算結果，可貼到 LINE');
  } }, icon('share', 18), '分享結算結果'));
  return out;
}

async function markPaid(t) {
  const shareBox = shareToggle();
  const ok = await confirmBox(`記錄 ${memberName(t.from)} 已轉 ${formatMinor(t.amount, base())} 給 ${memberName(t.to)}？`, '記為已付款', { extra: shareBox.el });
  if (!ok) return;
  const rec = { type: 'transfer', title: '還款', category: 'other', amount: t.amount / 10 ** CURRENCIES[base()].decimals, currency: base(), rate: 1, payerId: t.from, split: { mode: 'amount', parts: { [t.to]: t.amount / 10 ** CURRENCIES[base()].decimals } }, date: today(), note: '' };
  const saved = await run(() => store.addRecord(S.ledger.id, rec), '已記錄付款');
  if (shareBox.on()) await shareRecord('create', saved);
  reload();
}

// ---- 統計 ----
function statsTab(st, net) {
  const b = base();
  const mine = S.scope === 'me' && S.meId;
  const exp = S.records.filter((r) => r.type === 'expense');
  // 以目前範圍（全體／我的）計算每筆支出的金額
  const rows = exp.map((r) => { const x = recordShares(r, b); return { r, v: mine ? x.shares[S.meId] || 0 : x.total, shares: x.shares }; }).filter((x) => x.v);
  const total = rows.reduce((a, x) => a + x.v, 0);
  const byCat = {}, byDay = {};
  rows.forEach(({ r, v }) => { byCat[r.category] = (byCat[r.category] || 0) + v; byDay[r.date] = (byDay[r.date] || 0) + v; });
  const days = dayRange(Object.keys(byDay));
  const people = S.members.filter((m) => st.people[m.id] && st.people[m.id].share);
  const cats = Object.entries(byCat).sort((x, y) => y[1] - x[1]);
  const max = cats.length ? cats[0][1] : 1;
  const seg = h('div', { class: 'seg' }, [['all', '全體'], ['me', '我的']].map(([k, label]) => h('button', {
    class: (S.scope === k ? 'on' : ''), disabled: k === 'me' && !S.meId, onclick: () => { S.scope = k; renderLedger(); },
  }, label)));
  if (!rows.length) return [seg, h('p', { class: 'hint center' }, '還沒有支出可以統計。'), exportBox(net)];
  const kpi = (label, value) => h('div', { class: 'kpi' }, h('span', {}, label), h('strong', {}, value));
  return [
    seg,
    h('div', { class: 'stat-total' }, h('span', { class: 't-label' }, mine ? '我分攤的支出' : '團體總支出'), h('strong', {}, formatMinor(total, b))),
    h('div', { class: 'kpis' },
      kpi('每日平均', formatMinor(Math.round(total / days.length), b)),
      mine ? kpi('占團體', `${st.total ? Math.round((total / st.total) * 100) : 0}%`) : kpi('每人平均', formatMinor(Math.round(total / Math.max(1, people.length)), b)),
      kpi('天數', `${days.length} 天`), kpi('筆數', `${rows.length} 筆`)),
    h('h3', { class: 'sec-title' }, '每日花費'),
    trendChart(days, byDay, b),
    h('h3', { class: 'sec-title' }, '分類'),
    h('ul', { class: 'bars' }, cats.map(([c, v]) => h('li', {},
      h('span', { class: 'bar-label' }, `${categoryOf(c).icon} ${categoryOf(c).name}`),
      h('span', { class: 'bar-track' }, h('span', { class: 'bar-fill', style: `width:${Math.max(3, (v / max) * 100)}%` })),
      h('span', { class: 'bar-val' }, formatMinor(v, b), h('small', {}, `${Math.round((v / total) * 100)}%`))))),
    h('h3', { class: 'sec-title' }, '前 5 大支出'),
    h('ol', { class: 'top5' }, [...rows].sort((x, y) => y.v - x.v).slice(0, 5).map(({ r, v }) => h('li', {}, h('button', { class: 'rec', onclick: () => editor(r) },
      h('span', { class: 'rec-ic' }, categoryOf(r.category).icon),
      h('span', { class: 'rec-main' }, h('strong', {}, r.title), h('small', {}, `${r.date.slice(5).replace('-', '/')}，${memberName(r.payerId)} 先付`)),
      h('span', { class: 'rec-amt' }, h('strong', {}, formatMinor(v, b))))))),
    mine ? null : [
      h('h3', { class: 'sec-title' }, '每人 × 分類'),
      crossTable(exp, people, b),
      h('h3', { class: 'sec-title' }, '每個人'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'people' },
        h('thead', {}, h('tr', {}, h('th', {}, '成員'), h('th', {}, '代墊'), h('th', {}, '分攤'), h('th', {}, '結算'))),
        h('tbody', {}, S.members.filter((m) => m.active || st.people[m.id]).map((m) => {
          const p = st.people[m.id] || { paid: 0, share: 0 };
          const n = net[m.id] || 0;
          return h('tr', { class: m.id === S.meId ? 'me' : '' }, h('td', {}, m.name), h('td', {}, formatMinor(p.paid, b)), h('td', {}, formatMinor(p.share, b)), h('td', { class: n > 0 ? 'pos' : n < 0 ? 'neg' : '' }, formatMinor(n, b, { sign: true })));
        })))),
    ],
    exportBox(net),
  ];
}

function dayRange(dates) {
  if (!dates.length) return [];
  const sorted = [...dates].sort();
  const out = [];
  for (let d = new Date(sorted[0] + 'T00:00:00Z'), end = new Date(sorted.at(-1) + 'T00:00:00Z'); d <= end && out.length < 366; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
}

function trendChart(days, byDay, b) {
  const W = 340, H = 150, top = 22, bottom = 22;
  const vals = days.map((d) => byDay[d] || 0);
  const mx = Math.max(...vals, 1);
  const bw = W / days.length;
  const every = Math.ceil(days.length / 8);
  const peak = vals.indexOf(mx);
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="每日花費長條圖" class="trend">
    ${vals.map((v, i) => { const hh = v ? Math.max(2, (v / mx) * (H - top - bottom)) : 0; return `<rect x="${i * bw + bw * 0.18}" y="${H - bottom - hh}" width="${bw * 0.64}" height="${hh}" rx="3" class="${i === peak ? 'peak' : ''}"><title>${days[i]}：${formatMinor(v, b)}</title></rect>`; }).join('')}
    <line x1="0" x2="${W}" y1="${H - bottom + 0.5}" y2="${H - bottom + 0.5}" class="axis"/>
    ${days.map((d, i) => (i % every === 0 || i === days.length - 1 ? `<text x="${i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${Number(d.slice(5, 7))}/${Number(d.slice(8))}</text>` : '')).join('')}
    <text x="${Math.min(Math.max(peak * bw + bw / 2, 30), W - 30)}" y="14" text-anchor="middle" class="peak-label">${formatMinor(mx, b)}</text>
  </svg>`;
  return h('div', { class: 'trend-wrap', html: svg });
}

function crossTable(exp, people, b) {
  const cell = {};
  const catTotals = {};
  exp.forEach((r) => {
    const { shares } = recordShares(r, b);
    for (const [id, v] of Object.entries(shares)) { cell[id] = cell[id] || {}; cell[id][r.category] = (cell[id][r.category] || 0) + v; catTotals[r.category] = (catTotals[r.category] || 0) + v; }
  });
  const cats = Object.keys(catTotals).sort((x, y) => catTotals[y] - catTotals[x]);
  const short = (v) => (v ? formatMinor(v, b).replace(/^[^\d-]+/, '') : '–');
  return h('div', { class: 'table-wrap' }, h('table', { class: 'people cross' },
    h('thead', {}, h('tr', {}, h('th', {}, '成員'), cats.map((c) => h('th', { title: categoryOf(c).name }, `${categoryOf(c).icon} ${categoryOf(c).name}`)))),
    h('tbody', {}, people.map((m) => h('tr', { class: m.id === S.meId ? 'me' : '' }, h('td', {}, m.name), cats.map((c) => h('td', {}, short((cell[m.id] || {})[c]))))))),
  );
}

function exportBox(net) {
  const csvName = (k) => `${S.ledger.name}-${k}.csv`;
  const copyTable = () => copyText(recordsCsv(S.ledger, S.members, S.records, '\t'), '已複製表格，可直接貼到 Google 試算表或 Excel');
  if (inLineApp()) {
    return h('div', { class: 'export-box' },
      h('p', { class: 'hint' }, 'LINE 內無法下載檔案。可以用瀏覽器開啟後下載，或複製表格直接貼到試算表。'),
      h('button', { class: 'btn primary block', onclick: () => openExternal(webUrl({ l: S.ledger.id, tab: 'stats' })) }, icon('share', 18), '用瀏覽器開啟並下載'),
      h('button', { class: 'btn ghost block', onclick: copyTable }, icon('copy', 18), '複製表格'));
  }
  return h('div', { class: 'export-box' },
    h('div', { class: 'export' },
      h('button', { class: 'btn ghost', onclick: () => download(csvName('明細'), recordsCsv(S.ledger, S.members, S.records)) }, icon('down', 18), '匯出明細'),
      h('button', { class: 'btn ghost', onclick: () => download(csvName('統計'), summaryCsv(S.ledger, S.members, S.records, net)) }, icon('down', 18), '匯出統計')),
    h('button', { class: 'btn ghost block', onclick: copyTable }, icon('copy', 18), '複製表格'),
    h('p', { class: 'hint center' }, 'CSV 可用 Excel 或 Google 試算表開啟；「複製表格」可直接貼上。'));
}

// ---- 成員 ----
function membersTab() {
  const link = ledgerUrl(S.ledger.id, S.ledger.inviteCode);
  const addInput = h('input', { class: 'input', placeholder: '新成員名字', maxlength: 20, onkeydown: (e) => e.key === 'Enter' && addMember() });
  const addMember = async () => {
    const v = addInput.value.trim(); if (!v) return;
    await run(() => store.addMember(S.ledger.id, { name: v }), `已加入 ${v}`); reload();
  };
  const fundToggle = h('input', { type: 'checkbox', class: 'switch', checked: !!S.ledger.fundEnabled, onchange: async (e) => {
    const patch = { fundEnabled: e.target.checked ? 1 : 0 };
    if (e.target.checked && !S.ledger.fundCustodian) patch.fundCustodian = S.meId || (activeMembers()[0] || {}).id || null;
    await run(() => store.updateLedger(S.ledger.id, patch)); reload();
  } });
  return [
    h('div', { class: 'invite' },
      h('div', {}, h('strong', {}, '邀請朋友加入'), h('p', { class: 'hint' }, '只有拿到這個連結的人能加入。朋友點開後，選擇自己是哪一位就能一起記帳。連結外洩時，可在帳本設定重設。')),
      h('div', { class: 'row gap' },
        h('button', { class: 'btn primary grow', onclick: async () => {
          if (await pickAndShare([inviteFlex(S.ledger, link)])) toast('已送出邀請');
          else if (await sendToChat([inviteFlex(S.ledger, link)])) toast('已送出邀請');
          else copyText(link, '已複製邀請連結');
        } }, icon('share', 18), '分享到 LINE'),
        h('button', { class: 'btn ghost', onclick: () => copyText(link, '已複製邀請連結') }, icon('copy', 18), '複製連結'))),
    h('ul', { class: 'member-list' }, S.members.map((m) => h('li', {}, h('button', { class: `member ${m.active ? '' : 'off'}`, onclick: () => memberSheet(m) },
      avatar(m, 40),
      h('span', { class: 'rec-main' }, h('strong', {}, m.name),
        h('small', {}, [m.id === S.meId && '你', m.lineUserId ? '已綁定 LINE' : '尚未綁定', S.ledger.fundEnabled && S.ledger.fundCustodian === m.id && '公費保管人', !m.active && '已停用'].filter(Boolean).join('／'))),
      icon('arrow', 16))))),
    h('div', { class: 'row gap add-row' }, addInput, h('button', { class: 'btn ghost', onclick: addMember }, icon('plus', 18), '新增')),
    h('section', { class: 'fund-set' },
      h('label', { class: 'row between' }, h('span', {}, h('strong', {}, '公費'), h('small', { class: 'hint block' }, '大家先存一筆錢，共同開銷直接從公費付。')), fundToggle),
      S.ledger.fundEnabled ? [
        field('保管人', h('select', { class: 'input', onchange: async (e) => { await run(() => store.updateLedger(S.ledger.id, { fundCustodian: e.target.value }), '已更新保管人'); reload(); } },
          activeMembers().map((m) => h('option', { value: m.id, selected: m.id === S.ledger.fundCustodian }, m.name))), '實際拿著公費現金的人，結算時公費餘額會併入他的帳。'),
        h('button', { class: 'btn ghost block', onclick: () => editor(null, 'fund_in') }, '🏦 存入公費'),
      ] : null),
  ];
}

function memberSheet(m) {
  const editable = !m.lineUserId || m.id === S.meId;
  const pi = m.payInfo || {};
  const name = h('input', { class: 'input', value: m.name, maxlength: 20 });
  const isMe = m.id === S.meId;
  const pay = payFields(pi, !editable);
  const sync = h('input', { type: 'checkbox', class: 'switch', checked: true });
  const close = sheet(m.name, h('div', { class: 'form' },
    field('顯示名稱', name),
    h('h3', { class: 'sec-title' }, '匯款資訊'),
    editable ? null : h('p', { class: 'hint' }, `只有 ${m.name} 本人可以修改匯款資訊。`),
    pay.el,
    isMe ? h('label', { class: 'row between share-toggle' }, h('span', {}, '同步到我所有的帳本', h('small', { class: 'hint block' }, '記住這份資料，其他帳本和之後加入的帳本都自動帶入')), sync) : null,
    h('button', { class: 'btn primary block', onclick: async () => {
      const patch = { name: name.value.trim() || m.name };
      if (editable) patch.payInfo = pay.value();
      if (isMe) patch.syncAll = sync.checked;
      await run(() => store.updateMember(m.id, patch), isMe && sync.checked ? '已儲存，所有帳本已同步' : '已儲存');
      if (isMe && sync.checked && S.me) S.me.payInfo = patch.payInfo;
      close(); reload();
    } }, '儲存'),
    !m.lineUserId && m.id !== S.meId ? h('button', { class: 'btn ghost block', onclick: async () => { await run(() => store.claimMember(m.id), `你現在是 ${m.name}`); close(); reload(); } }, icon('user', 18), '這是我') : null,
    m.active ? h('button', { class: 'btn text-danger block', onclick: async () => {
      if (!(await confirmBox(`移除 ${m.name}？已有紀錄的成員會改為停用，帳目不受影響。`, '移除', { danger: true }))) return;
      const r = await run(() => store.removeMember(m.id));
      toast(r.archived ? `${m.name} 已停用` : `已移除 ${m.name}`); close(); reload();
    } }, icon('trash', 18), '移除成員') : h('button', { class: 'btn ghost block', onclick: async () => { await run(() => store.updateMember(m.id, { active: 1 }), '已恢復'); close(); reload(); } }, '恢復成員')));
}

function identitySheet() {
  const dn = (line.profile.displayName || '').toLowerCase();
  const guess = (m) => dn && (m.name.toLowerCase().includes(dn) || dn.includes(m.name.toLowerCase()));
  const list = activeMembers();
  const close = sheet('你是哪一位？', h('div', { class: 'form' },
    h('p', { class: 'hint' }, '選好之後，你的 LINE 大頭貼會帶入，餘額也會以你的角度顯示。'),
    h('ul', { class: 'member-list' }, list.map((m) => {
      const taken = m.lineUserId && m.lineUserId !== line.profile.userId;
      return h('li', {}, h('button', { class: `member ${guess(m) ? 'suggest' : ''}`, disabled: !!taken, onclick: async () => {
        await run(() => store.claimMember(m.id), `你好，${m.name}`); close(); reload();
      } }, avatar(m, 40), h('span', { class: 'rec-main' }, h('strong', {}, m.name), h('small', {}, taken ? '已被其他人選擇' : m.id === S.meId ? '目前的你' : guess(m) ? '可能是你' : '')), icon('arrow', 16)));
    })),
    h('button', { class: 'btn ghost block', onclick: async () => {
      await run(() => store.addMember(S.ledger.id, { name: line.profile.displayName, claim: true }), '已把你加入帳本'); close(); reload();
    } }, icon('plus', 18), `我不在名單上，加入「${line.profile.displayName}」`)));
}

function settingsSheet() {
  const name = h('input', { class: 'input', value: S.ledger.name, maxlength: 40 });
  const cur = currencySelect(S.ledger.baseCurrency);
  cur.disabled = S.records.length > 0;
  const share = h('input', { type: 'checkbox', class: 'switch', checked: !!S.ledger.shareDefault });
  const fr = { ...(S.ledger.fixedRates || {}) };
  const frBox = h('div', { class: 'fr-list' });
  const addSel = h('select', { class: 'input cur compact', 'aria-label': '選擇要固定的幣別' }, Object.keys(CURRENCIES).filter((c) => c !== S.ledger.baseCurrency).map((c) => h('option', { value: c }, c)));
  const drawFr = () => mount(frBox,
    Object.entries(fr).map(([c, v]) => h('div', { class: 'row gap fr-row' },
      h('span', { class: 'fr-cur' }, `1 ${c} =`),
      h('input', { class: 'input rate', inputmode: 'decimal', value: v, 'aria-label': `${c} 固定匯率`, oninput: (e) => (fr[c] = e.target.value) }),
      h('span', {}, S.ledger.baseCurrency),
      h('button', { class: 'icon-btn sm', 'aria-label': `移除 ${c} 固定匯率`, onclick: () => { delete fr[c]; drawFr(); } }, icon('x', 16)))),
    h('div', { class: 'row gap' }, addSel, h('button', { class: 'btn ghost sm', onclick: async () => {
      const c = addSel.value;
      if (fr[c] !== undefined) return;
      const t = await store.rates(S.ledger.baseCurrency).catch(() => null);
      const v = t && (t.rates || t)[c];
      fr[c] = v ? +Number(v).toPrecision(6) : '';
      drawFr();
    } }, icon('plus', 16), '加入固定匯率')));
  drawFr();
  const close = sheet('帳本設定', h('div', { class: 'form' },
    field('帳本名稱', name),
    field('結算幣別', cur, S.records.length ? '已有紀錄，無法更改結算幣別。' : null),
    field('固定匯率（選用）', frBox, '例如出發前換日圓的匯率。設定後記這個幣別會自動帶入，已記的帳不受影響。'),
    h('label', { class: 'row between' }, h('span', {}, '記帳後預設分享到 LINE'), share),
    h('button', { class: 'btn primary block', onclick: async () => {
      await run(() => store.updateLedger(S.ledger.id, { name: name.value.trim() || S.ledger.name, baseCurrency: cur.value, shareDefault: share.checked ? 1 : 0, fixedRates: Object.fromEntries(Object.entries(fr).filter(([, v]) => Number(v) > 0).map(([c, v]) => [c, Number(v)])) }), '已儲存'); close(); reload();
    } }, '儲存'),
    h('button', { class: 'btn ghost block', onclick: () => copyText(ledgerUrl(S.ledger.id), '已複製帳本連結（限成員開啟）') }, icon('copy', 18), '複製帳本連結（限成員）'),
    h('button', { class: 'btn ghost block', onclick: async () => {
      if (!(await confirmBox('重設後，舊的邀請連結會立刻失效；已經加入的人不受影響。', '重設邀請連結'))) return;
      const l = await run(() => store.resetInvite(S.ledger.id), '已重設邀請連結');
      S.ledger.inviteCode = l.inviteCode; close();
    } }, '重設邀請連結'),
    h('button', { class: 'btn ghost block', onclick: async () => { await run(() => store.updateLedger(S.ledger.id, { archived: S.ledger.archived ? 0 : 1 }), S.ledger.archived ? '已取消封存' : '已封存'); close(); reload(); } }, S.ledger.archived ? '取消封存' : '封存帳本（不能再新增紀錄）'),
    h('button', { class: 'btn text-danger block', onclick: async () => {
      if (!(await confirmBox(`刪除「${S.ledger.name}」？所有紀錄都會消失，無法復原。`, '刪除帳本', { danger: true }))) return;
      await run(() => store.deleteLedger(S.ledger.id), '已刪除帳本'); close(); home();
    } }, icon('trash', 18), '刪除帳本')));
}

// ============ 記帳編輯器 ============
function editor(rec, presetType) {
  const editing = !!rec;
  const b = base();
  const members = activeMembers();
  const r = rec ? structuredClone(rec) : {
    type: presetType || 'expense', title: '', category: 'food', amount: '', currency: S._lastCur || b, rate: 1,
    payerId: S.meId || (members[0] || {}).id, date: today(), note: '',
    split: { mode: 'equal', parts: Object.fromEntries(members.map((m) => [m.id, true])) },
  };
  if (r.type === 'fund_in') r.split = { mode: 'equal', parts: { [FUND_ID]: true } };
  const box = h('div', { class: 'form editor' });
  const shareBox = shareToggle();

  const amount = h('input', { class: 'amount-input', inputmode: 'decimal', placeholder: '0', value: r.amount, 'aria-label': '金額', oninput: () => { r.amount = amount.value; drawSplit(); drawRate(); } });
  const cur = currencySelect(r.currency, true);
  cur.onchange = async () => { r.currency = cur.value; S._lastCur = cur.value; rateSrc = ''; await ensureRate({ force: true }); drawRate(); drawSplit(); };
  const rateBox = h('div', {});
  // 匯率來源：fixed＝帳本固定、date＝消費日匯率、manual＝手動、saved＝原本存的
  let rateSrc = editing ? 'saved' : '';
  let rateDate = '';
  const fetchRates = async (d) => {
    const k = `${b}|${d}`;
    if (!S.rates[k]) S.rates[k] = await store.rates(b, d).catch(() => null);
    return S.rates[k];
  };
  const ensureRate = async ({ force = false } = {}) => {
    if (r.currency === b) { r.rate = 1; rateSrc = ''; return; }
    if (!force && (rateSrc === 'manual' || rateSrc === 'saved')) return;
    const fixed = (S.ledger.fixedRates || {})[r.currency];
    if (fixed) { r.rate = fixed; rateSrc = 'fixed'; return; }
    const t = await fetchRates(r.date);
    const v = t && (t.rates || t)[r.currency];
    if (v) { r.rate = +Number(v).toPrecision(6); rateSrc = 'date'; rateDate = t.date || r.date; }
  };
  const drawRate = () => {
    if (r.currency === b) return rateBox.replaceChildren();
    const inp = h('input', { class: 'input rate', inputmode: 'decimal', value: r.rate, 'aria-label': '匯率', oninput: () => { r.rate = inp.value; rateSrc = 'manual'; drawSplit(); drawConv(); drawSrc(); } });
    const conv = h('span', { class: 'hint' });
    const src = h('div', { class: 'rate-src' });
    const drawConv = () => conv.textContent = Number(r.amount) > 0 && Number(r.rate) > 0 ? `約 ${formatMinor(recordShares({ ...r, split: { mode: 'equal', parts: {} } }, b).total, b)}` : '';
    const drawSrc = () => {
      const label = { fixed: '使用帳本固定匯率', date: rateDate && rateDate !== r.date ? `${r.date} 沒有資料，使用 ${rateDate} 匯率` : `${r.date} 當日匯率`, manual: '手動輸入', saved: '原本儲存的匯率' }[rateSrc] || '';
      mount(src, h('small', { class: 'hint' }, label),
        rateSrc === 'manual' || rateSrc === 'saved' ? h('button', { class: 'link', onclick: async () => { rateSrc = ''; await ensureRate({ force: true }); drawRate(); drawSplit(); } }, '改用當日匯率') : null);
    };
    drawConv(); drawSrc();
    rateBox.replaceChildren(h('div', { class: 'rate-row' }, h('span', {}, `1 ${r.currency} =`), inp, h('span', {}, b), conv), src);
  };

  const typeSeg = h('div', { class: 'seg' }, [['expense', '支出'], ['transfer', '轉帳'], ...(S.ledger.fundEnabled ? [['fund_in', '存入公費']] : [])].map(([k, label]) =>
    h('button', { class: r.type === k ? 'on' : '', onclick: () => {
      if (r.type === k) return; r.type = k;
      if (k === 'fund_in') r.split = { mode: 'equal', parts: { [FUND_ID]: true } };
      else if (k === 'transfer') r.split = { mode: 'amount', parts: {} };
      else r.split = { mode: 'equal', parts: Object.fromEntries(members.map((m) => [m.id, true])) };
      if (r.payerId === FUND_ID && k !== 'expense') r.payerId = S.meId || members[0].id;
      draw();
    } }, label)));

  const title = h('input', { class: 'input', placeholder: '項目名稱，例如：晚餐', value: r.title, maxlength: 40, oninput: () => (r.title = title.value) });
  const date = h('input', { class: 'input', type: 'date', value: r.date, onchange: async () => {
    r.date = date.value;
    if (r.currency !== b && rateSrc !== 'manual') { await ensureRate({ force: true }); drawRate(); drawSplit(); }
  } });
  const note = h('input', { class: 'input', placeholder: '備註（選填）', value: r.note || '', maxlength: 120, oninput: () => (r.note = note.value) });
  const splitBox = h('div', {});

  function personChips(selected, onPick, { withFund = false, exclude } = {}) {
    const opts = [...members.map((m) => [m.id, m.name, m]), ...(withFund ? [[FUND_ID, '公費', { name: '公' }]] : [])].filter(([id]) => id !== exclude);
    return h('div', { class: 'chips scroll' }, opts.map(([id, n, m]) => h('button', { class: `chip person ${selected === id ? 'on' : ''}`, 'aria-pressed': String(selected === id), onclick: () => onPick(id) }, avatar(m, 22), n)));
  }

  function drawSplit() {
    if (r.type !== 'expense') return splitBox.replaceChildren();
    const parts = r.split.parts;
    const mode = r.split.mode;
    const modeSeg = h('div', { class: 'seg sm' }, [['equal', '平分'], ['amount', '自訂金額'], ['shares', '依份數']].map(([k, label]) => h('button', { class: mode === k ? 'on' : '', onclick: () => {
      const on = Object.keys(parts).filter((id) => parts[id]);
      r.split.mode = k;
      r.split.parts = Object.fromEntries(on.map((id) => [id, k === 'equal' ? true : k === 'shares' ? 1 : '']));
      drawSplit();
    } }, label)));
    const preview = Number(r.amount) > 0 && (r.currency === b || Number(r.rate) > 0) ? recordShares(r, b).shares : {};
    const rows = members.map((m) => {
      const on = mode === 'equal' ? !!parts[m.id] : m.id in parts;
      const check = h('input', { type: 'checkbox', checked: on, 'aria-label': `${m.name} 參與分攤`, onchange: () => {
        if (check.checked) parts[m.id] = mode === 'equal' ? true : mode === 'shares' ? 1 : ''; else delete parts[m.id];
        drawSplit();
      } });
      const val = mode === 'equal' ? null : h('input', { class: 'input mini', inputmode: 'decimal', value: on ? parts[m.id] : '', disabled: !on, 'aria-label': `${m.name} ${mode === 'amount' ? '金額' : '份數'}`,
        oninput: (e) => { parts[m.id] = e.target.value; drawSum(); updatePreview(); } });
      const pv = h('span', { class: 'split-pv', 'data-id': m.id }, preview[m.id] ? formatMinor(preview[m.id], b) : '');
      return h('label', { class: `split-row ${on ? '' : 'off'}` }, check, avatar(m, 26), h('span', { class: 'grow' }, m.name), val, pv);
    });
    const sum = h('p', { class: 'hint split-sum' });
    const drawSum = () => {
      if (mode !== 'amount') return (sum.textContent = '');
      const s = Object.values(parts).reduce((a, v) => a + (Number(v) || 0), 0);
      const left = (Number(r.amount) || 0) - s;
      sum.textContent = Math.abs(left) < 1e-9 ? '金額剛好分配完畢' : left > 0 ? `還差 ${formatMoney(left, r.currency)}` : `超出 ${formatMoney(-left, r.currency)}`;
      sum.classList.toggle('neg', Math.abs(left) >= 1e-9);
    };
    const updatePreview = () => {
      const ok = Number(r.amount) > 0 && (r.currency === b || Number(r.rate) > 0);
      const pv = ok ? recordShares(r, b).shares : {};
      splitBox.querySelectorAll('.split-pv').forEach((el) => (el.textContent = pv[el.dataset.id] ? formatMinor(pv[el.dataset.id], b) : ''));
    };
    drawSum();
    const allOn = members.every((m) => (mode === 'equal' ? parts[m.id] : m.id in parts));
    splitBox.replaceChildren(h('div', { class: 'row between' }, h('span', { class: 'field-label' }, '誰要分攤'), h('button', { class: 'link', onclick: () => {
      members.forEach((m) => (allOn ? delete parts[m.id] : (parts[m.id] = parts[m.id] ?? (mode === 'equal' ? true : mode === 'shares' ? 1 : ''))));
      drawSplit();
    } }, allOn ? '全部取消' : '全選')), modeSeg, h('div', { class: 'split-list' }, rows), sum);
  }

  function draw() {
    typeSeg.querySelectorAll('button').forEach((btn, i) => btn.className = ['expense', 'transfer', 'fund_in'][i] === r.type ? 'on' : '');
    const toId = r.type === 'transfer' ? Object.keys(r.split.parts)[0] : null;
    mount(box,
      typeSeg,
      h('div', { class: 'amount-row' }, cur, amount),
      rateBox,
      r.type === 'expense' ? [field('項目', title), h('div', { class: 'chips scroll cats' }, CATEGORIES.map((c) => h('button', { class: `chip ${r.category === c.id ? 'on' : ''}`, onclick: () => { r.category = c.id; draw(); } }, `${c.icon} ${c.name}`)))] : null,
      h('div', {}, h('span', { class: 'field-label' }, r.type === 'expense' ? '誰先付的' : r.type === 'transfer' ? '誰轉出' : '誰存入'),
        personChips(r.payerId, (id) => { r.payerId = id; if (r.type === 'transfer' && r.split.parts[id] !== undefined) r.split.parts = {}; draw(); }, { withFund: r.type === 'expense' && !!S.ledger.fundEnabled })),
      r.type === 'transfer' ? h('div', {}, h('span', { class: 'field-label' }, '轉給誰'), personChips(toId, (id) => { r.split.parts = { [id]: r.amount || 0 }; draw(); }, { exclude: r.payerId })) : null,
      splitBox,
      h('div', { class: 'grid2' }, field('日期', date), field('備註', note)),
      shareBox.el,
      h('button', { class: 'btn primary block', onclick: saveIt }, editing ? '儲存修改' : '記下這筆'),
      editing ? h('button', { class: 'btn text-danger block', onclick: deleteIt }, icon('trash', 18), '刪除這筆') : null);
    drawSplit();
  }

  async function saveIt() {
    if (r.type === 'transfer') { const to = Object.keys(r.split.parts)[0]; if (to) r.split = { mode: 'amount', parts: { [to]: Number(r.amount) } }; }
    const out = { type: r.type, title: r.title.trim() || (r.type === 'fund_in' ? '存入公費' : r.type === 'transfer' ? '轉帳' : categoryOf(r.category).name), category: r.category, amount: Number(r.amount), currency: r.currency, rate: r.currency === b ? 1 : Number(r.rate), payerId: r.payerId, split: r.split, date: r.date || today(), note: r.note || '' };
    const errs = validateRecord(out);
    if (out.currency !== b && !(out.rate > 0)) errs.push('請輸入匯率');
    if (errs.length) return toast(errs[0], 'err');
    const saved = await run(() => (editing ? store.updateRecord(rec.id, out) : store.addRecord(S.ledger.id, out)), editing ? '已儲存修改' : '已記下');
    close();
    if (shareBox.on()) await shareRecord(editing ? 'update' : 'create', { ...out, ...saved });
    reload();
  }
  async function deleteIt() {
    const sb = shareToggle();
    if (!(await confirmBox(`刪除「${rec.title}」？`, '刪除', { danger: true, extra: sb.el }))) return;
    await run(() => store.deleteRecord(rec.id), '已刪除');
    close();
    if (sb.on()) await shareRecord('delete', rec);
    reload();
  }

  const titles = { expense: editing ? '編輯支出' : '記一筆', transfer: '轉帳', fund_in: '存入公費' };
  const close = sheet(editing ? titles[r.type].replace('記一筆', '編輯紀錄') : titles[r.type], box, { tall: true });
  draw();
  ensureRate().then(drawRate).then(drawSplit);
  setTimeout(() => !editing && amount.focus(), 260);
}

// ============ 共用元件 ============
function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('small', { class: 'hint' }, hint) : null);
}
function currencySelect(value, compact) {
  return h('select', { class: `input cur ${compact ? 'compact' : ''}`, 'aria-label': '幣別' }, Object.entries(CURRENCIES).map(([k, c]) => h('option', { value: k, selected: k === value }, compact ? `${k}` : `${k}　${c.name}`)));
}
function shareToggle() {
  const cb = h('input', { type: 'checkbox', class: 'switch', checked: S.ledger ? !!S.ledger.shareDefault : true });
  const hint = line.demo ? '示範模式不會真的傳到 LINE' : canSendToChat() ? '會以你的名義傳到這個聊天室' : S.ledger && S.ledger.groupId ? '由記帳機器人通知群組' : '需從 LINE 聊天室開啟才能分享';
  return { el: h('label', { class: 'row between share-toggle' }, h('span', {}, '分享到 LINE 群組', h('small', { class: 'hint block' }, hint)), cb), on: () => cb.checked };
}
async function shareRecord(action, rec) {
  const msg = recordFlex(action, rec, S.ledger, S.members, ledgerUrl(S.ledger.id));
  if (line.demo) return toast('示範模式：已略過分享到 LINE');
  if (await sendToChat([msg])) return;
  if (S.ledger.groupId) { try { await store.notifyGroup(S.ledger.id, [msg]); return; } catch { /* fallthrough */ } }
  toast('未在 LINE 聊天室中開啟，這次沒有分享');
}

// ============ 啟動 ============
(async function boot() {
  try {
    await initLine();
    const qs = new URLSearchParams(location.search);
    S.groupId = qs.get('g');
    const l = qs.get('l');
    if (!line.demo) S.me = await store.me().catch(() => null);
    if (['list', 'settle', 'stats', 'members'].includes(qs.get('tab'))) S.tab = qs.get('tab');
    if (l) {
      await openLedger(l, { join: qs.get('join') });
      const rid = qs.get('r');
      const rec = rid && S.records.find((x) => x.id === rid);
      if (rec) editor(rec);
    } else await home();
  } catch (e) {
    console.error(e);
    app.replaceChildren(h('div', { class: 'empty fatal' }, h('p', { class: 'big' }, '無法開啟 Sharing'), h('p', {}, e.message || String(e)), h('button', { class: 'btn primary', onclick: () => location.reload() }, '重新載入')));
  } finally {
    document.body.classList.remove('booting');
  }
})();

