// LINE 訊息（Flex Message）與 CSV 匯出
import { formatMoney, formatMinor, fromMinor, recordShares, categoryOf, FUND_ID, stats } from './money.js';

const nameOf = (members, id) => (id === FUND_ID ? '公費' : (members.find((m) => m.id === id) || {}).name || '已移除成員');
const ACTION = { create: '新增', update: '修改', delete: '刪除' };

export function describeRecord(rec, members) {
  const payer = nameOf(members, rec.payerId);
  const ids = Object.keys(rec.split.parts || {});
  if (rec.type === 'transfer') return `${payer} 轉給 ${nameOf(members, ids[0])}`;
  if (rec.type === 'fund_in') return `${payer} 存入公費`;
  return `${payer} 先付，${ids.length} 人分攤`;
}

export function recordFlex(action, rec, ledger, members, url) {
  const amt = formatMoney(Number(rec.amount), rec.currency);
  const base = rec.currency !== ledger.baseCurrency ? formatMinor(recordShares(rec, ledger.baseCurrency).total, ledger.baseCurrency) : '';
  const title = rec.type === 'expense' ? `${categoryOf(rec.category).icon} ${rec.title || categoryOf(rec.category).name}` : rec.title || describeRecord(rec, members);
  const color = action === 'delete' ? '#8A94A6' : '#2F54EB';
  return {
    type: 'flex',
    altText: `【${ledger.name}】${ACTION[action]}：${rec.title || ''} ${amt}`,
    contents: {
      type: 'bubble', size: 'kilo',
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', contents: [
          { type: 'text', text: `${ledger.name}｜${ACTION[action]}紀錄`, size: 'xs', color: '#8A94A6' },
          { type: 'text', text: title, weight: 'bold', size: 'md', wrap: true, decoration: action === 'delete' ? 'line-through' : 'none' },
          { type: 'text', text: amt + (base ? `（約 ${base}）` : ''), size: 'xl', weight: 'bold', color },
          { type: 'text', text: describeRecord(rec, members), size: 'sm', color: '#5B6475', wrap: true },
        ],
      },
      footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: '開啟帳本', uri: url } }] },
    },
  };
}

export function inviteFlex(ledger, url) {
  return {
    type: 'flex', altText: `一起記帳：${ledger.name}`,
    contents: {
      type: 'bubble', size: 'kilo',
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
        { type: 'text', text: '一起分帳', size: 'xs', color: '#8A94A6' },
        { type: 'text', text: ledger.name, weight: 'bold', size: 'lg', wrap: true },
        { type: 'text', text: '點開後選擇你是哪一位成員，就能一起記帳。', size: 'sm', color: '#5B6475', wrap: true },
      ] },
      footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', color: '#2F54EB', height: 'sm', action: { type: 'uri', label: '加入帳本', uri: url } }] },
    },
  };
}

export function settleText(ledger, members, transfers) {
  if (!transfers.length) return `【${ledger.name}】目前已經結清，不需要轉帳。`;
  return [`【${ledger.name}】最少 ${transfers.length} 筆轉帳即可結清：`,
    ...transfers.map((t) => `・${nameOf(members, t.from)} → ${nameOf(members, t.to)}　${formatMinor(t.amount, ledger.baseCurrency)}`)].join('\n');
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
const TYPE = { expense: '支出', transfer: '轉帳', fund_in: '存入公費' };

export function recordsCsv(ledger, members, records) {
  const base = ledger.baseCurrency;
  const active = members.map((m) => m.id);
  const head = ['日期', '類型', '項目', '分類', '金額', '幣別', '匯率', `換算${base}`, '付款人', ...members.map((m) => `${m.name} 分攤`), '備註'];
  const f = (v) => fromMinor(v, base);
  const rows = [...records].sort((a, b) => (a.date < b.date ? -1 : 1)).map((r) => {
    const { total, shares } = recordShares(r, base);
    return [r.date, TYPE[r.type], r.title, r.type === 'expense' ? categoryOf(r.category).name : '', r.amount, r.currency, r.currency === base ? 1 : r.rate, f(total), nameOf(members, r.payerId), ...active.map((id) => (shares[id] ? f(shares[id]) : '')), r.note || ''];
  });
  return csv([head, ...rows]);
}

export function summaryCsv(ledger, members, records, balances) {
  const base = ledger.baseCurrency;
  const s = stats(records, base);
  const f = (v) => fromMinor(v, base);
  const rows = members.map((m) => { const p = s.people[m.id] || { paid: 0, share: 0, fundIn: 0 }; return [m.name, f(p.paid), f(p.share), f(p.fundIn), f(balances[m.id] || 0)]; });
  const cats = Object.entries(s.byCategory).map(([c, v]) => [categoryOf(c).name, f(v)]);
  return csv([[`${ledger.name}（${base}）`], [], ['成員', '代墊支出', '應分攤', '存入公費', '結算淨額(正=應收)'], ...rows, [], ['分類', '金額'], ...cats, ['合計', f(s.total)]]);
}
