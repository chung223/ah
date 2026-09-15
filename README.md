# 唉。嘆氣計數器

> 記下每一聲「唉」，看看自己什麼時候、為了什麼而嘆氣。資料只存在你的裝置裡。

![唉 · 嘆氣計數器（深色）](docs/screenshot-dark.jpg)

線上版：**https://chung223.github.io/ah/**（合併到 `main` 後由 GitHub Actions 自動部署，見下方「部署」）

## 功能

- **一顆大按鈕**：嘆氣的時候按一下。桌機也可以按空白鍵。按錯了可以撤銷，或在「最近」清單裡刪掉。
- **原因標記**：工作、課業、感情、家庭、金錢、身體、天氣、人際、其他，或「沒為什麼」。選一次會一直套用到之後的紀錄，事後也能在清單裡改。
- **今天的數字**：今日次數、這 7 天、距離上一次嘆氣多久、最長平靜時間、累計。
- **統計**：每天（7 天 / 30 天）、一天之中 24 小時的分布、原因比例、幾個紀錄，以及「觀察」：由資料組出來的幾句話（例如「你最常在下午 3 點左右嘆氣」、「這 7 天比前 7 天少嘆了 4 次」）。
- **自動偵測（實驗性）**：開啟麥克風，聽到像嘆氣的聲音就自動記一筆。聲音只在裝置上分析，不會上傳。判斷很粗略，會有誤判，所以預設關閉。
- **嘆完氣會有一句話**：安靜、有點幽默、不說教。累積到 1、10、50、100、500、1000 次會有里程碑訊息。
- **深色 / 淺色主題**、可選的吐氣音效（用 Web Audio 合成，沒有音檔）、「分享今天」。
- **PWA**：可以加到手機主畫面當作 App，離線也能開。
- **資料是你的**：只存在瀏覽器的 localStorage。可以匯出 JSON / CSV、匯入合併（同一時間的紀錄不會重複）、一鍵清除。

![統計頁](docs/screenshot-stats.jpg)

## 手機怎麼用

最簡單的用法：**加到主畫面，打開，按一下。**

- iPhone：用 Safari 打開網址 → 分享 → 加入主畫面。
- Android：用 Chrome 打開 → 選單 → 加到主畫面（或「安裝」）。

不想每次打開 App 再按，可以用**快速記錄網址**：

```
https://chung223.github.io/ah/?sigh=1
```

打開就直接記一筆並顯示「記錄了，今天第 N 次」。`?sigh=work` 可以帶原因（代號見下方「資料格式」）。網址在 App 的「設定」頁也找得到，有一鍵複製。

- iPhone：捷徑 App → 新增捷徑 → 加入「開啟 URL」動作、貼上網址 → 取名「嘆氣」。之後可以「嘿 Siri，嘆氣」，或在 設定 → 輔助使用 → 觸控 → 輕點背面 綁這個捷徑（有動作按鈕的機型也可以綁）。
- Android：長按已安裝的 App 圖示會有「記一次嘆氣」；或把這個網址另外加到主畫面當成第二顆圖示。

iPhone 請注意：主畫面 App 和 Safari 的紀錄是分開存的。想用捷徑（Siri、輕點背面）記錄，統計就用 Safari 看，加書籤就好，不要再加到主畫面；想用主畫面 App，就在 App 裡按按鈕。Android 的 Chrome 和已安裝的 App 共用同一份資料，沒有這個問題。

## 設計

方向是「黃昏日記」：深藍夜色配一盞琥珀色的燈。標題與語錄用思源宋體（Noto Serif TC），數字用 Fraunces，「今日嘆氣」直排。大按鈕會慢慢呼吸；按下去會擴散一圈光、飄出一個「唉」。淺色模式是同一套語言換成暖紙色。

![唉 · 嘆氣計數器（淺色）](docs/screenshot-light.jpg)

## 技術

純 HTML / CSS / JavaScript（ES modules）。沒有框架、沒有建置步驟、沒有執行期相依套件。

```
index.html               頁面骨架
styles.css               樣式（色票、主題、動畫、響應式）
src/app.js               畫面與事件：唯一會碰 DOM 的模組
src/stats.js             統計、洞察、時間格式化（純函式）
src/storage.js           資料結構、正規化、localStorage、匯入匯出（純函式）
src/detector.js          麥克風嘆氣偵測：classifyEvent（純函式）＋ SighListener
src/quotes.js            語錄、里程碑
src/sound.js             吐氣音效合成
sw.js                    Service Worker（離線快取）
manifest.webmanifest     PWA 設定
icons/                   圖示（SVG 原檔與輸出的 PNG）
test/                    單元測試（node --test）
scripts/serve.js         開發用靜態伺服器
.github/workflows/       GitHub Pages 部署
```

### 嘆氣是怎麼「聽」出來的

`SighListener` 用 `AnalyserNode` 每 40 ms 取一次音量（RMS）與頻譜，維持一個會慢慢跟著環境走的噪音地板；音量超過地板一段門檻就開始記錄一段「事件」，安靜下來後交給 `classifyEvent` 判斷：

1. **長度** 0.45 ~ 4.5 秒。太短是敲桌子，太長是講話或音樂。
2. **波形** 高峰在前 60%，之後漸弱，只有一兩個起伏。講話會有很多音節起伏。
3. **頻譜平坦度** 吐氣是氣音、接近雜訊，平坦度高；說話和哼歌有音高，平坦度低。

「靈敏度」同時調整音量門檻與平坦度門檻。

### 資料格式

```json
{
  "app": "ah-sigh-counter",
  "v": 1,
  "exportedAt": "2026-09-15T14:20:00",
  "sighs": [
    { "t": 1789456800000, "r": "work" },
    { "t": 1789460400000, "r": null, "a": 1 }
  ]
}
```

`t` 是毫秒時間戳，`r` 是原因代號（`null` 代表沒為什麼），`a: 1` 代表麥克風自動偵測。

## 本機執行

```bash
npm start        # http://localhost:8080
npm test         # 執行 test/ 裡的單元測試
```

或用任何靜態伺服器（例如 `python3 -m http.server 8080`）。因為是 ES modules，直接用 `file://` 開不行。

## 部署到 GitHub Pages

網站在 https://chung223.github.io/ah/ ，從 `gh-pages` 分支發布。

每次 push 到 `main`，`.github/workflows/deploy.yml` 會先跑測試，通過後把網站檔案（`index.html`、`styles.css`、`sw.js`、`manifest.webmanifest`、`icons/`、`src/`）推到 `gh-pages` 分支，GitHub Pages 幾十秒內就會更新。也可以在 Actions 頁面手動觸發。

發布時會把 `sw.js` 裡的 `VERSION` 換成該次 commit 的編號，所以每次更新都會建立新的離線快取、清掉舊的；使用者下次打開就是新版。

如果哪天 Pages 被關掉了，到 **Settings → Pages → Build and deployment → Source** 選 **Deploy from a branch → gh-pages / (root)** 即可。

## 隱私

沒有帳號、沒有伺服器、沒有分析追蹤。唯一的外部請求是 Google Fonts 的字型；離線時會退回系統字型。
