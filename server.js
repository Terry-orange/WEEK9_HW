'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const SHOPS_DIR = path.join(ROOT_DIR, 'shops');
const ASSETS_DIR = path.join(SHOPS_DIR, 'assets');
const SHOPS_JSON_PATH = path.join(DATA_DIR, 'shops.json');
const SHOPS_JS_PATH = path.join(DATA_DIR, 'shops-data.js');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

// ---------- Local Time Helpers (Strictly NO UTC) ----------
function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatLocalISO(date = new Date()) {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(offsetMin);
  const tz = `${sign}${pad2(Math.floor(absMin / 60))}:${pad2(absMin % 60)}`;
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}${tz}`
  );
}

function formatLocalReadable(isoOrDate) {
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return String(isoOrDate || '--');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function makeSlug(name, region) {
  const regionCodeMap = { 北部: 'north', 中部: 'central', 南部: 'south', 東部: 'east', 離島: 'islands' };
  const regionCode = regionCodeMap[region] || 'custom';
  const safeName = String(name || 'shop')
    .toLowerCase()
    .trim()
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, '')
    .replace(/^-+|-+$/g, '');
  const stamp = Date.now().toString(36).slice(-4);
  return `${safeName || 'shop'}-${regionCode}-${stamp}`;
}

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(SHOPS_DIR, { recursive: true });
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

function readShopsDb() {
  ensureDirs();
  if (!fs.existsSync(SHOPS_JSON_PATH)) {
    return {
      schemaVersion: '1.0.0',
      module: 'menu-price-collector',
      currency: 'TWD',
      updatedAt: formatLocalISO(new Date()),
      defaultRegions: ['北部', '中部', '南部'],
      customRegions: [],
      shops: []
    };
  }
  const raw = fs.readFileSync(SHOPS_JSON_PATH, 'utf-8');
  return JSON.parse(raw);
}

function writeShopsDb(db) {
  ensureDirs();
  db.updatedAt = formatLocalISO(new Date());
  const jsonText = JSON.stringify(db, null, 2);
  fs.writeFileSync(SHOPS_JSON_PATH, jsonText + '\n', 'utf-8');
  fs.writeFileSync(
    SHOPS_JS_PATH,
    `// Auto-synced from ./data/shops.json for file:// local browsing fallback\nwindow.__SHOPS_DATA__ = ${jsonText};\n`,
    'utf-8'
  );
}

function renderShopDetailHtml(shop) {
  const isPlanB = shop.status === 'needs_info';
  const links = shop.links || {};
  const menu = Array.isArray(shop.menu) ? shop.menu : [];

  const menuSectionsHtml = menu.length > 0
    ? menu
        .map((cat) => {
          const items = Array.isArray(cat.items) ? cat.items : [];
          const sizeLabels = Array.isArray(cat.sizeLabels) && cat.sizeLabels.length > 0 ? cat.sizeLabels : null;

          const subheadHtml = sizeLabels
            ? `<div class="menu-subhead"><span>品項（同類以 / 分隔）</span><span class="tabular-nums">${escapeHtml(sizeLabels.join(' / '))}</span></div>`
            : '';

          const itemsHtml = items.length > 0
            ? items
                .map((item) => {
                  let priceText = '依現場為準';
                  if (sizeLabels && item.prices && typeof item.prices === 'object') {
                    const hasAny = sizeLabels.some((sz) => typeof item.prices[sz] === 'number' && !Number.isNaN(item.prices[sz]));
                    if (hasAny) {
                      priceText = sizeLabels
                        .map((sz) => {
                          const val = item.prices[sz];
                          return typeof val === 'number' && !Number.isNaN(val) ? `$${val}` : '—';
                        })
                        .join(' / ');
                    }
                  } else if (typeof item.price === 'number' && !Number.isNaN(item.price)) {
                    priceText = `$${item.price}`;
                  }
                  const noteHtml = item.note ? `<span class="item-note">${escapeHtml(item.note)}</span>` : '';
                  return `
                    <div class="menu-item">
                      <div>
                        <span class="item-name">${escapeHtml(item.name)}</span>
                        ${noteHtml}
                      </div>
                      <span class="item-price tabular-nums">${escapeHtml(priceText)}</span>
                    </div>
                  `;
                })
                .join('')
            : '<p class="empty-cat">此分類尚無確認品項</p>';

          return `
            <section class="menu-card">
              <div class="menu-card-head">
                <h2 class="menu-card-title">
                  <span class="cat-icon-box">${escapeHtml((cat.category || '餐').slice(0, 1))}</span>
                  ${escapeHtml(cat.category || '未分類')}
                </h2>
                <span class="cat-count tabular-nums">${items.length} ${sizeLabels ? `組 · ${escapeHtml(sizeLabels.join('/'))}` : '項'}</span>
              </div>
              ${subheadHtml}
              <div class="menu-list">${itemsHtml}</div>
            </section>
          `;
        })
        .join('')
    : `
      <section class="menu-card" style="grid-column: 1 / -1;">
        <div class="menu-card-head">
          <h2 class="menu-card-title"><span class="cat-icon-box">補</span> 菜單品項待補充</h2>
        </div>
        <p class="empty-cat">目前尚未取得完整品項與標價，請由老闆提供菜單照片或補充資訊後更新。</p>
      </section>
    `;

  const photoBlockHtml = shop.menuImagePath
    ? `
      <section class="menu-card" style="grid-column: 1 / -1;">
        <div class="menu-card-head">
          <h2 class="menu-card-title"><span class="cat-icon-box">圖</span> 菜單照片紀錄</h2>
        </div>
        <img src="${escapeHtml(shop.menuImagePath)}" alt="${escapeHtml(shop.name)} 菜單照片" style="max-width:100%;border-radius:12px;border:1px solid var(--border-color);" />
      </section>
    `
    : '';

  return `<!DOCTYPE html>
<html lang="zh-Hant" data-theme="light" data-theme-mode="system">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(shop.name)}（${escapeHtml(shop.region)}）｜菜單與即時價格收集</title>
  <script>
    (function () {
      try {
        var saved = localStorage.getItem('menu_collector_theme') || 'system';
        var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        var resolved = saved === 'system' ? (prefersDark ? 'dark' : 'light') : saved;
        if (resolved !== 'dark' && resolved !== 'light') resolved = 'light';
        document.documentElement.setAttribute('data-theme', resolved);
        document.documentElement.setAttribute('data-theme-mode', saved);
      } catch (e) {
        document.documentElement.setAttribute('data-theme', 'light');
      }
    })();
  </script>
  <style>
    :root {
      --bg-page: #F8F7F4;
      --bg-card: #FFFFFF;
      --bg-subtle: #F1EFEA;
      --text-primary: #1C1E21;
      --text-secondary: #646A73;
      --text-muted: #8E95A0;
      --border-color: #E6E2D8;
      --accent: #F97316;
      --accent-soft: #FFF1E6;
      --accent-soft-hover: #FFE4CE;
      --accent-text: #C2410C;
      --success-bg: #ECFDF3;
      --success-text: #15803D;
      --success-border: #BBF7D0;
      --warn-bg: #FFF7ED;
      --warn-text: #B45309;
      --warn-border: #FED7AA;
      --shadow-sm: 0 1px 2px rgba(28, 30, 33, 0.05);
      --radius-sm: 10px;
      --radius-md: 14px;
      --radius-lg: 20px;
      --font-sans: "Inter", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", -apple-system, BlinkMacSystemFont, sans-serif;
    }
    html[data-theme="dark"] {
      --bg-page: #121316;
      --bg-card: #1D1F26;
      --bg-subtle: #252832;
      --text-primary: #F3F4F6;
      --text-secondary: #A1A7B3;
      --text-muted: #717885;
      --border-color: #2C303C;
      --accent: #FB923C;
      --accent-soft: rgba(249, 115, 22, 0.16);
      --accent-soft-hover: rgba(249, 115, 22, 0.25);
      --accent-text: #FDBA74;
      --success-bg: rgba(34, 197, 94, 0.14);
      --success-text: #86EFAC;
      --success-border: rgba(34, 197, 94, 0.3);
      --warn-bg: rgba(245, 158, 11, 0.15);
      --warn-text: #FCD34D;
      --warn-border: rgba(245, 158, 11, 0.32);
      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.25);
    }
    * { box-sizing: border-box; }
    html, body {
      margin: 0; padding: 0;
      background: var(--bg-page); color: var(--text-primary);
      font-family: var(--font-sans); line-height: 1.55;
    }
    a { color: inherit; text-decoration: none; }
    button { font-family: inherit; }
    .tabular-nums { font-variant-numeric: tabular-nums; }
    .page-shell { max-width: 980px; margin: 0 auto; padding: 24px 20px 64px; }
    .top-nav {
      display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
      padding: 14px 18px; background: var(--bg-card); border: 1px solid var(--border-color);
      border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: 22px;
    }
    .btn-back {
      display: inline-flex; align-items: center; gap: 7px; padding: 8px 14px; border-radius: 12px;
      background: var(--accent-soft); color: var(--accent-text); font-size: 0.88rem; font-weight: 700;
    }
    .btn-back:hover { background: var(--accent-soft-hover); }
    .theme-switcher {
      display: inline-flex; padding: 3px; background: var(--bg-subtle);
      border: 1px solid var(--border-color); border-radius: 12px; gap: 2px;
    }
    .theme-btn {
      border: none; background: transparent; color: var(--text-secondary);
      padding: 6px 10px; border-radius: 9px; font-size: 0.8rem; font-weight: 600; cursor: pointer;
    }
    .theme-btn.is-active { background: var(--accent-soft); color: var(--accent-text); }
    .shop-hero {
      background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg);
      padding: 24px; box-shadow: var(--shadow-sm); margin-bottom: 22px;
      display: flex; flex-direction: column; gap: 14px;
    }
    .badge-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .badge-region {
      padding: 4px 11px; border-radius: 8px; background: var(--accent-soft);
      color: var(--accent-text); font-size: 0.8rem; font-weight: 700;
    }
    .badge-status {
      padding: 4px 11px; border-radius: 999px; font-size: 0.78rem; font-weight: 700; border: 1px solid transparent;
    }
    .badge-status.is-complete { background: var(--success-bg); color: var(--success-text); border-color: var(--success-border); }
    .badge-status.is-plan-b { background: var(--warn-bg); color: var(--warn-text); border-color: var(--warn-border); }
    .shop-hero h1 { margin: 0; font-size: 1.65rem; font-weight: 800; }
    .shop-branch { margin: 0; font-size: 0.94rem; color: var(--text-secondary); }
    .plan-b-banner {
      padding: 12px 14px; border-radius: var(--radius-md); background: var(--warn-bg);
      border: 1px solid var(--warn-border); color: var(--warn-text); font-size: 0.88rem;
    }
    .info-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px; padding-top: 12px; border-top: 1px dashed var(--border-color);
    }
    .info-cell {
      background: var(--bg-subtle); border: 1px solid var(--border-color);
      border-radius: var(--radius-md); padding: 12px 14px;
    }
    .info-label { font-size: 0.76rem; font-weight: 700; color: var(--text-muted); margin-bottom: 4px; }
    .info-value { font-size: 0.88rem; color: var(--text-primary); word-break: break-word; }
    .link-pills { display: flex; gap: 8px; flex-wrap: wrap; }
    .link-pill {
      display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px;
      border-radius: var(--radius-sm); background: var(--accent-soft); color: var(--accent-text);
      font-size: 0.84rem; font-weight: 700;
    }
    .link-pill.is-muted { background: var(--bg-subtle); color: var(--text-muted); }
    .menu-grid { column-count: 1; column-gap: 16px; }
    @media (min-width: 720px) { .menu-grid { column-count: 2; } }
    .menu-card {
      display: inline-block; width: 100%; break-inside: avoid; margin-bottom: 16px;
      background: var(--bg-card); border: 1px solid var(--border-color);
      border-radius: var(--radius-lg); padding: 18px 20px; box-shadow: var(--shadow-sm);
    }
    .menu-card-head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border-color);
    }
    .menu-card-title { display: flex; align-items: center; gap: 9px; margin: 0; font-size: 1.02rem; font-weight: 700; }
    .cat-icon-box {
      width: 28px; height: 28px; border-radius: 8px; background: var(--accent-soft); color: var(--accent);
      display: inline-flex; align-items: center; justify-content: center; font-size: 0.85rem; font-weight: 800; flex-shrink: 0;
    }
    .cat-count { font-size: 0.78rem; font-weight: 700; color: var(--text-muted); }
    .menu-subhead {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 6px 10px; margin-bottom: 8px; border-radius: 8px;
      background: var(--bg-subtle); font-size: 0.78rem; font-weight: 700; color: var(--text-secondary);
    }
    .menu-list { display: flex; flex-direction: column; gap: 8px; }
    .menu-item {
      display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
      padding: 7px 0; border-bottom: 1px dashed var(--border-color);
    }
    .menu-item:last-child { border-bottom: none; padding-bottom: 0; }
    .item-name { font-size: 0.9rem; font-weight: 600; }
    .item-note { display: block; font-size: 0.76rem; color: var(--text-secondary); margin-top: 2px; }
    .item-price { font-size: 0.95rem; font-weight: 800; color: var(--accent-text); white-space: nowrap; }
    .empty-cat { margin: 0; font-size: 0.85rem; color: var(--text-secondary); }
  </style>
</head>
<body>
  <div class="page-shell">
    <nav class="top-nav" aria-label="頁面導覽">
      <a class="btn-back" href="../index.html">← 返回首頁</a>
      <div class="theme-switcher" role="group" aria-label="主題模式切換">
        <button type="button" class="theme-btn" data-theme-option="system">系統</button>
        <button type="button" class="theme-btn" data-theme-option="light">淺色</button>
        <button type="button" class="theme-btn" data-theme-option="dark">深色</button>
      </div>
    </nav>

    <header class="shop-hero">
      <div class="badge-row">
        <span class="badge-region">📍 ${escapeHtml(shop.region || '未分類')}</span>
        <span class="badge-status ${isPlanB ? 'is-plan-b' : 'is-complete'}">
          ${isPlanB ? '方案 B：依現場為準' : '菜單價格完整'}
        </span>
      </div>
      <div>
        <h1>${escapeHtml(shop.name)}</h1>
        <p class="shop-branch">${escapeHtml(shop.branch || '尚未指定分店')}</p>
      </div>
      ${
        isPlanB
          ? '<div class="plan-b-banner"><strong>依現場為準（方案 B）：</strong>目前網路公開資訊缺少完整菜單或統一標價，品項與價格依門市現場為準（切勿自行估算價格）。</div>'
          : ''
      }
      <div class="info-grid">
        <div class="info-cell">
          <div class="info-label">營業時間</div>
          <div class="info-value">${escapeHtml(shop.businessHours || '待補充')}</div>
        </div>
        <div class="info-cell">
          <div class="info-label">資料抓取本地時間（Local Time）</div>
          <div class="info-value tabular-nums">${escapeHtml(formatLocalReadable(shop.fetchedAt))}</div>
        </div>
        <div class="info-cell">
          <div class="info-label">最後更新備註</div>
          <div class="info-value">${escapeHtml(shop.updateNote || '--')}</div>
        </div>
      </div>
      <div class="link-pills">
        ${links.official ? `<a class="link-pill" href="${escapeHtml(links.official)}" target="_blank" rel="noopener noreferrer">🌐 官方網站</a>` : '<span class="link-pill is-muted">無官方網站</span>'}
        ${links.facebook ? `<a class="link-pill" href="${escapeHtml(links.facebook)}" target="_blank" rel="noopener noreferrer">Facebook</a>` : '<span class="link-pill is-muted">無 Facebook</span>'}
        ${links.instagram ? `<a class="link-pill" href="${escapeHtml(links.instagram)}" target="_blank" rel="noopener noreferrer">Instagram</a>` : '<span class="link-pill is-muted">無 Instagram</span>'}
      </div>
    </header>

    <main class="menu-grid">
      ${menuSectionsHtml}
      ${photoBlockHtml}
    </main>
  </div>

  <script>
    (function () {
      const STORAGE_KEY = 'menu_collector_theme';
      const mediaDark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
      function applyTheme(mode) {
        try { localStorage.setItem(STORAGE_KEY, mode); } catch {}
        const resolved = mode === 'system' ? (mediaDark && mediaDark.matches ? 'dark' : 'light') : mode;
        document.documentElement.setAttribute('data-theme', resolved);
        document.documentElement.setAttribute('data-theme-mode', mode);
        document.querySelectorAll('[data-theme-option]').forEach((btn) => {
          btn.classList.toggle('is-active', btn.dataset.themeOption === mode);
        });
      }
      if (mediaDark && mediaDark.addEventListener) {
        mediaDark.addEventListener('change', () => {
          if ((localStorage.getItem(STORAGE_KEY) || 'system') === 'system') applyTheme('system');
        });
      }
      document.querySelectorAll('[data-theme-option]').forEach((btn) => {
        btn.addEventListener('click', () => applyTheme(btn.dataset.themeOption));
      });
      applyTheme(localStorage.getItem(STORAGE_KEY) || 'system');
    })();
  </script>
</body>
</html>
`;
}

function persistShopRecord(rawShop, imageBase64, imageMimeType, replaceId = '') {
  const db = readShopsDb();
  const region = rawShop.region || '南部';
  const existing = replaceId ? db.shops.find((s) => s.id === replaceId) : null;
  const slug = existing ? path.basename(String(existing.slug || existing.id)) : makeSlug(rawShop.name, region);
  const fetchedAt = formatLocalISO(new Date());

  let menuImagePath = existing?.menuImagePath || '';
  if (imageBase64 && typeof imageBase64 === 'string') {
    const ext = imageMimeType && imageMimeType.includes('png') ? 'png' : imageMimeType && imageMimeType.includes('webp') ? 'webp' : 'jpg';
    const base64Body = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const filename = `${slug}.${ext}`;
    fs.writeFileSync(path.join(ASSETS_DIR, filename), Buffer.from(base64Body, 'base64'));
    menuImagePath = `./assets/${filename}`;
  }

  const normalizedMenu = Array.isArray(rawShop.menu)
    ? rawShop.menu
        .filter((c) => c && c.category)
        .map((c) => {
          const sizeLabels = Array.isArray(c.sizeLabels) && c.sizeLabels.length > 0 ? c.sizeLabels.map((s) => String(s)) : undefined;
          return {
            category: String(c.category),
            ...(sizeLabels ? { sizeLabels } : {}),
            items: Array.isArray(c.items)
              ? c.items
                  .filter((i) => i && i.name)
                  .map((i) => {
                    const out = {
                      name: String(i.name),
                      price: typeof i.price === 'number' && Number.isFinite(i.price) ? i.price : null,
                      note: String(i.note || '')
                    };
                    if (i.prices && typeof i.prices === 'object') {
                      out.prices = i.prices;
                      if (out.price === null) {
                        const firstNum = Object.values(i.prices).find((v) => typeof v === 'number' && Number.isFinite(v));
                        if (typeof firstNum === 'number') out.price = firstNum;
                      }
                    }
                    return out;
                  })
              : []
          };
        })
    : [];

  const shop = {
    id: slug,
    slug,
    name: String(rawShop.name || '').trim(),
    region,
    branch: String(rawShop.branch || '待確認分店').trim(),
    status: rawShop.status === 'complete' ? 'complete' : 'needs_info',
    businessHours: String(rawShop.businessHours || '待補充').trim(),
    fetchedAt,
    updateNote: String(rawShop.updateNote || '').trim(),
    links: {
      official: String(rawShop.links?.official || '').trim(),
      facebook: String(rawShop.links?.facebook || '').trim(),
      instagram: String(rawShop.links?.instagram || '').trim()
    },
    detailPath: `./shops/${slug}.html`,
    ...(menuImagePath ? { menuImagePath } : {}),
    menu: normalizedMenu
  };

  if (existing) {
    db.shops = db.shops.filter((s) => s.id !== existing.id);
  }
  db.shops.unshift(shop);
  writeShopsDb(db);

  const detailHtml = renderShopDetailHtml(shop);
  fs.writeFileSync(path.join(SHOPS_DIR, `${slug}.html`), detailHtml, 'utf-8');
  return shop;
}

function extractJsonFromText(text) {
  const cleaned = String(text || '').trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : cleaned;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1) return null;
  return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
}

async function runGeminiCollect({ query, regionHint, sourceText, sourceUrl, imageBase64, imageMimeType, apiKey }) {
  const parts = [];
  const hasImage = Boolean(imageBase64);

  const systemRule = `你是台灣餐廳與飲料店「菜單與即時價格收集助手」。
嚴格規則：
1. 盡可能整理完整分類菜單（主餐、飲品、甜點、點心/小菜、套餐等）與新台幣明確標價（純數字）。
2. 【飲品／分尺寸品項排版規則】：若飲品或同一系列品項有多種容量價格（如小/中/大 或 中/大），不可把同一品項拆成好幾列！請在分類加上 "sizeLabels": ["小", "中", "大"]（或 ["中", "大"]），並將同類同價位飲品合併同一列、名稱以 " / " 分隔（例如 "可樂 / 汽水 / 蘋果汁"），每項附上 "prices": { "小": null, "中": 29, "大": 34 } 與基準 "price" 數字。
3. 【防幻覺鐵則 / 方案 B】：絕對不可猜測、推算或捏造價格！如果網路上或圖片/文字找不到明確菜單品項或最新標價，或同名店家在北中南分店差異過大無法確認，必須設 status 為 "needs_info"，並在 clarificationReason 說明缺什麼或需要確認什麼。
4. 回覆必須只包含一個合法的 JSON 物件，結構如下：
{
  "status": "complete" | "needs_info",
  "clarificationReason": "若為 needs_info，簡短說明缺少哪部分資訊或哪裡需要使用者用按鈕確認；complete 則留空字串",
  "regionCandidates": ["北部", "中部", "南部"],
  "shop": {
    "name": "店名",
    "region": "北部" | "中部" | "南部",
    "branch": "具體分店或適用地區說明",
    "businessHours": "營業時間",
    "updateNote": "來源說明或方案 B 補件提示",
    "links": { "official": "", "facebook": "", "instagram": "" },
    "menu": [
      { "category": "主餐", "items": [{ "name": "品項名稱", "price": 120, "note": "" }] },
      { "category": "飲品", "sizeLabels": ["小", "中", "大"], "items": [{ "name": "紅茶 / 綠茶", "price": 25, "prices": { "小": null, "中": 25, "大": 30 }, "note": "" }] }
    ]
  }
}`;

  let userPrompt = `目標店家：${query}`;
  if (regionHint && regionHint !== 'ALL') userPrompt += `\n指定或優先地區：${regionHint}`;
  if (sourceUrl) userPrompt += `\n使用者補充網址：${sourceUrl}`;
  if (sourceText) userPrompt += `\n使用者補充菜單文字：\n${sourceText}`;
  if (hasImage) userPrompt += `\n請優先辨識附帶菜單照片中的完整分類品項與明確標價。`;
  if (!hasImage && !sourceText) {
    userPrompt += `\n請上網搜尋此店家的最新公開菜單、明確價格、營業時間、官方網站 / Facebook / Instagram 連結。若無法確認最新明確標價，請務必回傳 status: "needs_info"。`;
  }

  parts.push({ text: `${systemRule}\n\n${userPrompt}` });
  if (hasImage) {
    const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    parts.push({
      inline_data: {
        mime_type: imageMimeType || 'image/jpeg',
        data: base64Data
      }
    });
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts }],
    ...(hasImage ? {} : { tools: [{ google_search: {} }] })
  };

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Gemini API HTTP ${resp.status}: ${errText.slice(0, 240)}`);
  }

  const data = await resp.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('\n');
  const parsed = extractJsonFromText(text);
  if (!parsed || !parsed.shop) {
    throw new Error('AI 回傳格式無法解析為結構化菜單 JSON');
  }
  return parsed;
}

async function runBasicWebDiscovery(query) {
  // Without an LLM key, perform a light DuckDuckGo Instant Answer lookup for official website / summary only (never fabricating prices)
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return { official: '' };
    const data = await resp.json();
    return {
      official: data.AbstractURL || (Array.isArray(data.Results) && data.Results[0]?.FirstURL) || ''
    };
  } catch {
    return { official: '' };
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 12 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const parsedUrl = new URL(req.url, `http://${HOST}:${PORT}`);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    if (req.method === 'GET' && pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        mode: 'local-collector',
        hasEnvKey: Boolean(process.env.GEMINI_API_KEY),
        localTime: formatLocalISO(new Date())
      });
    }

    if (req.method === 'POST' && pathname === '/api/collect') {
      const body = await readJsonBody(req);
      const query = String(body.query || '').trim();
      const regionHint = String(body.regionHint || 'ALL').trim();
      const apiKey = String(body.apiKey || process.env.GEMINI_API_KEY || '').trim();

      if (!query) {
        return sendJson(res, 400, { error: '請輸入店名' });
      }

      if (!apiKey) {
        const discovery = await runBasicWebDiscovery(query);
        return sendJson(res, 200, {
          action: 'needs_clarification',
          reasonCode: 'no_api_key',
          reason: `未偵測到 Gemini API Key，無法自動擷取「${query}」的完整菜單與最新標價。請選擇下方按鈕補充，或於「⚙️ 設定」填入 Gemini API Key 啟用全自動整理。`,
          partialShop: {
            name: query,
            region: regionHint !== 'ALL' ? regionHint : '北部',
            branch: '待確認分店',
            status: 'needs_info',
            businessHours: '待補充',
            updateNote: '方案 B（依現場為準）：尚缺完整菜單或統一標價，品項與價格依現場為準',
            links: { official: discovery.official || '', facebook: '', instagram: '' },
            menu: []
          }
        });
      }

      try {
        const aiResult = await runGeminiCollect({
          query,
          regionHint,
          sourceText: body.sourceText || '',
          sourceUrl: body.sourceUrl || '',
          imageBase64: body.imageBase64 || '',
          imageMimeType: body.imageMimeType || '',
          apiKey
        });

        const shopCandidate = aiResult.shop || {};
        shopCandidate.name = shopCandidate.name || query;
        if (regionHint !== 'ALL') shopCandidate.region = regionHint;
        shopCandidate.status = aiResult.status === 'complete' ? 'complete' : 'needs_info';

        const hasPricedItems =
          Array.isArray(shopCandidate.menu) &&
          shopCandidate.menu.some((c) => Array.isArray(c.items) && c.items.some((i) => typeof i.price === 'number'));

        if (shopCandidate.status === 'complete' && hasPricedItems) {
          const saved = persistShopRecord(shopCandidate, body.imageBase64, body.imageMimeType, body.updateShopId || '');
          return sendJson(res, 200, { action: 'created', shop: saved });
        }

        return sendJson(res, 200, {
          action: 'needs_clarification',
          reasonCode: 'incomplete_data',
          reason:
            aiResult.clarificationReason ||
            `網路公開資訊不足以確認「${query}」的完整分類菜單或最新標價（依規範不予猜測價格），請用下方按鈕選擇處理方式：`,
          regionCandidates: Array.isArray(aiResult.regionCandidates) ? aiResult.regionCandidates : ['北部', '中部', '南部'],
          partialShop: shopCandidate
        });
      } catch (err) {
        return sendJson(res, 200, {
          action: 'needs_clarification',
          reasonCode: 'search_error',
          reason: `自動查詢「${query}」時發生問題（${err.message}）。請改用下方按鈕選擇方案 B 建檔或提供補充資訊：`,
          partialShop: {
            name: query,
            region: regionHint !== 'ALL' ? regionHint : '北部',
            branch: '待確認分店',
            status: 'needs_info',
            businessHours: '待補充',
            updateNote: '方案 B（依現場為準）：自動搜尋受限或資料不足，品項與價格依現場為準',
            links: { official: '', facebook: '', instagram: '' },
            menu: []
          }
        });
      }
    }

    if (req.method === 'POST' && pathname === '/api/save-shop') {
      const body = await readJsonBody(req);
      if (!body.shop || !String(body.shop.name || '').trim()) {
        return sendJson(res, 400, { error: '缺少店家名稱' });
      }
      const saved = persistShopRecord(body.shop, body.imageBase64, body.imageMimeType, body.updateShopId || '');
      return sendJson(res, 200, { action: 'created', shop: saved });
    }

    if (req.method === 'POST' && pathname === '/api/delete-shop') {
      const body = await readJsonBody(req);
      const targetId = String(body.id || '').trim();
      if (!targetId) {
        return sendJson(res, 400, { error: '缺少店家 ID' });
      }
      const db = readShopsDb();
      const targetShop = db.shops.find((s) => s.id === targetId);
      if (!targetShop) {
        return sendJson(res, 404, { error: '找不到該店家資料' });
      }
      db.shops = db.shops.filter((s) => s.id !== targetId);
      writeShopsDb(db);

      const safeSlug = path.basename(String(targetShop.slug || targetId));
      const detailFile = path.join(SHOPS_DIR, `${safeSlug}.html`);
      if (detailFile.startsWith(SHOPS_DIR) && fs.existsSync(detailFile)) {
        fs.unlinkSync(detailFile);
      }
      if (targetShop.menuImagePath) {
        const assetName = path.basename(targetShop.menuImagePath);
        const assetFile = path.join(ASSETS_DIR, assetName);
        if (assetFile.startsWith(ASSETS_DIR) && fs.existsSync(assetFile)) {
          fs.unlinkSync(assetFile);
        }
      }
      return sendJson(res, 200, { ok: true, deletedId: targetId });
    }

    // Serve Static Files Safely
    const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const safeTarget = path.resolve(ROOT_DIR, relPath);
    if (!safeTarget.startsWith(ROOT_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    if (!fs.existsSync(safeTarget) || fs.statSync(safeTarget).isDirectory()) {
      res.writeHead(404);
      return res.end('Not Found');
    }

    const ext = path.extname(safeTarget).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(safeTarget).pipe(res);
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Internal server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`菜單與即時價格收集伺服器已啟動：http://${HOST}:${PORT}/`);
});
