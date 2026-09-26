# QA：手指抽籤（多點觸控用 CDP 模擬）、帳本標題列（示範模式、手機尺寸）
import sys, os, time, http.server, threading, functools
from playwright.sync_api import sync_playwright, expect
ROOT = os.path.join(os.path.dirname(__file__), '..', 'web')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots'
os.makedirs(SHOTS, exist_ok=True)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8772), functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='zh-TW')
    ctx.route('**/*', lambda r: r.abort() if not r.request.url.startswith('http://127.0.0.1') else r.continue_())
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    cdp = ctx.new_cdp_session(pg)
    touch = lambda kind, pts: cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in pts]})
    shot = lambda n: pg.screenshot(path=f'{SHOTS}/{n}.png')
    pg.goto('http://127.0.0.1:8772/index.html'); pg.get_by_text('東京五日遊').click()
    pg.get_by_role('dialog').get_by_text('小安', exact=True).click(); pg.wait_for_timeout(400)

    # ---- 標題列：爬梯子右邊是手指抽籤；使用說明、設定移到下方靠右
    names = pg.locator('.top-actions .icon-btn').evaluate_all('els => els.map(e => e.getAttribute("aria-label"))')
    assert names == ['爬梯子', '手指抽籤', '吃什麼轉盤'], names
    subs = pg.locator('.ledger-sub .sub-actions .icon-btn').evaluate_all('els => els.map(e => e.getAttribute("aria-label"))')
    assert subs == ['使用說明', '帳本設定'], subs
    lad = pg.get_by_role('button', name='爬梯子').bounding_box(); gear = pg.get_by_role('button', name='帳本設定').bounding_box()
    assert gear['y'] > lad['y'] + lad['height'] - 1, '設定要在爬梯子下方'
    assert gear['x'] + gear['width'] > 390 - 24, '設定要靠右'
    shot('50-header')
    pg.get_by_role('button', name='使用說明').click()
    expect(pg.get_by_role('dialog', name='使用說明').get_by_text('手指抽籤（右上角手指圖示）')).to_be_visible()
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    def open_setup(mode, plus=0):
        pg.get_by_role('button', name='手指抽籤').click()
        d = pg.get_by_role('dialog', name='手指抽籤')
        d.get_by_role('button', name=mode, exact=True).click()
        for _ in range(plus): d.get_by_role('button', name='增加').click()
        return d

    # ---- 命運：1 根先放、半秒後共 3 根 → 3 秒鎖定 → 5 秒內揭曉
    d = open_setup('命運')
    expect(d.locator('.stepper strong')).to_have_text('1')
    shot('51-finger-setup')
    d.get_by_role('button', name='☝️ 開始手指抽籤！').click()
    st = pg.locator('.finger-stage')
    expect(st).to_be_visible(); expect(pg.locator('.fg-prompt')).to_contain_text('每人一根手指')
    shot('52-finger-wait')
    A, B, C, D = (110, 330), (280, 360), (190, 560), (120, 700)
    touch('touchStart', [(1, A)])
    expect(pg.locator('.fg-dot')).to_have_count(1); expect(pg.locator('.fg-count')).to_have_text('1 人')
    expect(st).to_have_class(__import__('re').compile('counting'))
    pg.wait_for_timeout(500)
    touch('touchStart', [(1, A), (2, B), (3, C)])
    expect(pg.locator('.fg-dot')).to_have_count(3); expect(pg.locator('.fg-count')).to_have_text('3 人')
    colors = pg.locator('.fg-dot').evaluate_all('els => els.map(e => e.style.getPropertyValue("--c"))')
    assert len(set(colors)) == 3, colors
    touch('touchMove', [(1, (A[0] + 20, A[1] + 10)), (2, B), (3, C)])   # 手指移動時圓圈跟著走
    pg.wait_for_timeout(200); shot('53-finger-counting')
    expect(st).to_have_class(__import__('re').compile('locked'), timeout=3500)
    t_lock = time.time()
    touch('touchStart', [(1, A), (2, B), (3, C), (4, D)])                # 鎖定後再放的不算
    expect(pg.locator('.fg-dot')).to_have_count(3)
    pg.wait_for_timeout(900); shot('54-finger-drawing')
    expect(pg.locator('.fg-result.show')).to_be_visible(timeout=6000)
    assert time.time() - t_lock < 5.2, f'鎖定到揭曉 {time.time() - t_lock:.1f}s'
    expect(pg.locator('.fg-dot.win')).to_have_count(1); expect(pg.locator('.fg-dot.lose')).to_have_count(2)
    expect(pg.locator('.fg-dot.win .fg-badge')).to_have_text('🎯 就是你！')
    expect(pg.locator('.fg-card-title')).to_have_text('🎯 選中 1 位')
    touch('touchEnd', [])                                                 # 放開手指，結果留著
    pg.wait_for_timeout(300)
    expect(pg.locator('.fg-dot')).to_have_count(3)
    shot('55-finger-fate-result')

    # 再來一次：清空重來；倒數中全部放開 → 取消倒數
    pg.get_by_role('button', name='🔁 再來一次').click()
    expect(pg.locator('.fg-dot')).to_have_count(0); expect(pg.locator('.fg-result.show')).to_have_count(0)
    touch('touchStart', [(5, A)]); expect(pg.locator('.fg-dot')).to_have_count(1)
    touch('touchEnd', []); pg.wait_for_timeout(250)
    expect(pg.locator('.fg-dot')).to_have_count(0)
    assert 'counting' not in st.get_attribute('class')
    # 只有 1 根手指撐過 3 秒 → 提示還差一位；第 2 根放上後重新倒數
    touch('touchStart', [(6, A)])
    expect(pg.locator('.fg-prompt')).to_contain_text('還差一位', timeout=4000)
    assert 'locked' not in st.get_attribute('class')
    touch('touchStart', [(6, A), (7, C)])
    expect(st).to_have_class(__import__('re').compile('locked'), timeout=3500)
    expect(pg.locator('.fg-result.show')).to_be_visible(timeout=6000)
    touch('touchEnd', [])
    pg.get_by_role('button', name='完成').click(); pg.wait_for_timeout(400)
    expect(st).to_have_count(0)

    # ---- 配對：4 根手指分 2 組，同組連線
    d = open_setup('配對'); expect(d.locator('.stepper strong')).to_have_text('2')
    d.get_by_role('button', name='☝️ 開始手指抽籤！').click()
    touch('touchStart', [(1, A), (2, B), (3, C), (4, D)])
    expect(pg.locator('.fg-result.show')).to_be_visible(timeout=9000)
    expect(pg.locator('.fg-dot.grouped')).to_have_count(4)
    expect(pg.locator('.fg-link')).to_have_count(2)
    expect(pg.locator('.fg-card li')).to_have_count(2)
    chip = pg.locator('.fg-card .fg-pet').first.evaluate('e => e.style.getPropertyValue("--c")')
    assert chip in ('#FF4D6D', '#4DABF7'), f'配對的名牌顏色要跟組別一樣：{chip}'
    shot('56-finger-pair-result')
    touch('touchEnd', [])
    pg.get_by_role('button', name='完成').click(); pg.wait_for_timeout(400)

    # 結果卡會避開手指：手指都在下半部 → 卡片放上方
    d = open_setup('配對'); d.get_by_role('button', name='☝️ 開始手指抽籤！').click()
    touch('touchStart', [(1, (110, 560)), (2, (280, 640)), (3, (190, 760))])
    expect(pg.locator('.fg-result.show')).to_be_visible(timeout=9000)
    expect(pg.locator('.fg-result')).to_have_class(__import__('re').compile('at-top'))
    card = pg.locator('.fg-result').bounding_box()
    assert card['y'] + card['height'] < 560 - 128, card
    pg.wait_for_timeout(600); shot('56b-finger-card-top')
    touch('touchEnd', [])
    pg.get_by_role('button', name='完成').click(); pg.wait_for_timeout(400)

    # ---- 優先權：沒有觸控時用滑鼠點（點一下新增、再點一下拿掉）
    d = open_setup('優先權')
    d.get_by_role('button', name='☝️ 開始手指抽籤！').click()
    for x, y in [A, B, C, D]: pg.mouse.click(x, y)
    pg.mouse.click(*D)                                                    # 再點一次拿掉
    expect(pg.locator('.fg-dot:not(.bye)')).to_have_count(3)
    expect(pg.locator('.fg-result.show')).to_be_visible(timeout=9000)
    expect(pg.locator('.fg-dot.ranked')).to_have_count(3)
    expect(pg.locator('.fg-badge', has_text='👑 第 1')).to_have_count(1)
    expect(pg.locator('.fg-rank')).to_have_count(3)
    shot('57-finger-priority-result')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(400)
    expect(pg.locator('.finger-stage')).to_have_count(0)
    # 設定會記住上次的模式
    pg.get_by_role('button', name='手指抽籤').click()
    expect(pg.get_by_role('dialog', name='手指抽籤').get_by_role('button', name='優先權', exact=True)).to_have_attribute('aria-pressed', 'true')
    b.close()
srv.shutdown()
print('FINGER E2E OK' if not errors else 'ERRORS ' + '\n'.join(errors)); sys.exit(1 if errors else 0)
