# Sharing — LINE 分帳記帳

在 LINE 群組裡一起記帳，也能用獨立網址開啟。支援多幣別、公費、自訂分攤，並自動算出**最少轉帳次數**的結清方式。

- 前端：`web/`（純 HTML/CSS/JS，無需建置，GitHub Pages 託管，透過 LINE LIFF 登入）
- 後端：`worker/`（Cloudflare Workers + D1 資料庫 + LINE Messaging API webhook）
- 共用邏輯：`web/js/money.js`（幣別／分攤）、`web/js/settle.js`（最少轉帳演算法），前後端共用同一份程式

## 功能

| 需求 | 做法 |
|---|---|
| 在 LINE 裡運作、也能連到獨立網站 | LIFF App；同一網址用一般瀏覽器開啟時走 LINE Login |
| 新增／修改／刪除每筆紀錄 | 支出、轉帳（還款）、存入公費三種類型 |
| 預設台幣、支援主流幣別 | 15 種幣別，自動帶入即時匯率（可手動改），結算統一換算成帳本幣別 |
| 自動分帳、最少匯款組合 | 位元 DP 求最多「零和分組」，保證最少筆數（≤18 人精確解，更多人用貪婪法） |
| 每人提供自己的匯款資訊 | 銀行／代碼／帳號、LINE Pay、街口、備註；只有本人能改；結算頁一鍵複製 |
| 團體與個人統計、匯出 | 分類長條圖、每人代墊／分攤／淨額；匯出明細與統計 CSV（Excel 可直接開） |
| 多個帳本 | 帳本列表，可封存、刪除 |
| 成員進來選自己是誰 | 首次開啟跳出「你是哪一位？」，依 LINE 名稱推薦、帶入大頭貼 |
| 分享群組、增減人數 | 以 LINE 分享邀請卡片或複製連結；可新增成員，已有帳目的成員改為停用 |
| 公費 | 存入公費、公費付款、指定保管人，結算時公費餘額併入保管人 |
| 異動是否分享到群組（預設要） | 每次新增／修改／刪除都有開關；預設值可在帳本設定調整 |

## 先試用（不需任何設定）

`config.js` 的 `LIFF_ID` 或 `API_BASE` 留空時自動進入**示範模式**，資料只存在瀏覽器：

```bash
cd web && python3 -m http.server 8080   # 開 http://localhost:8080
```

## 正式部署（約 20 分鐘）

### 1. 推到 GitHub
```bash
git config --global user.name "jonwenjen"
git config --global user.email "jonwenjen@gmail.com"

git init && git add . && git commit -m "Sharing v1"
git branch -M main
git remote add origin https://github.com/jonwenjen/Sharing.git
git push -u origin main
```
到 repo 的 **Settings → Pages → Source** 選 **GitHub Actions**。網址會是 `https://jonwenjen.github.io/Sharing/`。

### 2. 建立 LINE 頻道（[LINE Developers](https://developers.line.biz/console/)）
1. 建立 Provider。
2. 建一個 **LINE Login** channel → LIFF 分頁新增 LIFF app：
   - Size：`Full`；Endpoint URL：`https://jonwenjen.github.io/Sharing/`
   - Scopes：勾 `profile`、`openid`、`chat_message.write`
   - 打開 **Share Target Picker**
   - 記下 **LIFF ID** 與此 channel 的 **Channel ID** 
3. 建一個 **Messaging API** channel（記帳機器人）：
   - 記下 **Channel secret**  ，並發行 **Channel access token (long-lived)**   
   - 把 LINE Login channel 與此官方帳號綁定（LINE Login → Linked OA）

### 3. 部署後端（Cloudflare，免費方案即可）
```bash
cd worker && npm install
npx wrangler login
npx wrangler d1 create sharing           # 把輸出的 database_id    填進 wrangler.toml
npm run db:init
npx wrangler secret put
npx wrangler secret put 
# 編輯 wrangler.toml 的 LIFF_ID、LINE_LOGIN_CHANNEL_ID
npm run deploy                            # 記下 
```
回 Messaging API channel，Webhook URL 填 `https://sharing-api.xxx.workers.dev/webhook`，開啟 **Use webhook**。

### 4. 填前端設定
編輯 `web/js/config.js` 填入 `LIFF_ID` 與 `API_BASE`，push 後 GitHub Actions 會自動更新網站。

（選用）在 repo Secrets 設 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，之後改 `worker/` 也會自動部署。

## 在群組裡怎麼用
- 把記帳機器人拉進群組 → 它會貼出「開始記帳」按鈕，帳本會自動連結這個群組
- 群組輸入 `記帳`：叫出帳本按鈕；輸入 `結算`：直接回覆最少轉帳清單
- 從群組內開啟帳本記帳時，訊息會以你的名義送到群組；從外部瀏覽器記帳則由機器人推播（會用到官方帳號的免費訊息額度）

## 測試
```bash
npm test               # 單元＋API 整合測試（Node 22，用 node:sqlite 模擬 D1）
npm run test:e2e       # 手機尺寸 E2E（需 Python Playwright）
npm run build:demo     # 產生單檔示範版 dist/demo.html
```

## 資料與隱私
- 知道帳本連結的人都能檢視與加入該帳本（和 Splitwise／Lightsplit 的分享連結相同模式），請只分享給旅伴。
- 寫入動作都需要有效的 LINE 登入；匯款資訊只有綁定的本人能修改；刪除帳本僅限建立者。

## 專案文件
- [docs/PLAN.md](docs/PLAN.md)：規劃、角色分工與目標
- [docs/QA-REPORT.md](docs/QA-REPORT.md)：驗證報告
- [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)：驗收結果

