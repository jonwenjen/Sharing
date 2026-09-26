// Sharing 主程式：帳本列表、帳本（明細／結算／統計／成員）、記帳編輯器
import { line, initLine, ledgerUrl, pickAndShare, inLineApp, openExternal, webUrl } from './line.js';
import { store } from './store.js';
import { h, mount, fitText, emptyArt, skeleton, icon, avatar, toast, sheet, confirmBox, copyText, download } from './ui.js';
import {
  CURRENCIES, CATEGORIES, FUND_ID, categoryOf, formatMoney, formatMinor, fromMinor, decimalsOf, recordShares, amountSplit,
  settlementBalances, fundCash, stats, validateRecord, currencyGroups, guessCategory, evalAmount, allocate,
} from './money.js';
import { minTransfers } from './settle.js';
import { ladderSetup } from './ladderui.js';
import { fingerSetup } from './fingerui.js';
import { foodSetup } from './foodwheel.js';
import { recordFlex, inviteFlex, settleAllText, recordsCsv, summaryCsv, describeRecord } from './messages.js';

const S = { ledger: null, members: [], records: [], meId: null, tab: 'list', rates: {}, scope: 'all', cur: null, groupId: null, filter: { kind: 'all', cat: null, date: null }, flash: null };
// C4：記住最近開啟的帳本（只存在這支手機）
const RECENT_KEY = () => `sharing-recent-${line.profile ? line.profile.userId : ''}`;
const recentMap = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY())) || {}; } catch { return {}; } };
const touchRecent = (id) => { try { const m = recentMap(); m[id] = Date.now(); localStorage.setItem(RECENT_KEY(), JSON.stringify(m)); } catch { /* 無痕模式 */ } };
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
let viewToken = 0; // 避免慢回應蓋掉使用者已經切到的畫面
async function home() {
  const token = ++viewToken;
  S.ledger = null;
  setUrl({ g: S.groupId });
  const list = await run(() => store.listLedgers());
  if (token !== viewToken) return;
  const groupList = S.groupId ? await store.groupLedgers(S.groupId).catch(() => []) : [];
  if (token !== viewToken) return;
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
    l.myNet != null ? h('span', { class: `lc-bal ${l.myNet > 0 ? 'pos' : l.myNet < 0 ? 'neg' : ''}` },
      h('small', {}, l.myNet > 0 ? '應收' : l.myNet < 0 ? '應付' : '已結清'),
      l.myNet ? h('strong', {}, formatMinor(Math.abs(l.myNet), l.baseCurrency)) : null) : null,
    icon('arrow', 18));
  const groupOnly = groupList.filter((l) => !mine.has(l.id));
  const own = list.filter((l) => !l.viaAdmin);
  const adminOnly = list.filter((l) => l.viaAdmin);
  const recent = recentMap();
  const byRecent = (a, b) => (recent[b.id] || 0) - (recent[a.id] || 0) || (b.updatedAt || 0) - (a.updatedAt || 0);
  const sortA = (arr) => [...arr.filter((l) => !l.archived).sort(byRecent), ...arr.filter((l) => l.archived).sort(byRecent)];
  mount(app,
    h('header', { class: 'top home-top' },
      h('div', { class: 'brand' }, h('span', { class: 'brand-mark' }, 'S'), 'Sharing'),
      h('div', { class: 'top-actions' }, h('button', { class: 'icon-btn', 'aria-label': '使用說明', onclick: helpSheet }, icon('help')),
      h('button', { class: 'me-chip', 'aria-label': '我的帳號', onclick: accountSheet }, S.me && S.me.isAdmin ? h('em', { class: 'tag admin' }, '管理員') : null, avatar({ name: line.profile.displayName, avatar: line.profile.pictureUrl }, 30)))),
    line.demo ? h('p', { class: 'demo-note' }, '示範模式：資料只存在這支手機的瀏覽器。', h('button', { class: 'link', onclick: async () => { await store.reset(); home(); } }, '重設示範資料')) : null,
    h('main', { class: 'home' },
      h('h1', { class: 'home-title' }, '帳本'),
      groupOnly.length ? h('section', {}, h('h3', { class: 'sec-title' }, '這個 LINE 群組的帳本'), h('div', { class: 'stack' }, groupOnly.map(card))) : null,
      own.length
        ? h('div', { class: 'stack' }, sortA(own).map(card))
        : adminOnly.length ? h('p', { class: 'hint' }, '你還沒有自己的帳本。')
          : h('div', { class: 'empty' }, emptyArt(), h('p', {}, '還沒有帳本。建立一本，或請朋友傳邀請連結給你。')),
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

// ============ 爬梯子 ============
function openLadder() {
  const canShare = !line.demo && S.ledger.groupId && (S.meId || (S.viewer && S.viewer.isCreator));
  ladderSetup({
    members: activeMembers(),
    ledgerName: S.ledger.name,
    run: (p) => store.ladder(S.ledger.id, p),
    share: canShare ? async (game) => {
      try {
        const r = await store.shareLadder(game.id);
        if (r && r.ok) { toast(`已傳到「${S.ledger.groupName || 'LINE 群組'}」`); return true; }
        toast('LINE 拒絕了這則訊息', 'err');
      } catch (e) { toast(e.message, 'err'); }
      return false;
    } : null,
  });
}

// ============ 使用說明 ============
function helpSheet() {
  const sec = (title, items, open = false) => h('details', { open },
    h('summary', {}, title),
    h('ul', {}, items.map((x) => h('li', { html: x }))));
  sheet('使用說明', h('div', { class: 'help' },
    sec('在 LINE 群組裡', [
      '把<b>記帳機器人</b>拉進群組，按它貼出的「開始記帳」建立帳本，這本帳本就會連結這個群組。',
      '輸入 <code>記帳</code>：叫出開啟帳本的按鈕。',
      '輸入 <code>結算</code>：直接回覆「誰要轉給誰多少」，而且轉帳筆數最少。',
      '輸入 <code>說明</code>：顯示快速記帳格式。',
      '記帳、修改、刪除的通知<b>只會</b>由機器人傳到帳本連結的那個群組。',
    ], true),
    sec('在 LINE 直接打字記帳', [
      '<code>+1200 晚餐</code>：全員平分，用帳本的幣別。',
      '<code>+3000 JPY 拉麵 @小安 @我</code>：指定幣別與分攤的人；<code>@我</code> 代表自己，也可以用 LINE 的「提及」。',
      '幣別可寫 <code>JPY</code>、<code>円</code>、<code>日幣</code>、<code>¥</code>、<code>美金</code>、<code>韓元</code>…，分類會依項目名稱自動判斷。',
      '付款人＝發訊息的人。要先在網頁上選好自己的身分才能用。',
      '機器人回覆的卡片上可以按「修改」或「取消這筆」（只有記帳本人能取消）。',
    ]),
    sec('第一次加入帳本', [
      '朋友點你分享的<b>邀請連結</b>後，會先看到「歡迎加入」，從名單選自己，或按最下方「我不在名單上，加入」。',
      '只有帳本成員、連結群組的成員、拿到邀請連結的人才能進入帳本。連結外洩時可在設定裡重設。',
    ]),
    sec('記一筆', [
      '右下角「記一筆」：輸入金額、選幣別，外幣會依<b>消費日期</b>自動帶入當天匯率（可手動改，或在設定裡用固定匯率）。',
      '項目名稱下方可快速選分類：早午餐、晚餐、餐飲、飲料、甜點、交通、住宿…。',
      '「誰先付的」選付款人；有開公費時也可以選「公費」。',
      '分攤方式：<b>平分</b>、<b>自訂金額</b>、<b>依份數</b>。取消勾選的人不分攤。',
      '自訂金額填的總和不夠時，可選「<b>所有人平均</b>」（預設，所有勾選的人平均分攤差額）或「<b>沒填的人平均</b>」（只由勾選但沒填金額的人平分）。',
      '最下方的開關決定這筆要不要通知 LINE 群組。',
    ]),
    sec('結算、統計、匯出', [
      '<b>結算</b>：列出最少的轉帳方式，收款人的匯款資訊可一鍵複製；轉完帳按「記為已付款」。右上角可切換顯示幣別（依今日匯率換算，僅供參考）。',
      '<b>統計</b>：每日花費、分類占比、前 5 大支出、每人 × 分類；可切換「全體／我的」。',
      '<b>匯出</b>：CSV 或「複製表格」直接貼到試算表。在 LINE 裡無法下載時，按「用瀏覽器開啟並下載」。',
    ]),
    sec('成員、公費、匯款資訊', [
      '<b>成員</b>分頁：分享邀請連結、新增或移除成員（有帳目的成員會改為停用）。',
      '<b>匯款資訊</b>：首頁右上角頭像填一次，所有帳本自動同步，新帳本也會自動帶入。',
      '<b>公費</b>：開啟後指定保管人，用「存入公費」記錄大家交的錢，花費時付款人選「公費」。「誰存入」可以複選、預設全選，勾幾位金額就平分成幾筆。',
    ]),
    sec('爬梯子（右上角梯子圖示）', [
      '公平的隨機分配：每條路徑一對一，絕對不會重複；亂數由伺服器產生，誰也改不了結果。',
      '先選參加的人（預設全部），再選模式：<b>命運</b>（選出幾位）、<b>配對</b>（分成幾組）、<b>優先權</b>（排出順序）。',
      '按「開始」後倒數 3、2、1，所有人同時出發；橫線和終點全程蓋住，路徑走到哪才亮到哪，約 5 秒揭曉。',
      '結果可以分享到連結的 LINE 群組（每次只能分享一次）、複製，或再來一次。',
    ]),
    sec('手指抽籤（右上角手指圖示）', [
      '大家圍著同一支手機，每人放 <b>一根手指</b> 在螢幕上，每根手指會出現不同顏色的小動物。',
      '第一根手指放上後倒數 <b>3 秒</b>鎖定（倒數中還能加入），接著亮點在手指間亂跳，<b>5 秒內</b>揭曉。',
      '模式和爬梯子一樣：<b>命運</b>（選出幾位）、<b>配對</b>（分成幾組，同組會連線）、<b>優先權</b>（排出順序）。',
      '揭曉後就算放開手指，結果也會留在畫面上；按「再來一次」重新開始。沒有觸控螢幕時可以用滑鼠點一下新增一位。',
    ]),
    sec('吃什麼轉盤（右上角轉盤圖示）', [
      '先在上方選大項：<b>餐點</b>（正餐、麥當勞等速食、超商）、<b>小吃</b>、<b>飲料</b>（50嵐、清心福全、迷客夏等南部起家品牌和常見飲品）、<b>甜點</b>。',
      '下面會出現這個大項的細項，預設全選；可以一鍵全選、全部取消、整區全選或取消，或點卡片挑掉不想要的。',
      '也能加入自己的選項（例如巷口那家麵店），會加在目前的大項裡；選擇會記在這支手機上，下次打開還在。',
      '按「轉」後點中間的「轉！」，停下來就揭曉。不喜歡可以「再轉一次」，或「不要這個」拿掉後重轉。',
      '按「就選這個」會回到轉盤主畫面，結果顯示在最上面；按「記一筆」會直接打開記帳並填好項目名稱和分類。',
    ]),
    sec('音效與震動', [
      '爬梯子、手指抽籤、吃什麼轉盤都有音效和震動：倒數嗶嗶、GO！、一路喀喀喀、揭曉時碰一聲再來段勝利號角。',
      '遊戲畫面右上角的喇叭可以關掉音效（震動照舊），設定會記在這支手機。',
      'iPhone 開著靜音模式時聽不到音效；震動需要 iOS 18 以上。',
    ]),
    sec('記帳小技巧', [
      '金額可以直接輸入算式，例如 <code>1200+350</code>，旁邊的「+」鍵可以快速加上另一筆。',
      '項目名稱打「晚餐」「咖啡」等字，分類會自動幫你選好。',
      '新增時會記住上一次的付款人、幣別和分攤的人。',
      '打開一筆支出，按「複製成新的一筆」，適合每晚住宿這種重複的花費。',
      '同一個人重複加入時，到成員資料按「和另一位成員合併」，紀錄會移過去、金額不變。',
    ]),
    sec('帳本設定（標題下方右側齒輪）', [
      '修改名稱、固定匯率、預設是否分享到 LINE。',
      '<b>不同幣別合併結算</b>（預設開啟）：開啟時全部換算成結算幣別一起算；關閉後各幣別分開結算與統計、不換匯，結算和統計頁可以切換幣別。',
      '「連結到目前的 LINE 群組」：從群組裡的機器人按鈕開啟後，可把帳本連結到那個群組。',
      '重設邀請連結、封存帳本（不能再新增）、刪除帳本（只有建立者可以）。',
    ]),
  ), { tall: true });
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
  const token = ++viewToken;
  const y = window.scrollY;
  let data = null;
  if (!keepScroll) {
    mount(app, h('header', { class: 'top' }, h('button', { class: 'icon-btn', 'aria-label': '回帳本列表', onclick: home }, icon('back')), h('h1', { class: 'top-title' }, '')), h('main', { class: 'ledger' }, skeleton()));
    if (!S.ledger || S.ledger.id !== id) { S.filter = { kind: 'all', cat: null, date: null }; S.cur = null; }
  }
  busy(true);
  try { data = await store.getLedger(id, join); }
  catch (e) { busy(false); if (e.code === 'NO_ACCESS') return noAccess(e.message); toast(e.message || '無法開啟帳本', 'err'); return home(); }
  busy(false);
  if (token !== viewToken) return;
  if (join) toast('已加入帳本');
  Object.assign(S, { ledger: data.ledger, members: data.members, records: data.records, viewer: data.viewer || {} });
  S.meId = (S.members.find((m) => m.lineUserId === line.profile.userId) || {}).id || null;
  setUrl({ l: id });
  touchRecent(id);
  renderLedger();
  if (keepScroll) window.scrollTo(0, y);
  const adminOnly = S.viewer.isAdmin && !S.meId && !S.viewer.isCreator;
  // 還不是這本帳本的成員（例如剛用邀請連結進來）：先選身分或加入，才能使用帳本
  if (!S.meId && !adminOnly && !document.querySelector('.sheet-wrap.identity')) identitySheet({ required: true });
}
const reload = () => openLedger(S.ledger.id, { keepScroll: true });

const merged = () => S.ledger.mergeCurrencies == null || !!S.ledger.mergeCurrencies;
/** 依帳本設定取得結算群組（合併＝一組；分開＝每個幣別一組） */
function groups() {
  return currencyGroups(S.records, S.ledger).map((g) => {
    const s = settlementBalances(g.records, g.currency, custodian());
    return { ...g, net: s.net, fundUnassigned: s.fundUnassigned, stats: stats(g.records, g.currency) };
  });
}
/** 目前選到的幣別群組（分開結算時用）；找不到就用第一個 */
const pickGroup = (gs) => gs.find((g) => g.currency === S.cur) || gs[0];

// 轉盤結果 → 記一筆：飲料、甜點直接用大項的分類；餐點、小吃先猜（例如早午餐），猜不到就用餐飲
function pickFood(name, group) {
  if (S.ledger.archived) return toast('帳本已封存，無法新增');
  const g = guessCategory(name);
  const category = group && group.cat !== 'food' ? group.cat : g === 'other' || g === 'drink' || g === 'dessert' ? 'food' : g;
  editor(null, null, { preset: { title: name, category } });
}

function renderLedger() {
  const b = base();
  const gs = groups();
  if (!merged() && !S.cur) S.cur = 'all';
  const g0 = merged() ? gs[0] : pickGroup(gs);
  const { net, fundUnassigned } = g0;
  const st = g0.stats;
  const mine = S.meId ? net[S.meId] || 0 : null;
  const myLines = merged() ? null : gs.map((g) => ({ cur: g.currency, v: S.meId ? g.net[S.meId] || 0 : 0, total: g.stats.total })).filter((x) => x.v || x.total);
  const tabs = [['list', '明細'], ['settle', '結算'], ['stats', '統計'], ['members', '成員']];
  const meRow = h('span', { class: 't-who' }, avatar(S.members.find((m) => m.id === S.meId), 22), `你是 ${memberName(S.meId)}`, h('button', { class: 'link', onclick: identitySheet }, '更換'));
  const ticket = h('section', { class: 'ticket', 'aria-label': '我的結算' },
    h('div', { class: 'ticket-main' },
      !S.meId ? [h('span', { class: 't-label' }, '先告訴我們你是誰'), h('button', { class: 'btn primary', onclick: identitySheet }, '選擇我的身分')]
        : merged() ? [h('span', { class: 't-label' }, mine > 0 ? '結清後你會收到' : mine < 0 ? '結清時你需要付' : '你目前沒有欠款'),
          h('strong', { class: `t-amount ${mine > 0 ? 'pos' : mine < 0 ? 'neg' : ''}` }, formatMinor(Math.abs(mine), b)), meRow]
        : [h('span', { class: 't-label' }, myLines.some((x) => x.v) ? '我的結算（各幣別分開）' : '你目前沒有欠款'),
          h('div', { class: 'multi-cur' }, myLines.map((x) => h('span', { class: `mc-line ${x.v > 0 ? 'pos' : x.v < 0 ? 'neg' : ''}` },
            h('em', {}, x.cur), h('b', {}, x.v ? formatMinor(x.v, x.cur, { sign: true }) : '已結清'))) ), meRow]),
    h('div', { class: 'ticket-stub' },
      h('span', { class: 't-label' }, '總支出'),
      merged() ? h('strong', {}, formatMinor(st.total, b))
        : h('div', { class: 'multi-cur stub' }, myLines.map((x) => h('span', { class: 'mc-line' }, h('b', {}, formatMinor(x.total, x.cur))))),
      h('span', { class: 't-label' }, `${S.records.length} 筆紀錄`)));
  const body = { list: listTab, settle: () => settleTab(gs), stats: () => statsTab(gs), members: membersTab }[S.tab]();
  mount(app,
    h('header', { class: 'top' },
      h('button', { class: 'icon-btn', 'aria-label': '回帳本列表', onclick: home }, icon('back')),
      h('h1', { class: 'top-title' }, S.ledger.name),
      h('div', { class: 'top-actions' },
        h('button', { class: 'icon-btn', 'aria-label': '爬梯子', onclick: openLadder }, icon('ladder')),
        h('button', { class: 'icon-btn', 'aria-label': '手指抽籤', onclick: fingerSetup }, icon('finger')),
        h('button', { class: 'icon-btn', 'aria-label': '吃什麼轉盤', onclick: () => foodSetup({ onPick: pickFood }) }, icon('wheel')))),
    h('main', { class: 'ledger' },
      S.viewer && S.viewer.isAdmin && !S.meId ? h('p', { class: 'admin-banner' }, '🔑 管理員檢視：你不是這本帳本的成員') : null,
      h('div', { class: 'ledger-sub' },
        h('p', { class: 'ledger-meta' }, S.ledger.groupId ? `👥 ${S.ledger.groupName || 'LINE 群組'}` : '未連結群組', `　建立者 ${S.ledger.creatorName || '—'}`),
        h('div', { class: 'sub-actions' },
          h('button', { class: 'icon-btn sm', 'aria-label': '使用說明', onclick: helpSheet }, icon('help', 20)),
          h('button', { class: 'icon-btn sm', 'aria-label': '帳本設定', onclick: settingsSheet }, icon('gear', 20)))),
      ticket,
      h('nav', { class: 'tabs', role: 'tablist' }, tabs.map(([k, label]) => h('button', {
        role: 'tab', 'aria-selected': String(S.tab === k), class: S.tab === k ? 'on' : '',
        onclick: () => { S.tab = k; renderLedger(); },
      }, label))),
      h('div', { class: 'tab-body', role: 'tabpanel' }, body)),
    S.ledger.archived || S.tab !== 'list' ? null : h('button', { class: 'fab', onclick: () => (S.meId || (S.viewer && S.viewer.isAdmin) ? editor() : identitySheet({ required: true })), 'aria-label': '記一筆' }, icon('plus', 22), h('span', {}, '記一筆')));
  fitText(app, '.t-amount, .ticket-stub strong, .stat-total strong', 14);
}

// ---- 明細 ----
function listTab() {
  if (!S.records.length) return h('div', { class: 'empty' }, emptyArt(), h('p', {}, '還沒有任何紀錄。'), h('p', { class: 'hint' }, '按右下角「記一筆」，誰先付、幾個人分，一次填好。'));
  const b = base();
  const f = S.filter;
  const setF = (patch) => { S.filter = { ...f, ...patch }; renderLedger(); };
  const cats = [...new Set(S.records.filter((r) => r.type === 'expense').map((r) => r.category))];
  const chip = (label, on, onclick) => h('button', { class: `chip ${on ? 'on' : ''}`, 'aria-pressed': String(!!on), onclick }, label);
  const bar = h('div', { class: 'chips filters', role: 'group', 'aria-label': '篩選' },
    chip('全部', f.kind === 'all' && !f.cat && !f.date, () => setF({ kind: 'all', cat: null, date: null })),
    S.meId ? chip('我付的', f.kind === 'paid', () => setF({ kind: f.kind === 'paid' ? 'all' : 'paid' })) : null,
    S.meId ? chip('跟我有關', f.kind === 'mine', () => setF({ kind: f.kind === 'mine' ? 'all' : 'mine' })) : null,
    cats.map((c) => chip(`${categoryOf(c).icon} ${categoryOf(c).name}`, f.cat === c, () => setF({ cat: f.cat === c ? null : c }))),
    f.date ? chip(`📅 ${Number(f.date.slice(5, 7))}/${Number(f.date.slice(8))} ✕`, true, () => setF({ date: null })) : null);
  const keep = (r) => {
    if (f.cat && !(r.type === 'expense' && r.category === f.cat)) return false;
    if (f.date && r.date !== f.date) return false;
    if (f.kind === 'paid') return r.payerId === S.meId;
    if (f.kind === 'mine') return r.payerId === S.meId || !!recordShares(r, b).shares[S.meId];
    return true;
  };
  const list = S.records.filter(keep);
  if (!list.length) return [bar, h('div', { class: 'empty' }, h('p', {}, '沒有符合篩選的紀錄。'), h('button', { class: 'link', onclick: () => setF({ kind: 'all', cat: null, date: null }) }, '清除篩選'))];
  const flash = S.flash; S.flash = null;
  const sorted = [...list].sort((x, y) => (x.date === y.date ? y.createdAt - x.createdAt : x.date < y.date ? 1 : -1));
  const groups = {};
  sorted.forEach((r) => (groups[r.date] = groups[r.date] || []).push(r));
  const wd = '日一二三四五六';
  return [bar, ...Object.entries(groups).map(([date, rs]) => {
    const d = new Date(date + 'T00:00:00');
    return h('section', { class: 'day' },
      h('h3', { class: 'day-head' }, `${d.getMonth() + 1} 月 ${d.getDate()} 日（${wd[d.getDay()]}）`),
      h('ul', { class: 'rec-list' }, rs.map((r) => {
        const { total, shares } = recordShares(r, b);
        const effect = S.meId ? (r.payerId === S.meId ? total : 0) - (shares[S.meId] || 0) : 0;
        const glyph = r.type === 'expense' ? categoryOf(r.category).icon : r.type === 'transfer' ? '⇄' : '🏦';
        return h('li', {}, h('button', { class: `rec ${r.id === flash ? 'flash' : ''}`, onclick: () => editor(r) },
          h('span', { class: `rec-ic t-${r.type}` }, glyph),
          h('span', { class: 'rec-main' }, h('strong', {}, r.title || describeRecord(r, S.members)), h('small', {}, describeRecord(r, S.members))),
          h('span', { class: 'rec-amt' },
            h('strong', {}, formatMoney(Number(r.amount), r.currency)),
            r.currency !== b ? h('small', {}, `≈ ${formatMinor(total, b)}`) : null,
            effect ? h('small', { class: effect > 0 ? 'pos' : 'neg' }, `你 ${formatMinor(effect, b, { sign: true })}`) : null)));
      })));
  })];
}

// ---- 結算 ----
/** 分開結算時的幣別選擇列 */
function curChips(gs, extra, active = S.cur) {
  return h('div', { class: 'chips filters', role: 'group', 'aria-label': '幣別' },
    gs.map((g) => h('button', {
      class: `chip ${active === g.currency ? 'on' : ''}`, 'aria-pressed': String(active === g.currency),
      onclick: () => { S.cur = g.currency; renderLedger(); },
    }, `${CURRENCIES[g.currency] ? CURRENCIES[g.currency].symbol : ''} ${g.currency}`)),
    extra || null);
}

function settleTab(gs) {
  if (merged()) return settleGroup(gs[0]);
  const all = h('button', { class: `chip ${S.cur === 'all' ? 'on' : ''}`, 'aria-pressed': String(S.cur === 'all'), onclick: () => { S.cur = 'all'; renderLedger(); } }, '全部幣別');
  return [curChips(gs, all),
    h('p', { class: 'hint' }, '這本帳本各幣別分開結算，不會換匯。'),
    ...gs.filter((g) => S.cur === 'all' || S.cur === g.currency).map((g) => h('section', { class: 'cur-section' },
      h('h3', { class: 'sec-title' }, `${g.currency} 的結算`), settleGroup(g)))];
}

function settleGroup({ net, fundUnassigned, currency, records }) {
  const b = currency;
  let transfers = [];
  try { transfers = minTransfers(net); } catch (e) { return h('p', { class: 'warn' }, e.message); }
  const out = [];
  if (S.ledger.fundEnabled) {
    out.push(h('div', { class: 'fund-card' },
      h('div', {}, h('span', { class: 't-label' }, '公費餘額'), h('strong', {}, formatMinor(fundCash(records, b), b))),
      h('p', {}, S.ledger.fundCustodian ? `由 ${memberName(S.ledger.fundCustodian)} 保管，結算時已併入他的帳。` : '尚未指定保管人，請到「成員」設定。')));
  }
  if (fundUnassigned) out.push(h('p', { class: 'warn' }, `公費有 ${formatMinor(fundUnassigned, b)} 尚未指定保管人，結算結果暫不含這筆。`));
  if (!transfers.length) {
    out.push(h('div', { class: 'empty done' }, emptyArt(), h('p', { class: 'big' }, '已經結清'), h('p', { class: 'hint' }, '目前沒有人需要轉帳。')));
    return out;
  }
  const dc = merged() ? (S.settleCur || b) : b;
  const lr = S.rates[`${b}|latest`];
  if (dc !== b && !lr) store.rates(b).then((t) => { S.rates[`${b}|latest`] = t; renderLedger(); }).catch(() => toast('暫時取不到匯率', 'err'));
  const rateOf = (c) => lr && (lr.rates || lr)[c];
  const show = (minor) => {
    if (dc === b || !rateOf(dc)) return formatMinor(minor, b);
    const d = decimalsOf(dc);
    return formatMoney(Math.round((fromMinor(minor, b) / rateOf(dc)) * 10 ** d) / 10 ** d, dc);
  };
  const curSel = merged() ? h('select', { class: 'input cur compact', 'aria-label': '顯示幣別', onchange: (e) => { S.settleCur = e.target.value; renderLedger(); } },
    Object.keys(CURRENCIES).map((k) => h('option', { value: k, selected: k === dc }, k))) : null;
  out.push(h('div', { class: 'row between settle-head' }, h('p', { class: 'settle-sum' }, `只要 ${transfers.length} 筆轉帳就能結清`), curSel));
  if (dc !== b) out.push(h('p', { class: 'hint' }, lr ? `以 ${lr.date || '今日'} 匯率從 ${b} 換算，僅供參考；「記為已付款」仍以 ${b} 記錄。` : '載入匯率中…'));
  const xferItem = (t) => {
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
      h('button', { class: 'btn ghost sm', onclick: () => markPaid({ ...t, currency: b }) }, icon('check', 16), '記為已付款'));
  };
  // B2：跟我有關的放最上面
  const groupsX = S.meId
    ? [['我要付的', transfers.filter((t) => t.from === S.meId)], ['要付給我的', transfers.filter((t) => t.to === S.meId)], ['其他人', transfers.filter((t) => t.from !== S.meId && t.to !== S.meId)]]
    : [[null, transfers]];
  groupsX.filter(([, arr]) => arr.length).forEach(([title, arr]) => {
    if (title) out.push(h('h3', { class: 'sec-title' }, `${title}（${arr.length}）`));
    out.push(h('ul', { class: 'xfer-list' }, arr.map(xferItem)));
  });
  out.push(h('button', { class: 'btn ghost block', onclick: async () => {
    const text = settleAllText(S.ledger, S.members, S.records, merged() ? () => show : null);
    if (await shareToGroup({ kind: 'settle', currency: dc }, { fallbackText: text })) return;
    copyText(text, '已複製結算結果');
  } }, icon('share', 18), merged() ? '分享結算結果' : '分享結算結果（全部幣別）'));
  return out;
}

async function markPaid(t) {
  const shareBox = shareToggle();
  const ok = await confirmBox(`記錄 ${memberName(t.from)} 已轉 ${formatMinor(t.amount, t.currency || base())} 給 ${memberName(t.to)}？`, '記為已付款', { extra: shareBox.el });
  if (!ok) return;
  const cur = t.currency || base();
  const rec = { type: 'transfer', title: '還款', category: 'other', amount: t.amount / 10 ** CURRENCIES[cur].decimals, currency: cur, rate: 1, payerId: t.from, split: { mode: 'amount', parts: { [t.to]: t.amount / 10 ** CURRENCIES[cur].decimals } }, date: today(), note: '' };
  const saved = await run(() => store.addRecord(S.ledger.id, rec), '已記錄付款');
  if (shareBox.on()) await shareRecord('create', saved);
  reload();
}

// ---- 統計 ----
function statsTab(gs) {
  const g = merged() ? gs[0] : pickGroup(gs);
  const st = g.stats;
  const net = g.net;
  const b = g.currency;
  const mine = S.scope === 'me' && S.meId;
  const exp = g.records.filter((r) => r.type === 'expense');
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
  if (!rows.length) return [merged() ? null : curChips(gs, null, b), seg, h('p', { class: 'hint center' }, merged() ? '還沒有支出可以統計。' : '這個幣別還沒有支出可以統計。'), exportBox(net)];
  const kpi = (label, value) => h('div', { class: 'kpi' }, h('span', {}, label), h('strong', {}, value));
  return [
    merged() ? null : curChips(gs, null, b),
    seg,
    h('div', { class: 'stat-total' }, h('span', { class: 't-label' }, mine ? '我分攤的支出' : '團體總支出'), h('strong', {}, formatMinor(total, b))),
    h('div', { class: 'kpis' },
      kpi('每日平均', formatMinor(Math.round(total / days.length), b)),
      mine ? kpi('占團體', `${st.total ? Math.round((total / st.total) * 100) : 0}%`) : kpi('每人平均', formatMinor(Math.round(total / Math.max(1, people.length)), b)),
      kpi('天數', `${days.length} 天`), kpi('筆數', `${rows.length} 筆`)),
    h('h3', { class: 'sec-title' }, '每日花費'),
    h('div', { onclick: (e) => { const d = e.target.closest('[data-date]'); if (d) { S.filter = { kind: mine ? 'mine' : 'all', cat: null, date: d.dataset.date }; S.tab = 'list'; renderLedger(); window.scrollTo(0, 0); } } }, trendChart(days, byDay, b)),
    h('p', { class: 'hint' }, '點長條或分類，可以直接看那部分的明細。'),
    h('h3', { class: 'sec-title' }, '分類'),
    h('ul', { class: 'bars' }, cats.map(([c, v]) => h('li', { class: 'clickable', role: 'button', tabindex: '0', 'aria-label': `看 ${categoryOf(c).name} 的明細`, onclick: () => { S.filter = { kind: mine ? 'mine' : 'all', cat: c, date: null }; S.tab = 'list'; renderLedger(); window.scrollTo(0, 0); } },
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
    ${vals.map((v, i) => { const hh = v ? Math.max(2, (v / mx) * (H - top - bottom)) : 0; return `<rect x="${i * bw}" y="${top}" width="${bw}" height="${H - top - bottom}" class="hit" data-date="${days[i]}"></rect><rect x="${i * bw + bw * 0.18}" y="${H - bottom - hh}" width="${bw * 0.64}" height="${hh}" rx="3" class="${i === peak ? 'peak' : ''}" data-date="${days[i]}" style="cursor:pointer"><title>${days[i]}：${formatMinor(v, b)}</title></rect>`; }).join('')}
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
      h('button', { class: 'btn ghost', onclick: () => download(csvName('統計'), summaryCsv(S.ledger, S.members, S.records)) }, icon('down', 18), '匯出統計')),
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
    S.members.filter((x) => x.id !== m.id).length ? h('button', { class: 'btn ghost block', onclick: () => { close(); mergeSheet(m); } }, '👥 和另一位成員合併（重複加入時用）') : null,
    m.active ? h('button', { class: 'btn text-danger block', onclick: async () => {
      if (!(await confirmBox(`移除 ${m.name}？已有紀錄的成員會改為停用，帳目不受影響。`, '移除', { danger: true }))) return;
      const r = await run(() => store.removeMember(m.id));
      toast(r.archived ? `${m.name} 已停用` : `已移除 ${m.name}`); close(); reload();
    } }, icon('trash', 18), '移除成員') : h('button', { class: 'btn ghost block', onclick: async () => { await run(() => store.updateMember(m.id, { active: 1 }), '已恢復'); close(); reload(); } }, '恢復成員')));
}

/** 合併重複的成員：把 m 的紀錄、LINE 綁定都移到選擇的成員身上 */
function mergeSheet(m) {
  const others = S.members.filter((x) => x.id !== m.id);
  const conflict = (x) => m.lineUserId && x.lineUserId && m.lineUserId !== x.lineUserId;
  const count = S.records.filter((r) => r.payerId === m.id || (r.split && r.split.parts && m.id in r.split.parts)).length;
  const close = sheet(`合併「${m.name}」`, h('div', { class: 'form' },
    h('p', { class: 'hint' }, `常見情況：朋友點邀請連結時按了「我不在名單上」，結果同一個人出現兩次。選擇要保留的那一位，「${m.name}」的 ${count} 筆紀錄都會移過去，金額分配不變，然後「${m.name}」會被移除。`),
    h('ul', { class: 'member-list' }, others.map((x) => h('li', {}, h('button', {
      class: `member ${conflict(x) ? '' : ''}`, disabled: conflict(x),
      onclick: async () => {
        if (!(await confirmBox(`把「${m.name}」併入「${x.name}」？這個動作無法復原。`, '合併', { danger: true }))) return;
        const res = await run(() => store.mergeMember(m.id, x.id));
        toast(`已合併：${res.moved} 筆紀錄移到「${x.name}」${res.dropped ? `，移除 ${res.dropped} 筆自己轉給自己的轉帳` : ''}`);
        close(); reload();
      },
    }, avatar(x, 36), h('span', { class: 'rec-main' }, h('strong', {}, x.name), h('small', {}, conflict(x) ? '已綁定不同的 LINE 帳號，不能合併' : x.lineUserId ? '已綁定 LINE' : '尚未綁定')), icon('arrow', 16)))))));
}

function identitySheet({ required = false } = {}) {
  const dn = (line.profile.displayName || '').toLowerCase();
  const guess = (m) => dn && (m.name.toLowerCase().includes(dn) || dn.includes(m.name.toLowerCase()));
  const list = activeMembers();
  const free = list.filter((m) => !m.lineUserId || m.lineUserId === line.profile.userId);
  const close = sheet(required ? `歡迎加入「${S.ledger.name}」` : '你是哪一位？', h('div', { class: 'form' },
    h('p', { class: 'hint' }, required
      ? (free.length ? '你還不是這本帳本的成員。請從下面選出你是哪一位；名單上沒有你的話，按最下方加入。' : '名單上的成員都已經有人選了，請按下方加入成為新成員。')
      : '選好之後，你的 LINE 大頭貼會帶入，餘額也會以你的角度顯示。'),
    h('ul', { class: 'member-list' }, list.map((m) => {
      const taken = m.lineUserId && m.lineUserId !== line.profile.userId;
      return h('li', {}, h('button', { class: `member ${guess(m) ? 'suggest' : ''}`, disabled: !!taken, onclick: async () => {
        await run(() => store.claimMember(m.id), `你好，${m.name}`); close(); reload();
      } }, avatar(m, 40), h('span', { class: 'rec-main' }, h('strong', {}, m.name), h('small', {}, taken ? '已被其他人選擇' : m.id === S.meId ? '目前的你' : guess(m) ? '可能是你' : '')), icon('arrow', 16)));
    })),
    h('button', { class: 'btn ghost block', onclick: async () => {
      await run(() => store.addMember(S.ledger.id, { name: line.profile.displayName, claim: true }), '已把你加入帳本'); close(); reload();
    } }, icon('plus', 18), `我不在名單上，加入「${line.profile.displayName}」`),
    required ? h('button', { class: 'btn text block', onclick: () => { close(); home(); } }, '先回帳本列表') : null),
  { required });
  [...document.querySelectorAll('.sheet-wrap')].at(-1)?.classList.add('identity');
}

function settingsSheet() {
  const name = h('input', { class: 'input', value: S.ledger.name, maxlength: 40 });
  const cur = currencySelect(S.ledger.baseCurrency);
  cur.disabled = S.records.length > 0;
  const share = h('input', { type: 'checkbox', class: 'switch', checked: !!S.ledger.shareDefault });
  const mergeCur = h('input', { type: 'checkbox', class: 'switch', checked: merged() });
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
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'LINE 群組'),
      h('p', { class: 'hint' }, S.ledger.groupId ? `已連結「${S.ledger.groupName || 'LINE 群組'}」。記帳訊息只會傳到這個群組。` : '尚未連結。要連結的話，請在那個群組輸入「記帳」，從機器人的按鈕開啟後回到這裡。'),
      S.groupId && S.groupId !== S.ledger.groupId ? h('button', { class: 'btn ghost block', onclick: async () => {
        if (!(await confirmBox(S.ledger.groupId ? '改連結到目前開啟的 LINE 群組？之後的記帳訊息會改傳到這個群組。' : '連結到目前開啟的 LINE 群組？之後的記帳訊息會傳到這個群組。', '連結'))) return;
        await run(() => store.updateLedger(S.ledger.id, { groupId: S.groupId }), '已連結 LINE 群組'); close(); reload();
      } }, '連結到目前的 LINE 群組') : null),
    field('固定匯率（選用）', frBox, '例如出發前換日圓的匯率。設定後記這個幣別會自動帶入，已記的帳不受影響。'),
    h('label', { class: 'row between' }, h('span', {}, '記帳後預設分享到 LINE'), share),
    h('label', { class: 'row between' }, h('span', {}, h('strong', {}, '不同幣別合併結算'),
      h('small', { class: 'hint block' }, '開啟：全部換算成結算幣別，一起算出最少轉帳。關閉：各幣別分開結算、分開統計，不換匯，可在結算與統計切換幣別。')), mergeCur),
    h('button', { class: 'btn primary block', onclick: async () => {
      await run(() => store.updateLedger(S.ledger.id, { name: name.value.trim() || S.ledger.name, baseCurrency: cur.value, shareDefault: share.checked ? 1 : 0, mergeCurrencies: mergeCur.checked ? 1 : 0, fixedRates: Object.fromEntries(Object.entries(fr).filter(([, v]) => Number(v) > 0).map(([c, v]) => [c, Number(v)])) }), '已儲存'); close(); reload();
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
// 記住這本帳本上一次記帳的付款人、幣別、分攤的人（只存在這支手機）
const LAST_KEY = () => `sharing-last-${S.ledger.id}`;
const loadLast = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY())) || null; } catch { return null; } };
const saveLast = (v) => { try { localStorage.setItem(LAST_KEY(), JSON.stringify(v)); } catch { /* 無痕模式 */ } };

function editor(rec, presetType, { copyOf = null, preset = null } = {}) {
  const editing = !!rec;
  const b = base();
  const members = activeMembers();
  const ids = new Set(members.map((m) => m.id));
  const last = !editing && !copyOf && !presetType ? loadLast() : null;
  const lastParts = last && Array.isArray(last.parts) ? last.parts.filter((id) => ids.has(id)) : [];
  const r = rec ? structuredClone(rec) : copyOf ? { ...structuredClone(copyOf), date: today() } : {
    type: presetType || 'expense', title: '', category: 'food', amount: '', currency: (last && last.currency) || S._lastCur || b, rate: 1,
    payerId: last && (ids.has(last.payerId) || last.payerId === FUND_ID) ? last.payerId : S.meId || (members[0] || {}).id, date: today(), note: '',
    split: { mode: 'equal', parts: Object.fromEntries((lastParts.length ? lastParts : members.map((m) => m.id)).map((id) => [id, true])) },
  };
  if (preset) Object.assign(r, preset);
  if (copyOf) delete r.id;
  let catTouched = editing || !!copyOf || !!(preset && preset.category);
  // 新增的「存入公費」預設全部成員一起存（誰存入可複選）；編輯既有一筆時維持單一存入人
  if (r.type === 'fund_in') r.split = editing ? { mode: 'equal', parts: { [FUND_ID]: true } } : { mode: 'equal', parts: Object.fromEntries(members.map((m) => [m.id, true])) };
  const box = h('div', { class: 'form editor' });
  const shareBox = shareToggle();

  // 金額可以輸入算式，例如 1200+350
  const calc = h('small', { class: 'calc-hint', 'aria-live': 'polite' });
  const onAmount = () => {
    const raw = amount.value;
    const v = evalAmount(raw);
    r.amount = v == null ? '' : v;
    calc.textContent = /[+\-*/×÷]/.test(raw.replace(/^-/, '')) && v != null ? `= ${formatMoney(v, r.currency)}` : '';
    drawSplit(); drawRate(); drawFundIn();
  };
  const amount = h('input', { class: 'amount-input', inputmode: 'decimal', placeholder: '0', value: r.amount, 'aria-label': '金額', oninput: onAmount });
  const plusBtn = h('button', { class: 'plus-key', type: 'button', 'aria-label': '加號：再加一筆', onclick: () => { amount.value = `${amount.value}+`; amount.focus(); onAmount(); } }, '+');
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
    if (!merged()) { r.rate = 1; return mount(rateBox, h('p', { class: 'hint' }, `這本帳本各幣別分開結算，${r.currency} 不需要匯率。`)); }
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
      if (k === 'fund_in') r.split = editing ? { mode: 'equal', parts: { [FUND_ID]: true } } : { mode: 'equal', parts: Object.fromEntries(members.map((m) => [m.id, true])) };
      else if (k === 'transfer') r.split = { mode: 'amount', parts: {} };
      else r.split = { mode: 'equal', parts: Object.fromEntries(members.map((m) => [m.id, true])) };
      if (r.payerId === FUND_ID && k !== 'expense') r.payerId = S.meId || members[0].id;
      draw();
    } }, label)));

  const title = h('input', { class: 'input', placeholder: '項目名稱，例如：晚餐', value: r.title, maxlength: 40, oninput: () => {
    r.title = title.value;
    // 依項目名稱自動選分類（手動點過分類就不再自動改）
    if (!catTouched) {
      const g = guessCategory(r.title);
      if (g !== 'other' && g !== r.category) { r.category = g; box.querySelectorAll('.chips.cats .chip').forEach((el) => el.classList.toggle('on', el.dataset.cat === g)); }
    }
  } });
  const date = h('input', { class: 'input', type: 'date', value: r.date, onchange: async () => {
    r.date = date.value;
    if (r.currency !== b && rateSrc !== 'manual') { await ensureRate({ force: true }); drawRate(); drawSplit(); }
  } });
  const note = h('input', { class: 'input', placeholder: '備註（選填）', value: r.note || '', maxlength: 120, oninput: () => (r.note = note.value) });
  const splitBox = h('div', {});
  const fundBox = h('div', {});
  // A3：日期、備註、分享收進「更多選項」，預設收合（今天、依帳本預設分享）
  let moreOpen = editing && !!r.note;
  const moreSummary = () => `${r.date === today() ? '今天' : `${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8))}`}，${shareBox.on() ? '分享到群組' : '不分享'}${r.note ? '，有備註' : ''}`;
  const moreBox = () => {
    const sumTxt = h('small', { class: 'hint' }, moreSummary());
    const d = h('details', { class: 'more', open: moreOpen, ontoggle: () => (moreOpen = d.open), onchange: () => (sumTxt.textContent = moreSummary()), oninput: () => (sumTxt.textContent = moreSummary()) },
      h('summary', {}, h('span', {}, '更多選項'), sumTxt),
      h('div', { class: 'form more-body' }, h('div', { class: 'grid2' }, field('日期', date), field('備註', note)), shareBox.el));
    return d;
  };

  function personChips(selected, onPick, { withFund = false, exclude } = {}) {
    const opts = [...members.map((m) => [m.id, m.name, m]), ...(withFund ? [[FUND_ID, '公費', { name: '公' }]] : [])].filter(([id]) => id !== exclude);
    return h('div', { class: 'chips scroll' }, opts.map(([id, n, m]) => h('button', { class: `chip person ${selected === id ? 'on' : ''}`, 'aria-pressed': String(selected === id), onclick: () => onPick(id) }, avatar(m, 22), n)));
  }

  function drawSplit() {
    if (r.type !== 'expense') return splitBox.replaceChildren();
    const parts = r.split.parts;
    const mode = r.split.mode;
    const fill = r.split.fill || 'blank';
    const fillSeg = mode !== 'amount' ? null : h('div', { class: 'fill-opt' },
      h('span', { class: 'hint' }, '填的金額不夠時'),
      h('div', { class: 'seg sm' }, [['all', '所有人平均'], ['blank', '沒填的人平均']].map(([k, label]) => h('button', { class: fill === k ? 'on' : '', 'aria-pressed': String(fill === k), onclick: () => { r.split.fill = k; drawSplit(); } }, label))));
    const modeSeg = h('div', { class: 'seg sm' }, [['equal', '平分'], ['amount', '自訂金額'], ['shares', '依份數']].map(([k, label]) => h('button', { class: mode === k ? 'on' : '', onclick: () => {
      const on = Object.keys(parts).filter((id) => parts[id]);
      r.split.mode = k;
      r.split.parts = Object.fromEntries(on.map((id) => [id, k === 'equal' ? true : k === 'shares' ? 1 : '']));
      if (k === 'amount') r.split.fill = 'all'; else delete r.split.fill;
      drawSplit();
    } }, label)));
    const preview = Number(r.amount) > 0 && (r.currency === b || Number(r.rate) > 0) ? recordShares(r, b).shares : {};
    const rows = members.map((m) => {
      const on = mode === 'equal' ? !!parts[m.id] : m.id in parts;
      const check = h('input', { type: 'checkbox', checked: on, 'aria-label': `${m.name} 參與分攤`, onchange: () => {
        if (check.checked) parts[m.id] = mode === 'equal' ? true : mode === 'shares' ? 1 : ''; else delete parts[m.id];
        drawSplit();
      } });
      const val = mode === 'equal' ? null : h('input', { class: 'input mini', inputmode: 'decimal', value: on ? parts[m.id] : '', disabled: !on, placeholder: mode === 'amount' && on ? (fill === 'all' ? '0' : '平分') : '', 'aria-label': `${m.name} ${mode === 'amount' ? '金額' : '份數'}`,
        oninput: (e) => { parts[m.id] = e.target.value; drawSum(); updatePreview(); } });
      const pv = h('span', { class: 'split-pv', 'data-id': m.id }, preview[m.id] ? formatMinor(preview[m.id], b) : '');
      return h('label', { class: `split-row ${on ? '' : 'off'}` }, check, avatar(m, 26), h('span', { class: 'grow' }, m.name), val, pv);
    });
    const sum = h('p', { class: 'hint split-sum' });
    const drawSum = () => {
      if (mode !== 'amount') return (sum.textContent = '');
      if (!(Number(r.amount) > 0)) { sum.textContent = fill === 'all' ? '先輸入總金額；不足的金額會由所有勾選的人平均分攤' : '先輸入總金額；沒填金額的人會平分剩下的部分'; sum.classList.remove('neg'); return; }
      const x = amountSplit(parts, r.amount, r.currency, fill);
      const n = x.targets.length;
      const each = n && x.remainder > 0 ? x.remainder / n : 0;
      const eachTxt = formatMoney(Math.round(each * 10 ** decimalsOf(r.currency)) / 10 ** decimalsOf(r.currency), r.currency);
      sum.textContent = x.error ? x.error
        : n && x.remainder > 0 ? (fill === 'all'
          ? `不足 ${formatMoney(x.remainder, r.currency)} 由勾選的 ${n} 人平均分攤，每人再加約 ${eachTxt}`
          : `剩下 ${formatMoney(x.remainder, r.currency)} 由 ${n} 位沒填金額的人平分，每人約 ${eachTxt}`)
        : '金額剛好分配完畢';
      sum.classList.toggle('neg', !!x.error);
    };
    const updatePreview = () => {
      const ok = Number(r.amount) > 0 && (r.currency === b || Number(r.rate) > 0);
      const pv = ok ? recordShares(r, b).shares : {};
      splitBox.querySelectorAll('.split-pv').forEach((el) => (el.textContent = pv[el.dataset.id] ? formatMinor(pv[el.dataset.id], b) : ''));
    };
    drawSum();
    const allOn = members.every((m) => (mode === 'equal' ? parts[m.id] : m.id in parts));
    mount(splitBox, h('div', { class: 'row between' }, h('span', { class: 'field-label' }, '誰要分攤'), h('button', { class: 'link', onclick: () => {
      members.forEach((m) => (allOn ? delete parts[m.id] : (parts[m.id] = parts[m.id] ?? (mode === 'equal' ? true : mode === 'shares' ? 1 : ''))));
      drawSplit();
    } }, allOn ? '全部取消' : '全選')), modeSeg, fillSeg, h('div', { class: 'split-list' }, rows), sum);
  }

  // 新增的「存入公費」：誰存入可複選，預設全選；金額會平分給勾選的人各記一筆
  function drawFundIn() {
    if (editing || r.type !== 'fund_in') return fundBox.replaceChildren();
    const parts = r.split.parts;
    const allOn = members.every((m) => parts[m.id]);
    const rows = members.map((m) => {
      const on = !!parts[m.id];
      const check = h('input', { type: 'checkbox', checked: on, 'aria-label': `${m.name} 存入`, onchange: () => {
        if (check.checked) parts[m.id] = true; else delete parts[m.id];
        drawFundIn();
      } });
      return h('label', { class: `split-row ${on ? '' : 'off'}` }, check, avatar(m, 26), h('span', { class: 'grow' }, m.name));
    });
    const n = members.filter((m) => parts[m.id]).length;
    mount(fundBox, h('div', { class: 'row between' }, h('span', { class: 'field-label' }, '誰存入'), h('button', { class: 'link', onclick: () => {
      members.forEach((m) => (allOn ? delete parts[m.id] : (parts[m.id] = true)));
      drawFundIn();
    } }, allOn ? '全部取消' : '全選')), h('div', { class: 'split-list' }, rows),
    n > 1 && Number(r.amount) > 0 ? h('p', { class: 'hint' }, `金額會平分成 ${n} 筆，每人各存入約 ${formatMoney(Number(r.amount) / n, r.currency)}`) : null);
  }

  function draw() {
    typeSeg.querySelectorAll('button').forEach((btn, i) => btn.className = ['expense', 'transfer', 'fund_in'][i] === r.type ? 'on' : '');
    const toId = r.type === 'transfer' ? Object.keys(r.split.parts)[0] : null;
    mount(box,
      typeSeg,
      h('div', { class: 'amount-row' }, cur, amount, plusBtn),
      calc,
      rateBox,
      r.type === 'expense' ? [field('項目', title), h('div', { class: 'chips cats' }, CATEGORIES.map((c) => h('button', { class: `chip ${r.category === c.id ? 'on' : ''}`, 'data-cat': c.id, onclick: () => { r.category = c.id; catTouched = true; draw(); } }, `${c.icon} ${c.name}`)))] : null,
      r.type === 'fund_in' && !editing ? fundBox
        : h('div', {}, h('span', { class: 'field-label' }, r.type === 'expense' ? '誰先付的' : r.type === 'transfer' ? '誰轉出' : '誰存入'),
          personChips(r.payerId, (id) => { r.payerId = id; if (r.type === 'transfer' && r.split.parts[id] !== undefined) r.split.parts = {}; draw(); }, { withFund: r.type === 'expense' && !!S.ledger.fundEnabled })),
      r.type === 'transfer' ? h('div', {}, h('span', { class: 'field-label' }, '轉給誰'), personChips(toId, (id) => { r.split.parts = { [id]: r.amount || 0 }; draw(); }, { exclude: r.payerId })) : null,
      splitBox,
      moreBox(),
      h('button', { class: 'btn primary block', onclick: saveIt }, editing ? '儲存修改' : '記下這筆'),
      editing && r.type === 'expense' ? h('button', { class: 'btn ghost block', onclick: () => { close(); editor(null, null, { copyOf: rec }); } }, icon('copy', 18), '複製成新的一筆（日期改成今天）') : null,
      editing ? h('button', { class: 'btn text-danger block', onclick: deleteIt }, icon('trash', 18), '刪除這筆') : null);
    drawSplit();
    drawFundIn();
  }

  async function saveIt() {
    if (r.type === 'transfer') { const to = Object.keys(r.split.parts)[0]; if (to) r.split = { mode: 'amount', parts: { [to]: Number(r.amount) } }; }
    if (!editing && r.type === 'fund_in') return saveFundIn();
    const out = { type: r.type, title: r.title.trim() || (r.type === 'fund_in' ? '存入公費' : r.type === 'transfer' ? '轉帳' : categoryOf(r.category).name), category: r.category, amount: Number(r.amount), currency: r.currency, rate: r.currency === b ? 1 : Number(r.rate), payerId: r.payerId, split: r.split, date: r.date || today(), note: r.note || '' };
    const errs = validateRecord(out);
    if (out.currency !== b && !(out.rate > 0)) errs.push('請輸入匯率');
    if (errs.length) return toast(errs[0], 'err');
    const saved = await run(() => (editing ? store.updateRecord(rec.id, out) : store.addRecord(S.ledger.id, out)), editing ? '已儲存修改' : '已記下');
    if (!editing && out.type === 'expense') saveLast({ payerId: out.payerId, currency: out.currency, parts: out.split.mode === 'equal' ? Object.keys(out.split.parts).filter((k) => out.split.parts[k]) : null });
    close();
    if (shareBox.on()) await shareRecord(editing ? 'update' : 'create', { ...out, ...saved });
    S.flash = saved.id;
    reload();
  }
  // 新增「存入公費」且勾選多人：金額平分，各記一筆（每筆的存入人維持單一，跟既有資料格式相容）
  async function saveFundIn() {
    const depIds = members.filter((m) => r.split.parts[m.id]).map((m) => m.id);
    if (!depIds.length) return toast('請至少選一位存入的人', 'err');
    if (!(Number(r.amount) > 0)) return toast('請輸入大於 0 的金額', 'err');
    if (r.currency !== b && !(Number(r.rate) > 0)) return toast('請輸入匯率', 'err');
    const minorTotal = Math.round(Number(r.amount) * 10 ** decimalsOf(r.currency));
    const shareMinor = allocate(minorTotal, Object.fromEntries(depIds.map((id) => [id, 1])));
    let saved;
    for (const id of depIds) {
      const out = { type: 'fund_in', title: '存入公費', category: r.category, amount: fromMinor(shareMinor[id] || 0, r.currency), currency: r.currency, rate: r.currency === b ? 1 : Number(r.rate), payerId: id, split: { mode: 'equal', parts: { [FUND_ID]: true } }, date: r.date || today(), note: r.note || '' };
      // eslint-disable-next-line no-await-in-loop
      saved = await run(() => store.addRecord(S.ledger.id, out));
    }
    close();
    toast(depIds.length > 1 ? `已記下：${depIds.length} 人共存入 ${formatMoney(Number(r.amount), r.currency)}` : '已記下');
    S.flash = saved.id;
    reload();
  }
  async function deleteIt() {
    const sb = shareToggle();
    if (!(await confirmBox(`刪除「${rec.title}」？`, '刪除', { danger: true, extra: sb.el }))) return;
    await run(() => store.deleteRecord(rec.id));
    close();
    if (sb.on()) await shareRecord('delete', rec);
    await reload();
    toast(`已刪除「${rec.title}」`, '', { action: { label: '復原', onClick: async () => {
      const back = await run(() => store.restoreRecord(rec.id), '已復原');
      if (sb.on()) await shareRecord('create', back);
      S.flash = rec.id; reload();
    } } });
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
// 分享只走「帳本連結的 LINE 群組」：一律由記帳機器人推播到 ledger.groupId，
// 不再用 liff.sendMessages（它會傳到「目前開啟的聊天室」，可能是別的群組）。
function shareToggle() {
  const linked = !!(S.ledger && S.ledger.groupId);
  const cb = h('input', { type: 'checkbox', class: 'switch', checked: linked && !!S.ledger.shareDefault, disabled: !linked && !line.demo });
  const hint = line.demo ? '示範模式不會真的傳到 LINE'
    : linked ? `由記帳機器人傳到「${S.ledger.groupName || '連結的 LINE 群組'}」`
    : '這本帳本沒有連結 LINE 群組，不會分享（可在帳本設定連結）';
  return { el: h('label', { class: 'row between share-toggle' }, h('span', {}, '分享到 LINE 群組', h('small', { class: 'hint block' }, hint)), cb), on: () => cb.checked };
}
async function shareRecord(action, rec) {
  if (!rec || !rec.id) return;
  await shareToGroup({ kind: 'record', action, recordId: rec.id }, { quiet: true });
}
/** 只傳到帳本連結的群組；沒有連結就不傳 */
// 訊息內容由後端依紀錄產生，前端只告訴它「哪一筆、做了什麼」
async function shareToGroup(payload, { quiet = false, fallbackText = '' } = {}) {
  if (line.demo) { toast('示範模式：已略過分享到 LINE'); return true; }
  if (!S.ledger.groupId) {
    if (!quiet) {
      if (fallbackText) { copyText(fallbackText, '這本帳本沒有連結 LINE 群組，已複製文字'); return true; }
      toast('這本帳本沒有連結 LINE 群組', 'err');
    }
    return false;
  }
  if (!S.meId && !(S.viewer && S.viewer.isCreator)) { if (!quiet) toast('請先選擇你的身分才能傳到群組', 'err'); return false; }
  try {
    const r = await store.notifyGroup(S.ledger.id, payload);
    if (r && r.ok === false) throw new Error('LINE 拒絕了這則訊息');
    toast(`已傳到「${S.ledger.groupName || 'LINE 群組'}」`);
    return true;
  } catch (e) { toast(`分享失敗：${e.message}`, 'err'); return false; }
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

