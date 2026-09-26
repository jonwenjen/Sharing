# 交接筆記（給接手這個 repo 的新 Claude session）

任何一個新開的 session，只要 clone 了這個 repo，就會看到這份文件——不用依賴任何 Project 或記憶功能。

_最後更新：2026-09-26，HEAD 在 `1dcdd2e`（v1.10）_

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

## 版本歷史（v1.8 → v1.10）
- **v1.8**：記帳小技巧（金額可輸入算式、依項目名稱自動分類、記住上次付款人/幣別/分攤、複製成新一筆）、合併重複成員、吃什麼轉盤（單層 40 個候選）
- **v1.9**：吃什麼轉盤改成四大項（餐點／小吃／飲料／甜點），各自分區顯示（例如餐點分「正餐料理／速食連鎖／超商」）；飲料加入南部起家品牌（50嵐、清心福全、迷客夏、茶の魔手、翰林茶館、雙全紅茶、樺達奶茶）；轉完回到轉盤主畫面而非直接關閉
- **v1.10**：
  - 「存入公費」的「誰存入」改成可複選（預設全員勾選，可全選/全部取消）；勾多人時金額平分成多筆各自的單人存入紀錄，跟舊資料格式相容、後端沒動
  - 甜點新增「連鎖甜點」「連鎖咖啡店（甜點）」兩個分區

相關檔案：`web/js/foodwheel.js`（轉盤）、`web/js/app.js`（記帳編輯器、公費）、`web/js/money.js`（分帳邏輯、自動分類）。

## ⚠️ 卡住的地方：commit 已完成，但還沒推上 GitHub
截至這份文件寫的時候：
- `1dcdd2e`（v1.10）已經在使用者的 Mac（`~/Projects/Sharing`）本地，**但還不確定有沒有成功 `git push` 上去**——先跑 `git log origin/main --oneline -1` 跟本地 HEAD 比對，一致就代表已經推過了，不用重複處理。
- 背景：先前的雲端 session 沒有這個 repo 的推送權限（`access denied by the git proxy: ... not in this session's authorized repository set`），這個限制是「建立 session 當下」決定的，裝好 GitHub App／跑過 `/web-setup` 只對之後新建立的 session 有效。
- 如果你是全新建立的 session、且是透過 claude.ai/code 首頁的 repo 選擇器選到這個 repo 開始的，通常就有推送權限了，直接 `git push` 試試看即可。
- 如果還是被拒絕：把新的 commit 用 `git bundle create` 打包，透過裝置檔案工具傳給使用者，讓使用者在自己 Mac 的 repo 目錄 `git pull --ff-only <bundle> main` 套用，由使用者自己 `git push`。

## 開發慣例
- 商業邏輯（分帳、結算、猜分類）在 `web/js/money.js`，純函式、有單元測試（`tests/money.test.mjs`）
- 每個功能都有對應的 Playwright E2E（`tests/e2e*.py`），檔名對應功能（`e2e_food.py`＝轉盤、`e2e_fundin.py`＝公費複選、`e2e_ladder.py`＝爬梯子…）
- commit message 慣例：`vX.Y: 功能摘要（前端／後端）`，中文
- `dist/` 是 gitignore 的，`npm run build:demo` 本地產生即可，不用進版控
