# 菜單與即時價格收集 — 專案規範手冊 (`gemini.md`)

> 本專案為「期末記帳專案」之前置資料收集模組，採純靜態前端架構（HTML / CSS / Vanilla JS + JSON），透過相對路徑設計確保可直接部署於 GitHub Pages 正常運作。

---

## 1. 專案目錄與相對路徑規範

所有頁面、樣式、腳本與資料檔之間**一律使用相對路徑**，嚴禁使用 `/data/shops.json` 等根目錄絕對路徑，以確保部署至 GitHub Pages 子路徑（例如 `https://<username>.github.io/<repo>/`）時資源可正常載入。

```text
.
├── gemini.md              # 本專案核心規範手冊（AI 協作與開發準則）
├── index.html             # 首頁（自動搜尋收集、地區篩選、主題切換、設定抽屜、店家卡片容器）
├── server.js              # 零依賴本機收集伺服器（負責自動查詢、寫入 shops.json/shops-data.js 與生成 shops/*.html）
├── start-collector.bat    # Windows 一鍵啟動本機收集伺服器腳本
├── data/
│   ├── shops.json         # 結構化店家與菜單價格主資料庫（相容記帳系統 JSON 備份）
│   └── shops-data.js      # 本機 file:// 直接雙擊開啟時的同步資料備援（與 shops.json 內容同步）
└── shops/                 # 各店家詳細菜單頁面目錄
    ├── assets/            # 使用者上傳之菜單照片附件（相對路徑 ./assets/...）
    └── <shop-slug>.html   # 個別店家詳細頁（須包含返回首頁連結 ../index.html）
```

### 路徑引用規範
- `index.html` 引用資料：`./data/shops.json`（並透過 `<script src="./data/shops-data.js"></script>` 支援直接雙擊本機檔案 `file://` 瀏覽）
- `index.html` 連結詳細頁：`./shops/<shop-slug>.html`
- `shops/<shop-slug>.html` 返回首頁：`../index.html`
- `shops/<shop-slug>.html` 讀取資料（若有需要）：`../data/shops.json`

---

## 2. 輸入、搜尋與收集流程（店名優先搜尋 ＋ 地區篩選機制）

### 2.1 店名優先搜尋、自動建檔與地區篩選互動
1. **免手動輸入表單，輸入店名即自動整理**：首頁主介面不要求使用者自行填寫整份菜單表單。輸入店名按下「搜尋並整理」後，若資料庫尚未收錄，本機伺服器（`server.js`）會自動上網搜尋（可於「⚙️ 設定」填入 Gemini API Key 啟用即時查詢與照片辨識），自動整理後寫入 `data/shops.json`、`data/shops-data.js` 並生成 `shops/<slug>.html`。
2. **搜尋後地區篩選**：以店名搜尋進入後，可透過地區篩選按鈕對結果進行篩選；預設**僅顯示核心地區按鈕**：`[全部]`、`[北部]`、`[中部]`、`[南部]`，精準區分同名連鎖店在不同地區的分店與定價差異。
3. **遇問題或資料不足才彈出「按鈕為主」的對話框**：只有當自動搜尋查無完整價格、找不到菜單或需要確認地區時，才會彈出對話框，且互動**以按鈕為主**（地區點選按鈕、`[📷 上傳菜單照片]`、`[🔗 貼上官網/菜單網址或文字]`、`[📋 先標記「方案 B」直接建檔]`）。
4. **擴充與自訂地區（隱藏於設定）**：
   - 額外地區（例如：`東部`、`離島` 或特定縣市分區）的新增與管理功能必須收納於右上角 **「⚙️ 設定」** 按鈕展開的 Modal 彈窗或側邊抽屜中，避免主畫面按鈕過多造成雜亂。
   - 自訂地區儲存於瀏覽器 `localStorage`（鍵名：`menu_collector_regions`），並支援在設定中選擇是否顯示於主介面或僅保留備用。

### 2.2 菜單搜尋與「方案 B」防幻覺鐵則
1. **完整分類收集**：收集菜單時必須盡可能涵蓋完整分類（如：`主餐`、`飲品`、`甜點`、`點心/小菜`、`套餐` 等）與對應明確標價（新台幣 TWD 數值）。
2. **嚴禁捏造價格**：若網路來源（官網、Google 地圖商家照片、FB、IG、外送平台參考）無法確認明確品項或最新標價，**絕對不可自行猜測、推算或捏造價格**。
3. **強制執行「方案 B」**：
   - 當資料不完整、價格模糊或無法取得菜單時，必須切換為 **方案 B（資料待補充狀態）**。
   - 於資料欄位 `status` 標記為 `"needs_info"`，並在 `updateNote` 及頁面提示明確顯示：
     > **資料不足提示（方案 B）**：目前網路公開資訊缺少完整菜單或明確標價，請老闆提供補充資訊或最新菜單照片，切勿自行估算價格。

### 2.3 店家必填欄位清單
每筆店家資料（無論寫入 `data/shops.json` 或生成 `shops/<slug>.html`）均須具備以下 7 項核心欄位：

| 欄位名稱 | JSON 鍵名 | 說明 |
| :--- | :--- | :--- |
| **店名** | `name` | 店家完整名稱 |
| **分店 / 地區** | `region`、`branch` | 所屬地區（北部/中部/南部/自訂）與具體分店名稱 |
| **完整分類菜單與價格** | `menu` | 依分類分組的菜單陣列（含品項名稱、價格數字、單位/備註） |
| **營業時間** | `businessHours` | 每日或公休日營業時段說明 |
| **資料抓取本地時間** | `fetchedAt` | 抓取當下之電腦本地時間（Local Time，嚴禁 UTC） |
| **最後更新備註** | `updateNote` | 來源說明、價格確認狀態或方案 B 補件提示 |
| **官方 / FB / IG 連結** | `links` | 包含 `official`、`facebook`、`instagram` 欄位（無則留空字串 `""`） |

---

## 3. 本地時間規範（Local Time Only）

- **全面禁用 UTC**：所有時間紀錄與顯示**一律使用電腦本地時間（Local Time）**，嚴禁使用 `Date.prototype.toISOString()` 直接產出結尾為 `Z` 的 UTC 時間字串。
- **儲存格式**：建議使用帶本地時區偏移之 ISO 格式，例如：`2026-11-16T11:40:00+08:00`。
- **顯示格式**：介面呈現採用易讀之本地時間格式 `YYYY-MM-DD HH:mm`（如 `2026-11-16 11:40`）。
- **參考 JavaScript 實作**：
  ```js
  function formatLocalISO(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    const offsetMin = -date.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const absMin = Math.abs(offsetMin);
    const tz = `${sign}${pad(Math.floor(absMin / 60))}:${pad(absMin % 60)}`;
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${tz}`;
  }
  ```

---

## 4. 視覺風格與系統規範（對齊記帳系統風格）

### 4.1 三態主題切換
- 右上角提供主題切換元件，支援三種模式並持久化於 `localStorage`（鍵名：`menu_collector_theme`，值為 `system` / `light` / `dark`）：
  1. **跟隨系統**（`system`）：依據 `prefers-color-scheme` 自動切換。
  2. **手動淺色模式**（`light`）
  3. **手動深色模式**（`dark`）
- 建議將同一套主題變數與切換邏輯同步套用於 `index.html` 與所有 `shops/*.html` 詳細頁，確保瀏覽體驗一致。

### 4.2 配色系統（Color Tokens）
| 語意角色 | 淺色模式 (`light`) | 深色模式 (`dark`) |
| :--- | :--- | :--- |
| 頁面背景 (`--bg-page`) | `#F8F7F4`（柔和淡暖灰白） | `#121316`（深炭黑） |
| 卡片 / 容器背景 (`--bg-card`) | `#FFFFFF`（純白） | `#1D1F26`（深色卡片） |
| 次級表面 (`--bg-subtle`) | `#F1EFEA` | `#262933` |
| 主要文字 (`--text-primary`) | `#1C1E21` | `#F3F4F6` |
| 次要文字 (`--text-secondary`) | `#656B75` | `#9CA3AF` |
| 邊框線 (`--border-color`) | `#E6E3DC` | `#2E323E` |
| 品牌主強調橘 (`--accent`) | `#F97316`（亮橘色） | `#FB923C`（暖亮橘） |
| 強調懸停橘 (`--accent-hover`) | `#EA580C` | `#F97316` |
| 淡橘圖示/按鈕底色 (`--accent-soft`) | `#FFF1E6`（淡橘色背景） | `rgba(249, 115, 22, 0.16)` |
| 淡橘文字/標籤色 (`--accent-text`) | `#C2410C` | `#FDBA74` |

### 4.3 排版與元件規範
1. **Header**：標題固定為 **『菜單與即時價格收集』**，右上角配置「主題切換按鈕」與「⚙️ 設定按鈕」。
2. **店名搜尋與地區篩選區**：主搜尋欄直接開放輸入店名搜尋，下方簡潔呈現 `[全部]`、`[北部]`、`[中部]`、`[南部]` 地區篩選按鈕，點選後以亮橘強調狀態即時篩選該地區分店。
3. **店家卡片容器**：
   - **新店家卡片動態置頂**：卡片列表依 `fetchedAt` 由新到舊排序（最新抓取的店家永遠顯示在最上方 / 最左側第一張）。
   - 卡片須顯示：地區標籤、狀態標籤（完整 / 方案 B 待補）、店名與分店、分類品項摘要、營業時間、本地抓取時間、官方/社群連結與「查看詳細菜單」按鈕（主畫面卡片**不顯示刪除按鈕**，資料清理與本機刪除統一收納於「⚙️ 設定」抽屜）。
   - 金額數字與時間戳一律套用 `font-variant-numeric: tabular-nums`，對齊記帳系統的財務閱讀習慣。
4. **詳細頁（`shops/<slug>.html`）**：
   - 頂部導覽列左側必須提供明確的 **「← 返回首頁」** 連結（`href="../index.html"`），右側保留主題切換按鈕。
   - 清楚分區呈現完整分類菜單（主餐、飲品、甜點等）與標價，若為方案 B 狀態則醒目顯示補件提示區塊。

---

## 5. `data/shops.json` 資料格式與記帳備份規範

`data/shops.json` 採用結構化 JSON 格式，便於首頁讀取渲染，亦可直接作為後續記帳專案的菜單價格匯入檔與 JSON 備份檔。

```json
{
  "schemaVersion": "1.0.0",
  "module": "menu-price-collector",
  "currency": "TWD",
  "updatedAt": "2026-11-16T11:40:00+08:00",
  "defaultRegions": ["北部", "中部", "南部"],
  "customRegions": [],
  "shops": [
    {
      "id": "example-shop-north-001",
      "slug": "example-shop-north-001",
      "name": "範例店家名稱",
      "region": "北部",
      "branch": "台北大安店",
      "status": "complete",
      "businessHours": "週一至週日 11:00 - 21:00",
      "fetchedAt": "2026-11-16T11:40:00+08:00",
      "updateNote": "已核對官方最新菜單與現場價格",
      "links": {
        "official": "https://example.com",
        "facebook": "",
        "instagram": ""
      },
      "detailPath": "./shops/example-shop-north-001.html",
      "menu": [
        {
          "category": "主餐",
          "items": [
            {
              "name": "招牌餐點",
              "price": 180,
              "note": ""
            }
          ]
        },
        {
          "category": "飲品",
          "items": [
            {
              "name": "經典紅茶",
              "price": 45,
              "note": "冰/熱"
            }
          ]
        },
        {
          "category": "甜點",
          "items": []
        }
      ]
    }
  ]
}
```

### 欄位規則補充
- `status` 僅允許兩種值：
  - `"complete"`：已取得完整分類菜單與明確標價。
  - `"needs_info"`：觸發 **方案 B**（網路查無明確菜單或價格，待老闆提供資訊或照片）。
- `price`：必須為數值型別（`number`）或無法取得時為 `null`（限方案 B 待補品項），嚴禁填入估算字串或捏造數字。
- `detailPath`：相對於根目錄的詳細頁路徑（`./shops/<slug>.html`）。
