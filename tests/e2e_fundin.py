# QA：存入公費——誰存入可以複選、預設全選、全選／取消（示範模式）
import sys, os, http.server, threading, functools
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
    shot = lambda n: pg.screenshot(path=f'{SHOTS}/{n}.png')
    pg.goto('http://127.0.0.1:8772/index.html'); pg.get_by_text('東京五日遊').click()
    pg.get_by_role('dialog').get_by_text('小安', exact=True).click(); pg.wait_for_timeout(400)

    def open_fundin():
        pg.get_by_role('tab', name='成員').click(); pg.wait_for_timeout(200)
        pg.get_by_role('button', name='🏦 存入公費').click()
        return pg.get_by_role('dialog', name='存入公費')

    d = open_fundin()
    # 預設四位成員全選
    for n in ['小安', '阿哲', '米米', 'Kai']: expect(d.get_by_label(f'{n} 存入')).to_be_checked()
    expect(d.get_by_role('button', name='全部取消')).to_be_visible()
    shot('50-fundin-all')
    d.get_by_role('button', name='全部取消').click()
    for n in ['小安', '阿哲', '米米', 'Kai']: expect(d.get_by_label(f'{n} 存入')).not_to_be_checked()
    expect(d.get_by_role('button', name='全選')).to_be_visible()
    d.get_by_role('button', name='全選').click()
    for n in ['小安', '阿哲', '米米', 'Kai']: expect(d.get_by_label(f'{n} 存入')).to_be_checked()
    # 只留兩位 → 金額平分成 2 筆
    d.get_by_label('米米 存入').uncheck(); d.get_by_label('Kai 存入').uncheck()
    d.get_by_label('金額').fill('1000')
    expect(d.get_by_text('金額會平分成 2 筆', exact=False)).to_be_visible()
    shot('51-fundin-two')
    d.get_by_role('button', name='記下這筆').click(); pg.wait_for_timeout(500)
    expect(pg.get_by_text('已記下：2 人共存入 NT$1,000')).to_be_visible()
    pg.get_by_role('tab', name='明細').click()
    rows = pg.locator('.rec').filter(has=pg.locator('.rec-main strong', has_text='存入公費'))
    expect(rows).to_have_count(2)
    assert 'NT$500' in rows.nth(0).inner_text() and 'NT$500' in rows.nth(1).inner_text()
    shot('52-fundin-records')

    # 只選一人：行為跟原本單人存入一樣（一筆、金額不拆分）
    d = open_fundin()
    d.get_by_role('button', name='全部取消').click()
    d.get_by_label('小安 存入').check()
    d.get_by_label('金額').fill('300')
    expect(d.locator('.hint', has_text='平分成')).to_have_count(0)
    d.get_by_role('button', name='記下這筆').click(); pg.wait_for_timeout(500)
    pg.get_by_role('tab', name='明細').click()
    expect(pg.locator('.rec-main strong', has_text='存入公費')).to_have_count(3)

    # 沒有勾選任何人不能送出
    d = open_fundin()
    d.get_by_role('button', name='全部取消').click()
    d.get_by_label('金額').fill('100')
    d.get_by_role('button', name='記下這筆').click(); pg.wait_for_timeout(300)
    expect(pg.get_by_text('請至少選一位存入的人')).to_be_visible()
    d.get_by_role('button', name='關閉').click(); pg.wait_for_timeout(200)

    # 編輯既有一筆「存入公費」紀錄：維持單一存入人（不變成複選核取方塊）
    pg.get_by_role('tab', name='明細').click()
    pg.locator('.rec', has_text='公費存入').first.click()
    ed = pg.get_by_role('dialog', name='存入公費')
    expect(ed.locator('.split-list input[type=checkbox]')).to_have_count(0)  # 編輯模式沒有複選核取方塊
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    b.close()
srv.shutdown()
print('FUNDIN E2E OK' if not errors else 'ERRORS ' + '\n'.join(errors)); sys.exit(1 if errors else 0)
