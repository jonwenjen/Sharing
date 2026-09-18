import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickEntry } from '../web/js/parse.js';

test('快速記帳語法', () => {
  assert.equal(parseQuickEntry('晚餐 1200'), null);
  assert.deepEqual(parseQuickEntry('+1200 晚餐'), { amount: 1200, currency: null, title: '晚餐', mentions: [], includeMe: false });
  assert.deepEqual(parseQuickEntry('＋3,000 JPY 拉麵 @小安 @阿哲'), { amount: 3000, currency: 'JPY', title: '拉麵', mentions: ['小安', '阿哲'], includeMe: false });
  assert.equal(parseQuickEntry('+¥800 咖啡').currency, 'JPY');
  assert.equal(parseQuickEntry('+800円 咖啡').currency, 'JPY');
  assert.equal(parseQuickEntry('+800 日幣 咖啡').currency, 'JPY');
  assert.equal(parseQuickEntry('+12.5 usd taxi').currency, 'USD');
  assert.equal(parseQuickEntry('+300 元氣壽司').currency, null);
  assert.equal(parseQuickEntry('+300 元氣壽司').title, '元氣壽司');
  const me = parseQuickEntry('+500 飲料 @我@米米');
  assert.equal(me.includeMe, true);
  assert.deepEqual(me.mentions, ['米米']);
  assert.ok(parseQuickEntry('+abc').error);
  assert.ok(parseQuickEntry('+0 x').error);
});
