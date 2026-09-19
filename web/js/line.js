// LINE LIFF 包裝：登入、個人資料、分享到聊天室
import { CONFIG } from './config.js';

const state = { ready: false, demo: true, profile: null, idToken: null, context: null };
export const line = state;

export async function initLine() {
  // 只有「沒有填正式設定」時才會進示範模式；正式設定下絕不自動切示範，避免資料只存在手機裡
  const configured = !!(CONFIG.LIFF_ID && CONFIG.API_BASE);
  if (configured && !window.liff) {
    for (let i = 0; i < 20 && !window.liff; i++) await new Promise((r) => setTimeout(r, 250));
    if (!window.liff) throw new Error('LINE 登入元件載入失敗，請確認網路後按「重新載入」。');
  }
  if (!configured) {
    state.demo = true;
    state.profile = { userId: 'demo-me', displayName: '我（示範）', pictureUrl: '' };
    state.ready = true;
    return state;
  }
  await window.liff.init({ liffId: CONFIG.LIFF_ID });
  if (!window.liff.isLoggedIn()) { window.liff.login({ redirectUri: location.href }); return new Promise(() => {}); }
  state.demo = false;
  state.profile = await window.liff.getProfile();
  state.idToken = window.liff.getIDToken();
  state.context = window.liff.getContext();
  state.ready = true;
  return state;
}

/** 帳本連結；帶 join（邀請碼）時，沒有權限的人也能用它加入 */
export function ledgerUrl(id, join) {
  if (CONFIG.LIFF_ID && !state.demo) return `https://liff.line.me/${CONFIG.LIFF_ID}?l=${id}${join ? `&join=${join}` : ''}`;
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('l', id);
  if (join) u.searchParams.set('join', join);
  if (state.demo) u.searchParams.set('demo', '1');
  return u.toString();
}

/** 是否能以使用者身分直接發訊息到目前聊天室 */
export function canSendToChat() {
  if (state.demo || !window.liff) return false;
  const t = state.context && state.context.type;
  return window.liff.isInClient() && ['utou', 'group', 'room', 'square_chat'].includes(t);
}

export async function sendToChat(messages) {
  if (!canSendToChat()) return false;
  try { await window.liff.sendMessages(messages); return true; } catch (e) { console.warn(e); return false; }
}

export async function pickAndShare(messages) {
  if (state.demo || !window.liff || !window.liff.isApiAvailable('shareTargetPicker')) return false;
  const r = await window.liff.shareTargetPicker(messages);
  return !!r;
}

export function closeWindow() { if (!state.demo && window.liff && window.liff.isInClient()) window.liff.closeWindow(); }

export const inLineApp = () => !state.demo && !!window.liff && window.liff.isInClient();

/** 用手機預設瀏覽器開啟（LINE 內建瀏覽器無法下載檔案） */
export function openExternal(url) {
  if (inLineApp()) { window.liff.openWindow({ url, external: true }); return true; }
  window.open(url, '_blank');
  return false;
}

/** 一般網址（非 liff.line.me），給外部瀏覽器用 */
export function webUrl(params) {
  const u = new URL(CONFIG.WEB_URL || location.href);
  u.search = '';
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  if (state.demo) u.searchParams.set('demo', '1');
  return u.toString();
}
