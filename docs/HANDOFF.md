# 交接筆記（給接手這個 repo 的新 Claude session）

任何一個新開的 session，只要 clone 了這個 repo，就會看到這份文件——不用依賴任何 Project 或記憶功能。

_最後更新：2026-09-26（v1.12）_

## 這是什麼專案
LINE 群組記帳／分帳工具（類似 Splitwise / Lightsplit），前端是 LIFF 網頁（`web/`），後端是 Cloudflare Worker（`worker/`）+ D1。詳細規格看 `DESIGN.md`，開發規則看 `README.md`。

## 開發模式（重要，跑測試前一定要看）
`web/js/config.js` 的 `LIFF_ID`／`API_BASE` 若留空，會自動切換成「示範模式」（資料存在瀏覽器 localStorage，不連真的後端）。**任何 Playwright/E2E 測試都要在示範模式下跑**：
```bash
# 跑測試前
sed -i "s/LIFF_ID: '[^']*'/LIFF_ID: ''/; s/API_BASE: '[^']*'/API_BASE: ''/" web/js/config.js
npm run build:demo   # 重新打包 dist/demo.html（示範模式）
python3 tests/e2e_xxx.py /tmp/shots
npm test             # 單元測試

# 跑完一定要還原，不然會把清空的 config 提交上去：
git checkout -- web/js/config.js
npm run build:demo   # 用正式 config 重新打包一次
```

## 版本歷史（v1.8 → v1.12）
- **v1.8**：記帳小技巧（金額可輸入算式、依項目名稱自動分類、記住上次付款人/幣別/分攤、複製成新一筆）、合併重複成員、吃什麼轉盤（單層 40 個候選）
- **v1.9**：吃什麼轉盤改成四大項（餐點／小吃／飲料／甜點），各自分區顯示（例如餐點分「正餐料理／速食連鎖／超商」）；飲料加入南部起家品牌（50嵐、清心福全、迷客夏、茶の魔手、翰林茶館、雙全紅茶、樺達奶茶）；轉完回到轉盤主畫面而非直接關閉
- **v1.10**：
  - 「存入公費」的「誰存入」改成可複選（預設全員勾選，可全選/全部取消）；勾多人時金額平分成多筆各自的單人存入紀錄，跟舊資料格式相容、後端沒動
  - 甜點新增「連鎖甜點」「連鎖咖啡店（甜點）」兩個分區

- **v1.11**：
  - 吃什麼轉盤「轉XX！」按鈕移到細項清單上方（品項多時不用滑到底）
  - 帳本標題列：爬梯子右邊新增「手指抽籤」；使用說明、設定移到標題下方靠右
  - 手指抽籤（`web/js/fingerui.js`）：每人一根手指放上螢幕 → 第一根放上後 3 秒鎖定 → 5 秒內揭曉；模式同爬梯子（命運／配對／優先權），抽籤邏輯是 `ladder.js` 的 `fingerDraw()`（純函式、有單元測試）；沒觸控時可用滑鼠點

- **v1.12**：爬梯子、手指抽籤、吃什麼轉盤加上熱血音效與震動（`web/js/sfx.js`）。音效用 Web Audio 即時合成、不用音檔；Android 用 `navigator.vibrate`，iPhone 用 iOS 18 切換開關的觸覺回饋。遊戲畫面右上角可關音效（記在 localStorage）。`tests/e2e_sfx.py` 攔截振盪器與 vibrate 驗證

相關檔案：`web/js/foodwheel.js`（轉盤）、`web/js/app.js`（記帳編輯器、公費）、`web/js/money.js`（分帳邏輯、自動分類）。

## 推送
- 雲端 session 已經可以直接 `git push`。使用者要求：**commit 後直接 push 到 `main`，不用開分支或 PR**。
- 推到 `main` 且改到 `web/**` 時，GitHub Actions（`pages.yml`）會自動部署到 GitHub Pages；手機上看到舊版通常是 LINE 內建瀏覽器快取，關掉重開即可。
- 雲端 session 的 git proxy 不允許刪除遠端分支（403），要刪請使用者自己在 GitHub 上刪。

## 開發慣例
- 商業邏輯（分帳、結算、猜分類）在 `web/js/money.js`，純函式、有單元測試（`tests/money.test.mjs`）
- 每個功能都有對應的 Playwright E2E（`tests/e2e*.py`），檔名對應功能（`e2e_food.py`＝轉盤、`e2e_fundin.py`＝公費複選、`e2e_ladder.py`＝爬梯子、`e2e_finger.py`＝手指抽籤（用 CDP 模擬多點觸控）…）
- 雲端容器裡 pip 裝的 Playwright 版本跟預裝的 Chromium 對不上時，用 `launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome')` 跑（不要改測試檔提交）
- 示範版是把所有模組串成一個檔（`scripts/build-demo.mjs`），**各模組的頂層變數名稱不能重複**；新增模組要加進它的 `order`
- commit message 慣例：`vX.Y: 功能摘要（前端／後端）`，中文
- `dist/` 是 gitignore 的，`npm run build:demo` 本地產生即可，不用進版控
