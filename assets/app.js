/* MiniDash — 纯浏览器端经营日报生成器
 * 无框架、无依赖、无 CDN、无外链字体；所有计算在本页完成，数据不上传。
 */
(function () {
  'use strict';

  /* ============================ 常量 ============================ */

  var ROLES = [
    { key: 'date',    label: '日期',   required: true,  aliases: ['date', 'day', 'orderdate', 'dt', '日期', '交易日期', '下单日期', '时间', '天'] },
    { key: 'channel', label: '渠道',   required: false, aliases: ['channel', 'source', 'medium', 'platform', '渠道', '平台', '来源', '流量来源', '店铺'] },
    { key: 'orders',  label: '订单数', required: false, aliases: ['orders', 'order', 'ordercount', 'orderqty', 'qty', '订单数', '订单量', '单量', '订单', '销量'] },
    { key: 'revenue', label: '销售额', required: true,  aliases: ['revenue', 'sales', 'amount', 'gmv', 'salesamount', 'netrevenue', 'turnover', '销售额', '金额', '营收', '收入', '流水', '成交额'] },
    { key: 'refunds', label: '退款额', required: false, aliases: ['refunds', 'refund', 'refundamount', 'refunded', '退款额', '退款金额', '退款', '退费', '退货额'] }
  ];

  var DEMO_CSV = (typeof window !== 'undefined' && window.MINIDASH_DEMO_CSV) || '';
  var DAY_MS = 86400000;
  var WINDOW_DAYS = 7;

  /* ============================ 小工具 ============================ */

  function $(sel, root) { return (root || document).querySelector(sel); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function group(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

  function fmtInt(n) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n), r = Math.round(a);
    return (n < 0 ? '-' : '') + group(String(r));
  }

  function fmtMoney(n) {
    if (n == null || !isFinite(n)) return '—';
    var a = Math.abs(n);
    var s = (Math.round(a * 100) / 100 % 1 === 0) ? group(String(Math.round(a))) : group(a.toFixed(2));
    return (n < 0 ? '-¥' : '¥') + s;
  }

  function fmtPct(x, digits) {
    if (x == null || !isFinite(x)) return '—';
    var d = (digits == null) ? 1 : digits;
    return (x * 100).toFixed(d) + '%';
  }

  function fmtSignedPct(x, digits) {
    if (x == null || !isFinite(x)) return '—';
    var s = fmtPct(Math.abs(x), digits == null ? 1 : digits);
    return (x >= 0 ? '+' : '−') + s;
  }

  function dayKey(d) { return d.toISOString().slice(0, 10); }
  function shift(d, delta) { return new Date(d.getTime() + delta * DAY_MS); }

  /* ============================ CSV 解析 ============================ */

  function stripBOM(t) { return t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t; }

  function detectDelimiter(text) {
    var head = text.slice(0, 8000);
    var counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
    var inQ = false, lines = 0;
    for (var i = 0; i < head.length && lines < 3; i++) {
      var c = head.charAt(i);
      if (c === '"') { inQ = !inQ; continue; }
      if (inQ) continue;
      if (c === '\n') { lines++; continue; }
      if (counts.hasOwnProperty(c)) counts[c]++;
    }
    var best = ',', bestN = -1;
    [',', ';', '\t', '|'].forEach(function (d) { if (counts[d] > bestN) { bestN = counts[d]; best = d; } });
    return bestN <= 0 ? ',' : best;
  }

  function parseCSV(raw) {
    var text = stripBOM(String(raw == null ? '' : raw));
    var delim = detectDelimiter(text);
    var rows = [], row = [], field = '', inQ = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (inQ) {
        if (ch === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i++; } else { inQ = false; }
        } else { field += ch; }
      } else if (ch === '"') {
        inQ = true;
      } else if (ch === delim) {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else if (ch === '\r') {
        /* CRLF：忽略，由 \n 断行 */
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    var clean = [];
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r], any = false;
      for (var c = 0; c < cells.length; c++) { if (String(cells[c]).replace(/[\s\u00a0]/g, '') !== '') { any = true; break; } }
      if (any) clean.push(cells);
    }
    return { delimiter: delim, rows: clean };
  }

  /* 数字：容忍货币符号、千分位、百分号、全角空格、会计括号负数 */
  function toNumber(v) {
    if (v == null) return 0;
    var s = String(v).trim();
    if (!s) return 0;
    s = s.replace(/[\s\u00a0\u3000]/g, '');
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[^0-9.,\-+]/g, '');
    if (s === '' || s === '-' || s === '+') return 0;
    var lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      var decSep = lastDot > lastComma ? '.' : ',';
      var thouSep = decSep === '.' ? ',' : '.';
      s = s.split(thouSep).join('');
      if (decSep === ',') s = s.replace(/,/g, '.');
    } else if (lastComma >= 0) {
      var parts = s.split(',');
      var thousands = parts.length > 1 && parts.slice(1).every(function (p) { return p.length === 3; });
      s = thousands ? parts.join('') : s.replace(/,/g, '.');
    } else if (lastDot >= 0) {
      var dots = s.split('.');
      if (dots.length > 2 && dots.slice(1).every(function (p) { return p.length === 3; })) s = dots.join('');
    }
    var n = parseFloat(s);
    if (!isFinite(n)) return 0;
    if (neg && n > 0) n = -n;
    return n;
  }

  function mkDate(y, mo, d) {
    if (!(y >= 1900 && y <= 2200) || !(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
    var t = Date.UTC(y, mo - 1, d);
    var dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return dt;
  }

  function parseDay(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    s = s.replace(/[年月]/g, '-').replace(/日/g, '').replace(/[\/\.]/g, '-').replace(/-+/g, '-');
    s = s.replace(/\s+.*$/, '');           /* 去掉时间部分 */
    var m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) return mkDate(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{8})$/.exec(s))) return mkDate(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8));
    if ((m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(s))) {
      var a = +m[1], b = +m[2], y = +m[3];
      if (a > 12 && b <= 12) return mkDate(y, b, a);
      return mkDate(y, a, b);
    }
    if ((m = /^(\d{4})-(\d{1,2})$/.exec(s))) return mkDate(+m[1], +m[2], 1);
    return null;
  }

  /* ============================ 列映射 ============================ */

  function norm(s) {
    return String(s == null ? '' : s)
      .replace(/\uFEFF/g, '')
      .replace(/[\s\u00a0\u3000_\-\/\\()（）\[\]【】:：*·,，.。%＃#]/g, '')
      .toLowerCase();
  }

  function guessMapping(header) {
    var map = {}, used = {}, norms = [];
    for (var i = 0; i < header.length; i++) norms.push(norm(header[i]));

    ROLES.forEach(function (role) {
      for (var i = 0; i < norms.length; i++) {
        if (used[i] || !norms[i]) continue;
        if (role.aliases.indexOf(norms[i]) !== -1) { map[role.key] = i; used[i] = true; return; }
      }
    });
    ROLES.forEach(function (role) {
      if (map[role.key] != null) return;
      for (var i = 0; i < norms.length; i++) {
        if (used[i] || !norms[i]) continue;
        for (var a = 0; a < role.aliases.length; a++) {
          var al = role.aliases[a];
          if (al.length >= 2 && norms[i].indexOf(al) !== -1) { map[role.key] = i; used[i] = true; return; }
        }
      }
    });
    return map;
  }

  /* ============================ 计算 ============================ */

  function computeStats(records, meta) {
    var byDay = {};
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var d = byDay[r.key];
      if (!d) { d = byDay[r.key] = { key: r.key, day: r.day, orders: 0, revenue: 0, refunds: 0 }; }
      d.orders += r.orders;
      d.revenue += r.revenue;
      d.refunds += r.refunds;
    }
    var keys = Object.keys(byDay).sort();
    if (!keys.length) return null;
    var last = byDay[keys[keys.length - 1]].day;

    function slot(delta) {
      var day = shift(last, delta), k = dayKey(day);
      var hit = byDay[k];
      return hit ? { key: k, day: day, orders: hit.orders, revenue: hit.revenue, refunds: hit.refunds }
                 : { key: k, day: day, orders: 0, revenue: 0, refunds: 0, empty: true };
    }

    var win = [], prev = [], i;
    for (i = WINDOW_DAYS - 1; i >= 0; i--) win.push(slot(-i));
    for (i = WINDOW_DAYS * 2 - 1; i >= WINDOW_DAYS; i--) prev.push(slot(-i));

    function sum(list, f) { var t = 0; for (var j = 0; j < list.length; j++) t += list[j][f]; return t; }

    var hasOrders = !(meta && meta.hasOrders === false);
    var hasRefunds = !(meta && meta.hasRefunds === false);

    var revenue = sum(win, 'revenue');
    var orders = sum(win, 'orders');
    var refunds = sum(win, 'refunds');
    var prevRevenue = sum(prev, 'revenue');
    var refundRate = (hasRefunds && revenue > 0) ? refunds / revenue : null;
    var wow = prevRevenue > 0 ? (revenue - prevRevenue) / prevRevenue : null;

    var worst = null;
    if (hasRefunds) {
      win.forEach(function (d) {
        if (d.revenue > 0) {
          var rate = d.refunds / d.revenue;
          if (!worst || rate > worst.rate) worst = { day: d, rate: rate };
        }
      });
    }
    if (!hasOrders) orders = null;

    var stats = {
      meta: meta || {},
      win: win,
      totalDays: keys.length,
      startKey: win[0].key,
      endKey: win[win.length - 1].key,
      revenue: revenue,
      orders: orders,
      refunds: refunds,
      refundRate: refundRate,
      prevRevenue: prevRevenue,
      wow: wow,
      maxDailyRefundRate: worst ? worst.rate : null,
      maxDailyRefundDay: worst ? worst.day : null,
      avgOrderValue: orders > 0 ? revenue / orders : null
    };
    stats.anomalies = buildAnomalies(stats);
    stats.conclusion = buildConclusion(stats);
    return stats;
  }

  function buildAnomalies(s) {
    var out = [];
    if (s.refundRate != null && s.refundRate > 0.05) {
      out.push({ level: 'danger', text: '近 7 天退款率 ' + fmtPct(s.refundRate) + '，高于 5% 健康线（退款 ' + fmtMoney(s.refunds) + ' / 销售额 ' + fmtMoney(s.revenue) + '）' });
    }
    if (s.maxDailyRefundRate != null && s.maxDailyRefundRate > 0.10) {
      out.push({ level: 'danger', text: s.maxDailyRefundDay.key.slice(5) + ' 单日退款率 ' + fmtPct(s.maxDailyRefundRate) + '，超过 10% 单日红线，建议当天核对退款明细' });
    } else if (s.maxDailyRefundRate != null && s.maxDailyRefundRate > 0.05) {
      out.push({ level: 'warn', text: s.maxDailyRefundDay.key.slice(5) + ' 单日退款率 ' + fmtPct(s.maxDailyRefundRate) + '，高于 5%，留意是否集中退款' });
    }
    if (s.wow != null && s.wow < -0.30) {
      out.push({ level: 'danger', text: '销售额环比下跌 ' + fmtPct(Math.abs(s.wow)) + '，跌幅超过 30% 警戒线（上期 ' + fmtMoney(s.prevRevenue) + '）' });
    } else if (s.wow != null && s.wow < -0.10) {
      out.push({ level: 'warn', text: '销售额环比下跌 ' + fmtPct(Math.abs(s.wow)) + '，跌幅未到 30% 但值得看一眼渠道结构' });
    }
    if (s.revenue === 0) {
      out.push({ level: 'warn', text: '近 7 天销售额为 0，请检查「销售额」列是否选中了正确的列、数值格式是否可解析' });
    }
    if (!out.length) {
      out.push({
        level: 'ok',
        text: s.refundRate == null
          ? '销售额与环比没有触发预警（CSV 未包含退款列，退款率 / 单日退款率两项本次跳过）'
          : '三项预警线（退款率 5% / 单日 10% / 环比 -30%）都没有触发，指标在健康区间'
      });
    }
    return out;
  }

  function buildConclusion(s) {
    var head = '近 7 天销售额 ' + fmtMoney(s.revenue);
    var wowPart = s.wow == null ? '环比无可比数据' : ('环比' + fmtSignedPct(s.wow));
    var riskPart;
    if (s.refundRate == null && s.maxDailyRefundRate == null) riskPart = '这份 CSV 没有退款列，退款口径的三条预警本次没有参与判断';
    else if (s.refundRate != null && s.refundRate > 0.05) riskPart = '但退款率 ' + fmtPct(s.refundRate) + ' 已经超过 5% 健康线，先查退款来源再扩张投放';
    else if (s.maxDailyRefundRate != null && s.maxDailyRefundRate > 0.10) riskPart = '整体退款率 ' + fmtPct(s.refundRate) + ' 还算正常，但 ' + s.maxDailyRefundDay.key.slice(5) + ' 单日冲到 ' + fmtPct(s.maxDailyRefundRate) + '，建议核对那天发生了什么';
    else if (s.wow != null && s.wow < -0.30) riskPart = '跌幅已经超过 30% 警戒线，先确认是渠道断流还是数据缺失';
    else riskPart = '退款率 ' + fmtPct(s.refundRate) + ' 在 5% 健康线以内，节奏稳定';
    return head + '，' + wowPart + '，' + riskPart + '。';
  }

  /* ============================ 文字日报 ============================ */

  function buildReportText(s) {
    var lines = [];
    lines.push('【经营日报】' + s.startKey + ' ~ ' + s.endKey + '（最近 7 天）');
    lines.push('');
    lines.push('本周销售额：' + fmtMoney(s.revenue) + '（环比 ' + (s.wow == null ? '无可比数据' : fmtSignedPct(s.wow)) + '）');
    lines.push('订单数：' + fmtInt(s.orders) + ' 单' + (s.avgOrderValue ? '（客单价 ' + fmtMoney(s.avgOrderValue) + '）' : ''));
    lines.push('退款率：' + (s.refundRate == null ? '—（CSV 未包含退款列）' : fmtPct(s.refundRate) + '（退款 ' + fmtMoney(s.refunds) + '）'));
    lines.push('单日最高退款率：' + (s.maxDailyRefundRate == null ? '—' : fmtPct(s.maxDailyRefundRate) + '（' + s.maxDailyRefundDay.key.slice(5) + '）'));
    lines.push('');
    lines.push('一句话结论：' + s.conclusion);
    lines.push('');
    lines.push('异常提示：');
    for (var i = 0; i < s.anomalies.length; i++) {
      var tag = s.anomalies[i].level === 'ok' ? '正常' : (s.anomalies[i].level === 'danger' ? '警报' : '留意');
      lines.push('- [' + tag + '] ' + s.anomalies[i].text);
    }
    lines.push('');
    lines.push('每日销售额：');
    for (var j = 0; j < s.win.length; j++) {
      var d = s.win[j];
      lines.push('  ' + d.key + '  ' + fmtMoney(d.revenue) + '  ' + fmtInt(d.orders) + ' 单');
    }
    lines.push('');
    lines.push('— 由 MiniDash 生成：数据在你的浏览器里计算，全程未上传服务器。');
    return lines.join('\n');
  }

  /* ============================ SVG 图表 ============================ */

  var FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";

  function barChart(win, opt) {
    var x = opt.x, y = opt.y, w = opt.w, h = opt.h;
    var n = win.length;
    var max = 0;
    for (var i = 0; i < n; i++) if (win[i].revenue > max) max = win[i].revenue;
    if (max <= 0) max = 1;
    var slot = w / n;
    var barW = Math.min(opt.barW || 56, slot * 0.62);
    var out = [];
    var axisY = y + h;

    out.push('<line x1="' + x + '" y1="' + axisY + '" x2="' + (x + w) + '" y2="' + axisY + '" stroke="' + (opt.axisColor || 'rgba(255,255,255,0.14)') + '" stroke-width="1"/>');

    for (var k = 0; k < n; k++) {
      var d = win[k];
      var cx = x + slot * k + slot / 2;
      var bh = Math.max(d.revenue > 0 ? 3 : 0, (d.revenue / max) * (h - 34));
      var by = axisY - bh;
      var isPeak = d.revenue === max && max > 1;
      var fill = isPeak ? (opt.peakFill || 'url(#barPeak)') : (opt.fill || 'url(#barFill)');
      if (bh > 0) {
        out.push('<rect x="' + (cx - barW / 2).toFixed(1) + '" y="' + by.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="' + Math.min(8, barW / 3).toFixed(1) + '" fill="' + fill + '"/>');
      } else {
        out.push('<rect x="' + (cx - barW / 2).toFixed(1) + '" y="' + (axisY - 3) + '" width="' + barW.toFixed(1) + '" height="3" rx="1.5" fill="rgba(255,255,255,0.12)"/>');
      }
      if (opt.showValues !== false) {
        out.push('<text x="' + cx.toFixed(1) + '" y="' + (by - 10).toFixed(1) + '" text-anchor="middle" font-family="' + FONT + '" font-size="' + (opt.valueSize || 13) + '" font-weight="600" fill="' + (isPeak ? '#5eead4' : '#9aa7c2') + '">' + esc(shortMoney(d.revenue)) + '</text>');
      }
      out.push('<text x="' + cx.toFixed(1) + '" y="' + (axisY + (opt.labelGap || 22)) + '" text-anchor="middle" font-family="' + FONT + '" font-size="' + (opt.labelSize || 13) + '" fill="#76839e">' + esc(d.key.slice(5)) + '</text>');
    }
    return out.join('');
  }

  function shortMoney(n) {
    if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + 'w';
    return group(String(Math.round(n)));
  }

  function pageChartSVG(s) {
    var W = 760, H = 300;
    return [
      '<svg viewBox="0 0 ' + W + ' ' + H + '" style="display:block;width:100%;height:auto" role="img" aria-label="近 7 天销售额柱状图" xmlns="http://www.w3.org/2000/svg">',
      '<defs>',
      '<linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7c9cff"/><stop offset="100%" stop-color="#4f6bd8"/></linearGradient>',
      '<linearGradient id="barPeak" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7dffe6"/><stop offset="100%" stop-color="#2ab6a0"/></linearGradient>',
      '</defs>',
      '<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="transparent"/>',
      barChart(s.win, { x: 24, y: 26, w: W - 48, h: H - 70, barW: 58, labelSize: 13, valueSize: 13, labelGap: 24 }),
      '</svg>'
    ].join('');
  }

  /* 1080×1440 分享卡片：只用 SVG 基本图元（无 foreignObject），保证能画进 canvas */
  function buildCardSVG(s) {
    var W = 1080, H = 1440;
    var o = [];
    o.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="' + FONT + '">');
    o.push('<defs>');
    o.push('<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0b1224"/><stop offset="55%" stop-color="#0a1020"/><stop offset="100%" stop-color="#0d1730"/></linearGradient>');
    o.push('<linearGradient id="topline" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#5eead4"/><stop offset="100%" stop-color="#7c9cff"/></linearGradient>');
    o.push('<linearGradient id="barFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7c9cff"/><stop offset="100%" stop-color="#41559f"/></linearGradient>');
    o.push('<linearGradient id="barPeak" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7dffe6"/><stop offset="100%" stop-color="#1f9c8b"/></linearGradient>');
    o.push('<radialGradient id="glow" cx="0.16" cy="0.04" r="0.85"><stop offset="0%" stop-color="rgba(124,156,255,0.34)"/><stop offset="100%" stop-color="rgba(124,156,255,0)"/></radialGradient>');
    o.push('<radialGradient id="glow2" cx="0.94" cy="0.10" r="0.6"><stop offset="0%" stop-color="rgba(94,234,212,0.20)"/><stop offset="100%" stop-color="rgba(94,234,212,0)"/></radialGradient>');
    o.push('</defs>');

    o.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#bg)"/>');
    o.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#glow)"/>');
    o.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="url(#glow2)"/>');
    o.push('<rect x="0" y="0" width="' + W + '" height="6" fill="url(#topline)"/>');

    /* 头部 */
    o.push('<text x="72" y="120" font-size="54" font-weight="800" fill="#ffffff" letter-spacing="-1">经营日报</text>');
    o.push('<text x="72" y="166" font-size="25" fill="#8b9ab5">' + esc(s.startKey) + ' → ' + esc(s.endKey) + ' · 最近 7 天</text>');
    o.push('<rect x="846" y="76" width="162" height="52" rx="26" fill="rgba(94,234,212,0.10)" stroke="rgba(94,234,212,0.42)" stroke-width="1.5"/>');
    o.push('<text x="927" y="109" font-size="22" font-weight="700" fill="#5eead4" text-anchor="middle">MiniDash</text>');

    /* KPI 四宫格 */
    var tiles = [
      { label: '本周销售额', value: fmtMoney(s.revenue), note: s.wow == null ? '环比无可比数据' : '环比 ' + fmtSignedPct(s.wow), tone: (s.wow != null && s.wow < 0) ? 'down' : 'up' },
      { label: '订单数', value: fmtInt(s.orders) + ' 单', note: s.avgOrderValue ? '客单价 ' + fmtMoney(s.avgOrderValue) : '订单列未使用', tone: '' },
      { label: '退款率', value: fmtPct(s.refundRate), note: '退款 ' + fmtMoney(s.refunds), tone: (s.refundRate != null && s.refundRate > 0.05) ? 'down' : 'up' },
      { label: '单日最高退款率', value: fmtPct(s.maxDailyRefundRate), note: s.maxDailyRefundDay ? s.maxDailyRefundDay.key.slice(5) + ' 当天' : '无数据', tone: (s.maxDailyRefundRate != null && s.maxDailyRefundRate > 0.10) ? 'down' : '' }
    ];
    for (var t = 0; t < tiles.length; t++) {
      var col = t % 2, row = Math.floor(t / 2);
      var tx = 72 + col * 480, ty = 214 + row * 200;
      o.push('<rect x="' + tx + '" y="' + ty + '" width="456" height="176" rx="20" fill="rgba(255,255,255,0.055)" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>');
      o.push('<text x="' + (tx + 28) + '" y="' + (ty + 50) + '" font-size="24" fill="#9aa7c2">' + esc(tiles[t].label) + '</text>');
      var vColor = tiles[t].tone === 'down' ? '#ff8fa3' : (tiles[t].tone === 'up' ? '#eef2ff' : '#eef2ff');
      o.push('<text x="' + (tx + 28) + '" y="' + (ty + 112) + '" font-size="52" font-weight="800" fill="' + vColor + '" letter-spacing="-1.5">' + esc(tiles[t].value) + '</text>');
      o.push('<text x="' + (tx + 28) + '" y="' + (ty + 150) + '" font-size="21" fill="#76839e">' + esc(tiles[t].note) + '</text>');
    }

    /* 图表 */
    var cy = 636;
    o.push('<text x="72" y="' + (cy + 26) + '" font-size="27" font-weight="700" fill="#dbe4f7">近 7 天销售额</text>');
    o.push('<text x="1008" y="' + (cy + 26) + '" font-size="20" fill="#76839e" text-anchor="end">单位：元</text>');
    o.push(barChart(s.win, { x: 72, y: cy + 62, w: 936, h: 300, barW: 74, labelSize: 21, valueSize: 21, labelGap: 34 }));

    /* 一句话结论 */
    var ccY = 1086;
    o.push('<rect x="72" y="' + ccY + '" width="936" height="86" rx="16" fill="rgba(94,234,212,0.09)" stroke="rgba(94,234,212,0.30)" stroke-width="1"/>');
    o.push('<text x="100" y="' + (ccY + 38) + '" font-size="19" fill="#5eead4" letter-spacing="2">一句话结论</text>');
    var concl = s.conclusion.length > 46 ? s.conclusion.slice(0, 45) + '…' : s.conclusion;
    o.push('<text x="100" y="' + (ccY + 68) + '" font-size="21" fill="#d8fff7">' + esc(concl) + '</text>');

    /* 异常提示 */
    var ay = 1206;
    o.push('<text x="72" y="' + ay + '" font-size="23" font-weight="700" fill="#dbe4f7">异常提示</text>');
    var items = s.anomalies.slice(0, 2);
    for (var a = 0; a < items.length; a++) {
      var yy = ay + 30 + a * 46;
      var tone = items[a].level === 'ok' ? '#5eead4' : (items[a].level === 'danger' ? '#ff8fa3' : '#ffb86b');
      o.push('<circle cx="80" cy="' + (yy - 7) + '" r="5" fill="' + tone + '"/>');
      var txt = items[a].text;
      if (txt.length > 52) txt = txt.slice(0, 51) + '…';
      o.push('<text x="98" y="' + yy + '" font-size="20" fill="#9aa7c2">' + esc(txt) + '</text>');
    }

    /* 页脚 */
    o.push('<line x1="72" y1="1330" x2="1008" y2="1330" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>');
    o.push('<text x="72" y="1372" font-size="19" fill="#5c6880">数据在你的浏览器里计算，全程未上传服务器</text>');
    o.push('<text x="1008" y="1372" font-size="19" fill="#5c6880" text-anchor="end">MiniDash · CSV to Dashboard</text>');
    o.push('</svg>');
    return o.join('');
  }

  /* ============================ 状态与渲染 ============================ */

  var state = { fileName: '', header: [], rows: [], map: {}, delimiter: ',', stats: null, records: null };

  function setStatus(msg, kind) {
    var el = $('#status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function showAlert(html, kind) {
    var box = $('#alert');
    if (!box) return;
    if (!html) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.className = 'alert alert-' + (kind || 'error');
    box.innerHTML = '<span class="a-ico" aria-hidden="true">' + (kind === 'ok' ? '✓' : kind === 'warn' ? '!' : '⚠') + '</span><div>' + html + '</div>';
  }

  function clearAlert() { showAlert('', null); }

  /* ============================ 读取文件 ============================ */

  function looksLikeExcel(name, buffer) {
    var lower = String(name || '').toLowerCase();
    if (/\.(xlsx|xlsm|xlsb|xls)$/.test(lower)) return true;
    if (!buffer || buffer.byteLength < 4) return false;
    var b = new Uint8Array(buffer, 0, 4);
    if (b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04) return true;  /* xlsx = zip */
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return true;  /* xls = OLE */
    return false;
  }

  function decodeBuffer(buffer) {
    var utf8 = new TextDecoder('utf-8').decode(buffer);
    if (utf8.indexOf('\uFFFD') === -1) return { text: utf8, encoding: 'UTF-8' };
    try {
      var gbk = new TextDecoder('gbk').decode(buffer);
      if (gbk.indexOf('\uFFFD') === -1 || gbk.length) return { text: gbk, encoding: 'GBK / GB18030' };
    } catch (e) { /* 浏览器不支持 gbk 时退回 UTF-8 */ }
    return { text: utf8, encoding: 'UTF-8（含无法解码的字节）' };
  }

  function handleFile(file) {
    clearAlert();
    hideResult();
    hideMapping();
    if (!file) return;
    state.fileName = file.name || '未命名';
    if (looksLikeExcel(file.name, null) && /\.(xlsx|xlsm|xlsb|xls)$/i.test(file.name)) {
      showExcelNotSupported();
      return;
    }
    if (file.size === 0) {
      showExcelLessError('这个文件是空的（0 字节）。请回到表格软件重新导出一次 CSV，或换成 demo.csv 试试。');
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { showExcelLessError('读取文件失败，浏览器的文件读取被拒绝。请重试或换一个文件。'); };
    reader.onload = function () {
      var buffer = reader.result;
      if (looksLikeExcel(file.name, buffer)) { showExcelNotSupported(); return; }
      var decoded = decodeBuffer(buffer);
      ingestText(decoded.text, file.name, decoded.encoding);
    };
    reader.readAsArrayBuffer(file);
  }

  function showExcelNotSupported() {
    showAlert('<strong>这是 Excel 文件（.xlsx / .xls）。目前支持 CSV，Excel 请在表格软件里另存为 CSV 再上传。</strong><br>' +
      '本工具没有后端，无法零依赖解析 Excel 的二进制格式（.xlsx 本质是个 zip + 一堆 XML），所以它不会假装加载：' +
      '① Excel → 文件 → 另存为 → 类型选「CSV UTF-8（逗号分隔）(*.csv)」；' +
      '② 弹出「只保留当前工作表」时点确定；③ 把生成的 .csv 拖回来即可。' +
      '（下方有图示步骤）', 'warn');
    setStatus('未生成结果：Excel 二进制格式不支持，请另存为 CSV 后重新上传。', 'err');
  }

  function showExcelLessError(msg) {
    showAlert(msg, 'error');
    setStatus('未生成结果', 'err');
  }

  function ingestText(text, name, encoding) {
    var parsed = parseCSV(text);
    var rows = parsed.rows;
    if (!rows.length) { showExcelLessError('这个文件里没有任何可读内容（空文件或全是空行）。'); return; }
    if (rows.length === 1) { showExcelLessError('文件里只有表头「' + rows[0].join(' / ').slice(0, 80) + '」，没有数据行。'); return; }

    var header = rows[0].map(function (h) { return String(h).replace(/\uFEFF/g, '').trim(); });
    var body = rows.slice(1);
    var width = header.length;
    var ragged = 0;
    for (var i = 0; i < body.length; i++) if (body[i].length !== width) ragged++;

    if (width < 2) {
      showExcelLessError('只解析出 1 列数据，不像一张表。请确认文件是用逗号 / 分号 / 制表符分隔的 CSV；Excel / Numbers 导出时选「CSV」而不是「文本」或「单个工作表」。');
      return;
    }

    state.header = header;
    state.rows = body;
    state.delimiter = parsed.delimiter;
    state.encoding = encoding;
    state.map = guessMapping(header);

    renderMapping(ragged);
    validateAndRender();
  }

  /* ============================ 映射界面 ============================ */

  function renderMapping(ragged) {
    var card = $('#map-card');
    var grid = $('#map-grid');
    if (!card || !grid) return;

    var opts = ['<option value="">（未使用 / 没有这列）</option>'];
    for (var i = 0; i < state.header.length; i++) {
      opts.push('<option value="' + i + '">' + esc(state.header[i] || ('第 ' + (i + 1) + ' 列')) + '</option>');
    }
    var optsHTML = opts.join('');

    var html = '';
    for (var r = 0; r < ROLES.length; r++) {
      var role = ROLES[r];
      var sel = state.map[role.key];
      var selIsEmpty = sel == null;
      html += '<div class="field' + ((role.required && selIsEmpty) ? ' bad' : '') + '" data-role="' + role.key + '">';
      html += '<label for="map-' + role.key + '">' + esc(role.label) + (role.required ? '<span class="req">*</span>' : '') + '</label>';
      html += '<select id="map-' + role.key + '" data-role-key="' + role.key + '">' + optsHTML + '</select>';
      html += '<span class="hintline">' + (selIsEmpty ? (role.required ? '必填，请手动选择' : '可选，未使用') : '已自动识别：' + esc(state.header[sel])) + '</span>';
      html += '</div>';
    }
    grid.innerHTML = html;

    var nodes = grid.querySelectorAll('select');
    for (var n = 0; n < nodes.length; n++) {
      var key = nodes[n].getAttribute('data-role-key');
      var val = state.map[key];
      nodes[n].value = (val == null) ? '' : String(val);
      nodes[n].addEventListener('change', onMapChange);
    }

    /* 前 5 行预览 */
    var prev = $('#map-preview');
    if (prev) {
      var h = ['<thead><tr>'];
      for (var c = 0; c < state.header.length; c++) h.push('<th>' + esc(state.header[c] || ('第 ' + (c + 1) + ' 列')) + '</th>');
      h.push('</tr></thead><tbody>');
      for (var rw = 0; rw < Math.min(5, state.rows.length); rw++) {
        h.push('<tr>');
        for (var cc = 0; cc < state.header.length; cc++) h.push('<td>' + esc(state.rows[rw][cc] == null ? '' : state.rows[rw][cc]) + '</td>');
        h.push('</tr>');
      }
      h.push('</tbody>');
      prev.innerHTML = h.join('');
    }

    var meta = $('#map-meta');
    if (meta) {
      var delimName = state.delimiter === ',' ? '逗号 ,' : state.delimiter === ';' ? '分号 ;' : state.delimiter === '\t' ? '制表符 Tab' : '竖线 |';
      meta.textContent = (state.fileName || '未命名') + ' · 分隔符：' + delimName + ' · ' + state.rows.length + ' 行数据 · ' + state.header.length + ' 列 · 编码：' + (state.encoding || 'UTF-8') +
        (ragged ? ' · 有 ' + ragged + ' 行列数不齐（已按缺省值处理）' : '');
    }

    card.hidden = false;
  }

  function hideMapping() {
    var card = $('#map-card');
    if (card) card.hidden = true;
  }

  function onMapChange(ev) {
    var key = ev.target.getAttribute('data-role-key');
    var v = ev.target.value;
    if (v === '') { delete state.map[key]; } else { state.map[key] = parseInt(v, 10); }
    /* 同一列被两个角色选中时，清掉另一个 */
    Object.keys(state.map).forEach(function (k) {
      if (k !== key && String(state.map[k]) === String(v) && v !== '') delete state.map[k];
    });
    refreshHintClasses();
    validateAndRender();
  }

  function refreshHintClasses() {
    var fields = document.querySelectorAll('#map-grid .field');
    for (var i = 0; i < fields.length; i++) {
      var key = fields[i].getAttribute('data-role');
      var role = null;
      for (var r = 0; r < ROLES.length; r++) if (ROLES[r].key === key) role = ROLES[r];
      var sel = state.map[key];
      var bad = role && role.required && sel == null;
      if (bad) fields[i].classList.add('bad'); else fields[i].classList.remove('bad');
      var hint = fields[i].querySelector('.hintline');
      if (hint) hint.textContent = sel == null ? (role && role.required ? '必填，请手动选择' : '可选，未使用') : '已识别：' + (state.header[sel] || '');
    }
    var selects = document.querySelectorAll('#map-grid select');
    for (var s = 0; s < selects.length; s++) {
      var k = selects[s].getAttribute('data-role-key');
      selects[s].value = (state.map[k] == null) ? '' : String(state.map[k]);
    }
  }

  /* ============================ 校验 + 计算 + 渲染 ============================ */

  function buildRecords() {
    var map = state.map;
    var records = [], badDates = 0, sampleBad = null, dupes = {};
    if (map.date == null || map.revenue == null) return { error: 'missing' };

    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      var day = parseDay(row[map.date]);
      if (!day) {
        badDates++;
        if (sampleBad == null && String(row[map.date] == null ? '' : row[map.date]).trim() !== '') sampleBad = String(row[map.date]).trim();
        continue;
      }
      var key = dayKey(day);
      dupes[key] = true;
      records.push({
        key: key,
        day: day,
        orders: map.orders == null ? 0 : toNumber(row[map.orders]),
        revenue: toNumber(row[map.revenue]),
        refunds: map.refunds == null ? 0 : toNumber(row[map.refunds])
      });
    }
    return { records: records, badDates: badDates, sampleBad: sampleBad, days: Object.keys(dupes).length };
  }

  function validateAndRender() {
    clearAlert();
    hideResult();
    if (!state.header.length) return;

    var missing = [];
    for (var r = 0; r < ROLES.length; r++) {
      if (ROLES[r].required && state.map[ROLES[r].key] == null) missing.push(ROLES[r].label);
    }
    if (missing.length) {
      showAlert('<strong>缺少必需列：' + missing.join('、') + '。</strong>已解析出 ' + state.header.length + ' 列：' +
        state.header.map(function (h) { return '「' + esc(h) + '」'; }).join('、') +
        '。<br>请在下面的下拉框里手动指定「' + missing.join('」「') + '」对应哪一列。', 'error');
      setStatus('等待指定列映射', 'err');
      return;
    }

    var built = buildRecords();
    if (built.error) return;

    if (built.badDates > 0 && built.records.length === 0) {
      showAlert('<strong>「' + esc(state.header[state.map.date]) + '」这一列没能解析出任何日期。</strong>' +
        (built.sampleBad ? '示例值：<b>' + esc(built.sampleBad) + '</b>。' : '') +
        '支持 2026-11-01 / 2026/11/01 / 2026年11月1日 / 20261101 / 11/01/2026 这几种写法。请确认选对了列。', 'error');
      setStatus('日期列无法解析', 'err');
      return;
    }
    if (built.badDates > 0) {
      var ratio = built.badDates / (built.badDates + built.records.length);
      showAlert('有 ' + built.badDates + ' 行的日期无法识别，已跳过' + (ratio > 0.2 ? '（占比 ' + fmtPct(ratio, 0) + '，请检查这一列是否是日期）' : '') +
        (built.sampleBad ? '，示例：<b>' + esc(built.sampleBad) + '</b>' : '') + '。', ratio > 0.2 ? 'warn' : 'warn');
    }

    var totalRevenue = 0;
    for (var i = 0; i < built.records.length; i++) totalRevenue += built.records[i].revenue;
    if (built.records.length && totalRevenue === 0) {
      showAlert('<strong>「' + esc(state.header[state.map.revenue]) + '」这一列解析出来全是 0。</strong>' +
        '请确认选的是金额列，而不是数量或折扣列；支持 ¥1,234.56 / 1234.5 / 1.234,56 这类写法。', 'error');
      setStatus('销售额列无法解析', 'err');
      return;
    }

    var stats = computeStats(built.records, {
      fileName: state.fileName,
      rows: state.rows.length,
      days: built.days,
      channel: state.map.channel != null ? state.header[state.map.channel] : null,
      hasOrders: state.map.orders != null,
      hasRefunds: state.map.refunds != null
    });
    if (!stats) { showAlert('没有可用数据行。', 'error'); return; }
    state.stats = stats;
    renderResult(stats);
  }

  function hideResult() {
    var card = $('#result-card');
    if (card) card.hidden = true;
    state.stats = null;
  }

  function renderResult(s) {
    var card = $('#result-card');
    if (!card) return;

    /* KPI */
    var kpis = [
      { label: '本周销售额', value: fmtMoney(s.revenue), note: '环比 ' + (s.wow == null ? '无可比数据' : fmtSignedPct(s.wow)), tone: s.wow == null ? '' : (s.wow < 0 ? 'down' : 'up') },
      { label: '订单数', value: fmtInt(s.orders), note: s.meta.hasOrders ? '客单价 ' + fmtMoney(s.avgOrderValue) : '未映射订单列', tone: '' },
      { label: '退款率', value: fmtPct(s.refundRate), note: s.meta.hasRefunds ? ('退款 ' + fmtMoney(s.refunds)) : '未映射退款列', tone: (s.refundRate != null && s.refundRate > 0.05) ? 'down' : 'up' },
      { label: '单日最高退款率', value: fmtPct(s.maxDailyRefundRate), note: s.maxDailyRefundDay ? (s.maxDailyRefundDay.key + ' 当天') : '无数据', tone: (s.maxDailyRefundRate != null && s.maxDailyRefundRate > 0.10) ? 'down' : '' }
    ];
    var kh = ['<div class="kpi-grid">'];
    for (var i = 0; i < kpis.length; i++) {
      kh.push('<div class="kpi ' + kpis[i].tone + '">');
      kh.push('<div class="k-label">' + esc(kpis[i].label) + '</div>');
      kh.push('<div class="k-value">' + esc(kpis[i].value) + '</div>');
      kh.push('<div class="k-note">' + esc(kpis[i].note) + '</div>');
      kh.push('</div>');
    }
    kh.push('</div>');
    $('#kpi-grid').innerHTML = kh.join('');

    /* 一句话结论 */
    var cEl = $('#conclusion');
    if (cEl) cEl.innerHTML = '<span class="c-tag">一句话结论</span>' + esc(s.conclusion);

    /* 异常 */
    var ah = ['<ul class="anom-list">'];
    for (var a = 0; a < s.anomalies.length; a++) {
      var lv = s.anomalies[a].level;
      ah.push('<li class="lv-' + lv + '"><span class="ai" aria-hidden="true">' + (lv === 'ok' ? '✓' : lv === 'danger' ? '⚠' : '!') + '</span><span>' + esc(s.anomalies[a].text) + '</span></li>');
    }
    ah.push('</ul>');
    $('#anom-list').innerHTML = ah.join('');

    /* 图表 */
    var chartBox = $('#chart-box');
    if (chartBox) chartBox.innerHTML = pageChartSVG(s);

    /* 文字日报 */
    var pre = $('#report-pre');
    if (pre) pre.textContent = buildReportText(s);

    /* 数据摘要 */
    var sum = $('#result-meta');
    if (sum) {
      sum.textContent = s.startKey + ' ~ ' + s.endKey + ' · 覆盖 ' + s.totalDays + ' 个有数据的日子 / 共 ' + s.meta.rows + ' 行' +
        (s.meta.channel ? ' · 渠道列：' + s.meta.channel : '');
    }

    card.hidden = false;
    setStatus('已生成：' + s.endKey + ' 的日报卡', 'ok');
  }

  /* ============================ PNG 导出 ============================ */

  function downloadPng() {
    if (!state.stats) { setStatus('先生成日报再下载', 'err'); return; }
    setStatus('正在渲染 1080×1440 卡片…');
    var svg = buildCardSVG(state.stats);
    var img = new Image();
    img.onload = function () {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = 1080; canvas.height = 1440;
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0a1020';
        ctx.fillRect(0, 0, 1080, 1440);
        ctx.drawImage(img, 0, 0, 1080, 1440);
        canvas.toBlob(function (blob) {
          if (!blob) { setStatus('导出失败：canvas 没有产出图片数据', 'err'); return; }
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'minidash-report-' + state.stats.endKey + '.png';
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
          setStatus('已下载 PNG 卡片（1080×1440）：' + a.download, 'ok');
        }, 'image/png');
      } catch (e) {
        setStatus('导出失败：' + (e && e.message ? e.message : '浏览器拒绝 canvas 导出'), 'err');
      }
    };
    img.onerror = function () { setStatus('导出失败：卡片 SVG 渲染出错', 'err'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /* ============================ 复制文字 ============================ */

  function copyReport() {
    if (!state.stats) { setStatus('先生成日报再复制', 'err'); return; }
    var text = buildReportText(state.stats);
    function ok() { setStatus('文字日报已复制到剪贴板，可以直接粘贴到群里', 'ok'); }
    function fail() {
      setStatus('浏览器拒绝了剪贴板写入，已选中下方文字，按 Ctrl/⌘+C 手动复制', 'err');
      try {
        var range = document.createRange();
        var pre = $('#report-pre');
        range.selectNodeContents(pre);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) { /* ignore */ }
    }
    function legacy() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-2000px';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, text.length);
        var good = document.execCommand('copy');
        document.body.removeChild(ta);
        if (good) ok(); else fail();
      } catch (e) { fail(); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, legacy);
    } else {
      legacy();
    }
  }

  /* ============================ 加载示例 ============================ */

  function loadDemo() {
    if (!DEMO_CSV) { setStatus('示例数据未加载（assets/demo-data.js 缺失）', 'err'); return; }
    state.fileName = 'demo.csv（示例数据）';
    clearAlert();
    hideResult();
    hideMapping();
    ingestText(DEMO_CSV, 'demo.csv（示例数据）', 'UTF-8');
    var card = $('#result-card');
    if (card && !card.hidden && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ============================ 挂载 ============================ */

  var TOOL_HTML = [
    '<div id="alert" class="alert alert-error" role="alert" hidden></div>',

    '<section class="card" aria-labelledby="h-upload">',
    '  <h2 id="h-upload">1. 上传销售数据</h2>',
    '  <p class="sub">CSV 文件，第一行是表头。文件不会离开这台电脑。</p>',
    '  <div class="dropzone" id="dropzone" role="button" tabindex="0" aria-label="拖拽 CSV 文件到这里，或点击选择文件">',
    '    <div class="dz-icon" aria-hidden="true">⬆</div>',
    '    <div class="dz-main">把 CSV 拖到这里</div>',
    '    <div class="dz-hint">或者点下面的按钮选文件 · .csv</div>',
    '    <input type="file" id="file-input" accept=".csv,.txt,text/csv" class="sr-only" aria-label="选择 CSV 文件">',
    '  </div>',
    '  <div class="btn-row">',
    '    <button type="button" class="btn btn-primary" id="pick-btn">选择 CSV 文件</button>',
    '    <button type="button" class="btn btn-ghost" id="demo-btn">没有文件？用示例数据试试</button>',
    '  </div>',
    '  <div class="status" id="status" aria-live="polite"></div>',
    '  <div class="privacy"><span class="lock" aria-hidden="true">🔒</span><span><b>数据不上传、在你自己浏览器里算</b>：文件只在内存里解析，关掉页面即清空，没有服务器、没有埋点、没有第三方脚本。</span></div>',
    '  <div class="note">',
    '    <b>目前支持 CSV（.csv）。Excel 文件请先在表格软件里另存为 CSV。</b>',
    '    本工具没有后端，无法解析 .xlsx / .xls 二进制格式，也不会假装支持——遇到 Excel 文件会直接告诉你怎么办。',
    '    <ol class="excel-steps">',
    '      <li>打开 Excel（或 Numbers / WPS / Google Sheets），点「文件 → 另存为」。</li>',
    '      <li>格式选「CSV UTF-8（逗号分隔）(*.csv)」，别选「Excel 工作簿」。</li>',
    '      <li>弹出的「只保留当前工作表」提示选「确定」（一个 CSV 只能装一张表）。</li>',
    '      <li>把生成的 .csv 文件拖回上面的方框即可。</li>',
    '    </ol>',
    '    <div class="mock" aria-hidden="true">',
    '      <div class="mock-bar"><i></i><i></i><i></i><span>销售明细.xlsx · 文件</span></div>',
    '      <table><tbody>',
    '        <tr><th>另存为</th><td>CSV UTF-8（逗号分隔）</td></tr>',
    '        <tr><th>文件名</th><td class="hl">销售明细.csv</td></tr>',
    '        <tr><th>结果</th><td>可以直接拖进 MiniDash</td></tr>',
    '      </tbody></table>',
    '    </div>',
    '  </div>',
    '</section>',

    '<section class="card" id="map-card" aria-labelledby="h-map" hidden>',
    '  <h2 id="h-map">2. 确认列映射</h2>',
    '  <p class="sub" id="map-meta">—</p>',
    '  <div class="map-grid" id="map-grid"></div>',
    '  <table class="preview-table" id="map-preview"></table>',
    '  <div class="btn-row"><button type="button" class="btn" id="regen-btn">重新计算</button></div>',
    '</section>',

    '<section class="card" id="result-card" aria-labelledby="h-result" hidden>',
    '  <h2 id="h-result">3. 经营日报卡</h2>',
    '  <p class="sub" id="result-meta">—</p>',
    '  <div id="kpi-grid"></div>',
    '  <div class="conclusion" id="conclusion"></div>',
    '  <h3 style="font-size:15px;margin:20px 0 8px;color:#eef2ff">异常提示</h3>',
    '  <div id="anom-list"></div>',
    '  <h3 style="font-size:15px;margin:20px 0 8px;color:#eef2ff">近 7 天销售额</h3>',
    '  <div class="chart-box" id="chart-box"></div>',
    '  <div class="btn-row">',
    '    <button type="button" class="btn btn-primary" id="btn-png">⬇ 下载 PNG 卡片（1080×1440）</button>',
    '    <button type="button" class="btn" id="btn-copy">⧉ 复制文字日报</button>',
    '  </div>',
    '  <h3 style="font-size:15px;margin:22px 0 8px;color:#eef2ff">文字日报（可整段复制）</h3>',
    '  <pre class="report" id="report-pre"></pre>',
    '</section>'
  ].join('\n');

  function mount() {
    var host = document.getElementById('tool');
    if (!host) return;
    host.innerHTML = TOOL_HTML;

    var input = $('#file-input');
    var dz = $('#dropzone');

    $('#pick-btn').addEventListener('click', function () { input.click(); });
    dz.addEventListener('click', function (ev) { if (ev.target !== input) input.click(); });
    dz.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); input.click(); }
    });
    input.addEventListener('change', function () {
      if (input.files && input.files[0]) handleFile(input.files[0]);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (t) {
      dz.addEventListener(t, function (ev) { ev.preventDefault(); dz.classList.add('drag'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      dz.addEventListener(t, function (ev) { ev.preventDefault(); dz.classList.remove('drag'); });
    });
    dz.addEventListener('drop', function (ev) {
      var dt = ev.dataTransfer;
      if (dt && dt.files && dt.files[0]) handleFile(dt.files[0]);
    });
    $('#demo-btn').addEventListener('click', loadDemo);
    $('#regen-btn').addEventListener('click', validateAndRender);
    $('#btn-png').addEventListener('click', downloadPng);
    $('#btn-copy').addEventListener('click', copyReport);

    /* demo.csv 里的数据已内联，页面运行时不发任何请求 */
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  /* 供自测使用（不影响正常交互） */
  window.MiniDash = {
    parseCSV: parseCSV,
    toNumber: toNumber,
    parseDay: parseDay,
    guessMapping: guessMapping,
    buildCardSVG: function () { return state.stats ? buildCardSVG(state.stats) : null; },
    buildReportText: function () { return state.stats ? buildReportText(state.stats) : null; },
    state: state
  };
})();
