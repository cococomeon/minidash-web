# MiniDash — CSV to Dashboard

把一份 CSV 变成一张「经营日报卡」：KPI + 异常预警 + 近 7 天柱状图，可导出 1080×1440 PNG 和文字日报。

**纯静态、纯浏览器端**：没有后端、没有构建步骤、没有 npm 依赖、没有 CDN、没有外链字体、没有埋点。
所有计算在你的浏览器里完成，**数据不上传**。

---

## 1. 本地怎么开

不要双击 `index.html`（`file://` 下有些浏览器会限制剪贴板与 canvas 导出），用任意静态服务器：

```bash
cd minidash-web
python3 -m http.server 7810
```

然后打开 <http://127.0.0.1:7810/>。

其它等价方式：

```bash
npx --yes serve -l 7810 .        # 需要 node
php -S 127.0.0.1:7810            # 需要 php
```

没有文件？点页面上「没有文件？用示例数据试试」，或用仓库里的 `demo.csv`。

---

## 2. 怎么部署到 GitHub Pages

### 方式 A：仓库根目录就是站点根（最简单）

```bash
cd minidash-web
git init -b main
git add .
git commit -m "feat: MiniDash 静态工具站"
git remote add origin git@github.com:<你的用户名>/<仓库名>.git
git push -u origin main
```

然后 GitHub 仓库 → Settings → Pages：

- **Source** 选 `Deploy from a branch`
- **Branch** 选 `main`，目录选 `/ (root)`
- 保存，等 1 分钟左右，访问 `https://<你的用户名>.github.io/<仓库名>/`

### 方式 B：放在子目录

把整个目录内容推到 `main` 分支的 `minidash-web/` 下，Pages 里同样选 root，
最终地址就是 `https://<你的用户名>.github.io/<仓库名>/minidash-web/`。

### 部署前必改的三处域名

页面里用的占位域名是 `https://cococomeon.github.io/minidash-web/`，换成你自己的，否则 `og:image` / `canonical` / `sitemap` 都指向别人的域名：

```bash
cd minidash-web
grep -rl 'minidash-web.example.github.io' . | xargs sed -i '' 's#https://cococomeon.github.io/minidash-web/#https://<你的用户名>.github.io/<仓库名>/#g'
```

（Linux 上 `sed -i ''` 改成 `sed -i`。）

改动位置共 5 个文件：`index.html`、`excel.html`、`sales-report.html`、`sitemap.xml`、`robots.txt`。

### 自定义域名

在 `minidash-web/` 下加一个 `CNAME` 文件，内容写你的域名（一行），Pages 里填同一个域名，然后把上面那些 URL 换成你的域名。

### 提交到搜索引擎

1. `https://search.google.com/search-console` 添加资源，提交 `https://<域名>/sitemap.xml`
2. `https://ziyuan.baidu.com` 同样提交一次 sitemap
3. 页面已经带了 `SoftwareApplication` + `FAQPage` 两个 JSON-LD，可以用 `https://search.google.com/test/rich-results` 验证

---

## 3. 文件结构

```
minidash-web/
├── index.html            # 入口 1：CSV to dashboard
├── excel.html            # 入口 2：Excel to dashboard（讲清另存 CSV）
├── sales-report.html     # 入口 3：AI sales report generator
├── assets/
│   ├── style.css         # 全部样式（无外链字体、无 @import）
│   ├── app.js            # CSV 解析 + 计算 + SVG 卡片 + PNG 导出 + 剪贴板
│   ├── demo-data.js      # 示例数据内联（与 demo.csv 逐字相同）
│   └── preview.png       # og:image 分享图（由 demo 卡片生成，1080×1440）
├── demo.csv              # 可直接下载的示例数据
├── sitemap.xml
├── robots.txt
└── README.md
```

三个 HTML 共用同一套 `style.css` 和 `app.js`，只有文案、`<title>`、`<meta description>`、`<h1>`、JSON-LD 不同 —— 这样三页能各自吃自己的关键词，而工具逻辑只有一份。

示例数据有两份是故意的：`demo.csv` 给用户下载，`assets/demo-data.js` 给「用示例数据试试」按钮用（内联，避免运行时抓文件，也避免 `file://` 下 fetch 失败）。**改数据请两个一起改**，校验方法：

```bash
node -e "const fs=require('fs');const a=fs.readFileSync('demo.csv','utf8');global.window={};require('./assets/demo-data.js');console.log(a===window.MINIDASH_DEMO_CSV?'一致':'不一致')"
```

---

## 4. 当前限制（明确写出来，不粉饰）

| 限制 | 说明 |
| --- | --- |
| **只支持 CSV** | 不支持 `.xlsx` / `.xls`。Excel 是 zip + XML，浏览器零依赖解析的成本太高。检测到 Excel 文件（扩展名或文件头魔数）会直接给出「请另存为 CSV」的中文提示和步骤，**不假装支持、不静默失败**。 |
| **只算这几类指标** | 销售额、订单数、退款率、单日最高退款率、环比、近 7 天趋势。不算毛利、不算广告费、不算 LTV、不分渠道拆解、不做同比。 |
| **窗口固定 7 天** | 以数据里最后一天为终点往前 7 个自然日，不能自定义区间。环比用紧邻的前 7 天。 |
| **不做登录 / 存储** | 没有账号、没有数据库、没有 localStorage 业务缓存。刷新即清空，也不支持「保存上次的分析」。 |
| **不做定时 / 不发送** | 纯静态页面没有任何发送能力，不能定时跑、不能自动发群、不能接 webhook。 |
| **结论是规则不是大模型** | 「一句话结论」由确定性规则拼装，保证每天口径一致。想要更自由的叙述属于定制。 |
| **PNG 尺寸固定** | 1080×1440 竖版，不能换尺寸、配色、logo。 |
| **单文件、单次分析** | 一次只能分析一个 CSV；不支持多文件合并、追加历史。 |
| **浏览器要求** | 需要 `TextDecoder`、`canvas.toBlob`、`Blob` / `URL.createObjectURL`（Chrome / Edge / Safari / Firefox 的近年版本都满足）。剪贴板写入需要页面在 localhost 或 https 下。 |

### 已知的解析边界

- **金额**：能剥掉货币符号与千分位，认 `¥1,234.56`、`$1,234`、`1.234,56`、`(1,234)`（会计负数）。但纯文本单元格里混进单位（如 `1234元`）会被当成 1234；不可解析的值按 0 计，若整列为 0 页面会报错而不是静默出图。
- **日期**：认 `2026-11-01`、`2026/11/01`、`2026年11月1日`、`20261101`、`11/01/2026`、`2026-11`（补 1 号）。`01/02/2026` 这种先判 mm/dd，除非第一个数大于 12 才按 dd/mm。
- **编码**：先按 UTF-8 解，出现替换字符时回退 GBK / GB18030。
- **重复行**：同一个日期的多行会按日期求和（所以「一天多渠道」的明细表可以直接用）。
- **列数不齐**：少列的行按缺省值（0）处理，页面会提示有几行不齐。

---

## 5. 怎么验收（不装任何依赖）

站点本身零依赖；验收用的浏览器自动化是临时的（Playwright + 本机 Chrome），不进仓库。
起服务后按下表逐条核对，10 分钟能走完：

| # | 操作 | 期望 |
| --- | --- | --- |
| 1 | 打开 `/`，点「用示例数据试试」 | 出现 4 个 KPI、结论条、异常列表、7 根柱子 |
| 2 | 点「下载 PNG 卡片」 | 触发下载，文件是 PNG 且 **1080×1440**（读 IHDR 第 16–23 字节） |
| 3 | 点「复制文字日报」 | 剪贴板内容含「本周销售额」 |
| 4 | 把 CSV 表头改成 `日期,渠道,订单数,销售额,退款额` 再传 | 五个下拉框自动选中，直接出结果 |
| 5 | 传只有 `date,channel` 的 CSV | 出现「缺少必需列：销售额」中文提示，不白屏 |
| 6 | 传 0 字节文件 | 出现「这个文件是空的（0 字节）」 |
| 7 | 传 `.xlsx` | 出现「目前支持 CSV，Excel 请在表格软件里另存为 CSV」+ 四步操作 |
| 8 | 1280 与 375 两档宽度 | `document.documentElement.scrollWidth <= innerWidth + 1`，console error 为 0 |

```bash
# 2 的取证方式：读 PNG 头
node -e "const b=require('fs').readFileSync('<下载的文件>.png');console.log(b.slice(1,4).toString(),b.readUInt32BE(16)+'x'+b.readUInt32BE(20))"
```

---

## 6. 换掉 CTA 的联系方式

`index.html` / `excel.html` / `sales-report.html` 底部的 CTA 段落里写着「联系方式写在 README 里（部署时改成你自己的）」，把那一句换成你的微信号 / 邮箱 / 收款链接即可。页面本身不主动外链任何第三方脚本。
