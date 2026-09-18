// LINE LIFF 包裝：登入、個人資料、分享到聊天室
import { CONFIG } from './config.js';

const state = { ready: false, demo: true, profile: null, idToken: null, context: null };
export const line = state;

export async function initLine() {
  const qs = new URLSearchParams(location.search);
  const wantDemo = qs.has('demo') || !CONFIG.LIFF_ID || !CONFIG.API_BASE || !window.liff;
  if (wantDemo) {
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

export function ledgerUrl(id) {
  if (CONFIG.LIFF_ID && !state.demo) return `https://liff.line.me/${CONFIG.LIFF_ID}?l=${id}`;
  const u = new URL(location.href);
  u.search = '';
  u.searchParams.set('l', id);
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
