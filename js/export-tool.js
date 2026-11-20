/* ============================================================
   管理页「数据导出」模块
   - 底部胶囊导航：记录管理 / 数据导出
   - 导出视图：筛选、统计、明细预览、下载 Excel / CSV
   - 只在管理员页面内运行，普通用户页不受影响
   ============================================================ */
(function () {
  'use strict';

  var root = document.getElementById('admin-export-view');
  var nav = document.getElementById('admin-bottom-nav');
  var recordView = document.getElementById('admin-record-view');
  var overviewView = document.getElementById('admin-overview-view');
  var adminView = document.getElementById('admin-view');
  if (!root || !nav || !recordView || !overviewView || !adminView) return;

  /* ============================================================
     一、配置与常量
     ============================================================ */
  var CFG = {
    appId: typeof LC_APP_ID !== 'undefined' ? LC_APP_ID : 'PkkbpTxYiRWgHbA8h0noWSwh-gzGzoHsz',
    appKey: typeof LC_APP_KEY !== 'undefined' ? LC_APP_KEY : 'suQbFb5BnNKjjSIEPlxfr7BW',
    serverURL: typeof LC_SERVER !== 'undefined' ? LC_SERVER : 'https://pkkbptxy.lc-cn-n1-shared.com'
  };

  var PAGE_SIZE = 20;
  var WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  var SHIFT_ORDER = ['早班', '中班', '晚班', '拼班', '休息'];
  var QUICK = [
    ['all', '全部'],
    ['cycle', '本计薪周期'],
    ['prev', '上个周期'],
    ['30', '近 30 天'],
    ['year', '本年']
  ];

  var DETAIL_HEADER = ['日期', '星期', '班次', '上班', '下班', '第二段上班', '第二段下班',
    '饭点开始', '饭点结束', '有效工时', '基本工资', '加班补贴', '合计', '备注'];

  var state = {
    all: [],
    filtered: [],
    page: 1,
    sortDir: 'desc',
    quick: 'cycle',
    shifts: [],
    keyword: '',
    loading: false,
    error: null,
    loaded: false
  };

  /* ============================================================
     二、通用工具
     ============================================================ */
  function $(id) { return document.getElementById(id); }

  function safeNum(v) {
    var n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  /* 计薪口径与 js/script.js 保持一致：试用期 2700、转正 2900，月标准工时 208 */
  var BASE_SALARY = 2900;
  var TRIAL_SALARY = 2700;
  var TRIAL_END_DATE = '2026-05-31';
  var MONTH_HOURS = 208;

  function hourlyRate(dateStr) {
    var base = (String(dateStr || '').slice(0, 10) <= TRIAL_END_DATE) ? TRIAL_SALARY : BASE_SALARY;
    return base / MONTH_HOURS;
  }

  function round3(n) { return Math.round((safeNum(n) + Number.EPSILON) * 1000) / 1000; }


  function trunc2(n) {
    return Math.floor(safeNum(n) * 100) / 100;
  }

  function escapeHtml(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function formatDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function weekdayOf(dateStr) {
    if (!dateStr) return '';
    var p = String(dateStr).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (isNaN(d.getTime())) return '';
    return WEEK[d.getDay()];
  }

    function hourOf(t) {
    if (!t) return null;
    var h = parseInt(String(t).split(':')[0], 10);
    return isNaN(h) ? null : h;
  }

  function minOf(t) {
    if (!t) return null;
    var p = String(t).split(':');
    var h = Number(p[0]);
    var m = Number(p[1] || 0);
    if (isNaN(h)) return null;
    return h * 60 + (isNaN(m) ? 0 : m);
  }

  function fmtHours(n) {
    var v = safeNum(n);
    if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
    return String(Math.round(v * 100) / 100);
  }

  function notify(theme, title, description) {
    if (typeof showAlert === 'function') {
      showAlert({ theme: theme, title: title, description: description || '' });
    }
  }

  /* 工时算法：与主页面 calcRecordHours 完全一致
     工作时长 − 饭点与实际工作时段的重叠部分（拼班中场休息里吃饭不重复扣） */
  function calcHours(r) {
    if (!r || r.shift === '休息') return 0;
    var segs = [];
    var push = function (s, e) {
      var a = minOf(s);
      var b = minOf(e);
      if (a !== null && b !== null && b > a) segs.push([a, b]);
    };
    push(r.shiftStart, r.shiftEnd);
    if (r.shift === '拼班') push(r.shiftStart2, r.shiftEnd2);
    var worked = 0;
    segs.forEach(function (s) { worked += s[1] - s[0]; });
    var meal = 0;
    var ms = minOf(r.mealStart);
    if (ms !== null) {
      var meRaw = minOf(r.mealEnd);
      var me = meRaw === null ? ms + 60 : meRaw;
      if (me > ms) {
        segs.forEach(function (s) { meal += Math.max(0, Math.min(s[1], me) - Math.max(s[0], ms)); });
      }
    }
    return Math.max(0, (worked - meal) / 60);
  }


  function cycleRange(now) {
    var start, end;
    if (now.getDate() >= 26) {
      start = new Date(now.getFullYear(), now.getMonth(), 26);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 25);
    } else {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 26);
      end = new Date(now.getFullYear(), now.getMonth(), 25);
    }
    return { start: start, end: end };
  }

  function rangeText(from, to) {
    if (from && to) return from + ' 至 ' + to;
    if (from) return from + ' 起';
    if (to) return '截至 ' + to;
    return '全部时间';
  }

  /* ============================================================
     三、视图骨架
     ============================================================ */
  function buildUI() {
    var quickChips = QUICK.map(function (q) {
      return '<button class="exp-chip' + (q[0] === state.quick ? ' active' : '') +
        '" type="button" data-quick="' + q[0] + '">' + q[1] + '</button>';
    }).join('');

    var shiftChips = '<button class="exp-chip active" type="button" data-shift="__all">全部</button>' +
      SHIFT_ORDER.map(function (s) {
        return '<button class="exp-chip" type="button" data-shift="' + s + '">' + s + '</button>';
      }).join('');

    root.innerHTML =
      '<div class="exp-head">' +
        '<div>' +
          '<h2 class="exp-title">数据导出</h2>' +
          '<p class="exp-sub">读取 LeanCloud 记录库，筛选后导出为 Excel / CSV 表格</p>' +
        '</div>' +
        '<div class="exp-head-side">' +
          '<span class="exp-status" id="exp-status"><span class="exp-dot"></span><span id="exp-status-text">未连接</span></span>' +
          '<button class="exp-btn ghost" id="exp-refresh" type="button">刷新</button>' +
        '</div>' +
      '</div>' +

      '<section class="exp-card">' +
        '<div class="exp-card-head"><span class="exp-card-title">筛选范围</span>' +
          '<button class="exp-link muted" type="button" id="exp-reset">重置</button></div>' +
        '<div class="exp-field"><span class="exp-label">快捷范围</span>' +
          '<div class="exp-chips" id="exp-quick">' + quickChips + '</div></div>' +
        '<div class="exp-field"><span class="exp-label">起止日期</span>' +
          '<div class="exp-dates">' +
            '<input type="date" class="exp-input" id="exp-from" aria-label="开始日期">' +
            '<span class="exp-sep">至</span>' +
            '<input type="date" class="exp-input" id="exp-to" aria-label="结束日期">' +
          '</div></div>' +
        '<div class="exp-field"><span class="exp-label">班次</span>' +
          '<div class="exp-chips" id="exp-shifts">' + shiftChips + '</div></div>' +
        '<div class="exp-field"><span class="exp-label">备注关键词</span>' +
          '<input type="search" class="exp-input" id="exp-kw" placeholder="如：当当、京东、抖音"></div>' +
      '</section>' +

      '<section class="exp-card">' +
        '<div class="exp-card-head"><span class="exp-card-title">本次结果</span>' +
          '<span class="exp-card-meta" id="exp-range">全部时间</span></div>' +
        '<div class="exp-stats">' +
          '<div class="exp-stat"><span class="exp-stat-label">记录条数</span>' +
            '<span class="exp-stat-value" id="exp-records">0</span><span class="exp-stat-unit">条</span></div>' +
          '<div class="exp-stat"><span class="exp-stat-label">出勤天数</span>' +
            '<span class="exp-stat-value" id="exp-days">0</span><span class="exp-stat-unit">天</span></div>' +
          '<div class="exp-stat"><span class="exp-stat-label">有效工时</span>' +
            '<span class="exp-stat-value" id="exp-hours">0</span><span class="exp-stat-unit">小时</span></div>' +
          '<div class="exp-stat"><span class="exp-stat-label">基本工资</span>' +
            '<span class="exp-stat-value" id="exp-base">0.00</span><span class="exp-stat-unit">元</span></div>' +
          '<div class="exp-stat"><span class="exp-stat-label">加班补贴</span>' +
            '<span class="exp-stat-value" id="exp-allow">0.00</span><span class="exp-stat-unit">元</span></div>' +
          '<div class="exp-stat money"><span class="exp-stat-label">应发合计</span>' +
            '<span class="exp-stat-value" id="exp-total">0.00</span><span class="exp-stat-unit">元</span></div>' +
        '</div>' +
        '<div class="exp-actions">' +
          '<button class="exp-btn primary" id="exp-xlsx" type="button" disabled>下载 Excel</button>' +
          '<button class="exp-btn" id="exp-csv" type="button" disabled>下载 CSV</button>' +
        '</div>' +
        '<p class="exp-note">Excel 含「工资明细」与「汇总统计」两张工作表，可用 WPS / Office 直接打开。</p>' +
      '</section>' +

      '<section class="exp-card">' +
        '<div class="exp-card-head"><span class="exp-card-title">明细预览</span>' +
          '<div class="exp-head-tools"><span class="exp-card-meta" id="exp-match">0 条</span>' +
            '<button class="exp-link" type="button" id="exp-sort">日期 ' + (state.sortDir === 'asc' ? '升序' : '降序') + '</button></div></div>' +
        '<div class="exp-table-wrap">' +
          '<table class="exp-table"><thead><tr>' +
            '<th>日期</th><th>星期</th><th>班次</th><th>上班</th><th>下班</th>' +
            '<th class="num" title="有效工时（小时）">工时</th>' +
            '<th class="num" title="当日基本工资">基本</th>' +
            '<th class="num" title="加班补贴">补贴</th>' +
            '<th class="num" title="基本工资 + 加班补贴">合计</th><th>备注</th>' +
          '</tr></thead>' +
          '<tbody id="exp-rows"><tr><td colspan="10" class="exp-state"><strong>正在连接数据库</strong>稍候，正在读取记录</td></tr></tbody>' +
          '</table>' +
        '</div>' +
        '<p class="exp-table-hint">表格可左右滑动查看全部列</p>' +
        '<div class="exp-pager">' +
          '<span class="exp-pager-info" id="exp-pager-info">—</span>' +
          '<div class="exp-pager-btns" id="exp-pager-btns"></div>' +
        '</div>' +
      '</section>';
  }

  /* ============================================================
     四、读取数据
     ============================================================ */
  function ensureAV() {
    if (typeof AV === 'undefined') throw new Error('LeanCloud SDK 未加载');
    if (!AV.applicationId) {
      AV.init({ appId: CFG.appId, appKey: CFG.appKey, serverURL: CFG.serverURL });
    }
  }

  function mapBill(o) {
    return {
      date: o.get('date') || '',
      shift: o.get('shift') || '',
      shiftStart: o.get('shiftStart') || '',
      shiftEnd: o.get('shiftEnd') || '',
      shiftStart2: o.get('shiftStart2') || '',
      shiftEnd2: o.get('shiftEnd2') || '',
      mealStart: o.get('mealStart') || '',
      mealEnd: o.get('mealEnd') || '',
      money: safeNum(o.get('money')),
      allowance: safeNum(o.get('allowance')),
      title: o.get('title') || '',
      updatedAt: o.get('updatedAt') || null,
      weekday: '',
      hours: 0
    };
  }

  function fetchBills() {
    var out = [];
    var skip = 0;

    function nextBatch(resolve, reject, attempt) {
      var q = new AV.Query('Bill');
      q.ascending('createdAt');
      q.limit(1000);
      q.skip(skip);
      q.find().then(function (res) {
        for (var i = 0; i < res.length; i++) out.push(mapBill(res[i]));
        if (res.length < 1000) { resolve(out); return; }
        skip += 1000;
        if (skip >= 10000) { resolve(out); return; }
        nextBatch(resolve, reject, attempt);
      }).catch(function (err) {
        if (attempt >= 2) { reject(err); return; }
        setTimeout(function () { nextBatch(resolve, reject, attempt + 1); }, 600 * (attempt + 1));
      });
    }

    return new Promise(function (resolve, reject) {
      nextBatch(resolve, reject, 0);
    });
  }

  function setStatus(kind, text) {
    var chip = $('exp-status');
    if (!chip) return;
    chip.className = 'exp-status' + (kind ? ' ' + kind : '');
    $('exp-status-text').textContent = text;
  }

  function loadData() {
    if (state.loading) return Promise.resolve();
    state.loading = true;
    state.error = null;
    setStatus('connecting', '读取中');
    renderExportButtons();
    renderTable();

    return fetchBills().then(function (list) {
      list.forEach(function (r) {
        r.weekday = weekdayOf(r.date);
        r.hours = calcHours(r);
        // 基本工资统一由「工时 × 当期时薪」推导（试用期 2700 / 转正 2900），和主页面同源
        r.money = round3(r.hours * hourlyRate(r.date));
      });
      state.all = list;
      state.loaded = true;
      state.loading = false;
      setStatus('ok', '已连接 · ' + list.length + ' 条');
      applyFilters();
      renderOverview();
      notify('success', '已读取 ' + list.length + ' 条记录', '');
    }).catch(function (err) {
      state.loaded = false;
      state.loading = false;
      state.all = [];
      state.filtered = [];
      state.error = err;
      setStatus('fail', '连接失败');
      renderAll();
      renderOverview();
      notify('error', '数据读取失败', '请检查网络，或确认页面是通过 http 访问（本地文件会被浏览器拦截）');
    }).then(function () {
      state.loading = false;
      renderExportButtons();
    });
  }

  /* ============================================================
     五、筛选、排序、统计
     ============================================================ */
  function applyFilters() {
    var from = $('exp-from') ? $('exp-from').value : '';
    var to = $('exp-to') ? $('exp-to').value : '';
    var kw = state.keyword.trim().toLowerCase();
    var shifts = state.shifts;

    state.filtered = state.all.filter(function (r) {
      if (from && r.date < from) return false;
      if (to && r.date > to) return false;
      if (shifts.length && shifts.indexOf(r.shift) === -1) return false;
      if (kw) {
        var hay = (r.title + ' ' + r.shift).toLowerCase();
        if (hay.indexOf(kw) === -1) return false;
      }
      return true;
    });

    state.filtered.sort(function (a, b) {
      var d = String(a.date).localeCompare(String(b.date));
      if (d !== 0) return state.sortDir === 'asc' ? d : -d;
      return String(a.updatedAt || '').localeCompare(String(b.updatedAt || ''));
    });

    state.page = 1;
    renderAll();
  }

  function summarize(list) {
    var hours = 0, base = 0, allow = 0, days = 0;
    list.forEach(function (r) {
      if (r.shift === '休息') return;
      days += 1;
      hours += r.hours;
      base += r.money;
      allow += r.allowance;
    });
    return {
      records: list.length,
      days: days,
      hours: hours,
      base: base,
      allow: allow,
      total: base + allow
    };
  }

  /* ============================================================
     六、渲染
     ============================================================ */
  function renderAll() {
    renderSummary();
    renderTable();
    renderPager();
    renderExportButtons();
  }

  /* 数字滚动：统计值从 0 数到目标，给筛选 / 刷新一个可见的反馈 */
  var expRAF = {};
  function expCountNum(el, target, fmt, fromZero) {
    if (!el) return;
    var key = el.id || 'x';
    if (expRAF[key]) { cancelAnimationFrame(expRAF[key]); expRAF[key] = 0; }
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var cur = fromZero ? 0 : parseFloat(String(el.textContent).replace(/[^0-9.\-]/g, ''));
    if (!isFinite(cur)) cur = 0;
    if (reduce || Math.abs(cur - target) < 1e-6) { el.textContent = fmt(target); return; }
    var start = 0;
    var dur = 560;
    function frame(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(cur + (target - cur) * e);
      if (p < 1) {
        expRAF[key] = requestAnimationFrame(frame);
      } else {
        expRAF[key] = 0;
        el.textContent = fmt(target);
      }
    }
    expRAF[key] = requestAnimationFrame(frame);
  }

  function renderSummary(fromZero) {
    var s = summarize(state.filtered);
    var intFmt = function (v) { return String(Math.round(v)); };
    var moneyFmt = function (v) { return v.toFixed(2); };
    expCountNum($('exp-records'), s.records, intFmt, fromZero);
    expCountNum($('exp-days'), s.days, intFmt, fromZero);
    expCountNum($('exp-hours'), s.hours, fmtHours, fromZero);
    expCountNum($('exp-base'), s.base, moneyFmt, fromZero);
    expCountNum($('exp-allow'), s.allow, moneyFmt, fromZero);
    expCountNum($('exp-total'), trunc2(s.total), moneyFmt, fromZero);
    $('exp-match').textContent = s.records + ' 条';
    $('exp-range').textContent = rangeText(
      $('exp-from') ? $('exp-from').value : '',
      $('exp-to') ? $('exp-to').value : ''
    );
  }

  function stateRow(title, hint) {
    return '<tr><td colspan="10" class="exp-state"><strong>' + escapeHtml(title) + '</strong>' +
      (hint ? escapeHtml(hint) : '') + '</td></tr>';
  }

  function renderTable() {
    var body = $('exp-rows');
    if (!body) return;

    if (state.loading && !state.loaded) {
      body.innerHTML = stateRow('正在读取数据库', '首次加载需要几秒，请稍候');
      return;
    }
    if (state.error) {
      body.innerHTML = stateRow('没能连上数据库', '请确认网络正常，且页面通过 http 打开；然后点右上角「刷新」重试');
      return;
    }
    if (!state.filtered.length) {
      body.innerHTML = stateRow('这个范围内没有记录', '把日期范围放宽，或点「重置」查看全部数据');
      return;
    }

    var start = (state.page - 1) * PAGE_SIZE;
    var rows = state.filtered.slice(start, start + PAGE_SIZE);

    body.innerHTML = rows.map(function (r) {
      var isRest = r.shift === '休息';
      return '<tr>' +
        '<td>' + escapeHtml(r.date || '—') + '</td>' +
        '<td>' + escapeHtml(r.weekday) + '</td>' +
        '<td><span class="exp-badge' + (isRest ? ' rest' : '') + '">' + escapeHtml(r.shift || '未填') + '</span></td>' +
        '<td><span class="exp-t-start">' + escapeHtml(isRest ? '—' : (r.shiftStart || '—')) + '</span>' +
          '<span class="exp-t-range">' + escapeHtml(isRest ? '—' : ((r.shiftStart || '—') + ' – ' + (r.shiftEnd || '—'))) + '</span></td>' +
        '<td class="exp-t-end">' + escapeHtml(isRest ? '—' : (r.shiftEnd || '—')) + '</td>' +
        '<td class="num">' + fmtHours(r.hours) + '</td>' +
        '<td class="num">' + r.money.toFixed(2) + '</td>' +
        '<td class="num">' + r.allowance.toFixed(2) + '</td>' +
        '<td class="num exp-money-cell">' + (r.money + r.allowance).toFixed(2) + '</td>' +
        '<td class="remark">' + escapeHtml(r.title || '') + '</td>' +
        '</tr>';
    }).join('');

    /* 新数据逐行淡入，最多错峰到 260ms，避免长列表显得慢 */
    var trs = body.querySelectorAll('tr');
    for (var i = 0; i < trs.length; i++) {
      trs[i].style.animationDelay = Math.min(i * 16, 260) + 'ms';
    }
  }

  function renderPager() {
    var total = state.filtered.length;
    var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page > pages) state.page = pages;

    $('exp-pager-info').textContent = total
      ? '第 ' + ((state.page - 1) * PAGE_SIZE + 1) + ' - ' + Math.min(state.page * PAGE_SIZE, total) + ' 条，共 ' + total + ' 条'
      : '共 0 条';

    var page = state.page;
    var html = '';
    html += '<button class="exp-page-btn" data-page="' + (page - 1) + '"' + (page <= 1 ? ' disabled' : '') + '>上一页</button>';

    var nums = [];
    var from = Math.max(1, page - 2);
    var to = Math.min(pages, page + 2);
    if (from > 1) nums.push(1);
    if (from > 2) nums.push('...');
    for (var i = from; i <= to; i++) nums.push(i);
    if (to < pages - 1) nums.push('...');
    if (to < pages) nums.push(pages);

    nums.forEach(function (n) {
      if (n === '...') {
        html += '<span class="exp-pager-info">…</span>';
      } else {
        html += '<button class="exp-page-btn' + (n === page ? ' current' : '') +
          '" data-page="' + n + '">' + n + '</button>';
      }
    });

    html += '<button class="exp-page-btn" data-page="' + (page + 1) + '"' + (page >= pages ? ' disabled' : '') + '>下一页</button>';
    $('exp-pager-btns').innerHTML = html;
  }

  function renderExportButtons() {
    var disabled = state.loading || !state.filtered.length;
    $('exp-xlsx').disabled = disabled;
    $('exp-csv').disabled = disabled;
  }

  /* ============================================================
     七、交互
     ============================================================ */
  function setQuick(key) {
    var today = new Date();
    var from = '', to = '';
    if (key === 'all') {
      from = ''; to = '';
    } else if (key === 'cycle') {
      var c = cycleRange(today);
      from = formatDate(c.start); to = formatDate(c.end);
    } else if (key === 'prev') {
      var c0 = cycleRange(today);
      var d = new Date(c0.start);
      d.setDate(d.getDate() - 1);
      var c1 = cycleRange(d);
      from = formatDate(c1.start); to = formatDate(c1.end);
    } else if (key === '30') {
      var s = new Date(today);
      s.setDate(s.getDate() - 29);
      from = formatDate(s); to = formatDate(today);
    } else if (key === 'year') {
      from = today.getFullYear() + '-01-01';
      to = today.getFullYear() + '-12-31';
    }

    $('exp-from').value = from;
    $('exp-to').value = to;
    state.quick = key;
    markQuick();
    applyFilters();
  }

  function markQuick() {
    Array.prototype.forEach.call($('exp-quick').children, function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-quick') === state.quick);
    });
  }

  function markShifts() {
    Array.prototype.forEach.call($('exp-shifts').children, function (btn) {
      var v = btn.getAttribute('data-shift');
      if (v === '__all') btn.classList.toggle('active', state.shifts.length === 0);
      else btn.classList.toggle('active', state.shifts.indexOf(v) !== -1);
    });
  }

  /* 默认筛选：本计薪周期 + 日期降序（最新在前） */
  function initDefaults() {
    var c = cycleRange(new Date());
    $('exp-from').value = formatDate(c.start);
    $('exp-to').value = formatDate(c.end);
    state.quick = 'cycle';
    state.sortDir = 'desc';
    state.page = 1;
    markQuick();
    $('exp-sort').textContent = '日期 降序';
    $('exp-range').textContent = formatDate(c.start) + ' 至 ' + formatDate(c.end);
  }

  function bindUI() {
    $('exp-quick').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-quick]');
      if (!btn) return;
      setQuick(btn.getAttribute('data-quick'));
    });

    $('exp-shifts').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-shift]');
      if (!btn) return;
      var v = btn.getAttribute('data-shift');
      if (v === '__all') {
        state.shifts = [];
      } else {
        var idx = state.shifts.indexOf(v);
        if (idx === -1) state.shifts.push(v);
        else state.shifts.splice(idx, 1);
      }
      markShifts();
      applyFilters();
    });

    $('exp-from').addEventListener('change', function () {
      if (this.value && $('exp-to').value && this.value > $('exp-to').value) {
        $('exp-to').value = this.value;
      }
      state.quick = '';
      markQuick();
      applyFilters();
    });

    $('exp-to').addEventListener('change', function () {
      if (this.value && $('exp-from').value && this.value < $('exp-from').value) {
        $('exp-from').value = this.value;
      }
      state.quick = '';
      markQuick();
      applyFilters();
    });

    var kwTimer = null;
    $('exp-kw').addEventListener('input', function () {
      var v = this.value;
      clearTimeout(kwTimer);
      kwTimer = setTimeout(function () {
        state.keyword = v;
        applyFilters();
      }, 220);
    });

    $('exp-reset').addEventListener('click', function () {
      $('exp-kw').value = '';
      state.keyword = '';
      state.shifts = [];
      markShifts();
      initDefaults();
      applyFilters();
    });

    $('exp-sort').addEventListener('click', function () {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      this.textContent = state.sortDir === 'asc' ? '日期 升序' : '日期 降序';
      applyFilters();
    });

    $('exp-pager-btns').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-page]');
      if (!btn || btn.disabled) return;
      var p = Number(btn.getAttribute('data-page'));
      var pages = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
      if (p < 1 || p > pages || p === state.page) return;
      state.page = p;
      renderTable();
      renderPager();
    });

    $('exp-refresh').addEventListener('click', function () {
      if (state.loading) return;
      state.loaded = false;
      this.disabled = true;
      var self = this;
      loadData().then(function () { self.disabled = false; });
    });

    $('exp-xlsx').addEventListener('click', function () {
      try {
        var blob = buildWorkbookBlob();
        downloadBlob(blob, fileName('xlsx'));
        notify('success', '已开始下载 Excel', state.filtered.length + ' 条记录');
      } catch (err) {
        notify('error', '导出失败', (err && err.message) || '未知错误');
      }
    });

    $('exp-csv').addEventListener('click', function () {
      try {
        downloadBlob(buildCsvBlob(), fileName('csv'));
        notify('success', '已开始下载 CSV', state.filtered.length + ' 条记录');
      } catch (err) {
        notify('error', '导出失败', (err && err.message) || '未知错误');
      }
    });
  }

  /* ============================================================
     八、底部导航切换
     ============================================================ */
  function playViewEnter(el) {
    el.classList.remove('admin-view-enter');
    // 强制回流，保证每次切换都能重新播放进入动画
    void el.offsetWidth;
    el.classList.add('admin-view-enter');
    // 动画结束立刻摘掉类，避免任何残留状态影响布局
    el.onanimationend = function (e) {
      if (e.target !== el) return;
      el.classList.remove('admin-view-enter');
      el.onanimationend = null;
    };
  }

  /* 底部高亮块按当前按钮实测定位（三个标签宽度不同也能对齐） */
  var thumbInited = false;

  function syncThumb(instant) {
    var btn = nav.querySelector('.tab-btn.active');
    if (!btn) return;
    var navRect = nav.getBoundingClientRect();
    if (!navRect.width) return;
    var rect = btn.getBoundingClientRect();
    var pad = 6;
    var x = rect.left - navRect.left - pad;
    var w = rect.width;

    nav.style.setProperty('--thumb-x', x.toFixed(1) + 'px');
    nav.style.setProperty('--thumb-w', w.toFixed(1) + 'px');

    if (instant || !thumbInited) {
      nav.classList.remove('thumb-ready');
      void nav.offsetWidth;
      nav.classList.add('thumb-ready');
      thumbInited = true;
    }
  }

  function scheduleThumb(instant) {
    if (adminView.classList.contains('hidden')) return;
    syncThumb(instant);
    requestAnimationFrame(function () {
      if (!adminView.classList.contains('hidden')) syncThumb(instant);
    });
    setTimeout(function () {
      if (!adminView.classList.contains('hidden')) syncThumb(true);
    }, 240);
  }

  function switchTab(tab) {
    var map = {
      record: recordView,
      export: root,
      overview: overviewView
    };
    var showing = map[tab] || recordView;
    var changed = showing.classList.contains('hidden');

    if (changed) {
      Object.keys(map).forEach(function (k) {
        if (map[k] && map[k] !== showing) map[k].classList.add('hidden');
      });
      showing.classList.remove('hidden');
      playViewEnter(showing);
    }

    nav.setAttribute('data-active', tab);
    // 概览页整页铺开，靠这个属性放宽 #admin-view 的宽度；记录页 / 导出页保持原窄版
    adminView.setAttribute('data-tab', tab);

    Array.prototype.forEach.call(nav.querySelectorAll('[data-admin-tab]'), function (btn) {
      var on = btn.getAttribute('data-admin-tab') === tab;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    // 选中项展开文字、其余收起，这里重新量一次位置让高亮块跟过去
    scheduleThumb(false);
    ovTipHide();

    if (tab === 'export' && !state.loaded && !state.loading) loadData();
    if (tab === 'overview') {
      if (!state.loaded && !state.loading) loadData();
      renderOverview();
    }

    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function bindNav() {
    nav.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-admin-tab]');
      if (!btn) return;
      switchTab(btn.getAttribute('data-admin-tab'));
    });

    var wasHidden = adminView.classList.contains('hidden');
    var observer = new MutationObserver(function () {
      var nowHidden = adminView.classList.contains('hidden');
      if (wasHidden && !nowHidden) switchTab('record');
      wasHidden = nowHidden;
    });
    observer.observe(adminView, { attributes: true, attributeFilter: ['class'] });

    window.addEventListener('resize', function () {
      if (adminView.classList.contains('hidden')) return;
      scheduleThumb(true);
    });
  }

  /* ============================================================
     九、导出的数据整理
     ============================================================ */
  function detailRows() {
    return state.filtered.map(function (r) {
      return [
        r.date,
        r.weekday,
        r.shift,
        r.shiftStart,
        r.shiftEnd,
        r.shiftStart2,
        r.shiftEnd2,
        r.mealStart,
        r.mealEnd,
        { value: Math.round(r.hours * 100) / 100, style: 'num' },
        { value: Math.round(r.money * 1000) / 1000, style: 'num' },
        { value: Math.round(r.allowance * 1000) / 1000, style: 'num' },
        { value: Math.round((r.money + r.allowance) * 1000) / 1000, style: 'num' },
        r.title
      ];
    });
  }

  function summaryRows() {
    var s = summarize(state.filtered);
    var now = new Date();
    var stamp = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) +
      ' ' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());

    return [
      ['导出时间', stamp],
      ['筛选范围', rangeText($('exp-from').value, $('exp-to').value)],
      ['班次筛选', state.shifts.length ? state.shifts.join('、') : '全部班次'],
      ['备注关键词', state.keyword || '无'],
      ['记录条数', { value: s.records, style: 'int' }],
      ['出勤天数', { value: s.days, style: 'int' }],
      ['有效工时（小时）', { value: Math.round(s.hours * 100) / 100, style: 'num' }],
      ['基本工资合计（元）', { value: Math.round(s.base * 1000) / 1000, style: 'num' }],
      ['加班补贴合计（元）', { value: Math.round(s.allow * 1000) / 1000, style: 'num' }],
      ['应发合计（元）', { value: Math.round(s.total * 1000) / 1000, style: 'num' }],
      ['平均时薪（元/小时）', { value: s.hours > 0 ? Math.round((s.base / s.hours) * 100) / 100 : 0, style: 'num' }],
      ['平均每日基本工资（元/天）', { value: s.days > 0 ? Math.round((s.base / s.days) * 100) / 100 : 0, style: 'num' }]
    ];
  }

  function fileName(ext) {
    var from = $('exp-from').value;
    var to = $('exp-to').value;
    var label = from && to ? from + '至' + to : (from ? from + '起' : (to ? '截至' + to : '全部'));
    return '工资明细_' + label + '.' + ext;
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 1200);
  }

  /* ============================================================
     十、CSV
     ============================================================ */
  function csvCell(v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildCsvBlob() {
    if (!state.filtered.length) throw new Error('当前没有可导出的记录');
    var lines = [];
    lines.push(DETAIL_HEADER.map(csvCell).join(','));
    state.filtered.forEach(function (r) {
      lines.push([
        r.date, r.weekday, r.shift, r.shiftStart, r.shiftEnd,
        r.shiftStart2, r.shiftEnd2, r.mealStart, r.mealEnd,
        (Math.round(r.hours * 100) / 100).toFixed(2),
        r.money.toFixed(3), r.allowance.toFixed(3), (r.money + r.allowance).toFixed(3),
        r.title
      ].map(csvCell).join(','));
    });
    return new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  }

  /* ===== XLSX-WRITER-START ===== */
  /* 轻量 xlsx 生成器：不使用外部库，按 OOXML 结构直接打包 ZIP（store 模式） */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(buf, off, v) {
    buf[off] = v & 0xFF;
    buf[off + 1] = (v >>> 8) & 0xFF;
  }

  function u32(buf, off, v) {
    buf[off] = v & 0xFF;
    buf[off + 1] = (v >>> 8) & 0xFF;
    buf[off + 2] = (v >>> 16) & 0xFF;
    buf[off + 3] = (v >>> 24) & 0xFF;
  }

  function concatBytes(parts) {
    var len = 0, i;
    for (i = 0; i < parts.length; i++) len += parts[i].length;
    var out = new Uint8Array(len);
    var p = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], p); p += parts[i].length; }
    return out;
  }

  function toBytes(v) {
    if (v instanceof Uint8Array) return v;
    return new TextEncoder().encode(String(v));
  }

  function zipStore(entries) {
    var now = new Date();
    var dosTime = ((now.getHours() & 0x1F) << 11) | ((now.getMinutes() & 0x3F) << 5) | ((now.getSeconds() >> 1) & 0x1F);
    var dosDate = (((now.getFullYear() - 1980) & 0x7F) << 9) | (((now.getMonth() + 1) & 0x0F) << 5) | (now.getDate() & 0x1F);

    var chunks = [];
    var central = [];
    var offset = 0;

    entries.forEach(function (e) {
      var name = new TextEncoder().encode(e.name);
      var data = toBytes(e.data);
      var crc = crc32(data);

      var lh = new Uint8Array(30 + name.length);
      u32(lh, 0, 0x04034b50);
      u16(lh, 4, 20);
      u16(lh, 6, 0x0800);
      u16(lh, 8, 0);
      u16(lh, 10, dosTime);
      u16(lh, 12, dosDate);
      u32(lh, 14, crc);
      u32(lh, 18, data.length);
      u32(lh, 22, data.length);
      u16(lh, 26, name.length);
      u16(lh, 28, 0);
      lh.set(name, 30);
      chunks.push(lh, data);

      var ch = new Uint8Array(46 + name.length);
      u32(ch, 0, 0x02014b50);
      u16(ch, 4, 20);
      u16(ch, 6, 20);
      u16(ch, 8, 0x0800);
      u16(ch, 10, 0);
      u16(ch, 12, dosTime);
      u16(ch, 14, dosDate);
      u32(ch, 16, crc);
      u32(ch, 20, data.length);
      u32(ch, 24, data.length);
      u16(ch, 28, name.length);
      u16(ch, 30, 0);
      u16(ch, 32, 0);
      u16(ch, 34, 0);
      u16(ch, 36, 0);
      u32(ch, 38, 0);
      u32(ch, 42, offset);
      ch.set(name, 46);
      central.push(ch);

      offset += lh.length + data.length;
    });

    var centralBytes = concatBytes(central);
    var eocd = new Uint8Array(22);
    u32(eocd, 0, 0x06054b50);
    u16(eocd, 4, 0);
    u16(eocd, 6, 0);
    u16(eocd, 8, entries.length);
    u16(eocd, 10, entries.length);
    u32(eocd, 12, centralBytes.length);
    u32(eocd, 16, offset);
    u16(eocd, 20, 0);

    return concatBytes(chunks.concat([centralBytes, eocd]));
  }

  var XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

  function xmlEsc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c];
    });
  }

  function colLetter(n) {
    var s = '';
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function stringCell(ref, value, styleIdx) {
    var s = (value === null || value === undefined) ? '' : String(value);
    if (s === '') return '';
    var st = styleIdx ? ' s="' + styleIdx + '"' : '';
    return '<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + xmlEsc(s) + '</t></is></c>';
  }

  function cellXml(ref, item, isHeader) {
    if (item === null || item === undefined) return '';
    if (isHeader) return stringCell(ref, item, 1);

    if (typeof item === 'object' && item.value !== undefined) {
      if (item.style === 'int') return '<c r="' + ref + '" s="3"><v>' + (Number(item.value) || 0) + '</v></c>';
      if (item.style === 'num') return '<c r="' + ref + '" s="2"><v>' + (Number(item.value) || 0) + '</v></c>';
      return stringCell(ref, item.value, 0);
    }
    if (typeof item === 'number' && isFinite(item)) return '<c r="' + ref + '" s="2"><v>' + item + '</v></c>';
    return stringCell(ref, item, 0);
  }

  function sheetXml(header, rows, widths) {
    var totalCols = header.length;
    var xml = XML_HEAD + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    xml += '<dimension ref="A1:' + colLetter(totalCols) + (rows.length + 1) + '"/>';
    xml += '<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
      '</sheetView></sheetViews>';
    xml += '<sheetFormatPr defaultRowHeight="16"/>';
    if (widths && widths.length) {
      xml += '<cols>';
      widths.forEach(function (w, i) {
        xml += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      });
      xml += '</cols>';
    }
    xml += '<sheetData>';
    xml += '<row r="1" ht="24" customHeight="1">';
    header.forEach(function (h, i) {
      xml += '<c r="' + colLetter(i + 1) + '1" s="1" t="inlineStr"><is><t>' + xmlEsc(h) + '</t></is></c>';
    });
    xml += '</row>';
    rows.forEach(function (row, ri) {
      var rn = ri + 2;
      xml += '<row r="' + rn + '">';
      for (var ci = 0; ci < header.length; ci++) {
        xml += cellXml(colLetter(ci + 1) + rn, row[ci], false);
      }
      xml += '</row>';
    });
    xml += '</sheetData>';
    xml += '<autoFilter ref="A1:' + colLetter(totalCols) + (rows.length + 1) + '"/>';
    xml += '</worksheet>';
    return xml;
  }

  function stylesXml() {
    return XML_HEAD +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2">' +
      '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF1B3358"/><name val="Calibri"/><family val="2"/></font>' +
      '</fonts>' +
      '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFDE7F1"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="thin"><color rgb="FFD6E2F0"/></bottom><diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="4">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
      '<alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
      '<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  }

  function contentTypesXml() {
    return XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '</Types>';
  }

  function rootRelsXml() {
    return XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';
  }

  function workbookXml() {
    return XML_HEAD +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' +
      '<sheet name="工资明细" sheetId="1" r:id="rId1"/>' +
      '<sheet name="汇总统计" sheetId="2" r:id="rId2"/>' +
      '</sheets>' +
      '</workbook>';
  }

  function workbookRelsXml() {
    return XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';
  }

  function buildXlsxBytes(detailHeader, detailData, summaryHeader, summaryData) {
    var detail = sheetXml(detailHeader, detailData,
      [12, 7, 8, 9, 9, 11, 11, 10, 10, 9, 11, 11, 10, 26]);
    var summary = sheetXml(summaryHeader, summaryData, [26, 20]);

    var files = [
      { name: '[Content_Types].xml', data: contentTypesXml() },
      { name: '_rels/.rels', data: rootRelsXml() },
      { name: 'xl/workbook.xml', data: workbookXml() },
      { name: 'xl/_rels/workbook.xml.rels', data: workbookRelsXml() },
      { name: 'xl/styles.xml', data: stylesXml() },
      { name: 'xl/worksheets/sheet1.xml', data: detail },
      { name: 'xl/worksheets/sheet2.xml', data: summary }
    ];

    return zipStore(files);
  }
  /* ===== XLSX-WRITER-END ===== */

  function buildWorkbookBlob() {
    if (!state.filtered.length) throw new Error('当前没有可导出的记录');
    var bytes = buildXlsxBytes(DETAIL_HEADER, detailRows(), ['项目', '数值'], summaryRows());
    return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ============================================================
     十、数据概览（图表全部用内联 SVG 手绘，无第三方库）
     ============================================================ */
  var PALETTE = ['#0052D9', '#3D7FFF', '#2BA471', '#E37318', '#9AA4B6', '#C9CFD9'];
  var SHIFT_COLOR = {
    '早班': PALETTE[0],
    '中班': PALETTE[1],
    '晚班': PALETTE[2],
    '拼班': PALETTE[3],
    '休息': PALETTE[4]
  };
  var COMPOSE_BASE = '#0052D9';
  var COMPOSE_ALLOW = '#E37318';

  function fmtMoney(n) {
    return safeNum(n).toFixed(2);
  }

  function axisNum(n) {
    var v = safeNum(n);
    if (v >= 10000) return (v / 10000).toFixed(v >= 100000 ? 0 : 1) + '万';
    return String(Math.round(v));
  }

  function niceMax(v) {
    if (!(v > 0)) return 1;
    var exp = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
    var f = v / exp;
    var steps = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < steps.length; i++) {
      if (f <= steps[i]) return steps[i] * exp;
    }
    return 10 * exp;
  }

  function monthOf(dateStr) {
    var s = String(dateStr || '');
    return s.length >= 7 ? s.slice(0, 7) : '';
  }

  function monthText(key) {
    return String(Number(String(key).slice(5, 7))) + '月';
  }

  function monthList(count, endKey) {
    var y = Number(endKey.slice(0, 4));
    var m = Number(endKey.slice(5, 7));
    var out = [];
    for (var i = count - 1; i >= 0; i--) {
      var yy = y;
      var mm = m - i;
      while (mm <= 0) { mm += 12; yy -= 1; }
      out.push(String(yy) + '-' + pad2(mm));
    }
    return out;
  }

  function buildMonthMap(list) {
    var map = {};
    list.forEach(function (r) {
      var k = monthOf(r.date);
      if (!k) return;
      var m = map[k] || (map[k] = { key: k, records: 0, days: 0, hours: 0, base: 0, allow: 0, total: 0 });
      m.records += 1;
      if (r.shift !== '休息') {
        m.days += 1;
        m.hours += r.hours;
      }
      m.base += r.money;
      m.allow += r.allowance;
      m.total = m.base + m.allow;
    });
    return map;
  }

  /* 计薪周期 26 日 ~ 次月 25 日：给周期维度出图用 */
  function cycleOf(dateStr) {
    var p = String(dateStr || '').split('-');
    if (p.length < 3) return null;
    var y = Number(p[0]), m = Number(p[1]), d = Number(p[2]);
    if (!y || !m || !d) return null;
    return d >= 26
      ? { start: formatDate(new Date(y, m - 1, 26)), end: formatDate(new Date(y, m, 25)) }
      : { start: formatDate(new Date(y, m - 2, 26)), end: formatDate(new Date(y, m - 1, 25)) };
  }

  function buildCycleMap(list) {
    var map = {};
    list.forEach(function (r) {
      var c = cycleOf(r.date);
      if (!c) return;
      var m = map[c.start] || (map[c.start] = {
        key: c.start, end: c.end, records: 0, days: 0, hours: 0, base: 0, allow: 0, total: 0
      });
      m.records += 1;
      if (r.shift !== '休息') {
        m.days += 1;
        m.hours += r.hours;
      }
      m.base += r.money;
      m.allow += r.allowance;
      m.total = m.base + m.allow;
    });
    return map;
  }

  /* 周期短标签：6.26-7.25 */
  function cycleLabel(item) {
    return Number(item.key.slice(5, 7)) + '.' + Number(item.key.slice(8, 10)) + '-' +
      Number(item.end.slice(5, 7)) + '.' + Number(item.end.slice(8, 10));
  }

  function cycleSeries(map, count) {
    var keys = Object.keys(map).sort();
    if (!keys.length) return [];
    var picked = count ? keys.slice(Math.max(0, keys.length - count)) : keys;
    return picked.map(function (k) { return map[k]; });
  }

  /* 周期内每一天：给「当下周期」的每日曲线/柱图用，没记录的日子也占位（0 元 / 0 小时） */
  function buildDailySeries(list, from, to) {
    var byDate = {};
    list.forEach(function (r) {
      if (!r.date) return;
      var d = byDate[r.date] || (byDate[r.date] = { total: 0, hours: 0, days: 0 });
      d.total += safeNum(r.money) + safeNum(r.allowance);
      if (r.shift !== '休息') {
        d.days += 1;
        d.hours += safeNum(r.hours);
      }
    });
    var out = [];
    var sy = Number(String(from).slice(0, 4)), sm = Number(String(from).slice(5, 7)), sd = Number(String(from).slice(8, 10));
    var ey = Number(String(to).slice(0, 4)), em = Number(String(to).slice(5, 7)), ed = Number(String(to).slice(8, 10));
    var start = new Date(sy, sm - 1, sd);
    var end = new Date(ey, em - 1, ed);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return out;
    for (var t = start.getTime(); t <= end.getTime(); t += 86400000) {
      var ds = formatDate(new Date(t));
      var d = byDate[ds];
      out.push({
        key: ds,
        label: Number(ds.slice(5, 7)) + '.' + Number(ds.slice(8, 10)),
        tip: ds + (d ? '' : ' · 无记录'),
        total: d ? d.total : 0,
        hours: d ? d.hours : 0,
        days: d ? d.days : 0
      });
    }
    return out;
  }

  function recentMonths(map, count) {
    var keys = Object.keys(map).sort();
    var end = keys.length ? keys[keys.length - 1] : formatDate(new Date()).slice(0, 7);
    return monthList(count, end).map(function (k) {
      return map[k] || { key: k, records: 0, days: 0, hours: 0, base: 0, allow: 0, total: 0 };
    });
  }

  function kpiHtml(label, value, unit, cls, num, dec, sub) {
    var attrs = '';
    if (num !== undefined && num !== null) {
      attrs = ' data-num="' + num + '" data-dec="' + (dec || 0) + '"';
    }
    return '<div class="ov-kpi' + (cls ? ' ' + cls : '') + '"' + attrs + '>' +
      '<span class="k-label">' + escapeHtml(label) + '</span>' +
      '<span class="k-value">' + escapeHtml(value) + (unit ? '<small>' + escapeHtml(unit) + '</small>' : '') +
      '</span>' + (sub ? '<span class="k-sub">' + escapeHtml(sub) + '</span>' : '') + '</div>';
  }

  /* 收入趋势：面积折线 */
  function svgTrend(items, width) {
    var W = width || 660, H = 212, padL = 36, padR = 34, padT = 22, padB = 30;
    var n = items.length || 1;
    var iw = W - padL - padR;
    var ih = H - padT - padB;
    var max = niceMax(Math.max.apply(null, items.map(function (it) { return it.total; }).concat([1])));

    var pts = items.map(function (it, idx) {
      var x = n <= 1 ? padL + iw / 2 : padL + idx * iw / (n - 1);
      var y = padT + ih - (it.total / max) * ih;
      return { x: x, y: y };
    });

    var d = pts.map(function (p, i) {
      return (i ? 'L' : 'M') + p.x.toFixed(1) + ',' + p.y.toFixed(1);
    }).join(' ');

    var area = d +
      ' L' + pts[pts.length - 1].x.toFixed(1) + ',' + (padT + ih) +
      ' L' + pts[0].x.toFixed(1) + ',' + (padT + ih) + ' Z';

    var grid = '';
    [0, 0.5, 1].forEach(function (f) {
      var y = padT + ih - f * ih;
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) +
        '" stroke="var(--exp-hairline)" stroke-width="1"' +
        (f === 0 ? '' : ' stroke-dasharray="3 4"') + '/>';
      grid += '<text x="' + (padL - 7) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" class="ov-axis-text">' +
        (f === 0 ? '0' : axisNum(max * f)) + '</text>';
    });

    var xlab = '';
    items.forEach(function (it, idx) {
      if (n > 10 && idx % 2 === 1 && idx !== n - 1) return;
      if (n > 10 && idx === n - 2) return;                 /* 倒数第二个让位给末日标签，避免叠字 */
      var isLast = (n > 10 && idx === n - 1);
      xlab += '<text x="' + (isLast ? pts[idx].x + 2 : pts[idx].x).toFixed(1) + '" y="' + (H - 8) +
        '" text-anchor="' + (isLast ? 'end' : 'middle') + '" class="ov-axis-text">' +
        (it.label || monthText(it.key)) + '</text>';
    });

    var dots = '';
    items.forEach(function (it, idx) {
      if (!it.total) return;
      dots += '<circle cx="' + pts[idx].x.toFixed(1) + '" cy="' + pts[idx].y.toFixed(1) +
        '" r="3" fill="' + PALETTE[0] + '" class="ov-dot-pt" style="animation-delay:' +
        (0.12 + idx * 0.03).toFixed(2) + 's"/>';
    });

    /* 每个点的透明热区：悬停出数值气泡 */
    var hits = '';
    items.forEach(function (it, idx) {
      var tipText = (it.tip || it.label || it.key) + ' · ' + fmtMoney(it.total) + ' 元 · ' +
        fmtHours(it.hours) + ' 小时 · ' + it.days + ' 天出勤';
      hits += '<circle class="ov-hit" cx="' + pts[idx].x.toFixed(1) + '" cy="' + pts[idx].y.toFixed(1) +
        '" r="10" fill="transparent" data-tip="' + escapeHtml(tipText) + '"/>';
    });

    var last = items[items.length - 1];
    var lastPt = pts[pts.length - 1];
    var tip = (last && last.total)
      ? '<text x="' + Math.max(lastPt.x - 8, 60).toFixed(1) + '" y="' + Math.max(lastPt.y - 8, 12).toFixed(1) +
        '" text-anchor="end" class="ov-value-text">' + fmtMoney(last.total) + '</text>'
      : '';

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ov-svg" preserveAspectRatio="xMidYMid meet">' +
      '<defs><linearGradient id="ovAreaGrad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#0052D9" stop-opacity="0.18"/>' +
      '<stop offset="100%" stop-color="#0052D9" stop-opacity="0.02"/>' +
      '</linearGradient></defs>' +
      grid +
      '<path class="ov-area" d="' + area + '" fill="url(#ovAreaGrad)"/>' +
      '<path d="' + d + '" fill="none" stroke="' + PALETTE[0] + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ov-line"/>' +
      dots + tip + xlab + hits +
      '</svg>';
  }

  /* 柱状图（工时 / 月度对比用） */
  function svgBars(items, valueKey, color, width, height) {
    var W = width || 640, H = height || 176, padL = 30, padR = 18, padT = 20, padB = 28;
    var iw = W - padL - padR;
    var ih = H - padT - padB;
    var step = iw / (items.length || 1);
    var bw = Math.min(step * 0.5, 36);
    var max = niceMax(Math.max.apply(null, items.map(function (it) { return it[valueKey]; }).concat([1])));
    var bars = '', vals = '', labs = '', skipLab = step < 34;

    items.forEach(function (it, i) {
      var v = safeNum(it[valueKey]);
      var h = max ? (v / max) * ih : 0;
      var x = padL + i * step + (step - bw) / 2;
      var y = padT + ih - h;
      bars += '<rect class="ov-bar-rect" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) +
        '" height="' + Math.max(h, 1.5).toFixed(1) + '" rx="' + Math.min(bw / 2, 5).toFixed(1) +
        '" fill="' + color + '" opacity="' + (v > 0 ? 0.92 : 0.14) + '"' +
        ' data-tip="' + escapeHtml((it.tip || it.label || it.key) + ' · ' + fmtHours(v) + ' 小时 · ' +
          (it.days ? it.days + ' 天出勤' : '无出勤')) + '"/>';
      if (v > 0) {
        vals += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 6).toFixed(1) +
          '" text-anchor="middle" class="ov-value-text">' + fmtHours(v) + '</text>';
      }
      var total = items.length;
      var showLab = !skipLab || i % 2 === 0 || i === total - 1;
      if (skipLab && i === total - 2) showLab = false;      /* 倒数第二个让位给末日标签 */
      if (showLab) {
        var isLastBar = skipLab && i === total - 1;
        labs += '<text x="' + (x + bw / 2 + (isLastBar ? 2 : 0)).toFixed(1) + '" y="' + (H - 9) +
          '" text-anchor="' + (isLastBar ? 'end' : 'middle') + '" class="ov-axis-text">' +
          (it.label || monthText(it.key)) + '</text>';
      }
    });

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="ov-svg">' + bars + vals + labs + '</svg>';
  }

  /* 环形图（班次分布） */
  function svgDonut(items, total, centerLabel) {
    var S = 180, r = 63, sw = 21, cx = S / 2, cy = S / 2;
    var C = 2 * Math.PI * r;
    var acc = 0;
    var ring = '';

    items.forEach(function (it) {
      var frac = total ? it.value / total : 0;
      var len = Math.max(frac * C - 3, 0.6);
      var off = -(acc * C) - 1.5;
      var pct = total ? Math.round(frac * 100) : 0;
      ring += '<circle class="ov-arc" cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + it.color +
        '" stroke-width="' + sw + '" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) +
        '" stroke-dashoffset="' + off.toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"' +
        ' data-name="' + escapeHtml(it.name) + '" data-val="' + it.value + '" data-pct="' + pct + '"' +
        ' data-tip="' + escapeHtml(it.name + ' · ' + it.value + ' 条 · ' + pct + '%') + '"/>';
      acc += frac;
    });

    return '<svg viewBox="0 0 ' + S + ' ' + S + '" class="ov-svg ov-donut" data-total="' + total +
      '" data-cap="' + escapeHtml(centerLabel) + '">' + ring +
      '<text id="ov-donut-num" x="' + cx + '" y="' + (cy + 3) + '" text-anchor="middle" class="ov-donut-num">' +
        total + '</text>' +
      '<text id="ov-donut-cap" x="' + cx + '" y="' + (cy + 20) + '" text-anchor="middle" class="ov-donut-cap">' +
        escapeHtml(centerLabel) + '</text>' +
      '</svg>';
  }

  /* ============================================================
     十、数据概览（指标大盘）
     版式参考 Ant Design「数据可视化页」规范：概览先行、一卡一主题、
     模块控制在 5–9 个、核心指标平铺在页面顶部、附筛选器。
     图表全部用内联 SVG 手绘，无第三方库。
     ============================================================ */
  var ovRange = 'all';

  function rangeRecords(records, range) {
    if (!range || range === 'all') return records;
    if (range === 'cycle') {
      var c = cycleRange(new Date());
      var cs = formatDate(c.start);
      var ce = formatDate(c.end);
      return records.filter(function (r) {
        return r.date && r.date >= cs && r.date <= ce;
      });
    }
    /* 近 6 个月 = 最近 6 个计薪周期（26 日 ~ 次月 25 日），不按自然月切 */
    var keys = Object.keys(buildCycleMap(records)).sort();
    if (!keys.length) return records;
    var keep = {};
    keys.slice(Math.max(0, keys.length - 6)).forEach(function (k) { keep[k] = 1; });
    return records.filter(function (r) {
      var cy = cycleOf(r.date);
      return cy && keep[cy.start];
    });
  }

  function ovRangeText() {
    if (ovRange === 'cycle') {
      var c = cycleRange(new Date());
      return '本计薪周期 ' + formatDate(c.start).slice(5) + ' 至 ' + formatDate(c.end).slice(5);
    }
    if (ovRange === 'all') return '全部周期';
    return '近 6 个周期';
  }

  function buildOverviewUI() {
    var ov = overviewView;
    if (!ov || ov.getAttribute('data-built') === '1') return;
    ov.setAttribute('data-built', '1');

    ov.innerHTML =
      '<div class="ov-page">' +
        '<header class="ov-head">' +
          '<div class="ov-head-left">' +
            '<h2 class="ov-title">数据概览</h2>' +
            '<p class="ov-sub">周期趋势、班次结构与收入构成，一屏看全</p>' +
          '</div>' +
          '<div class="ov-head-tools">' +
            '<div class="ov-range" id="ov-range" role="group" aria-label="统计范围">' +
              '<button type="button" class="on" data-range="all">全部</button>' +
              '<button type="button" data-range="6">近 6 个月</button>' +
              '<button type="button" data-range="cycle">当下周期</button>' +
            '</div>' +
            '<span class="exp-status" id="ov-status"><span class="exp-dot"></span>' +
              '<span id="ov-status-text">待读取</span></span>' +
          '</div>' +
        '</header>' +

        '<div class="ov-grid">' +

          '<section class="exp-card ov-card span-12 ov-anim" style="animation-delay:.02s">' +
            '<div class="exp-card-head"><span class="exp-card-title">关键指标</span>' +
              '<span class="exp-card-meta" id="ov-kpi-meta">全部时间</span></div>' +
            '<div class="ov-kpis" id="ov-kpis"><div class="ov-empty">正在读取数据库…</div></div>' +
          '</section>' +

          '<section class="exp-card ov-card span-8 ov-anim" style="animation-delay:.06s">' +
            '<div class="exp-card-head"><span class="exp-card-title" id="ov-trend-title">周期收入趋势</span>' +
              '<span class="exp-card-meta" id="ov-trend-meta">全部周期</span></div>' +
            '<div class="ov-chart" id="ov-trend"><div class="ov-empty">正在读取数据库…</div></div>' +
          '</section>' +

          '<section class="exp-card ov-card span-4 ov-anim" style="animation-delay:.09s">' +
            '<div class="exp-card-head"><span class="exp-card-title">班次分布</span>' +
              '<span class="exp-card-meta" id="ov-pie-meta">全部时间</span></div>' +
            '<div id="ov-pie"><div class="ov-empty">正在读取数据库…</div></div>' +
          '</section>' +

          '<section class="exp-card ov-card span-6 ov-anim" style="animation-delay:.12s">' +
            '<div class="exp-card-head"><span class="exp-card-title">周期工资对比</span>' +
              '<span class="exp-card-meta" id="ov-month-meta">最近 6 个周期</span></div>' +
            '<div id="ov-month"><div class="ov-empty">正在读取数据库…</div></div>' +
          '</section>' +

          '<section class="exp-card ov-card span-6 ov-anim" style="animation-delay:.18s">' +
            '<div class="exp-card-head"><span class="exp-card-title" id="ov-hours-title">周期工时</span>' +
              '<span class="exp-card-meta" id="ov-hours-meta">全部周期</span></div>' +
            '<div class="ov-chart" id="ov-hours"><div class="ov-empty">正在读取数据库…</div></div>' +
          '</section>' +

          '<section class="exp-card ov-card span-4 ov-anim" style="animation-delay:.15s">' +
            '<div class="exp-card-head"><span class="exp-card-title">收入构成</span>' +
              '<span class="exp-card-meta" id="ov-compose-meta">全部时间</span></div>' +
            '<div id="ov-compose"><div class="ov-empty">正在读取数据库…</div></div>' +
          '</section>' +

          '<section class="exp-card ov-card span-4 ov-anim" style="animation-delay:.21s">' +
            '<div class="exp-card-head"><span class="exp-card-title">星期分布</span>' +
              '<span class="exp-card-meta" id="ov-week-meta">出勤天数</span></div>' +
            '<div id="ov-week"><div class="ov-empty">正在读取数据库…</div></div>' +
          '</section>' +

          '<section class="exp-card ov-card span-4 ov-anim" style="animation-delay:.24s">' +
            '<div class="exp-card-head"><span class="exp-card-title">最近记录</span>' +
              '<span class="exp-card-meta" id="ov-recent-meta">最新 6 条</span></div>' +
            '<div id="ov-recent"><div class="ov-empty">正在读取数据库…</div></div>' +
          '</section>' +

        '</div>' +
      '</div>';

    bindOverviewRange();
  }

  function bindOverviewRange() {
    var box = $('ov-range');
    if (!box || box.getAttribute('data-bound') === '1') return;
    box.setAttribute('data-bound', '1');
    box.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-range]');
      if (!btn) return;
      ovRange = btn.getAttribute('data-range') || 'all';
      Array.prototype.forEach.call(box.querySelectorAll('[data-range]'), function (x) {
        x.classList.toggle('on', x === btn);
      });
      renderOverview();
    });
  }

  function renderOverview() {
    if (!overviewView || !$('ov-kpis')) return;

    var statusText = $('ov-status-text');
    var chip = $('ov-status');

    if (state.error) {
      chip.className = 'exp-status fail';
      statusText.textContent = '读取失败';
      $('ov-kpis').innerHTML = '<div class="ov-empty">读取失败，请回导出页点「刷新」重试</div>';
      return;
    }

    if (!state.loaded) {
      chip.className = 'exp-status connecting';
      statusText.textContent = '读取中';
      return;
    }

    var label = ovRangeText();
    var src = rangeRecords(state.all, ovRange);
    var sum = summarize(src);

    /* 统一口径：一切按计薪周期（26 日 ~ 次月 25 日）分组，卡片 x 轴都取自这里 */
    var cmap = buildCycleMap(src);
    var ckeys = Object.keys(cmap).sort();
    var cycleBars = cycleSeries(cmap, 0).map(function (m) {
      m.label = cycleLabel(m);
      m.tip = m.key + ' ~ ' + m.end;
      return m;
    });

    var isCycle = ovRange === 'cycle';
    var axisItems, axisMeta, trendTitle, hoursTitle, windowLabel;

    if (isCycle) {
      /* 当下周期：趋势/工时都拆到周期内的每一天，未来日期不占位 */
      var cr = cycleRange(new Date());
      var cs = formatDate(cr.start);
      var ce = formatDate(cr.end);
      var todayStr = formatDate(new Date());
      var lastDay = ce < todayStr ? ce : todayStr;
      axisItems = buildDailySeries(src, cs, lastDay);
      axisMeta = cycleLabel({ key: cs, end: ce }) + ' · 每日';
      trendTitle = '周期内每日收入';
      hoursTitle = '周期内每日工时';
      windowLabel = '本计薪周期 ' + cs.slice(5) + ' 至 ' + ce.slice(5);
    } else {
      axisItems = cycleBars;
      trendTitle = '周期收入趋势';
      hoursTitle = '周期工时';
      axisMeta = ovRange === '6'
        ? '近 6 个周期 · 共 ' + axisItems.length + ' 个'
        : '全部 ' + axisItems.length + ' 个周期';
      windowLabel = axisMeta;
    }

    var cycleMeta = isCycle
      ? '本期 ' + (cycleBars[0] ? cycleBars[0].label : '')
      : axisMeta;

    chip.className = 'exp-status ok';
    statusText.textContent = '已连接 · ' + state.all.length + ' 条';

    /* 平均时薪：剔除试用期 3–5 月，统一按正式工 2900/208 折算，随筛选实时重算 */
    var RATE_FORMAL = 2900 / 208;
    var formalHours = 0, formalMoney = 0;
    src.forEach(function (r) {
      if (r.shift === '休息' || !r.date || r.date < '2026-06-01') return;
      formalHours += safeNum(r.hours);
      formalMoney += round3(safeNum(r.hours) * RATE_FORMAL) + safeNum(r.allowance);
    });
    var rate = formalHours > 0 ? formalMoney / formalHours : 0;
    var perDay = sum.days ? sum.hours / sum.days : 0;
    var restCount = src.filter(function (r) { return r.shift === '休息'; }).length;
    var shareTips = state.all.length ? Math.round((src.length / state.all.length) * 100) : 0;

    /* 关键指标：一屏平铺，卡片同时给出辅助说明 */
    $('ov-kpis').innerHTML =
      kpiHtml('累计收入', fmtMoney(sum.total), '元', 'money', Math.round(sum.total * 100) / 100, 2,
        '基本 ' + fmtMoney(sum.base) + ' + 补贴 ' + fmtMoney(sum.allow)) +
      kpiHtml('有效工时', fmtHours(sum.hours), '小时', '', Math.round(sum.hours * 10) / 10, sum.hours % 1 ? 1 : 0,
        sum.days ? '日均 ' + perDay.toFixed(2) + ' 小时' : '暂无出勤') +
      kpiHtml('出勤天数', String(sum.days), '天', '', sum.days, 0,
        '含休息 ' + restCount + ' 天 · 覆盖 ' + ckeys.length + ' 个周期') +
      kpiHtml('平均时薪', rate.toFixed(2), '元/时', 'hot', Math.round(rate * 100) / 100, 2,
        '正式工 2900 折算 · 不含试用期 3–5 月') +
      kpiHtml('记录条数', String(sum.records), '条', '', sum.records, 0,
        src.length === state.all.length ? '全部记录' : '占全部 ' + shareTips + '%') +
      kpiHtml('覆盖周期', String(ckeys.length), '个', '', ckeys.length, 0,
        ckeys.length ? cycleLabel(cmap[ckeys[0]]) + ' 起' : '暂无数据');

    $('ov-kpi-meta').textContent = ckeys.length
      ? cycleLabel(cmap[ckeys[0]]) + ' 起 · ' + label
      : label;

    var curStart = formatDate(cycleRange(new Date()).start);
    var inProgress = ckeys.length && ckeys[ckeys.length - 1] === curStart;
    var running = (isCycle ? '' : (inProgress ? ' · 本期进行中' : ''));
    $('ov-trend-title').textContent = trendTitle;
    $('ov-hours-title').textContent = hoursTitle;
    $('ov-trend-meta').textContent = windowLabel + running;
    $('ov-month-meta').textContent = cycleMeta + running;

    /* 收入趋势：全部/近 6 → 每个周期一个点；当下周期 → 周期内每天一个点 */
    /* 手机上把图表的 viewBox 收窄，字号才不会被等比缩小 */
    var narrow = (window.innerWidth || 1024) < 720;
    $('ov-trend').innerHTML = sum.records
      ? svgTrend(axisItems, narrow ? 440 : 660)
      : '<div class="ov-empty">暂无数据</div>';

    /* 周期工资对比：每个计薪周期一根条 */
    var maxTotal = Math.max.apply(null, cycleBars.map(function (m) { return m.total; }).concat([0]));
    var rows = cycleBars.map(function (m) {
      var pct = maxTotal ? (m.total / maxTotal) * 100 : 0;
      var tipText = m.key + ' ~ ' + m.end + ' · ' + fmtMoney(m.total) + ' 元 · ' + fmtHours(m.hours) + ' 小时 · ' +
        m.days + ' 天 · 占最高周期 ' + pct.toFixed(1) + '%';
      return '<div class="ov-bar-row">' +
        '<div class="bar-head"><span>' + cycleLabel(m) + '</span><b>' + fmtMoney(m.total) + ' 元</b></div>' +
        '<div class="ov-bar-track"><i class="ov-bar-fill" style="width:' + pct.toFixed(1) + '%"' +
          ' data-tip="' + escapeHtml(tipText) + '"></i></div>' +
        '</div>';
    }).join('');
    $('ov-month').innerHTML = rows || '<div class="ov-empty">暂无数据</div>';

    /* 收入构成：单独一张卡讲基本工资与补贴的关系 */
    var baseShare = sum.total ? (sum.base / sum.total) * 100 : 0;
    var allowShare = sum.total ? 100 - baseShare : 0;
    $('ov-compose').innerHTML =
      '<div class="ov-compose">' +
        '<div class="ov-compose-nums">' +
          '<div class="ov-num-block"><span>基本工资</span><b>' + fmtMoney(sum.base) +
            '</b><small>元 · ' + baseShare.toFixed(1) + '%</small></div>' +
          '<div class="ov-num-block allow"><span>加班补贴</span><b>' + fmtMoney(sum.allow) +
            '</b><small>元 · ' + allowShare.toFixed(1) + '%</small></div>' +
        '</div>' +
        '<div class="ov-stack">' +
          '<i style="width:' + baseShare.toFixed(1) + '%;background:' + COMPOSE_BASE + '"' +
            ' data-tip="' + escapeHtml('基本工资 ' + fmtMoney(sum.base) + ' 元 · ' + baseShare.toFixed(1) + '%') + '"></i>' +
          '<i style="width:' + allowShare.toFixed(1) + '%;background:' + COMPOSE_ALLOW + '"' +
            ' data-tip="' + escapeHtml('加班补贴 ' + fmtMoney(sum.allow) + ' 元 · ' + allowShare.toFixed(1) + '%') + '"></i>' +
        '</div>' +
        '<div class="ov-legend">' +
          '<span class="lg"><span class="ov-dot" style="background:' + COMPOSE_BASE + '"></span>基本工资 <b>' +
            baseShare.toFixed(1) + '%</b></span>' +
          '<span class="lg"><span class="ov-dot" style="background:' + COMPOSE_ALLOW + '"></span>加班补贴 <b>' +
            allowShare.toFixed(1) + '%</b></span>' +
        '</div>' +
      '</div>';
    $('ov-compose-meta').textContent = label + ' · 合计 ' + fmtMoney(sum.total) + ' 元';

    /* 班次分布 */
    var shifts = SHIFT_ORDER.map(function (name) {
      var count = 0;
      src.forEach(function (r) { if (r.shift === name) count += 1; });
      return { name: name, value: count, color: SHIFT_COLOR[name] || PALETTE[5] };
    }).filter(function (s) { return s.value > 0; });

    var shiftTotal = shifts.reduce(function (a, s) { return a + s.value; }, 0);

    $('ov-pie').innerHTML = shiftTotal
      ? '<div class="ov-pie-wrap">' +
          '<div class="ov-pie-svg">' + svgDonut(shifts, shiftTotal, '条记录') + '</div>' +
          '<div class="ov-legend" style="margin-top:0">' +
            shifts.map(function (s) {
              return '<span class="lg"><span class="ov-dot" style="background:' + s.color + '"></span>' +
                escapeHtml(s.name) + ' <b>' + s.value + '</b> 条 · ' +
                ((s.value / shiftTotal) * 100).toFixed(0) + '%</span>';
            }).join('') +
          '</div></div>'
      : '<div class="ov-empty">暂无数据</div>';
    $('ov-pie-meta').textContent = label + ' · ' + shiftTotal + ' 条';

    /* 工时：与收入趋势同一根 x 轴（周期 / 周期内每天） */
    var hoursSum = axisItems.reduce(function (a, m) { return a + m.hours; }, 0);
    $('ov-hours').innerHTML = sum.records
      ? svgBars(axisItems, 'hours', PALETTE[2], narrow ? 420 : 640, narrow ? 230 : 320)
      : '<div class="ov-empty">暂无数据</div>';
    $('ov-hours-meta').textContent = axisMeta + ' · ' + fmtHours(hoursSum) + ' 小时';

    /* 星期分布 */
    var wk = [0, 0, 0, 0, 0, 0, 0];
    src.forEach(function (r) {
      if (r.shift === '休息') return;
      var d = new Date(r.date);
      if (!isNaN(d.getTime())) wk[d.getDay()] += 1;
    });
    var wkMax = Math.max.apply(null, wk.concat([1]));
    var order = [1, 2, 3, 4, 5, 6, 0];

    $('ov-week').innerHTML = order.map(function (idx) {
      var pct = (wk[idx] / wkMax) * 100;
      var tipText = WEEK[idx] + ' · ' + wk[idx] + ' 天出勤 · 占最高 ' + pct.toFixed(1) + '%';
      return '<div class="ov-week-row">' +
        '<span>' + WEEK[idx] + '</span>' +
        '<span class="wk-track"><i class="wk-fill" style="width:' + pct.toFixed(1) + '%"' +
          ' data-tip="' + escapeHtml(tipText) + '"></i></span>' +
        '<span class="wk-num">' + wk[idx] + ' 天</span>' +
        '</div>';
    }).join('');
    $('ov-week-meta').textContent = label + ' · 共 ' + sum.days + ' 天';

    /* 最近记录（明细分块，呼应规范的「明细」模板） */
    var recent = src.slice().sort(function (a, b) {
      return String(b.date).localeCompare(String(a.date));
    }).slice(0, 6);

    $('ov-recent').innerHTML = recent.length
      ? '<div class="ov-recent">' + recent.map(function (r) {
          var color = SHIFT_COLOR[r.shift] || PALETTE[5];
          var money = safeNum(r.money) + safeNum(r.allowance);
          var tipText = r.date + ' ' + (r.weekday || '') + ' · ' + r.shift + ' · ' +
            fmtHours(r.hours) + ' 小时 · ' + fmtMoney(money) + ' 元';
          return '<div class="rc-row" data-tip="' + escapeHtml(tipText) + '">' +
            '<span class="rc-dot" style="background:' + color + '"></span>' +
            '<span class="rc-date">' + escapeHtml(String(r.date).slice(5)) +
              '<i>' + escapeHtml(r.weekday || '') + '</i></span>' +
            '<span class="rc-shift">' + escapeHtml(r.shift || '') + '</span>' +
            '<span class="rc-hours">' + fmtHours(r.hours) + ' h</span>' +
            '<b class="rc-money">' + fmtMoney(money) + '</b>' +
          '</div>';
        }).join('') + '</div>'
      : '<div class="ov-empty">暂无数据</div>';
    $('ov-recent-meta').textContent = '最新 ' + recent.length + ' 条 · ' + label;

    /* 切档后重放动效：折线重绘 + KPI 数字重新跳动 */
    ovAnimateCharts();
  }

  /* 图表切换动效：面积淡入 / 折线描线 / KPI 数字滚动 */
  function ovAnimateCharts() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var svg = $('ov-trend') ? $('ov-trend').querySelector('svg') : null;

    if (svg && !reduce) {
      var area = svg.querySelector('.ov-area');
      var line = svg.querySelector('.ov-line');
      if (area) {
        area.style.transition = 'none';
        area.style.opacity = '0';
        requestAnimationFrame(function () {
          area.style.transition = 'opacity 0.55s ease 0.06s';
          area.style.opacity = '1';
        });
      }
      if (line && line.getTotalLength) {
        var len = line.getTotalLength();
        if (len) {
          line.style.transition = 'none';
          line.style.strokeDasharray = len.toFixed(1) + ' ' + len.toFixed(1);
          line.style.strokeDashoffset = len.toFixed(1);
          requestAnimationFrame(function () {
            line.style.transition = 'stroke-dashoffset 0.8s cubic-bezier(0.3, 0.7, 0.35, 1)';
            line.style.strokeDashoffset = '0';
          });
        }
      }
    }

    var cards = $('ov-kpis') ? $('ov-kpis').querySelectorAll('.ov-kpi') : [];
    Array.prototype.forEach.call(cards, function (card) { ovCountUp(card); });
  }

  /* ============================================================
     十一、概览页悬停交互（数值气泡 / KPI 数字滚动 / 环形中心联动）
     ============================================================ */
  function ovTipEl() {
    var el = $('ov-tip');
    if (!el) {
      el = document.createElement('div');
      el.className = 'ov-tip';
      el.id = 'ov-tip';
      el.setAttribute('aria-hidden', 'true');
    }
    // 必须挂在 body 上：外层玻璃容器带 backdrop-filter 会形成包含块，
    // 挂在其内部时 position:fixed 会相对它定位，气泡就会飘到卡片外面。
    if (el.parentNode !== document.body) document.body.appendChild(el);
    return el;
  }

  function ovTipShow(text, x, y) {
    var el = ovTipEl();
    if (!el || !text) return;
    el.textContent = text;
    el.classList.add('show');
    var w = el.offsetWidth || 140;
    var h = el.offsetHeight || 30;
    var left = x + 14;
    if (left + w > window.innerWidth - 10) left = x - w - 14;
    var top = y - h - 14;
    if (top < 10) top = y + 20;
    if (top + h > window.innerHeight - 10) top = window.innerHeight - h - 10;
    el.style.left = Math.max(8, left) + 'px';
    el.style.top = Math.max(8, top) + 'px';
  }

  function ovTipHide() {
    var el = ovTipEl();
    if (el) el.classList.remove('show');
  }

  function ovDonutCenter(svg, num, cap) {
    if (!svg) return;
    var n = svg.querySelector('#ov-donut-num');
    var c = svg.querySelector('#ov-donut-cap');
    if (n) n.textContent = num;
    if (c) c.textContent = cap;
  }

  function ovDonutRestore(svg) {
    if (!svg) return;
    ovDonutCenter(svg, svg.getAttribute('data-total') || '', svg.getAttribute('data-cap') || '');
  }

  function ovCountUp(card) {
    if (card._animating) return;
    var target = Number(card.getAttribute('data-num'));
    var dec = Number(card.getAttribute('data-dec') || 0);
    var valEl = card.querySelector('.k-value');
    if (!valEl || !isFinite(target)) return;
    var unitEl = valEl.querySelector('small');
    var unitHtml = unitEl ? unitEl.outerHTML : '';
    if (card._raf) cancelAnimationFrame(card._raf);
    card._animating = true;
    var start = 0;
    var dur = 640;

    function frame(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var e = 1 - Math.pow(1 - p, 3);
      var cur = target * e;
      valEl.innerHTML = cur.toFixed(dec) + unitHtml;
      if (p < 1) {
        card._raf = requestAnimationFrame(frame);
      } else {
        valEl.innerHTML = target.toFixed(dec) + unitHtml;
        card._raf = 0;
        card._animating = false;
      }
    }
    card._raf = requestAnimationFrame(frame);
  }

  function ovCountRestore(card) {
    var target = Number(card.getAttribute('data-num'));
    var dec = Number(card.getAttribute('data-dec') || 0);
    var valEl = card.querySelector('.k-value');
    if (!valEl || !isFinite(target)) return;
    if (card._raf) { cancelAnimationFrame(card._raf); card._raf = 0; }
    card._animating = false;
    var unitEl = valEl.querySelector('small');
    valEl.innerHTML = target.toFixed(dec) + (unitEl ? unitEl.outerHTML : '');
  }

  function bindOverviewHover() {
    if (!overviewView || overviewView.getAttribute('data-hover') === '1') return;
    overviewView.setAttribute('data-hover', '1');

    overviewView.addEventListener('mousemove', function (e) {
      var hit = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (!hit) return;
      ovTipShow(hit.getAttribute('data-tip'), e.clientX, e.clientY);
    });

    overviewView.addEventListener('mouseover', function (e) {
      var hit = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (!hit) return;
      ovTipShow(hit.getAttribute('data-tip'), e.clientX, e.clientY);

      var arc = e.target.closest('.ov-arc');
      if (arc) {
        var svg = arc.closest('.ov-donut');
        ovDonutCenter(svg, arc.getAttribute('data-val'),
          arc.getAttribute('data-name') + ' ' + arc.getAttribute('data-pct') + '%');
      }

      var kpi = e.target.closest('.ov-kpi');
      if (kpi) ovCountUp(kpi);
    });

    overviewView.addEventListener('mouseout', function (e) {
      var hit = e.target.closest ? e.target.closest('[data-tip]') : null;
      if (hit && hit !== e.relatedTarget && !(hit.contains && hit.contains(e.relatedTarget))) ovTipHide();

      var arc = e.target.closest('.ov-arc');
      if (arc) {
        var svg = arc.closest('.ov-donut');
        if (!(e.relatedTarget && svg && svg.contains(e.relatedTarget))) ovDonutRestore(svg);
      }

      var kpi = e.target.closest('.ov-kpi');
      if (kpi && !(e.relatedTarget && kpi.contains(e.relatedTarget))) ovCountRestore(kpi);
    });

    window.addEventListener('scroll', ovTipHide, { passive: true });
  }

  /* ============================================================
     十二、启动
     ============================================================ */
  /* 一键回到顶部：滚动超过一屏后出现，点击平滑回顶 */
  function bindBackToTop() {
    var btn = $('back-to-top');
    if (!btn || btn.getAttribute('data-bound') === '1') return;
    btn.setAttribute('data-bound', '1');
    function sync() {
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      btn.classList.toggle('show', y > 320);
    }
    window.addEventListener('scroll', sync, { passive: true });
    document.addEventListener('scroll', sync, { passive: true, capture: true });
    window.addEventListener('resize', sync);
    btn.addEventListener('click', function () {
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) {
        window.scrollTo(0, 0);
      }
    });
    sync();
  }

  /* 切到「数据导出」标签时重放卡片与统计的入场动效 */
  function expReplayIn() {
    var cards = root.querySelectorAll('.exp-card');
    for (var i = 0; i < cards.length; i++) {
      cards[i].style.animation = 'none';
      cards[i].style.animationDelay = (i * 70) + 'ms';
      void cards[i].offsetWidth;
      cards[i].style.animation = '';
    }
    var stats = root.querySelectorAll('.exp-stat');
    for (var j = 0; j < stats.length; j++) {
      stats[j].style.animation = 'none';
      stats[j].style.animationDelay = (130 + j * 40) + 'ms';
      void stats[j].offsetWidth;
      stats[j].style.animation = '';
    }
    renderSummary(true);
  }

  function watchExportTab() {
    var view = document.getElementById('admin-view');
    if (!view || view.getAttribute('data-exp-watch') === '1') return;
    view.setAttribute('data-exp-watch', '1');
    var prev = view.getAttribute('data-tab');
    new MutationObserver(function () {
      var cur = view.getAttribute('data-tab');
      if (cur === 'export' && prev !== 'export') setTimeout(expReplayIn, 24);
      prev = cur;
    }).observe(view, { attributes: true, attributeFilter: ['data-tab'] });
  }

  function boot() {
    buildUI();
    buildOverviewUI();
    bindUI();
    initDefaults();
    bindNav();
    bindOverviewHover();
    bindBackToTop();
    watchExportTab();

    // 若进入时管理页已可见（例如热重载后状态保留），先把默认标签与高亮块摆好
    if (!adminView.classList.contains('hidden')) {
      switchTab('record');
      scheduleThumb(true);
    }
    window.addEventListener('load', function () {
      if (!adminView.classList.contains('hidden')) scheduleThumb(true);
    });
    setTimeout(function () {
      if (!adminView.classList.contains('hidden')) scheduleThumb(true);
    }, 260);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
