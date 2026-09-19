// 本機啟動 Worker（node:sqlite 模擬 D1、模擬 LINE API），給遠端模式 E2E 用
import http from 'node:http';
import { createD1 } from './d1-shim.mjs';
import worker from '../worker/src/index.js';

const GROUP = new Set(['robin', 'zhe']);
const env = { DB: createD1(new URL('../worker/schema.sql', import.meta.url)), DEV_MODE: '1', ALLOWED_ORIGINS: '*', ADMIN_USER_IDS: 'boss', LIFF_ID: '2000000000-Test', LINE_CHANNEL_ACCESS_TOKEN: 'tok', LINE_CHANNEL_SECRET: 's' };
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  const u = String(url);
  const gm = u.match(/\/v2\/bot\/group\/([^/]+)\/member\/([^/?]+)/);
  if (gm) return new Response('{}', { status: GROUP.has(decodeURIComponent(gm[2])) ? 200 : 404 });
  if (/\/summary$/.test(u)) return new Response(JSON.stringify({ groupName: '滑雪團' }));
  if (u.includes('api.line.me')) return new Response('{}');
  if (u.includes('currency-api')) return new Response(JSON.stringify({ date: '2026-09-18', twd: { jpy: 4.7 } }));
  return realFetch(url, opt);
};
http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request(`http://127.0.0.1:8787${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, () => console.log('local api on 8787'));
