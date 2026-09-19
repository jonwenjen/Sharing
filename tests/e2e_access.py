# QA：遠端模式（本機 Worker）驗證權限控管與帳本標示
import sys, os, subprocess, time, http.server, threading, functools, json, urllib.request
from playwright.sync_api import sync_playwright, expect
ROOT = os.path.join(os.path.dirname(__file__), '..')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots'
api = subprocess.Popen(['node', 'tests/local-api.mjs'], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
time.sleep(1.5)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8766), functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.join(ROOT, 'web')))
threading.Thread(target=srv.serve_forever, daemon=True).start()
CONFIG = "export const CONFIG = { LIFF_ID: '2000000000-Test', API_BASE: 'http://127.0.0.1:8787', WEB_URL: 'http://127.0.0.1:8766/index.html' };"
def liff_stub(uid, name):
    return """window.liff = { init: async () => {}, isLoggedIn: () => true, login: () => {}, isInClient: () => false,
      getProfile: async () => ({ userId: '%s', displayName: '%s', pictureUrl: '' }), getIDToken: () => 'dev:%s:%s',
      getContext: () => ({ type: 'external' }), isApiAvailable: () => false, openWindow: () => {}, closeWindow: () => {} };""" % (uid, name, uid, name)
errors = []
def page_for(b, uid, name):
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, locale='zh-TW')
    ctx.route('**/js/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body=CONFIG))
    ctx.route('https://static.line-scdn.net/**', lambda r: r.fulfill(status=200, content_type='text/javascript', body=liff_stub(uid, name)))
    ctx.route('https://fonts.**', lambda r: r.abort())
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    return pg
with sync_playwright() as p:
    b = p.chromium.launch()
    # Robin 建立帳本（連結群組）
    robin = page_for(b, 'robin', 'Robin')
    robin.goto('http://127.0.0.1:8766/index.html?g=Cski')
    robin.get_by_role('button', name='建立帳本').click()
    d = robin.get_by_role('dialog'); d.get_by_placeholder('例如：東京五日遊').fill('志賀高原')
    d.get_by_role('button', name='建立帳本').click()
    expect(robin.locator('.top-title')).to_have_text('志賀高原')
    expect(robin.locator('.ledger-meta')).to_contain_text('滑雪團')
    lid = robin.evaluate("new URLSearchParams(location.search).get('l')")
    robin.get_by_role('tab', name='成員').click()
    robin.get_by_role('button', name='複製連結').click()  # 觸發邀請連結
    code = json.loads(urllib.request.urlopen(urllib.request.Request(f'http://127.0.0.1:8787/api/ledgers/{lid}', headers={'Authorization': 'Bearer dev:robin:Robin'})).read())['ledger']['inviteCode']
    robin.get_by_role('button', name='回帳本列表').click()
    expect(robin.locator('.ledger-card').first).to_contain_text('我建立的')
    expect(robin.locator('.ledger-card').first).to_contain_text('👥 滑雪團')
    expect(robin.locator('.ledger-card').first).to_contain_text('建立者 Robin')
    robin.screenshot(path=f'{SHOTS}/20-home-labels.png')
    # 陌生人直接開帳本 → 沒有權限
    eve = page_for(b, 'eve', 'Eve')
    eve.goto(f'http://127.0.0.1:8766/index.html?l={lid}')
    expect(eve.get_by_text('無法開啟這本帳本')).to_be_visible()
    eve.screenshot(path=f'{SHOTS}/21-no-access.png')
    eve.locator('.btn.primary', has_text='回帳本列表').click()
    expect(eve.get_by_text('志賀高原')).to_have_count(0)
    # 用邀請連結加入
    eve.goto(f'http://127.0.0.1:8766/index.html?l={lid}&join={code}')
    expect(eve.locator('.top-title')).to_have_text('志賀高原')
    expect(eve.get_by_role('dialog', name='歡迎加入「志賀高原」')).to_be_visible()
    eve.screenshot(path=f'{SHOTS}/25-invite-identity.png')
    assert 'join=' not in eve.url, '加入後網址要移除邀請碼'
    eve.goto(f'http://127.0.0.1:8766/index.html')
    expect(eve.get_by_text('志賀高原')).to_be_visible()
    # 群組成員（zhe）不用邀請連結也能進
    zhe = page_for(b, 'zhe', 'Zhe')
    zhe.goto(f'http://127.0.0.1:8766/index.html?l={lid}')
    expect(zhe.locator('.top-title')).to_have_text('志賀高原')
    # 管理員
    boss = page_for(b, 'boss', 'Boss')
    boss.goto('http://127.0.0.1:8766/index.html')
    expect(boss.get_by_text('其他帳本（管理員可檢視')).to_be_visible()
    expect(boss.locator('.ledger-card.admin-view').first).to_contain_text('管理員檢視')
    expect(boss.locator('.me-chip')).to_contain_text('管理員')
    boss.screenshot(path=f'{SHOTS}/22-admin-home.png')
    boss.locator('.ledger-card.admin-view').first.click()
    expect(boss.get_by_text('管理員檢視：你不是這本帳本的成員')).to_be_visible()
    expect(boss.get_by_role('dialog')).to_have_count(0)
    boss.screenshot(path=f'{SHOTS}/23-admin-ledger.png')
    boss.get_by_role('button', name='回帳本列表').click(); boss.locator('.me-chip').click()
    expect(boss.get_by_role('dialog').get_by_text('boss', exact=True)).to_be_visible()
    boss.screenshot(path=f'{SHOTS}/24-account.png')
    # 重設邀請連結後舊連結失效
    robin.goto(f'http://127.0.0.1:8766/index.html?l={lid}')
    robin.get_by_role('button', name='帳本設定').click()
    robin.get_by_role('button', name='重設邀請連結').click(); robin.get_by_role('dialog').last.get_by_role('button', name='重設邀請連結').click()
    robin.wait_for_timeout(500)
    frank = page_for(b, 'frank', 'Frank')
    frank.goto(f'http://127.0.0.1:8766/index.html?l={lid}&join={code}')
    expect(frank.get_by_text('邀請連結已失效')).to_be_visible()
    # 正式設定下，LINE 元件載入失敗時不可偷偷進示範模式
    ctx2 = b.new_context(viewport={'width': 390, 'height': 844})
    ctx2.route('**/js/config.js', lambda r: r.fulfill(status=200, content_type='text/javascript', body=CONFIG))
    ctx2.route('https://static.line-scdn.net/**', lambda r: r.abort())
    ctx2.route('https://fonts.**', lambda r: r.abort())
    pg2 = ctx2.new_page(); pg2.goto('http://127.0.0.1:8766/index.html')
    expect(pg2.get_by_text('LINE 登入元件載入失敗')).to_be_visible(timeout=10000)
    expect(pg2.get_by_text('示範模式')).to_have_count(0)
    pg2.screenshot(path=f'{SHOTS}/26-liff-failed.png')
    b.close()
api.terminate(); srv.shutdown()
print('ACCESS E2E OK' if not errors else 'ERRORS: ' + '\n'.join(errors))
sys.exit(1 if errors else 0)
