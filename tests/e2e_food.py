# QA：吃什麼轉盤、記帳小技巧（記住上次、自動分類、算式、複製）、合併成員（示範模式、手機尺寸）
import sys, os, http.server, threading, functools
from playwright.sync_api import sync_playwright, expect
ROOT = os.path.join(os.path.dirname(__file__), '..', 'web')
SHOTS = sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots'
os.makedirs(SHOTS, exist_ok=True)
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8771), functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
errors = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='zh-TW')
    ctx.route('**/*', lambda r: r.abort() if not r.request.url.startswith('http://127.0.0.1') else r.continue_())
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    shot = lambda n: pg.screenshot(path=f'{SHOTS}/{n}.png')
    pg.goto('http://127.0.0.1:8771/index.html'); pg.get_by_text('東京五日遊').click()
    pg.get_by_role('dialog').get_by_text('小安', exact=True).click(); pg.wait_for_timeout(400)

    # ---- 吃什麼轉盤
    pg.get_by_role('button', name='吃什麼轉盤').click()
    d = pg.get_by_role('dialog', name='吃什麼轉盤')
    cards = d.locator('.food-card')
    assert cards.count() >= 30, cards.count()
    expect(d.locator('.food-card.on')).to_have_count(cards.count())        # 預設全選
    shot('40-food-setup')
    d.get_by_role('button', name='⬜ 全部取消').click()
    expect(d.locator('.food-card.on')).to_have_count(0)
    expect(d.get_by_role('button', name='🎡 轉起來！')).to_be_disabled()
    d.get_by_role('button', name='✅ 全選').click()
    expect(d.locator('.food-card.on')).to_have_count(cards.count())
    d.get_by_role('button', name='剉冰', exact=True).click()                            # 取消一個
    expect(d.locator('.food-count strong')).to_have_text(str(cards.count() - 1))
    d.get_by_placeholder('加入自己的選項，例如：巷口麵店').fill('阿婆麵攤'); d.get_by_role('button', name='加入').click()
    expect(d.get_by_role('button', name='阿婆麵攤', exact=True)).to_have_attribute('aria-pressed', 'true')
    d.get_by_role('button', name='🎡 轉起來！').click()
    stage = pg.locator('.food-stage'); expect(stage).to_be_visible()
    shot('41-food-wheel')
    pg.get_by_role('button', name='轉動轉盤').click()
    pg.wait_for_timeout(1500); shot('42-food-spinning')
    expect(pg.locator('.fw-result.show')).to_be_visible(timeout=7000)
    name = pg.locator('.fw-name').inner_text().rstrip('！')
    assert name != '剉冰', '取消的選項不該被轉到'
    shot('43-food-result')
    pg.get_by_role('button', name='🔁 再轉一次').click()
    expect(pg.locator('.fw-result.show')).to_have_count(0)
    expect(pg.locator('.fw-result.show')).to_be_visible(timeout=7000)
    name = pg.locator('.fw-name').inner_text().rstrip('！')
    pg.get_by_role('button', name='✅ 就吃這個，記一筆').click()
    ed = pg.get_by_role('dialog', name='記一筆')
    expect(ed.get_by_placeholder('項目名稱，例如：晚餐')).to_have_value(name)   # 直接帶入項目
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # 下次打開選擇還在
    pg.get_by_role('button', name='吃什麼轉盤').click()
    d = pg.get_by_role('dialog', name='吃什麼轉盤')
    expect(d.get_by_role('button', name='剉冰', exact=True)).to_have_attribute('aria-pressed', 'false')
    expect(d.get_by_role('button', name='阿婆麵攤', exact=True)).to_be_visible()
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)

    # ---- 記帳小技巧
    pg.get_by_role('button', name='記一筆').click()
    ed = pg.get_by_role('dialog', name='記一筆')
    ed.get_by_label('金額').fill('1200+350')
    expect(ed.locator('.calc-hint')).to_have_text('= NT$1,550')
    ed.get_by_role('button', name='加號：再加一筆').click(); ed.get_by_label('金額').press('End'); ed.get_by_label('金額').type('50')
    expect(ed.locator('.calc-hint')).to_have_text('= NT$1,600')
    ed.get_by_placeholder('項目名稱，例如：晚餐').fill('星巴克咖啡')
    expect(ed.locator('.chips.cats .chip.on')).to_have_text('🧋 飲料')     # 自動分類
    ed.get_by_role('button', name='阿哲').first.click()                    # 付款人改成阿哲
    ed.get_by_label('Kai 參與分攤').uncheck()
    shot('44-editor-calc')
    ed.get_by_role('button', name='記下這筆').click(); pg.wait_for_timeout(500)
    expect(pg.locator('.rec', has_text='星巴克咖啡')).to_contain_text('NT$1,600')
    # 下一筆記住付款人與分攤的人
    pg.get_by_role('button', name='記一筆').click()
    ed = pg.get_by_role('dialog', name='記一筆')
    expect(ed.locator('.chip.person.on').first).to_contain_text('阿哲')
    expect(ed.get_by_label('Kai 參與分攤')).not_to_be_checked()
    # 手動選分類後不再自動改
    ed.get_by_role('button', name='🍰 甜點').click()
    ed.get_by_placeholder('項目名稱，例如：晚餐').fill('晚餐')
    expect(ed.locator('.chips.cats .chip.on')).to_have_text('🍰 甜點')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    # 複製成新的一筆
    pg.locator('.rec', has_text='星巴克咖啡').click()
    pg.get_by_role('button', name='複製成新的一筆（日期改成今天）').click()
    ed = pg.get_by_role('dialog', name='記一筆')
    expect(ed.get_by_placeholder('項目名稱，例如：晚餐')).to_have_value('星巴克咖啡')
    expect(ed.get_by_label('金額')).to_have_value('1600')
    ed.get_by_role('button', name='記下這筆').click(); pg.wait_for_timeout(500)
    expect(pg.locator('.rec', has_text='星巴克咖啡')).to_have_count(2)

    # ---- 合併成員：新增一個重複的「小安(2)」再合併
    pg.get_by_role('tab', name='成員').click()
    pg.get_by_placeholder('新成員名字').fill('小安(2)'); pg.get_by_role('button', name='新增').click(); pg.wait_for_timeout(300)
    pg.get_by_role('tab', name='明細').click()
    pg.get_by_role('button', name='記一筆').click()
    ed = pg.get_by_role('dialog', name='記一筆')
    ed.get_by_label('金額').fill('500'); ed.get_by_placeholder('項目名稱，例如：晚餐').fill('重複測試')
    ed.get_by_role('button', name='小安(2)').first.click()
    ed.get_by_role('button', name='記下這筆').click(); pg.wait_for_timeout(500)
    pg.get_by_role('tab', name='成員').click()
    pg.locator('.member', has_text='小安(2)').click()
    pg.get_by_role('button', name='👥 和另一位成員合併（重複加入時用）').click()
    m = pg.get_by_role('dialog', name='合併「小安(2)」')
    expect(m.get_by_text('筆紀錄都會移過去', exact=False)).to_be_visible()
    shot('45-merge')
    m.locator('.member', has_text='小安').first.click()
    pg.get_by_role('button', name='合併', exact=True).click(); pg.wait_for_timeout(600)
    expect(pg.locator('.member', has_text='小安(2)')).to_have_count(0)
    pg.get_by_role('tab', name='明細').click()
    expect(pg.locator('.rec', has_text='重複測試')).to_contain_text('小安 先付')
    b.close()
srv.shutdown()
print('FOOD E2E OK' if not errors else 'ERRORS ' + '\n'.join(errors)); sys.exit(1 if errors else 0)
