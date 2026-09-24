// 產生單一檔案的示範版（不需 LINE、資料存在瀏覽器），輸出到 dist/demo.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const root = new URL('../web/', import.meta.url);
const order = ['config', 'line', 'money', 'settle', 'ladder', 'ui', 'store', 'messages', 'ladderui', 'foodwheel', 'app'];
const js = order.map((f) => {
  let s = readFileSync(new URL(`js/${f}.js`, root), 'utf8');
  s = s.replace(/import\s*\{[\s\S]*?\}\s*from\s*'[^']+';\n?/g, '').replace(/^export\s+(?=(const|let|function|async|class))/gm, '');
  return `// ---- ${f}.js ----\n${s}`;
}).join('\n');
const css = readFileSync(new URL('css/app.css', root), 'utf8');
let html = readFileSync(new URL('index.html', root), 'utf8')
  .replace('<link rel="stylesheet" href="css/app.css">', `<style>\n${css}\n</style>`)
  .replace(/<script charset="utf-8" src="https:\/\/static\.line-scdn\.net[^<]+<\/script>\n?/, '')
  .replace('<script type="module" src="js/app.js"></script>', () => `<script type="module">\n${js}\n</script>`)
  .replace('<title>Sharing 分帳</title>', '<title>Sharing 分帳（示範）</title>');
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/demo.html', import.meta.url), html);
console.log('dist/demo.html', (html.length / 1024).toFixed(1), 'KB');
