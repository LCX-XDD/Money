// ========== 全局变量 ==========
let savedScrollTop = 0;
let clickBlocker = null;
let currentProgress = 0;
let currentMiniProgress = 0;
let progressTimer = null;
let miniProgressTimer = null;
let isLoading = false;

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let recordDates = new Set();
let selectedDate = '';
let allBillList = [];

const LC_APP_ID = "PkkbpTxYiRWgHbA8h0noWSwh-gzGzoHsz";
const LC_APP_KEY = "suQbFb5BnNKjjSIEPlxfr7BW";
const LC_SERVER = "https://pkkbptxy.lc-cn-n1-shared.com";
const BASE_SALARY = 2900;

// ========== 通用工具函数 ==========
function safeNum(val, fallback = 0) {
  const num = Number(val);
  return isNaN(num) ? fallback : num;
}

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getCycleRange(now = new Date()) {
  let cycleStart, cycleEnd;
  if (now.getDate() >= 26) {
    cycleStart = new Date(now.getFullYear(), now.getMonth(), 26);
    cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, 25);
  } else {
    cycleStart = new Date(now.getFullYear(), now.getMonth() - 1, 26);
    cycleEnd = new Date(now.getFullYear(), now.getMonth(), 25);
  }
  return { cycleStart, cycleEnd };
}

function calcWagePercent(totalWage) {
  return Math.max(0, Math.round(safeNum(totalWage) / BASE_SALARY * 100));
}

// ========== 进度条动画（通用函数，消除重复） ==========
function runProgressAnim(circleEl, textEl, cssVar, targetPercent, timerRef, min = 0, max = Infinity) {
  if (!circleEl || !textEl) return;

  if (timerRef.value) {
    clearInterval(timerRef.value);
    timerRef.value = null;
  }

  targetPercent = Math.max(min, Math.min(max, safeNum(targetPercent)));
  let current = Math.max(min, Math.min(max, safeNum(parseInt(circleEl.style.getPropertyValue(cssVar)))));
  const step = targetPercent > current ? 1 : -1;

  timerRef.value = setInterval(() => {
    current += step;
    current = Math.max(min, Math.min(max, current));
    circleEl.style.setProperty(cssVar, current);
    textEl.textContent = `${current}%`;
    if (current === targetPercent) {
      clearInterval(timerRef.value);
      timerRef.value = null;
    }
  }, 10);
}

function animateProgress(targetPercent) {
  const circle = document.getElementById('bottom-progress');
  const text = document.getElementById('progress-text');
  runProgressAnim(circle, text, '--progress', targetPercent, { value: progressTimer }, 0, Infinity);
}

function animateMiniProgress(targetPercent) {
  const circle = document.getElementById('top-progress');
  const text = document.getElementById('cycle-progress-text');
  runProgressAnim(circle, text, '--mini-progress', targetPercent, { value: miniProgressTimer }, 0, 100);
}

function calculateCycleProgress() {
  const { cycleStart, cycleEnd } = getCycleRange();
  const totalMs = cycleEnd - cycleStart;
  const passedMs = Date.now() - cycleStart.getTime();
  return Math.min(Math.round((passedMs / totalMs) * 100), 100);
}

function initTopMiniCards() {
  const bottomCircle = document.getElementById('bottom-progress');
  const bottomText = document.getElementById('progress-text');
  const topCircle = document.getElementById('top-progress');
  const topText = document.getElementById('cycle-progress-text');

  if (bottomCircle) bottomCircle.style.setProperty('--progress', 0);
  if (bottomText) bottomText.textContent = '0%';
  if (topCircle) topCircle.style.setProperty('--mini-progress', 0);
  if (topText) topText.textContent = '0%';

  setTimeout(() => {
    animateMiniProgress(calculateCycleProgress());
    const totalWage = parseFloat(document.getElementById('total-wage-num')?.textContent || 0);
    animateProgress(calcWagePercent(totalWage));
  }, 200);
}

// ========== 滚动控制 ==========
function disableBodyScroll() {
  savedScrollTop = window.pageYOffset || document.documentElement.scrollTop;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${savedScrollTop}px`;
  document.body.style.width = '100%';
  
  if (!clickBlocker) {
    clickBlocker = document.createElement('div');
    clickBlocker.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      z-index: 9998; background: transparent; pointer-events: auto;
    `;
    document.body.appendChild(clickBlocker);
  }
}

function enableBodyScroll() {
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  window.scrollTo(0, savedScrollTop);
  document.activeElement?.blur?.();
  document.body.offsetHeight;
  
  setTimeout(() => {
    if (clickBlocker?.parentNode) {
      clickBlocker.parentNode.removeChild(clickBlocker);
      clickBlocker = null;
    }
  }, 350);
}

// ========== LeanCloud 初始化 ==========
if (!AV.applicationId) {
  AV.init({ appId: LC_APP_ID, appKey: LC_APP_KEY, serverURL: LC_SERVER });
}
const Bill = AV.Object.extend('Bill');

// ========== 薪资计算 ==========
function getBaseWageByDate(dateStr) {
  return new Date(dateStr) >= new Date('2026-06-01') ? BASE_SALARY / 208 : 2700 / 208;
}

// ========== Toast 提示 ==========
function showToast(text, type = "normal", duration = 2200) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = text;
  toast.className = "toast";
  if (type === "success") toast.classList.add("success");
  if (type === "error") toast.classList.add("error");
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), duration);
}

// ========== 表单初始化 ==========
function initTimeSelect() {
  const shiftSelect = document.getElementById('record-shift');
  const shiftStart = document.getElementById('shift-start');
  const shiftEnd = document.getElementById('shift-end');
  const shiftStart2 = document.getElementById('shift-start2');
  const shiftEnd2 = document.getElementById('shift-end2');
  const mealStart = document.getElementById('meal-start');
  const workHoursTip = document.getElementById('work-hours-tip');
  const moneyInput = document.getElementById('record-money');
  const allowanceInput = document.getElementById('record-allowance');
  const dateInput = document.getElementById('record-date');

  if (!shiftSelect || !shiftStart || !shiftEnd || !shiftStart2 || !shiftEnd2 || !mealStart || !workHoursTip || !moneyInput || !allowanceInput || !dateInput) return;

  const allHours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
  const allOpts = allHours.map(h => `<option value="${h}">${h}</option>`).join('');
  const workOpts = allHours.filter(h => parseInt(h) >= 9).map(h => `<option value="${h}">${h}</option>`).join('');
  const defaultOpt = '<option value="">请选择</option>';

  shiftStart.innerHTML = defaultOpt + workOpts;
  shiftStart2.innerHTML = defaultOpt + workOpts;
  shiftEnd.innerHTML = shiftEnd2.innerHTML = mealStart.innerHTML = defaultOpt;
  shiftEnd.disabled = shiftEnd2.disabled = mealStart.disabled = true;

  ['normal-time-row', 'normal-end-row', 'part2-start-row', 'part2-end-row', 'meal-wrap'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });

  function setAllowanceByHour(hour) {
    const map = { 21: 15, 22: 20, 23: 25 };
    allowanceInput.value = map[hour] || 0;
  }

  function autoFillEnd(startEl, endEl) {
    if (!startEl.value) return;
    const endHour = (parseInt(startEl.value.split(':')[0]) + 9) % 24;
    endEl.value = `${String(endHour).padStart(2, '0')}:00`;
    setAllowanceByHour(endHour);
  }

  function calcWorkHours() {
    let total = 0;
    if (shiftStart.value && shiftEnd.value) {
      const s = parseInt(shiftStart.value.split(':')[0]);
      const e = parseInt(shiftEnd.value.split(':')[0]);
      if (e > s) total += e - s;
    }
    if (shiftSelect.value === '拼班' && shiftStart2.value && shiftEnd2.value) {
      const s2 = parseInt(shiftStart2.value.split(':')[0]);
      const e2 = parseInt(shiftEnd2.value.split(':')[0]);
      if (e2 > s2) total += e2 - s2;
    }
    if (shiftSelect.value !== '拼班' && mealStart.value) {
      total = Math.max(0, total - 1);
    }
    workHoursTip.textContent = `有效工时：${total} 小时`;
    const hourly = getBaseWageByDate(dateInput.value || formatDate(new Date()));
    moneyInput.value = (Math.round(total * hourly * 1000) / 1000).toFixed(2);
  }

  shiftSelect.addEventListener('change', () => {
    const val = shiftSelect.value;
    ['normal-time-row', 'normal-end-row', 'part2-start-row', 'part2-end-row', 'meal-wrap'].forEach(id => {
      document.getElementById(id)?.classList.add('hidden');
    });
    shiftEnd.disabled = shiftStart2.disabled = shiftEnd2.disabled = mealStart.disabled = true;

    if (val === '休息') {
      shiftStart.value = shiftStart2.value = mealStart.value = '';
      shiftEnd.innerHTML = shiftEnd2.innerHTML = defaultOpt;
      shiftEnd.disabled = shiftEnd2.disabled = mealStart.disabled = true;
      moneyInput.value = '';
      allowanceInput.value = 0;
      calcWorkHours();
      return;
    }

    if (['早班', '中班', '晚班'].includes(val)) {
      document.getElementById('normal-time-row')?.classList.remove('hidden');
      document.getElementById('normal-end-row')?.classList.remove('hidden');
      document.getElementById('meal-wrap')?.classList.remove('hidden');
      shiftEnd.disabled = !shiftStart.value;
      mealStart.disabled = !shiftEnd.value;
    }

    if (val === '拼班') {
      ['normal-time-row', 'normal-end-row', 'part2-start-row', 'part2-end-row'].forEach(id => {
        document.getElementById(id)?.classList.remove('hidden');
      });
      shiftEnd.disabled = !shiftStart.value;
      shiftStart2.disabled = false;
      shiftEnd2.disabled = !shiftStart2.value;
    }
    calcWorkHours();
  });

  shiftStart.addEventListener('change', () => {
    if (!shiftStart.value) {
      shiftEnd.innerHTML = mealStart.innerHTML = defaultOpt;
      shiftEnd.disabled = mealStart.disabled = true;
      calcWorkHours();
      return;
    }
    const startH = parseInt(shiftStart.value.split(':')[0]);
    const afterOpts = allHours.filter(h => parseInt(h.split(':')[0]) > startH).map(h => `<option value="${h}">${h}</option>`).join('');
    shiftEnd.innerHTML = defaultOpt + afterOpts;
    shiftEnd.disabled = false;
    mealStart.innerHTML = defaultOpt + afterOpts;
    autoFillEnd(shiftStart, shiftEnd);
    mealStart.disabled = !shiftEnd.value;
    calcWorkHours();
  });

  shiftEnd.addEventListener('change', () => {
    mealStart.disabled = !shiftEnd.value;
    setAllowanceByHour(parseInt(shiftEnd.value.split(':')[0]));
    calcWorkHours();
  });

  shiftStart2.addEventListener('change', () => {
    if (!shiftStart2.value) {
      shiftEnd2.innerHTML = defaultOpt;
      shiftEnd2.disabled = true;
      calcWorkHours();
      return;
    }
    const startH = parseInt(shiftStart2.value.split(':')[0]);
    const afterOpts = allHours.filter(h => parseInt(h.split(':')[0]) > startH).map(h => `<option value="${h}">${h}</option>`).join('');
    shiftEnd2.innerHTML = defaultOpt + afterOpts;
    shiftEnd2.disabled = false;
    autoFillEnd(shiftStart2, shiftEnd2);
    calcWorkHours();
  });

  shiftEnd2.addEventListener('change', () => {
    setAllowanceByHour(parseInt(shiftEnd2.value.split(':')[0]));
    calcWorkHours();
  });

  mealStart.addEventListener('change', calcWorkHours);
  window.calcWorkHours = calcWorkHours;
}

// ========== 数据加载 ==========
async function loadData(retryCount = 0, autoRender = true, showLoading = true, autoStopLoading = true) {
  if (isLoading) return null;
  isLoading = true;

  const wageBox = document.querySelector('.total-wage-box');
  const refreshBtn = document.getElementById('refresh-data-btn');

  if (showLoading && wageBox) {
    wageBox.classList.add('loading');
    refreshBtn?.classList.add('spinning');
  }

  try {
    const query = new AV.Query(Bill);
    query.descending('createdAt');
    query.limit(1000);
    const res = await query.find();
    
    allBillList = res;
    recordDates = new Set(res.map(i => i.get('date') || ''));

    if (autoRender) {
      renderData(res);
      renderUserCalendar();
      renderAdminCalendar();
      renderTotalAndStat();
    }
    return res;
  } catch (e) {
    if (retryCount < 3) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return await loadData(retryCount + 1, autoRender, false, autoStopLoading);
    }
    showToast('数据加载失败，请刷新', 'error');
    return null;
  } finally {
    isLoading = false;
    if (autoStopLoading && wageBox) {
      wageBox.classList.remove('loading');
      refreshBtn?.classList.remove('spinning');
    }
  }
}

// ========== 管理列表渲染 ==========
function buildCycleMap(list) {
  const map = {};
  list.forEach(item => {
    const dateStr = item.get('date') || '';
    if (!dateStr) return;
    const { cycleStart, cycleEnd } = getCycleRange(new Date(dateStr));
    const key = `${formatDate(cycleStart)} ~ ${formatDate(cycleEnd)}`;
    if (!map[key]) map[key] = [];
    map[key].push(item);
  });
  Object.values(map).forEach(arr => arr.sort((a, b) => new Date(b.get('date')) - new Date(a.get('date'))));
  return map;
}

function renderData(list) {
  const adminList = document.getElementById('admin-list');
  if (!adminList) return;
  adminList.innerHTML = '';
  if (!list.length) {
    adminList.innerHTML = '<div style="text-align:center;color:#8e8e93;padding:20px;">暂无记录</div>';
    return;
  }

  const cycleMap = buildCycleMap(list);
  Object.keys(cycleMap).sort().reverse().forEach(key => {
    const records = cycleMap[key];
    const group = document.createElement('div');
    group.className = 'cycle-group';
    group.innerHTML = `
      <div class="cycle-header" data-cycle="${key}">
        <span>${key}</span>
        <span style="color:#8e8e93;font-size:12px;">${records.length} 条记录</span>
      </div>
    `;
    group.querySelector('.cycle-header').addEventListener('click', () => {
      openAdminCycleDetailPopup(key, records);
    });
    adminList.appendChild(group);
  });
}

// ========== 表单清空 ==========
function clearForm() {
  ['record-date', 'record-shift', 'shift-start', 'shift-end', 'shift-start2', 'shift-end2', 'meal-start', 'record-allowance', 'record-money', 'record-remark', 'edit-id'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  selectedDate = '';
}

// ========== 日历渲染（合并重复逻辑） ==========
function renderCalendar(bodyId, titleId, isAdmin = false) {
  const calendarBody = document.getElementById(bodyId);
  const calendarTitle = document.getElementById(titleId);
  const currentCycleEl = document.getElementById('current-cycle');
  if (!calendarBody || !calendarTitle) return;

  const { cycleStart, cycleEnd } = getCycleRange(new Date(currentYear, currentMonth, 1));
  const displayText = `${formatDate(cycleStart)}~${formatDate(cycleEnd)}`;
  calendarTitle.innerText = displayText;
  if (!isAdmin && currentCycleEl) currentCycleEl.innerText = displayText;

  calendarBody.innerHTML = '';
  const days = [];
  const s = new Date(cycleStart);
  while (s <= cycleEnd) {
    days.push(new Date(s));
    s.setDate(s.getDate() + 1);
  }

  const firstDay = days[0].getDay();
  for (let i = 0; i < firstDay; i++) {
    const el = document.createElement('div');
    el.className = 'calendar-day other';
    calendarBody.appendChild(el);
  }

  days.forEach(date => {
    const dateStr = formatDate(date);
    const el = document.createElement('div');
    el.className = 'calendar-day';
    const record = allBillList.find(item => item.get('date') === dateStr);
    if (record) {
      const shift = record.get('shift') || '';
      el.classList.add(shift === '休息' ? 'rest' : 'has-record');
      el.innerHTML = `${date.getDate()}<div class="shift-tag">${shift}</div>`;
    } else {
      el.textContent = date.getDate();
    }

    if (selectedDate === dateStr) el.classList.add('selected');
    el.addEventListener('click', () => {
      selectedDate = dateStr;
      if (isAdmin) {
        const dateInput = document.getElementById('record-date');
        if (dateInput) dateInput.value = dateStr;
      }
      renderUserCalendar();
      renderAdminCalendar();
    });
    calendarBody.appendChild(el);
  });
}

function renderUserCalendar() { renderCalendar('calendar-body', 'calendar-title', false); }
function renderAdminCalendar() { renderCalendar('admin-calendar-body', 'admin-calendar-title', true); }

// ========== 统计与进度更新 ==========
function renderTotalAndStat() {
  const totalWageNum = document.getElementById('total-wage-num');
  if (!totalWageNum) return;

  const statIds = ['stat-work-hours', 'stat-work-days', 'stat-21h-days', 'stat-22h-days', 'stat-23h-days', 'stat-base-money', 'stat-allowance'];
  const statEls = {};
  statIds.forEach(id => statEls[id] = document.getElementById(id));
  const cycleGroupList = document.getElementById('cycle-group-list');

  const { cycleStart, cycleEnd } = getCycleRange();
  const startStr = formatDate(cycleStart);
  const endStr = formatDate(cycleEnd);
  const currentList = allBillList.filter(item => {
    const d = item.get('date') || '';
    return d >= startStr && d <= endStr;
  });

  let totalWage = 0, totalHours = 0, workDays = 0;
  let day21 = 0, day22 = 0, day23 = 0, totalBase = 0, totalAllow = 0;

  currentList.forEach(item => {
    const shift = item.get('shift') || '';
    if (shift === '休息') return;
    const money = safeNum(item.get('money'));
    const allow = safeNum(item.get('allowance'));
    const sEnd = item.get('shiftEnd') || '';
    const mStart = item.get('mealStart') || '';

    workDays++;
    totalBase += money;
    totalAllow += allow;

    let h = 0;
    const s = safeNum((item.get('shiftStart') || '00:00').split(':')[0]);
    const e = safeNum((sEnd || '00:00').split(':')[0]);
    if (e > s) h += e - s;

    if (shift === '拼班') {
      const s2 = safeNum((item.get('shiftStart2') || '00:00').split(':')[0]);
      const e2 = safeNum((item.get('shiftEnd2') || '00:00').split(':')[0]);
      if (e2 > s2) h += e2 - s2;
    }
    if (shift !== '拼班' && mStart) h = Math.max(0, h - 1);

    totalHours += h;
    const hourly = getBaseWageByDate(item.get('date'));
    const wage = Math.round(h * hourly * 1000) / 1000;
    totalWage += Math.round((wage + allow) * 1000) / 1000;

    const endHour = safeNum(sEnd.split(':')[0]);
    if (endHour === 21) day21++;
    if (endHour === 22) day22++;
    if (endHour === 23) day23++;
  });

  totalWageNum.innerText = totalWage.toFixed(2);
  if (statEls['stat-work-hours']) statEls['stat-work-hours'].innerText = totalHours.toFixed(1) + ' 小时';
  if (statEls['stat-work-days']) statEls['stat-work-days'].innerText = workDays + ' 天';
  if (statEls['stat-21h-days']) statEls['stat-21h-days'].innerText = day21 + ' 天';
  if (statEls['stat-22h-days']) statEls['stat-22h-days'].innerText = day22 + ' 天';
  if (statEls['stat-23h-days']) statEls['stat-23h-days'].innerText = day23 + ' 天';
  if (statEls['stat-base-money']) statEls['stat-base-money'].innerText = '¥' + totalBase.toFixed(2);
  if (statEls['stat-allowance']) statEls['stat-allowance'].innerText = '¥' + totalAllow.toFixed(2);

  // 更新进度条
  const progressText = document.getElementById('progress-text');
  const progressCircle = document.getElementById('bottom-progress');
  if (progressText && progressCircle) {
    const percent = calcWagePercent(totalWageNum.textContent);
    currentProgress = percent;
    progressCircle.style.setProperty('--progress', 0);
    progressText.textContent = '0%';
    animateProgress(percent);

    const miniCircle = document.getElementById('top-progress');
    const miniText = document.getElementById('cycle-progress-text');
    if (miniCircle && miniText) {
      miniCircle.style.setProperty('--mini-progress', 0);
      miniText.textContent = '0%';
      animateMiniProgress(calculateCycleProgress());
    }
  }

  // 历史周期列表
  if (cycleGroupList) {
    cycleGroupList.innerHTML = '';
    const cycleMap = buildCycleMap(allBillList);
    Object.keys(cycleMap).sort().reverse().forEach(key => {
      const records = cycleMap[key];
      const group = document.createElement('div');
      group.className = 'cycle-group';
      group.innerHTML = `
        <div class="cycle-header" data-cycle="${key}">
          <span>${key}</span>
          <span style="color:#8e8e93;font-size:12px;">${records.length} 条记录</span>
        </div>
      `;
      group.querySelector('.cycle-header').addEventListener('click', () => {
        openCycleDetailPopup(key, records);
      });
      cycleGroupList.appendChild(group);
    });
  }
}

// ========== 周期详情弹窗（合并公共逻辑） ==========
function buildDetailList(listEl, records, showActions = false) {
  const calcBtn = document.createElement('button');
  calcBtn.innerText = '查看本期总工资';
  calcBtn.className = 'cycle-calc-btn';
  calcBtn.onclick = function (e) {
    e.stopPropagation();
    e.preventDefault();
    this.blur();

    let totalHours = 0, totalBase = 0, totalAllow = 0, totalWage = 0, workDays = 0;
    records.forEach(item => {
      const shift = item.get('shift') || '';
      if (shift === '休息') return;
      workDays++;
      const allow = safeNum(item.get('allowance'));
      totalAllow += allow;

      let h = 0;
      const s = safeNum((item.get('shiftStart') || '00:00').split(':')[0]);
      const e = safeNum((item.get('shiftEnd') || '00:00').split(':')[0]);
      if (e > s) h += e - s;

      if (shift === '拼班') {
        const s2 = safeNum((item.get('shiftStart2') || '00:00').split(':')[0]);
        const e2 = safeNum((item.get('shiftEnd2') || '00:00').split(':')[0]);
        if (e2 > s2) h += e2 - s2;
      }
      if (shift !== '拼班' && item.get('mealStart')) h = Math.max(0, h - 1);
      totalHours += h;

      const daily = Math.round(h * getBaseWageByDate(item.get('date')) * 1000) / 1000;
      totalBase += daily;
      totalWage += Math.round((daily + allow) * 1000) / 1000;
    });

    document.getElementById('cycle-total-title').innerText = `${listEl.dataset.cycle} 工资统计`;
    document.getElementById('cycle-total-info').innerHTML = `
      出勤天数：${workDays} 天<br>
      总工时：${totalHours.toFixed(2)} 小时<br>
      总基本工资：¥${totalBase.toFixed(2)}<br>
      总加班补贴：¥${totalAllow.toFixed(2)}<br>
      <hr style="margin:8px 0;border:1px solid rgba(0,0,0,0.1);">
      <strong>本期总工资：¥${totalWage.toFixed(2)}</strong>
    `;
    document.getElementById('cycle-total-overlay').classList.add('show');
    disableBodyScroll();
  };
  listEl.appendChild(calcBtn);

  records.forEach(item => {
    const date = item.get('date') || '';
    const time = new Date(item.createdAt);
    const timeStr = `${date} ${String(time.getHours()).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}:${String(time.getSeconds()).padStart(2,'0')}`;
    const shift = item.get('shift') || '';
    const s1 = item.get('shiftStart') || '';
    const e1 = item.get('shiftEnd') || '';
    const s2 = item.get('shiftStart2') || '';
    const e2 = item.get('shiftEnd2') || '';
    const meal = item.get('mealStart') || '';
    const money = safeNum(item.get('money'));
    const allow = safeNum(item.get('allowance'));
    const remark = item.get('title') || '无';

    let timeInfo = shift === '拼班'
      ? `${s1 && e1 ? s1+'-'+e1 : '未设置'} / ${s2 && e2 ? s2+'-'+e2 : '未设置'}`
      : `${s1}-${e1}`;

    let mealLine = '';
    if (meal) {
      const [h, m] = meal.split(':').map(Number);
      mealLine = `<div class="info-line">饭点：${meal}-${String(h+1).padStart(2,'0')}:${String(m).padStart(2,'0')}</div>`;
    }

    const itemEl = document.createElement('div');
    itemEl.className = 'cycle-detail-item';
    itemEl.innerHTML = `
      <span class="date-text">${timeStr}</span>
      <div class="info-line">班次：${shift} | 时间：${timeInfo}</div>
      ${mealLine}
      <div class="info-line">当日工资：<span class="money">¥${(money + allow).toFixed(2)}</span> | 备注：${remark}</div>
      ${showActions ? `
        <div class="item-op" style="margin-top:12px;gap:12px;">
          <button class="btn-sm btn-edit" 
            data-id="${item.id}" data-date="${date}" data-shift="${shift}"
            data-shift-start="${s1}" data-shift-end="${e1}"
            data-shift-start2="${s2}" data-shift-end2="${e2}"
            data-meal-start="${meal}" data-allowance="${allow}"
            data-money="${money}" data-remark="${remark}"
          >编辑</button>
          <button class="btn-sm btn-del" data-id="${item.id}">删除</button>
        </div>
      ` : ''}
    `;
    listEl.appendChild(itemEl);
  });
}

function openCycleDetailPopup(cycleKey, records) {
  const title = document.getElementById('cycle-detail-title');
  const list = document.getElementById('cycle-detail-record-list');
  const overlay = document.getElementById('cycle-detail-overlay');
  if (!title || !list || !overlay) return;

  title.innerText = cycleKey;
  list.dataset.cycle = cycleKey;
  list.innerHTML = '';
  buildDetailList(list, records, false);

  overlay.classList.add('show');
  disableBodyScroll();
}

function openAdminCycleDetailPopup(cycleKey, records) {
  const title = document.getElementById('cycle-detail-title');
  const list = document.getElementById('cycle-detail-record-list');
  const overlay = document.getElementById('cycle-detail-overlay');
  if (!title || !list || !overlay) return;

  title.innerText = cycleKey;
  list.dataset.cycle = cycleKey;
  list.innerHTML = '';
  buildDetailList(list, records, true);

  overlay.classList.add('show');
  disableBodyScroll();
}

// ========== 页面初始化 ==========
document.addEventListener('DOMContentLoaded', function () {
  // 编辑/删除事件委托
  const recordList = document.getElementById('cycle-detail-record-list');
  if (recordList) {
    recordList.addEventListener('click', function(e) {
      const editBtn = e.target.closest('.btn-edit');
      if (editBtn) {
        e.stopPropagation();
        e.preventDefault();
        editBtn.blur();

        document.getElementById('cycle-detail-overlay')?.classList.remove('show');
        enableBodyScroll();

        const fields = {
          'record-date': 'date', 'record-shift': 'shift',
          'shift-start': 'shiftStart', 'shift-end': 'shiftEnd',
          'shift-start2': 'shiftStart2', 'shift-end2': 'shiftEnd2',
          'meal-start': 'mealStart', 'record-allowance': 'allowance',
          'record-money': 'money', 'record-remark': 'remark', 'edit-id': 'id'
        };
        Object.entries(fields).forEach(([elId, dataKey]) => {
          const el = document.getElementById(elId);
          if (el) el.value = editBtn.dataset[dataKey];
        });

        document.getElementById('record-shift')?.dispatchEvent(new Event('change'));
        window.calcWorkHours?.();
        selectedDate = editBtn.dataset.date;
        renderUserCalendar();
        renderAdminCalendar();

        showToast('已进入编辑模式，修改完成后点击保存即可', 'success');
        document.getElementById('record-shift')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      const delBtn = e.target.closest('.btn-del');
      if (delBtn) {
        e.stopPropagation();
        e.preventDefault();
        delBtn.blur();
        if (!confirm('确定删除该条记录？')) return;

        AV.Object.createWithoutData('Bill', delBtn.dataset.id).destroy()
          .then(() => {
            loadData();
            showToast('删除成功', 'success');
            document.getElementById('cycle-detail-overlay')?.classList.remove('show');
            enableBodyScroll();
          })
          .catch(() => showToast('删除失败', 'error'));
      }
    });
  }

  // 登录相关
  const adminEntrance = document.getElementById('admin-entrance');
  const loginOverlay = document.getElementById('login-overlay');
  const adminPwdInput = document.getElementById('admin-pwd-input');
  const loginCancel = document.getElementById('login-cancel');
  const loginConfirm = document.getElementById('login-confirm');
  const userView = document.getElementById('user-view');
  const adminView = document.getElementById('admin-view');
  const backUserBtn = document.getElementById('back-user');
  const saveBtn = document.getElementById('save-btn');

  adminEntrance?.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    this.blur();
    loginOverlay?.classList.add('show');
    if (adminPwdInput) {
      adminPwdInput.value = '';
      adminPwdInput.focus();
    }
    disableBodyScroll();
  });

  loginCancel?.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    this.blur();
    loginOverlay?.classList.remove('show');
    enableBodyScroll();
  });

  function doLogin() {
    const pwd = adminPwdInput?.value.trim();
    if (pwd === 'admin123') {
      localStorage.setItem('isAdminLoggedIn', 'true');
      loginOverlay?.classList.remove('show');
      enableBodyScroll();
      document.body.classList.add('admin-active');
      userView?.classList.add('hidden');
      adminView?.classList.remove('hidden');
      adminEntrance?.classList.add('hidden');
      const dateInput = document.getElementById('record-date');
      if (dateInput) dateInput.value = formatDate(new Date());
      setTimeout(() => loadData(), 300);
    } else {
      showToast('密码错误', 'error');
    }
  }

  loginConfirm?.addEventListener('click', doLogin);
  adminPwdInput?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  backUserBtn?.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    this.blur();
    localStorage.removeItem('isAdminLoggedIn');
    document.body.classList.remove('admin-active');
    adminView?.classList.add('hidden');
    userView?.classList.remove('hidden');
    adminEntrance?.classList.remove('hidden');
    clearForm();
    renderTotalAndStat();
    renderUserCalendar();
    showToast('已返回用户页面', 'success');
  });

  saveBtn?.addEventListener('click', async function (e) {
    e.stopPropagation();
    e.preventDefault();
    this.blur();

    const date = document.getElementById('record-date')?.value.trim();
    const shift = document.getElementById('record-shift')?.value;
    if (!date || !shift) {
      showToast('请选择日期和班次', 'error');
      return;
    }

    const data = {
      date, shift,
      shiftStart: document.getElementById('shift-start')?.value,
      shiftEnd: document.getElementById('shift-end')?.value,
      shiftStart2: document.getElementById('shift-start2')?.value,
      shiftEnd2: document.getElementById('shift-end2')?.value,
      mealStart: document.getElementById('meal-start')?.value,
      money: safeNum(document.getElementById('record-money')?.value),
      allowance: safeNum(document.getElementById('record-allowance')?.value),
      title: document.getElementById('record-remark')?.value.trim()
    };
    const editId = document.getElementById('edit-id')?.value.trim();

    try {
      if (editId) {
        const obj = AV.Object.createWithoutData('Bill', editId);
        Object.entries(data).forEach(([k, v]) => obj.set(k, v));
        await obj.save();
        showToast('修改成功', 'success');
      } else {
        const bill = new Bill();
        Object.entries(data).forEach(([k, v]) => bill.set(k, v));
        await bill.save();
        showToast('保存成功', 'success');
      }
      clearForm();
      loadData();
    } catch (err) {
      showToast('保存失败', 'error');
    }
  });

  // 日历翻页
  document.getElementById('prev-month-btn')?.addEventListener('click', () => {
    currentMonth--;
    renderUserCalendar();
  });
  document.getElementById('next-month-btn')?.addEventListener('click', () => {
    currentMonth++;
    renderUserCalendar();
  });
  document.getElementById('admin-prev-month-btn')?.addEventListener('click', () => {
    currentMonth--;
    renderAdminCalendar();
  });
  document.getElementById('admin-next-month-btn')?.addEventListener('click', () => {
    currentMonth++;
    renderAdminCalendar();
  });

  // 详情弹窗
  const detailOverlay = document.getElementById('detail-overlay');
  document.getElementById('detail-btn')?.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    this.blur();
    renderTotalAndStat();
    detailOverlay?.classList.add('show');
    disableBodyScroll();
  });
  document.getElementById('detail-close')?.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    this.blur();
    detailOverlay?.classList.remove('show');
    enableBodyScroll();
  });

  const cycleDetailOverlay = document.getElementById('cycle-detail-overlay');
  document.getElementById('cycle-detail-close')?.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    this.blur();
    cycleDetailOverlay?.classList.remove('show');
    enableBodyScroll();
  });

  const cycleTotalOverlay = document.getElementById('cycle-total-overlay');
  document.getElementById('cycle-total-close')?.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    this.blur();
    cycleTotalOverlay?.classList.remove('show');
    enableBodyScroll();
  });

  // 遮罩点击关闭 + 移动端滚动修复
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
      if (e.target === this) {
        this.classList.remove('show');
        enableBodyScroll();
      }
    });
    overlay.addEventListener('touchmove', function(e) {
      if (e.target === this) e.preventDefault();
    }, { passive: false });
  });

  // 刷新按钮
  document.getElementById('refresh-data-btn')?.addEventListener('click', async function (e) {
    e.stopPropagation();
    e.preventDefault();
    this.blur();

    if (this.classList.contains('spinning') || isLoading) return;
    const wageBox = document.querySelector('.total-wage-box');

    try {
      wageBox?.classList.add('loading');
      this.classList.add('spinning');

      const rollback = new Promise(resolve => {
        animateProgress(0);
        animateMiniProgress(0);
        setTimeout(resolve, 1000);
      });
      await rollback;

      const data = await loadData(0, false, false, false);
      if (data) {
        renderData(data);
        renderUserCalendar();
        renderAdminCalendar();
        renderTotalAndStat();
        showToast('数据刷新成功', 'success');
      } else {
        showToast('数据加载失败，请重试', 'error');
      }
    } catch (err) {
      showToast('刷新失败，请重试', 'error');
      console.error('刷新异常：', err);
    } finally {
      wageBox?.classList.remove('loading');
      this.classList.remove('spinning');
    }
  });

  // 初始化登录状态
  const isAdmin = localStorage.getItem('isAdminLoggedIn') === 'true';
  const todayStr = formatDate(new Date());
  selectedDate = todayStr;

  if (isAdmin) {
    document.body.classList.add('admin-active');
    userView?.classList.add('hidden');
    adminView?.classList.remove('hidden');
    adminEntrance?.classList.add('hidden');
    const dateInput = document.getElementById('record-date');
    if (dateInput) dateInput.value = todayStr;
    loadData();
  } else {
    document.body.classList.remove('admin-active');
    userView?.classList.remove('hidden');
    adminView?.classList.add('hidden');
    adminEntrance?.classList.remove('hidden');
    loadData().then(() => renderUserCalendar());
    initTopMiniCards();
  }

  initTimeSelect();
});
