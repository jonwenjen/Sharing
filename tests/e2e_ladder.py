# QA：爬梯子（示範模式、手機尺寸）
import sys, os, http.server, threading, functools
from playwright.sync_api import sync_playwright, expect
ROOT = os.path.join(os.path.dirname(__file__), '..', 'web')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots'
os.makedirs(SHOTS, exist_ok=True)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8767), functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='zh-TW')
    ctx.route('**/*', lambda r: r.abort() if not r.request.url.startswith('http://127.0.0.1') else r.continue_())
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto('http://127.0.0.1:8767/index.html'); pg.get_by_text('東京五日遊').click()
    pg.get_by_role('dialog').get_by_text('小安', exact=True).click(); pg.wait_for_timeout(400)
    for mode, label in [('命運', '選出'), ('配對', '分成'), ('優先權', None)]:
        pg.get_by_role('button', name='爬梯子').click()
        d = pg.get_by_role('dialog', name='爬梯子')
        expect(d.get_by_text('參加的人（4/4）')).to_be_visible()   # 預設全選
        d.get_by_role('button', name=mode, exact=True).click()
        if label: expect(d.locator('.stepper')).to_contain_text(label)
        if mode == '配對': d.get_by_role('button', name='增加').click(); expect(d.locator('.stepper strong')).to_have_text('3')
        if mode == '命運': pg.screenshot(path=f'{SHOTS}/30-ladder-setup.png')
        d.get_by_role('button', name='🪜 開始爬梯子！').click()
        stage = pg.locator('.ladder-stage')
        expect(stage).to_be_visible()
        expect(pg.locator('.lad-rung.on')).to_have_count(0)            # 盲盒：一開始看不到橫線
        expect(pg.locator('.lad-slot.masked')).to_have_count(4)        # 終點全部遮住
        if mode == '命運':
            pg.wait_for_timeout(500); pg.screenshot(path=f'{SHOTS}/31-ladder-countdown.png')
            pg.wait_for_timeout(2000); pg.screenshot(path=f'{SHOTS}/32-ladder-running.png')
            assert pg.locator('.lad-rung.on').count() > 0, '跑的途中橫線要逐一點亮'
        expect(pg.locator('.lad-result.show')).to_be_visible(timeout=7000)  # 全程約 5 秒
        expect(pg.locator('.lad-slot.masked')).to_have_count(0)
        if mode == '命運':
            expect(pg.locator('.lad-slot.hit')).to_have_count(1)
            pg.screenshot(path=f'{SHOTS}/33-ladder-result.png')
        if mode == '配對': assert pg.locator('.lad-card li').count() == 3
        if mode == '優先權':
            expect(pg.locator('.lad-card li')).to_have_count(4)
            pg.screenshot(path=f'{SHOTS}/34-ladder-priority.png')
            pg.get_by_role('button', name='🔁 再來一次').click()
            expect(pg.locator('.ladder-stage')).to_have_count(1)
            expect(pg.locator('.lad-slot.masked')).to_have_count(4)
            expect(pg.locator('.lad-result.show')).to_be_visible(timeout=7000)
        pg.get_by_role('button', name='完成').click(); pg.wait_for_timeout(400)
        expect(stage).to_have_count(0)
    # 少於 2 人不能開始
    pg.get_by_role('button', name='爬梯子').click()
    d = pg.get_by_role('dialog', name='爬梯子'); d.get_by_role('button', name='全部取消').click()
    expect(d.get_by_role('button', name='🪜 開始爬梯子！')).to_be_disabled()
    b.close()
srv.shutdown()
print('LADDER E2E OK' if not errors else 'ERRORS ' + '\n'.join(errors)); sys.exit(1 if errors else 0)
