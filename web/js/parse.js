// LINE 群組快速記帳語法解析（純函式，前後端共用）
// 格式：+金額 [幣別] 項目 [@成員 …]
//   +1200 晚餐                → 台幣（帳本幣別），全員平分
//   +3000 JPY 拉麵 @小安 @阿哲 → 日圓，只有小安、阿哲分攤
//   +¥3000 拉麵 @我 @米米      → 「@我」代表發訊息的人
import { CURRENCIES } from './money.js';

const ALIASES = {
  '円': 'JPY', '日圓': 'JPY', '日幣': 'JPY', '日元': 'JPY', 'YEN': 'JPY', '¥': 'JPY', '￥': 'JPY',
  '台幣': 'TWD', '臺幣': 'TWD', '元': 'TWD', 'NT': 'TWD', 'NT$': 'TWD',
  '美金': 'USD', '美元': 'USD', 'US$': 'USD', '$': 'USD',
  '歐元': 'EUR', '€': 'EUR', '韓元': 'KRW', '韓幣': 'KRW', '₩': 'KRW',
  '港幣': 'HKD', '人民幣': 'CNY', '泰銖': 'THB', '฿': 'THB', '英鎊': 'GBP', '£': 'GBP',
};
const curOf = (tok) => {
  if (!tok) return null;
  const u = tok.toUpperCase();
  if (CURRENCIES[u]) return u;
  return ALIASES[tok] || ALIASES[u] || null;
};

export const QUICK_HELP = [
  '快速記帳格式：',
  '+1200 晚餐　→ 全員平分（帳本幣別）',
  '+3000 JPY 拉麵 @小安 @阿哲　→ 指定幣別與分攤的人',
  '@我＝自己；付款人＝發訊息的人',
  '其他指令：記帳、結算、說明',
].join('\n');

/** @returns {null | {amount:number,currency:string|null,title:string,mentions:string[],includeMe:boolean,error?:string}} */
export function parseQuickEntry(text) {
  const t = String(text || '').trim().replace(/\u3000/g, ' ');
  if (!/^[+＋]/.test(t)) return null;
  const m = t.match(/^[+＋]\s*(NT\$|US\$|[¥￥$€₩฿£])?\s*([\d,]+(?:\.\d+)?)\s*(.*)$/i);
  if (!m) return { error: '看不懂金額，範例：+1200 晚餐' };
  const amount = Number(m[2].replace(/,/g, ''));
  if (!(amount > 0)) return { error: '金額需大於 0' };
  let currency = curOf(m[1]);
  let rest = m[3].trim();
  // 金額後緊接的幣別：+3000JPY、+3000 円、+3000 日幣
  const cm = rest.match(/^([A-Za-z]{3}|円|日圓|日幣|日元|台幣|臺幣|美金|美元|歐元|韓元|韓幣|港幣|人民幣|泰銖|英鎊|元)(?=\s|$|@)/);
  if (cm && curOf(cm[1])) { currency = curOf(cm[1]); rest = rest.slice(cm[0].length).trim(); }
  const mentions = [];
  let includeMe = false;
  const words = [];
  for (const tok of rest.split(/\s+/).filter(Boolean)) {
    if (/^[@＠]/.test(tok)) {
      tok.split(/[@＠]/).filter(Boolean).forEach((n) => (/^(我|me)$/i.test(n) ? (includeMe = true) : mentions.push(n)));
    } else words.push(tok);
  }
  return { amount, currency, title: words.join(' ').slice(0, 40), mentions, includeMe };
}
