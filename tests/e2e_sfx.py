# QA：爬梯子、手指抽籤、吃什麼轉盤的音效與震動（示範模式、手機尺寸）
import sys, os, json, http.server, threading, functools
from playwright.sync_api import sync_playwright, expect
ROOT = os.path.join(os.path.dirname(__file__), '..', 'web')
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 8774), functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
errors = []
# 記錄每個振盪器開始發聲、每次震動
PROBE = """
window.__osc = 0; window.__vib = [];
const _start = OscillatorNode.prototype.start;
OscillatorNode.prototype.start = function (...a) { window.__osc++; return _start.apply(this, a); };
window.__plays = 0;
const _play = HTMLMediaElement.prototype.play;
HTMLMediaElement.prototype.play = function () { window.__plays++; return _play.call(this); };
if (!window.__noSession) Object.defineProperty(navigator, 'audioSession', { configurable: true, value: { type: 'auto' } });
Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p) => { window.__vib.push(JSON.stringify(p)); return true; } });
"""
WIN = json.dumps([40, 60, 40, 60, 120]).replace(' ', '')
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='zh-TW')
    ctx.add_init_script(PROBE)
    ctx.route('**/*', lambda r: r.abort() if not r.request.url.startswith('http://127.0.0.1') else r.continue_())
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errors.append(str(e)))
    cdp = ctx.new_cdp_session(pg)
    touch = lambda kind, pts: cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y, 'id': i} for i, (x, y) in pts]})
    osc = lambda: pg.evaluate('window.__osc')
    vib = lambda: pg.evaluate('window.__vib')
    reset = lambda: pg.evaluate('window.__osc = 0; window.__vib = []')
    pg.goto('http://127.0.0.1:8774/index.html'); pg.get_by_text('東京五日遊').click()
    pg.get_by_role('dialog').get_by_text('小安', exact=True).click(); pg.wait_for_timeout(400)

    # ---- 爬梯子：倒數、GO、橫線喀喀、揭曉、勝利號角
    reset()
    pg.get_by_role('button', name='爬梯子').click()
    pg.get_by_role('dialog', name='爬梯子').get_by_role('button', name='🪜 開始爬梯子！').click()
    expect(pg.locator('.lad-result.show')).to_be_visible(timeout=8000)
    assert pg.evaluate('navigator.audioSession.type') == 'playback', 'iPhone 靜音模式也要出聲'
    v = vib()
    assert osc() > 30, f'爬梯子音效太少：{osc()}'
    assert '25' in v and '[60,40,60]' in v and '8' in v and WIN in v, v
    assert pg.evaluate("new (window.AudioContext || window.webkitAudioContext)().state") in ('running', 'suspended')
    # 關閉音效：不再發聲，但還是會震動；設定記住
    pg.get_by_role('button', name='關閉音效').click()
    expect(pg.get_by_role('button', name='開啟音效')).to_be_visible()
    assert pg.evaluate("localStorage.getItem('sharing-sfx-v1')") == 'off'
    reset()
    pg.get_by_role('button', name='🔁 再來一次').click()
    expect(pg.locator('.lad-slot.masked')).to_have_count(4)
    expect(pg.locator('.ladder-stage')).to_have_count(1)
    expect(pg.locator('.lad-result.show')).to_be_visible(timeout=8000)
    assert osc() == 0, f'靜音時不該有聲音：{osc()}'
    assert WIN in vib(), vib()
    assert pg.evaluate('navigator.audioSession.type') == 'auto', '靜音時不用搶音訊'
    pg.get_by_role('button', name='開啟音效').click()
    assert pg.evaluate("localStorage.getItem('sharing-sfx-v1')") == 'on'
    assert pg.evaluate('navigator.audioSession.type') == 'playback'
    pg.get_by_role('button', name='完成').click(); pg.wait_for_timeout(400)
    assert pg.evaluate('navigator.audioSession.type') == 'auto', '離開遊戲要還原，別的 App 的音樂才能繼續'

    # ---- 手指抽籤：放手指啵、倒數嗶、鎖定碰、亂跳喀、揭曉、號角
    reset()
    pg.get_by_role('button', name='手指抽籤').click()
    pg.get_by_role('dialog', name='手指抽籤').get_by_role('button', name='☝️ 開始手指抽籤！').click()
    expect(pg.get_by_role('button', name='關閉音效')).to_be_visible()
    assert pg.evaluate('navigator.audioSession.type') == 'playback'
    touch('touchStart', [(1, (110, 330)), (2, (280, 560))])
    expect(pg.locator('.fg-result.show')).to_be_visible(timeout=9000)
    v = vib()
    assert osc() > 30, f'手指抽籤音效太少：{osc()}'
    assert v.count('15') >= 2 and '25' in v and '[60,40,60]' in v and v.count('8') >= 5 and WIN in v, v
    touch('touchEnd', [])
    pg.get_by_role('button', name='完成').click(); pg.wait_for_timeout(400)
    assert pg.evaluate('navigator.audioSession.type') == 'auto'

    # ---- 吃什麼轉盤：咻、每格喀一聲、停下碰＋號角
    reset()
    pg.get_by_role('button', name='吃什麼轉盤').click()
    pg.get_by_role('dialog', name='吃什麼轉盤').locator('.food-go').click()
    pg.get_by_role('button', name='轉動轉盤').click()
    pg.wait_for_timeout(1200)
    assert pg.locator('.fw-pointer.bump').count() == 1, '轉的時候指針要跟著喀喀動'
    expect(pg.locator('.fw-result.show')).to_be_visible(timeout=7000)
    v = vib()
    ticks = v.count('6')
    assert ticks >= 15, f'轉過的格數太少：{ticks}'
    assert '30' in v and '[80,40,40,60,120]' in v, v
    assert osc() > ticks, osc()
    assert pg.evaluate('navigator.audioSession.type') == 'playback'
    pg.get_by_role('button', name='回到選單').click(); pg.wait_for_timeout(400)
    assert pg.evaluate('navigator.audioSession.type') == 'auto'

    # ---- 舊版 iPhone（沒有 audioSession）：先播一段無聲音訊，靜音模式才會有聲音
    old = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, locale='zh-TW',
                        user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1')
    old.add_init_script('window.__noSession = true;' + PROBE)
    old.route('**/*', lambda r: r.abort() if not r.request.url.startswith('http://127.0.0.1') else r.continue_())
    op = old.new_page(); op.on('pageerror', lambda e: errors.append(str(e)))
    op.goto('http://127.0.0.1:8774/index.html'); op.get_by_text('東京五日遊').click()
    op.get_by_role('dialog').get_by_text('小安', exact=True).click(); op.wait_for_timeout(400)
    op.get_by_role('button', name='爬梯子').click()
    op.get_by_role('dialog', name='爬梯子').get_by_role('button', name='🪜 開始爬梯子！').click()
    expect(op.locator('.ladder-stage')).to_be_visible()
    assert op.evaluate('window.__plays') == 1, op.evaluate('window.__plays')
    expect(op.locator('.lad-result.show')).to_be_visible(timeout=8000)
    op.get_by_role('button', name='🔁 再來一次').click()
    expect(op.locator('.lad-slot.masked')).to_have_count(4)
    assert op.evaluate('window.__plays') == 1, '無聲音訊只要播一次'
    b.close()
srv.shutdown()
print('SFX E2E OK' if not errors else 'ERRORS ' + '\n'.join(errors)); sys.exit(1 if errors else 0)
