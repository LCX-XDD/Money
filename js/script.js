// ========== 禁止/恢复页面滚动 ==========
let savedScrollTop = 0;
let clickBlocker = null;
let currentProgress = 0; // 保存当前进度百分比
let currentMiniProgress = 0; // 顶部小圆进度条变量
let progressTimer = null;
let miniProgressTimer = null;


// 底部悬赏金进度条动画
function animateProgress(targetPercent) {
  const progressCircle = document.getElementById('bottom-progress');
  const progressText = document.getElementById('progress-text');
  if (!progressCircle || !progressText) return;

  // 先清除上一个动画定时器，彻底杜绝多动画叠加
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }

  // 强制数值合法化：非数字→0，严格限制在0-100
  targetPercent = Number(targetPercent);
  if (isNaN(targetPercent)) targetPercent = 0;
  targetPercent = Math.max(0, Math.min(100, targetPercent));

  // 当前值同样合法化
  let current = parseInt(progressCircle.style.getPropertyValue('--progress'));
  if (isNaN(current)) current = 0;
  current = Math.max(0, Math.min(100, current));

  const step = targetPercent > current ? 1 : -1;

  progressTimer = setInterval(() => {
    current += step;
    // 每一步都强制边界，绝对不会出现负数
    current = Math.max(0, Math.min(100, current));

    progressCircle.style.setProperty('--progress', current);
    progressText.textContent = `${current}%`;

    if (current === targetPercent) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }, 10);
}


// 顶部抓猪进度条动画
function animateMiniProgress(targetPercent) {
  const miniCircle = document.getElementById('top-progress');
  const miniText = document.getElementById('cycle-progress-text');
  if (!miniCircle || !miniText) return;

  if (miniProgressTimer) {
    clearInterval(miniProgressTimer);
    miniProgressTimer = null;
  }

  targetPercent = Number(targetPercent);
  if (isNaN(targetPercent)) targetPercent = 0;
  targetPercent = Math.max(0, Math.min(100, targetPercent));

  let current = parseInt(miniCircle.style.getPropertyValue('--mini-progress'));
  if (isNaN(current)) current = 0;
  current = Math.max(0, Math.min(100, current));

  const step = targetPercent > current ? 1 : -1;

  miniProgressTimer = setInterval(() => {
    current += step;
    current = Math.max(0, Math.min(100, current));

    miniCircle.style.setProperty('--mini-progress', current);
    miniText.textContent = `${current}%`;

    if (current === targetPercent) {
      clearInterval(miniProgressTimer);
      miniProgressTimer = null;
    }
  }, 10);
}

// 计算周期进度百分比（26号~次月25号）
function calculateCycleProgress() {
  const now = new Date();
  let cycleStart, cycleEnd;

  if (now.getDate() >= 26) {
    cycleStart = new Date(now.getFullYear(), now.getMonth(), 26);
    cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, 25);
  } else {
    cycleStart = new Date(now.getFullYear(), now.getMonth() - 1, 26);
    cycleEnd = new Date(now.getFullYear(), now.getMonth(), 25);
  }

  const totalMs = cycleEnd - cycleStart;
  const passedMs = now - cycleStart;
  const percent = Math.min(Math.round((passedMs / totalMs) * 100), 100);
  return percent;
}


// 初始化顶部周期进度条
function initTopMiniCards() {
  const miniCircle = document.querySelector('.progress-circle.mini-progress');
  const miniText = document.getElementById('cycle-progress-text');
  const progressCircle = document.querySelector('.progress-window:not(.top-progress-window) .progress-circle');
  const progressText = document.getElementById('progress-text');

  // 先重置两个进度条为 0
  if(miniCircle) miniCircle.style.setProperty('--mini-progress', 0);
  if(miniText) miniText.textContent = '0%';
  if(progressCircle) progressCircle.style.setProperty('--progress', 0);
  if(progressText) progressText.textContent = '0%';

  // 延迟统一入场动画
  setTimeout(() => {
    const cyclePercent = calculateCycleProgress();
    currentMiniProgress = cyclePercent;
    animateMiniProgress(cyclePercent);

    const totalWageNum = document.getElementById('total-wage-num');
    let wagePercent = 0;
    if(totalWageNum){
      const totalWage = parseFloat(totalWageNum.textContent) || 0;
      wagePercent = Math.max(0, Math.min(Math.round(totalWage / 2900 * 100), 100));
    }
    animateProgress(wagePercent);
  }, 200);
}



function disableBodyScroll() {
  savedScrollTop = window.pageYOffset || document.documentElement.scrollTop;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${savedScrollTop}px`;
  document.body.style.width = '100%';
  
  if (!clickBlocker) {
    clickBlocker = document.createElement('div');
    clickBlocker.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 9998;
      background: transparent;
      pointer-events: auto;
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
    if (clickBlocker && clickBlocker.parentNode) {
      clickBlocker.parentNode.removeChild(clickBlocker);
      clickBlocker = null;
    }
  }, 350);
}

const LC_APP_ID = "PkkbpTxYiRWgHbA8h0noWSwh-gzGzoHsz";
const LC_APP_KEY = "suQbFb5BnNKjjSIEPlxfr7BW";
const LC_SERVER = "https://pkkbptxy.lc-cn-n1-shared.com";

if (!AV.applicationId) {
  AV.init({
    appId: LC_APP_ID,
    appKey: LC_APP_KEY,
    serverURL: LC_SERVER
  });
}

const Bill = AV.Object.extend('Bill');

// 分阶段底薪自动计算
function getBaseWageByDate(dateStr) {
  const date = new Date(dateStr);
  if (date >= new Date('2026-06-01')) {
    return 2900 / 208;
  }
  return 2700 / 208;
}

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let recordDates = new Set();
let selectedDate = '';
let allBillList = [];

// ========== Toast ==========
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

// ========== 日期格式化 ==========
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ========== 初始化时间选择器 ==========
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

  const allHours = [];
  for (let i = 0; i < 24; i++) allHours.push(`${String(i).padStart(2, '0')}:00`);
  const allOpts = allHours.map(h => `<option value="${h}">${h}</option>`).join('');
  const workHours = allHours.filter(h => parseInt(h) >= 9);
  const workOpts = workHours.map(h => `<option value="${h}">${h}</option>`).join('');
  const defaultOpt = '<option value="">请选择</option>';

  shiftStart.innerHTML = defaultOpt + workOpts;
  shiftStart2.innerHTML = defaultOpt + workOpts;
  shiftEnd.innerHTML = defaultOpt;
  shiftEnd2.innerHTML = defaultOpt;
  mealStart.innerHTML = defaultOpt;

  shiftEnd.disabled = true;
  shiftEnd2.disabled = true;
  mealStart.disabled = true;

  document.getElementById('normal-time-row').classList.add('hidden');
  document.getElementById('normal-end-row').classList.add('hidden');
  document.getElementById('part2-start-row').classList.add('hidden');
  document.getElementById('part2-end-row').classList.add('hidden');
  document.getElementById('meal-wrap').classList.add('hidden');

  function updateMealStartState() {
    mealStart.disabled = !shiftEnd.value;
  }

  function autoFillEndAndAllowance(startEl, endEl) {
    if (!startEl.value) return;
    const startHour = parseInt(startEl.value.split(':')[0]);
    const endHour = (startHour + 9) % 24;
    endEl.value = `${String(endHour).padStart(2, '0')}:00`;
    setAllowanceByEndHour(endHour);
  }

  function updateAllowanceByEndTime(endEl) {
    if (!endEl.value) return;
    const endHour = parseInt(endEl.value.split(':')[0]);
    setAllowanceByEndHour(endHour);
  }

  function setAllowanceByEndHour(endHour) {
    if (endHour === 21) allowanceInput.value = 15;
    else if (endHour === 22) allowanceInput.value = 20;
    else if (endHour === 23) allowanceInput.value = 25;
    else allowanceInput.value = 0;
  }

  function calcWorkHours() {
    let totalHour = 0;

    if (shiftStart.value && shiftEnd.value) {
      let s = parseInt(shiftStart.value.split(':')[0]);
      let e = parseInt(shiftEnd.value.split(':')[0]);
      if (e > s) totalHour += e - s;
    }

    if (shiftSelect.value === '拼班' && shiftStart2.value && shiftEnd2.value) {
      let s2 = parseInt(shiftStart2.value.split(':')[0]);
      let e2 = parseInt(shiftEnd2.value.split(':')[0]);
      if (e2 > s2) totalHour += e2 - s2;
    }

    if (shiftSelect.value !== '拼班' && mealStart.value) {
      totalHour = Math.max(0, totalHour - 1);
    }

    workHoursTip.textContent = `有效工时：${totalHour} 小时`;

    const currentDate = dateInput.value || formatDate(new Date());
    const HOURLY_WAGE = getBaseWageByDate(currentDate);
    const dailyWage = Math.round(totalHour * HOURLY_WAGE * 1000) / 1000;
    moneyInput.value = dailyWage.toFixed(2);
  }

  shiftSelect.addEventListener('change', () => {
    const val = shiftSelect.value;

    document.getElementById('normal-time-row').classList.add('hidden');
    document.getElementById('normal-end-row').classList.add('hidden');
    document.getElementById('part2-start-row').classList.add('hidden');
    document.getElementById('part2-end-row').classList.add('hidden');
    document.getElementById('meal-wrap').classList.add('hidden');

    shiftEnd.disabled = true;
    shiftStart2.disabled = true;
    shiftEnd2.disabled = true;
    mealStart.disabled = true;

    if (val === '休息') {
      shiftStart.value = '';
      shiftEnd.innerHTML = defaultOpt; shiftEnd.disabled = true;
      shiftStart2.value = '';
      shiftEnd2.innerHTML = defaultOpt; shiftEnd2.disabled = true;
      mealStart.value = ''; mealStart.disabled = true;
      moneyInput.value = '';
      allowanceInput.value = 0;
      calcWorkHours();
      return;
    }

    if (val === '早班' || val === '中班' || val === '晚班') {
      document.getElementById('normal-time-row').classList.remove('hidden');
      document.getElementById('normal-end-row').classList.remove('hidden');
      document.getElementById('meal-wrap').classList.remove('hidden');
      
      shiftEnd.disabled = !shiftStart.value;
      mealStart.disabled = !shiftEnd.value;
    }

    if (val === '拼班') {
      document.getElementById('normal-time-row').classList.remove('hidden');
      document.getElementById('normal-end-row').classList.remove('hidden');
      document.getElementById('part2-start-row').classList.remove('hidden');
      document.getElementById('part2-end-row').classList.remove('hidden');
      
      shiftEnd.disabled = !shiftStart.value;
      shiftStart2.disabled = false;
      shiftEnd2.disabled = !shiftStart2.value;
    }

    calcWorkHours();
  });

  shiftStart.addEventListener('change', () => {
    if (!shiftStart.value) {
      shiftEnd.innerHTML = defaultOpt;
      shiftEnd.disabled = true;

      mealStart.innerHTML = defaultOpt;
      mealStart.disabled = true;

      calcWorkHours();
      return;
    }
    const startH = parseInt(shiftStart.value.split(':')[0]);
    const afterOpts = allHours.filter(h => parseInt(h.split(':')[0]) > startH)
                                .map(h => `<option value="${h}">${h}</option>`).join('');
    shiftEnd.innerHTML = defaultOpt + afterOpts;
    shiftEnd.disabled = false;

    mealStart.innerHTML = defaultOpt + afterOpts;
    autoFillEndAndAllowance(shiftStart, shiftEnd);
    updateMealStartState();
    calcWorkHours();
  });

  shiftEnd.addEventListener('change', () => {
    updateMealStartState();
    updateAllowanceByEndTime(shiftEnd);
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
    const afterOpts = allHours.filter(h => parseInt(h.split(':')[0]) > startH)
                                .map(h => `<option value="${h}">${h}</option>`).join('');
    shiftEnd2.innerHTML = defaultOpt + afterOpts;
    shiftEnd2.disabled = false;
    autoFillEndAndAllowance(shiftStart2, shiftEnd2);
    calcWorkHours();
  });

  shiftEnd2.addEventListener('change', () => {
    updateAllowanceByEndTime(shiftEnd2);
    calcWorkHours();
  });

  mealStart.addEventListener('change', calcWorkHours);
  window.calcWorkHours = calcWorkHours;
}

// 防重复请求 + 自动重试
// ✅ 优化后的加载函数：支持手动控制动画停止
// 防重复请求 + 自动重试
let isLoading = false;
async function loadData(retryCount = 0, autoRender = true, showLoading = true, autoStopLoading = true) {
  if (isLoading) return null;
  isLoading = true;

  const wageBox = document.querySelector('.total-wage-box');
  const refreshBtn = document.getElementById('refresh-data-btn');

  if (showLoading && wageBox) {
    wageBox.classList.add('loading');
    if (refreshBtn) refreshBtn.classList.add('spinning');
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
    // 修复：重试时用await等待结果，确保Promise完整执行
    if (retryCount < 3) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const retryResult = await loadData(retryCount + 1, autoRender, false, autoStopLoading);
      return retryResult;
    }
    showToast('数据加载失败，请刷新', 'error');
    return null;
  } finally {
    if (autoStopLoading) {
      isLoading = false;
      if (wageBox) wageBox.classList.remove('loading');
      if (refreshBtn) refreshBtn.classList.remove('spinning');
    }
  }
}

function renderData(list) {
  const adminList = document.getElementById('admin-list');
  if (!adminList) return;
  adminList.innerHTML = '';
  if (!list.length) {
    adminList.innerHTML = '<div style="text-align:center;color:#8e8e93;padding:20px;">暂无记录</div>';
    return;
  }

  const cycleMap = {};
  list.forEach(item => {
    const dateStr = item.get('date') || '';
    if (!dateStr) return;
    const d = new Date(dateStr);
    let cStart, cEnd;
    if (d.getDate() >= 26) {
      cStart = new Date(d.getFullYear(), d.getMonth(), 26);
      cEnd = new Date(d.getFullYear(), d.getMonth() + 1, 25);
    } else {
      cStart = new Date(d.getFullYear(), d.getMonth() - 1, 26);
      cEnd = new Date(d.getFullYear(), d.getMonth(), 25);
    }
    const cycleKey = `${formatDate(cStart)} ~ ${formatDate(cEnd)}`;
    if (!cycleMap[cycleKey]) cycleMap[cycleKey] = [];
    cycleMap[cycleKey].push(item);
  });

  Object.values(cycleMap).forEach(records => {
    records.sort((a,b) => new Date(b.get('date')) - new Date(a.get('date')));
  });

  Object.keys(cycleMap).sort().reverse().forEach(cycleKey => {
    const records = cycleMap[cycleKey];
    const group = document.createElement('div');
    group.className = 'cycle-group';
    group.innerHTML = `
      <div class="cycle-header" data-cycle="${cycleKey}">
        <span>${cycleKey}</span>
        <span style="color:#8e8e93;font-size:12px;">${records.length} 条记录</span>
      </div>
    `;
    adminList.appendChild(group);

    group.querySelector('.cycle-header').addEventListener('click', () => {
      openAdminCycleDetailPopup(cycleKey, records);
    });
  });
}

function clearForm() {
  const dateInput = document.getElementById('record-date');
  const shiftSelect = document.getElementById('record-shift');
  const shiftStart = document.getElementById('shift-start');
  const shiftEnd = document.getElementById('shift-end');
  const shiftStart2 = document.getElementById('shift-start2');
  const shiftEnd2 = document.getElementById('shift-end2');
  const mealStart = document.getElementById('meal-start');
  const allowanceInput = document.getElementById('record-allowance');
  const moneyInput = document.getElementById('record-money');
  const remarkInput = document.getElementById('record-remark');
  const editId = document.getElementById('edit-id');

  if (dateInput) dateInput.value = '';
  if (shiftSelect) shiftSelect.value = '';
  if (shiftStart) shiftStart.value = '';
  if (shiftEnd) shiftEnd.value = '';
  if (shiftStart2) shiftStart2.value = '';
  if (shiftEnd2) shiftEnd2.value = '';
  if (mealStart) mealStart.value = '';
  if (allowanceInput) allowanceInput.value = '';
  if (moneyInput) moneyInput.value = '';
  if (remarkInput) remarkInput.value = '';
  if (editId) editId.value = '';
  selectedDate = '';
}

// 渲染用户页面日历
function renderUserCalendar() {
  const calendarBody = document.getElementById('calendar-body');
  const calendarTitle = document.getElementById('calendar-title');
  const currentCycle = document.getElementById('current-cycle');
  
  if (!calendarBody || !calendarTitle || !currentCycle) return;

  const today = new Date();
  let cycleStart, cycleEnd;

  if (today.getDate() >= 26) {
    cycleStart = new Date(currentYear, currentMonth, 26);
    cycleEnd = new Date(currentYear, currentMonth + 1, 25);
  } else {
    cycleStart = new Date(currentYear, currentMonth - 1, 26);
    cycleEnd = new Date(currentYear, currentMonth, 25);
  }

  const startStr = formatDate(cycleStart);
  const endStr = formatDate(cycleEnd);
  const cycleDisplayText = startStr + '~' + endStr;

  calendarTitle.innerText = cycleDisplayText;
  currentCycle.innerText = cycleDisplayText;

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
      if (shift === '休息') {
        el.classList.add('rest');
      } else {
        el.classList.add('has-record');
      }
      el.innerHTML = `${date.getDate()}<div class="shift-tag">${shift}</div>`;
    } else {
      el.textContent = date.getDate();
    }

    if (selectedDate === dateStr) el.classList.add('selected');
    el.addEventListener('click', () => {
      selectedDate = dateStr;
      renderUserCalendar();
      renderAdminCalendar();
    });
    calendarBody.appendChild(el);
  });
}

// 渲染管理员页面日历
function renderAdminCalendar() {
  const calendarBody = document.getElementById('admin-calendar-body');
  const calendarTitle = document.getElementById('admin-calendar-title');
  
  if (!calendarBody || !calendarTitle) return;

  const today = new Date();
  let cycleStart, cycleEnd;

  if (today.getDate() >= 26) {
    cycleStart = new Date(currentYear, currentMonth, 26);
    cycleEnd = new Date(currentYear, currentMonth + 1, 25);
  } else {
    cycleStart = new Date(currentYear, currentMonth - 1, 26);
    cycleEnd = new Date(currentYear, currentMonth, 25);
  }

  const startStr = formatDate(cycleStart);
  const endStr = formatDate(cycleEnd);
  const cycleDisplayText = startStr + '~' + endStr;

  calendarTitle.innerText = cycleDisplayText;

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
      if (shift === '休息') {
        el.classList.add('rest');
      } else {
        el.classList.add('has-record');
      }
      el.innerHTML = `${date.getDate()}<div class="shift-tag">${shift}</div>`;
    } else {
      el.textContent = date.getDate();
    }

    if (selectedDate === dateStr) el.classList.add('selected');
    el.addEventListener('click', () => {
      selectedDate = dateStr;
      const dateInput = document.getElementById('record-date');
      if (dateInput) dateInput.value = dateStr;
      renderUserCalendar();
      renderAdminCalendar();
    });
    calendarBody.appendChild(el);
  });
}

function renderTotalAndStat() {
  const totalWageNum = document.getElementById('total-wage-num');
  const statWorkHours = document.getElementById('stat-work-hours');
  const statWorkDays = document.getElementById('stat-work-days');
  const stat21hDays = document.getElementById('stat-21h-days');
  const stat22hDays = document.getElementById('stat-22h-days');
  const stat23hDays = document.getElementById('stat-23h-days');
  const statBaseMoney = document.getElementById('stat-base-money');
  const statAllowance = document.getElementById('stat-allowance');
  const cycleGroupList = document.getElementById('cycle-group-list');

  if (!totalWageNum) return;

  const now = new Date();
  let cycleStart, cycleEnd;
  if (now.getDate() >= 26) {
    cycleStart = new Date(now.getFullYear(), now.getMonth(), 26);
    cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, 25);
  } else {
    cycleStart = new Date(now.getFullYear(), now.getMonth() - 1, 26);
    cycleEnd = new Date(now.getFullYear(), now.getMonth(), 25);
  }
  const cycleStartStr = formatDate(cycleStart);
  const cycleEndStr = formatDate(cycleEnd);

  const currentCycleList = allBillList.filter(item => {
    const d = item.get('date') || '';
    return d >= cycleStartStr && d <= cycleEndStr;
  });

  let totalWage = 0, totalWorkHours = 0, workDays = 0;
  let day21 = 0, day22 = 0, day23 = 0;
  let totalBase = 0, totalAllow = 0;
  const cycleMap = {};

  currentCycleList.forEach(item => {
    const dateStr = item.get('date') || '';
    if (!dateStr) return;

    const shift = item.get('shift') || '';
    const money = parseFloat(item.get('money')) || 0;
    const allow = parseFloat(item.get('allowance')) || 0;
    const sEnd = item.get('shiftEnd') || '';
    const mStart = item.get('mealStart') || '';
    if (shift === '休息') return;

    workDays++;
    totalBase += money;
    totalAllow += allow;

    let h = 0;
    let s = parseInt((item.get('shiftStart') || '00:00').split(':')[0]);
    let e = parseInt((sEnd || '00:00').split(':')[0]);
    if (e > s) h += e - s;
    if (shift === '拼班') {
      let s2 = parseInt((item.get('shiftStart2') || '00:00').split(':')[0]);
      let e2 = parseInt((item.get('shiftEnd2') || '00:00').split(':')[0]);
      if (e2 > s2) h += e2 - s2;
    }
    if (shift !== '拼班' && mStart) h = Math.max(0, h - 1);
    totalWorkHours += h;

    const HOURLY_WAGE = getBaseWageByDate(dateStr);
    const wage = Math.round(h * HOURLY_WAGE * 1000) / 1000;
    totalWage += Math.round((wage + allow) * 1000) / 1000;

    const endHour = parseInt(sEnd.split(':')[0]);
    if (endHour === 21) day21++;
    if (endHour === 22) day22++;
    if (endHour === 23) day23++;
  });

  allBillList.forEach(item => {
    const dateStr = item.get('date') || '';
    if (!dateStr) return;
    const d = new Date(dateStr);
    let cStart, cEnd;
    if (d.getDate() >= 26) {
      cStart = new Date(d.getFullYear(), d.getMonth(), 26);
      cEnd = new Date(d.getFullYear(), d.getMonth() + 1, 25);
    } else {
      cStart = new Date(d.getFullYear(), d.getMonth() - 1, 26);
      cEnd = new Date(d.getFullYear(), d.getMonth(), 25);
    }
    const cycleKey = `${formatDate(cStart)} ~ ${formatDate(cEnd)}`;
    if (!cycleMap[cycleKey]) cycleMap[cycleKey] = [];
    cycleMap[cycleKey].push(item);
  });

  Object.values(cycleMap).forEach(records => {
    records.sort((a,b) => new Date(b.get('date')) - new Date(a.get('date')));
  });

  if (cycleGroupList) {
    cycleGroupList.innerHTML = '';
    Object.keys(cycleMap).sort().reverse().forEach(cycleKey => {
      const records = cycleMap[cycleKey];
      const group = document.createElement('div');
      group.className = 'cycle-group';
      group.innerHTML = `
        <div class="cycle-header" data-cycle="${cycleKey}">
          <span>${cycleKey}</span>
          <span style="color:#8e8e93;font-size:12px;">${records.length} 条记录</span>
        </div>
      `;
      cycleGroupList.appendChild(group);
      group.querySelector('.cycle-header').addEventListener('click', () => {
        openCycleDetailPopup(cycleKey, records);
      });
    });
  }

  totalWageNum.innerText = totalWage.toFixed(2);

  if (statWorkHours) statWorkHours.innerText = totalWorkHours.toFixed(1) + ' 小时';
  if (statWorkDays) statWorkDays.innerText = workDays + ' 天';
  if (stat21hDays) stat21hDays.innerText = day21 + ' 天';
  if (stat22hDays) stat22hDays.innerText = day22 + ' 天';
  if (stat23hDays) stat23hDays.innerText = day23 + ' 天';
  if (statBaseMoney) statBaseMoney.innerText = '¥' + totalBase.toFixed(2);
  if (statAllowance) statAllowance.innerText = '¥' + totalAllow.toFixed(2);

  // ✅ 更新圆形进度条（逐帧动画）
  const progressText = document.getElementById('progress-text');
  // 【已修正】精准选中下方抓捕进度条
  const progressCircle = document.getElementById('bottom-progress');
  if (progressText && progressCircle) {
    const totalWage = parseFloat(totalWageNum.textContent) || 0;
    const percentage = Math.max(0, Math.min(Math.round(totalWage / 2900 * 100), 100));
    currentProgress = percentage;
  
    // 先重置为0，再播放动画
    progressCircle.style.setProperty('--progress', 0);
    progressText.textContent = '0%';
    animateProgress(percentage);
  
    // 同步更新顶部周期小圆进度条
    const cyclePercent = calculateCycleProgress();
    const miniCircle = document.getElementById('top-progress');
    const miniText = document.getElementById('cycle-progress-text');
    if(miniCircle && miniText){
      miniCircle.style.setProperty('--mini-progress', 0);
      miniText.textContent = '0%';
      animateMiniProgress(cyclePercent);
    }
  }
}

// ========== 周期明细弹窗 ==========
function openCycleDetailPopup(cycleKey, records) {
  const cycleDetailTitle = document.getElementById('cycle-detail-title');
  const list = document.getElementById('cycle-detail-record-list');
  const cycleDetailOverlay = document.getElementById('cycle-detail-overlay');

  if (!cycleDetailTitle || !list || !cycleDetailOverlay) return;

  cycleDetailTitle.innerText = cycleKey;
  list.innerHTML = '';

  const calcBtn = document.createElement('button');
  calcBtn.innerText = '查看本期总工资';
  calcBtn.className = 'cycle-calc-btn';
  
  calcBtn.onclick = function (e) {
    e.stopPropagation();
    e.preventDefault();
    this.blur();

    let totalHours = 0;
    let totalBase = 0;
    let totalAllow = 0;
    let totalWage = 0;
    let workDays = 0;

    records.forEach(item => {
      const shift = item.get('shift') || '';
      if (shift === '休息') return;

      workDays++;
      const allow = parseFloat(item.get('allowance')) || 0;
      totalAllow += allow;

      let h = 0;
      const s = parseInt((item.get('shiftStart') || '00:00').split(':')[0]);
      const e = parseInt((item.get('shiftEnd') || '00:00').split(':')[0]);
      if (e > s) h += e - s;

      if (shift === '拼班') {
        const s2 = parseInt((item.get('shiftStart2') || '00:00').split(':')[0]);
        const e2 = parseInt((item.get('shiftEnd2') || '00:00').split(':')[0]);
        if (e2 > s2) h += e2 - s2;
      }

      const meal = item.get('mealStart') || '';
      if (shift !== '拼班' && meal) h = Math.max(0, h - 1);
      totalHours += h;

      const HOURLY_WAGE = getBaseWageByDate(item.get('date'));
      const dayWage = Math.round(h * HOURLY_WAGE * 1000) / 1000;
      totalBase += dayWage;
      totalWage += Math.round((dayWage + allow) * 1000) / 1000;
    });

    document.getElementById('cycle-total-title').innerText = `${cycleKey} 工资统计`;
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

  list.appendChild(calcBtn);

  records.forEach(item => {
    const workDate = item.get('date') || '';
    const createdTime = new Date(item.createdAt);
    const timeStr = `${workDate} ${String(createdTime.getHours()).padStart(2, '0')}:${String(createdTime.getMinutes()).padStart(2, '0')}:${String(createdTime.getSeconds()).padStart(2, '0')}`;

    const shift = item.get('shift') || '';
    const sStart = item.get('shiftStart') || '';
    const sEnd = item.get('shiftEnd') || '';
    const sStart2 = item.get('shiftStart2') || '';
    const sEnd2 = item.get('shiftEnd2') || '';
    const meal = item.get('mealStart') || '';
    const money = parseFloat(item.get('money')) || 0;
    const allow = parseFloat(item.get('allowance')) || 0;
    const r = item.get('title') || '无';

    let timeInfo = '';
    if (shift === '拼班') {
      const t1 = (sStart && sEnd) ? `${sStart}-${sEnd}` : '未设置';
      const t2 = (sStart2 && sEnd2) ? `${sStart2}-${sEnd2}` : '未设置';
      timeInfo = t1 + ' / ' + t2;
    } else {
      timeInfo = `${sStart}-${sEnd}`;
    }

    let mealLine = '';
    if (meal) {
      const [h, m] = meal.split(':').map(Number);
      const endH = h + 1;
      const endMeal = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      mealLine = `<div class="info-line">饭点：${meal}-${endMeal}</div>`;
    }

    list.insertAdjacentHTML('beforeend', `
      <div class="cycle-detail-item">
        <span class="date-text">${timeStr}</span>
        <div class="info-line">班次：${shift} | 时间：${timeInfo}</div>
        ${mealLine}
        <div class="info-line">当日工资：<span class="money">¥${(money + allow).toFixed(2)}</span> | 备注：${r}</div>
      </div>
    `);
  });

  cycleDetailOverlay.classList.add('show');
  disableBodyScroll();
}

// 管理员周期详情弹窗
function openAdminCycleDetailPopup(cycleKey, records) {
  const cycleDetailTitle = document.getElementById('cycle-detail-title');
  const list = document.getElementById('cycle-detail-record-list');
  const cycleDetailOverlay = document.getElementById('cycle-detail-overlay');

  if (!cycleDetailTitle || !list || !cycleDetailOverlay) return;

  cycleDetailTitle.innerText = cycleKey;
  list.innerHTML = '';

  const calcBtn = document.createElement('button');
  calcBtn.innerText = '查看本期总工资';
  calcBtn.className = 'cycle-calc-btn';
  
  calcBtn.onclick = function (e) {
    e.stopPropagation();
    e.preventDefault();
    this.blur();

    let totalHours = 0;
    let totalBase = 0;
    let totalAllow = 0;
    let totalWage = 0;
    let workDays = 0;

    records.forEach(item => {
      const shift = item.get('shift') || '';
      if (shift === '休息') return;

      workDays++;
      const allow = parseFloat(item.get('allowance')) || 0;
      totalAllow += allow;

      let h = 0;
      // 修复：工时解析增加NaN兜底
      const s = parseInt((item.get('shiftStart') || '00:00').split(':')[0] || 0);
      const e = parseInt((item.get('shiftEnd') || '00:00').split(':')[0] || 0);
      if (e > s) h += e - s;

      if (shift === '拼班') {
        const s2 = parseInt((item.get('shiftStart2') || '00:00').split(':')[0] || 0);
        const e2 = parseInt((item.get('shiftEnd2') || '00:00').split(':')[0] || 0);
        if (e2 > s2) h += e2 - s2;
      }

      const meal = item.get('mealStart') || '';
      if (shift !== '拼班' && meal) h = Math.max(0, h - 1);
      totalHours += h;

      const HOURLY_WAGE = getBaseWageByDate(item.get('date'));
      const dayWage = Math.round(h * HOURLY_WAGE * 1000) / 1000;
      totalBase += dayWage;
      totalWage += Math.round((dayWage + allow) * 1000) / 1000;
    });

    document.getElementById('cycle-total-title').innerText = `${cycleKey} 工资统计`;
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

  list.appendChild(calcBtn);

  records.forEach(item => {
    const workDate = item.get('date') || '';
    const createdTime = new Date(item.createdAt);
    const timeStr = `${workDate} ${String(createdTime.getHours()).padStart(2, '0')}:${String(createdTime.getMinutes()).padStart(2, '0')}:${String(createdTime.getSeconds()).padStart(2, '0')}`;

    const shift = item.get('shift') || '';
    const sStart = item.get('shiftStart') || '';
    const sEnd = item.get('shiftEnd') || '';
    const sStart2 = item.get('shiftStart2') || '';
    const sEnd2 = item.get('shiftEnd2') || '';
    const meal = item.get('mealStart') || '';
    const money = parseFloat(item.get('money')) || 0;
    const allow = parseFloat(item.get('allowance')) || 0;
    const r = item.get('title') || '无';
    const id = item.id;

    let timeInfo = '';
    if (shift === '拼班') {
      const t1 = (sStart && sEnd) ? `${sStart}-${sEnd}` : '未设置';
      const t2 = (sStart2 && sEnd2) ? `${sStart2}-${sEnd2}` : '未设置';
      timeInfo = t1 + ' / ' + t2;
    } else {
      timeInfo = `${sStart}-${sEnd}`;
    }

    let mealLine = '';
    if (meal) {
      const [h, m] = meal.split(':').map(Number);
      const endH = h + 1;
      const endMeal = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      mealLine = `<div class="info-line">饭点：${meal}-${endMeal}</div>`;
    }

    const itemEl = document.createElement('div');
    itemEl.className = 'cycle-detail-item';
    // 修复：移除末尾多余的 } 语法错误
    itemEl.innerHTML = `
      <span class="date-text">${timeStr}</span>
      <div class="info-line">班次：${shift} | 时间：${timeInfo}</div>
      ${mealLine}
      <div class="info-line">当日工资：<span class="money">¥${(money + allow).toFixed(2)}</span> | 备注：${r}</div>
      <div class="item-op" style="margin-top:12px;gap:12px;">
        <button class="btn-sm btn-edit" 
          data-id="${id}" 
          data-date="${workDate}" 
          data-shift="${shift}"
          data-shift-start="${sStart}" 
          data-shift-end="${sEnd}"
          data-shift-start2="${sStart2}" 
          data-shift-end2="${sEnd2}"
          data-meal-start="${meal}"
          data-allowance="${allow}"
          data-money="${money}"
          data-remark="${r}"
        >编辑</button>
        <button class="btn-sm btn-del" data-id="${id}">删除</button>
      </div>
    `;
    list.appendChild(itemEl);
  });

  // 修复：打开弹窗禁用页面滚动
  cycleDetailOverlay.classList.add('show');
  disableBodyScroll();
}
document.addEventListener('DOMContentLoaded', function () {
  // ========== 周期详情列表事件委托（根治重复绑定+ID作用域问题） ==========
  const recordList = document.getElementById('cycle-detail-record-list');
  if (recordList) {
    // 编辑按钮事件委托
    recordList.addEventListener('click', function(e) {
      const editBtn = e.target.closest('.btn-edit');
      if (!editBtn) return;
      e.stopPropagation();
      e.preventDefault();
      editBtn.blur();

      const cycleDetailOverlay = document.getElementById('cycle-detail-overlay');
      if (cycleDetailOverlay) cycleDetailOverlay.classList.remove('show');
      enableBodyScroll();
      
      const dateInput = document.getElementById('record-date');
      const shiftSelect = document.getElementById('record-shift');
      const shiftStart = document.getElementById('shift-start');
      const shiftEnd = document.getElementById('shift-end');
      const shiftStart2 = document.getElementById('shift-start2');
      const shiftEnd2 = document.getElementById('shift-end2');
      const mealStart = document.getElementById('meal-start');
      const allowanceInput = document.getElementById('record-allowance');
      const moneyInput = document.getElementById('record-money');
      const remarkInput = document.getElementById('record-remark');
      const editId = document.getElementById('edit-id');

      if (dateInput) dateInput.value = editBtn.dataset.date;
      if (shiftSelect) shiftSelect.value = editBtn.dataset.shift;

      shiftSelect.dispatchEvent(new Event('change'));

      if (shiftStart) shiftStart.value = editBtn.dataset.shiftStart;
      if (shiftStart.value) shiftStart.dispatchEvent(new Event('change'));
      if (shiftEnd) shiftEnd.value = editBtn.dataset.shiftEnd;
      if (mealStart) mealStart.value = editBtn.dataset.mealStart;

      if (shiftStart2) shiftStart2.value = editBtn.dataset.shiftStart2;
      if (shiftStart2.value) shiftStart2.dispatchEvent(new Event('change'));
      if (shiftEnd2) shiftEnd2.value = editBtn.dataset.shiftEnd2;

      if (allowanceInput) allowanceInput.value = editBtn.dataset.allowance;
      if (moneyInput) moneyInput.value = editBtn.dataset.money;
      if (remarkInput) remarkInput.value = editBtn.dataset.remark;
      if (editId) editId.value = editBtn.dataset.id;
      
      window.calcWorkHours();

      selectedDate = editBtn.dataset.date;
      renderUserCalendar();
      renderAdminCalendar();
    });

    // 删除按钮事件委托
    recordList.addEventListener('click', async function(e) {
      const delBtn = e.target.closest('.btn-del');
      if (!delBtn) return;
      e.stopPropagation();
      e.preventDefault();
      delBtn.blur();

      if (!confirm('确定删除该条记录？')) return;
      try {
        // 修复：从按钮dataset取ID，避免作用域错误
        const delId = delBtn.dataset.id;
        await AV.Object.createWithoutData('Bill', delId).destroy();
        loadData();
        showToast('删除成功', 'success');
        const cycleDetailOverlay = document.getElementById('cycle-detail-overlay');
        if (cycleDetailOverlay) cycleDetailOverlay.classList.remove('show');
        enableBodyScroll();
      } catch (e) {
        showToast('删除失败', 'error');
      }
    });
  } // ✅ 这里是 if (recordList) 的闭合大括号，之前大概率漏掉了

  // 第一步：先获取所有元素
  const adminEntrance = document.getElementById('admin-entrance');
  const loginOverlay = document.getElementById('login-overlay');
  const adminPwdInput = document.getElementById('admin-pwd-input');
  const loginCancelBtn = document.getElementById('login-cancel');
  const loginConfirmBtn = document.getElementById('login-confirm');
  const userView = document.getElementById('user-view');
  const adminView = document.getElementById('admin-view');

  // 管理员入口点击事件
  if (adminEntrance && loginOverlay && adminPwdInput) {
    adminEntrance.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.blur();

      loginOverlay.classList.add('show');
      adminPwdInput.value = '';
      adminPwdInput.focus();
      disableBodyScroll();
    });
  }

  // 第二步：处理登录状态
  const isAdminLoggedIn = localStorage.getItem('isAdminLoggedIn');
  const now = new Date();
  const todayStr = formatDate(now);

  selectedDate = todayStr;

  if (isAdminLoggedIn === 'true') {
    document.body.classList.add('admin-active');
    if (userView) userView.classList.add('hidden');
    if (adminView) adminView.classList.remove('hidden');
    if (adminEntrance) adminEntrance.classList.add('hidden');
    
    const dateInput = document.getElementById('record-date');
    if (dateInput) dateInput.value = todayStr;
    loadData();
  } else {
    document.body.classList.remove('admin-active');
    if (userView) userView.classList.remove('hidden');
    if (adminView) adminView.classList.add('hidden');
    if (adminEntrance) adminEntrance.classList.remove('hidden');
    
    loadData().then(() => {
      renderUserCalendar();
    });
  }
  // 初始化顶部进度+表情包卡片（仅用户页面）
  if (isAdminLoggedIn !== 'true') {
    initTopMiniCards();
  }
  initTimeSelect();

  // 第三步：绑定登录相关事件
  if (loginCancelBtn && loginOverlay) {
    loginCancelBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.blur();

      loginOverlay.classList.remove('show');
      enableBodyScroll();
    });
  }

  // 登录确认按钮
  if (loginConfirmBtn && adminPwdInput && loginOverlay) {
    loginConfirmBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.blur();

      const pwd = adminPwdInput.value.trim();
      if (pwd === 'admin123') {
        localStorage.setItem('isAdminLoggedIn', 'true');
        loginOverlay.classList.remove('show');
        enableBodyScroll();
        
        document.body.classList.add('admin-active');
        if (userView) userView.classList.add('hidden');
        if (adminView) adminView.classList.remove('hidden');
        if (adminEntrance) adminEntrance.classList.add('hidden');
        
        const dateInput = document.getElementById('record-date');
        if (dateInput) dateInput.value = todayStr;
        setTimeout(() => loadData(), 300);
      } else {
        showToast('密码错误', 'error');
      }
    });

    // 回车登录
    adminPwdInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') loginConfirmBtn.click();
    });
  }

  const backUserBtn = document.getElementById('back-user');
  if (backUserBtn) {
    backUserBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.blur();

      localStorage.removeItem('isAdminLoggedIn');
      document.body.classList.remove('admin-active');
      
      if (adminView) adminView.classList.add('hidden');
      if (userView) userView.classList.remove('hidden');
      if (adminEntrance) adminEntrance.classList.remove('hidden');
      
      clearForm();
      renderTotalAndStat();
      renderUserCalendar();
      showToast('已返回用户页面', 'success');
    });
  }

  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.blur();

      const dateInput = document.getElementById('record-date');
      const shiftSelect = document.getElementById('record-shift');
      const shiftStart = document.getElementById('shift-start');
      const shiftEnd = document.getElementById('shift-end');
      const shiftStart2 = document.getElementById('shift-start2');
      const shiftEnd2 = document.getElementById('shift-end2');
      const mealStart = document.getElementById('meal-start');
      const moneyInput = document.getElementById('record-money');
      const allowanceInput = document.getElementById('record-allowance');
      const remarkInput = document.getElementById('record-remark');
      const editId = document.getElementById('edit-id');

      const date = dateInput.value.trim();
      const shift = shiftSelect.value;
      const sStart = shiftStart.value;
      const sEnd = shiftEnd.value;
      const sStart2 = shiftStart2.value;
      const sEnd2 = shiftEnd2.value;
      const meal = mealStart.value;
      const money = parseFloat(moneyInput.value) || 0;
      const allowance = parseFloat(allowanceInput.value) || 0;
      const remark = remarkInput.value.trim();
      const editObjId = editId.value.trim();

      if (!date || !shift) {
        showToast('请选择日期和班次', 'error');
        return;
      }

      try {
        if (editObjId) {
          const obj = AV.Object.createWithoutData('Bill', editObjId);
          obj.set('date', date);
          obj.set('shift', shift);
          obj.set('shiftStart', sStart);
          obj.set('shiftEnd', sEnd);
          obj.set('shiftStart2', sStart2);
          obj.set('shiftEnd2', sEnd2);
          obj.set('mealStart', meal);
          obj.set('money', money);
          obj.set('allowance', allowance);
          obj.set('title', remark);
          await obj.save();
          showToast('修改成功', 'success');
        } else {
          const bill = new Bill();
          bill.set('date', date);
          bill.set('shift', shift);
          bill.set('shiftStart', sStart);
          bill.set('shiftEnd', sEnd);
          bill.set('shiftStart2', sStart2);
          bill.set('shiftEnd2', sEnd2);
          bill.set('mealStart', meal);
          bill.set('money', money);
          bill.set('allowance', allowance);
          bill.set('title', remark);
          await bill.save();
          showToast('保存成功', 'success');
        }
        clearForm();
        loadData();
      } catch (err) {
        showToast('保存失败', 'error');
      }
    });
  }

  // 用户页面日历按钮
  const prevMonthBtn = document.getElementById('prev-month-btn');
  const nextMonthBtn = document.getElementById('next-month-btn');
  if (prevMonthBtn && nextMonthBtn) {
    prevMonthBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.blur();

      currentMonth--;
      renderUserCalendar();
    });

    nextMonthBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.blur();

      currentMonth++;
      renderUserCalendar();
    });
  }

  // 管理员页面日历按钮
  const adminPrevMonthBtn = document.getElementById('admin-prev-month-btn');
  const adminNextMonthBtn = document.getElementById('admin-next-month-btn');
  if (adminPrevMonthBtn && adminNextMonthBtn) {
    adminPrevMonthBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.blur();

      currentMonth--;
      renderAdminCalendar();
    });

    adminNextMonthBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.blur();

      currentMonth++;
      renderAdminCalendar();
    });
  }

  const detailBtn = document.getElementById('detail-btn');
  const detailOverlay = document.getElementById('detail-overlay');
  const detailClose = document.getElementById('detail-close');
  if (detailBtn && detailOverlay && detailClose) {
    detailBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.blur();

      renderTotalAndStat();
      detailOverlay.classList.add('show');
      disableBodyScroll();
    });

    detailClose.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.blur();

      detailOverlay.classList.remove('show');
      enableBodyScroll();
    });
  }

  const cycleDetailClose = document.getElementById('cycle-detail-close');
  const cycleDetailOverlay = document.getElementById('cycle-detail-overlay');
  if (cycleDetailClose && cycleDetailOverlay) {
    cycleDetailClose.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.blur();

      cycleDetailOverlay.classList.remove('show');
      enableBodyScroll();
    });
  }

  const cycleTotalClose = document.getElementById('cycle-total-close');
  const cycleTotalOverlay = document.getElementById('cycle-total-overlay');
  if (cycleTotalClose && cycleTotalOverlay) {
    cycleTotalClose.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.blur();

      cycleTotalOverlay.classList.remove('show');
      enableBodyScroll();
    });
  }

  // 点击弹窗遮罩层关闭弹窗
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
      if (e.target === this) {
        this.classList.remove('show');
        enableBodyScroll();
      }
    });

    overlay.addEventListener('touchmove', function(e) {
      // 只有点击的是遮罩背景本身时，才阻止滚动；弹窗内容区域允许滚动
      if (e.target === this) {
        e.preventDefault();
      }
    }, { passive: false });
  });

  // 刷新按钮：双进度条同步动画
  document.getElementById('refresh-data-btn').addEventListener('click', async function (e) {
    e.stopPropagation();
    e.preventDefault();
    this.blur();

    if (this.classList.contains('spinning') || isLoading) return;

    // 获取所有进度条/加载元素
    const progressCircle = document.querySelector('.progress-window:not(.top-progress-window) .progress-circle');
    const progressText = document.getElementById('progress-text');
    const miniCircle = document.querySelector('.progress-circle.mini-progress');
    const miniText = document.getElementById('cycle-progress-text');
    const wageBox = document.querySelector('.total-wage-box');
    const refreshBtn = document.getElementById('refresh-data-btn');

    // 1. 立即开启加载动画
    if (wageBox) wageBox.classList.add('loading');
    if (refreshBtn) refreshBtn.classList.add('spinning');

    // 2. 两个进度条同步回退到 0
    const rollbackAll = new Promise((resolve) => {
      if (progressCircle && progressText) animateProgress(0);
      if (miniCircle && miniText) animateMiniProgress(0);
      setTimeout(resolve, 1000);
    });

    // 3. 加载数据
    const dataTask = loadData(0, false, false, false);

    // 4. 等待数据加载 + 双进度回退全部完成
    const [data] = await Promise.all([dataTask, rollbackAll]);

    // 5. 渲染页面数据
    if (data) {
      renderData(data);
      renderUserCalendar();
      renderAdminCalendar();
      renderTotalAndStat();
    }

    // 6. 双进度条同步向前动画到各自目标值
    const forwardAll = new Promise((resolve) => {
      // 工资进度百分比
      const totalWageNum = document.getElementById('total-wage-num');
      let wagePercent = 0;
      if(totalWageNum){
        const totalWage = parseFloat(totalWageNum.textContent) || 0;
        wagePercent = Math.max(0, Math.min(Math.round(totalWage / 2900 * 100), 100));
      }
      // 周期进度百分比
      const cyclePercent = calculateCycleProgress();

      // 同时执行前进动画
      if (progressCircle && progressText) animateProgress(wagePercent);
      if (miniCircle && miniText) animateMiniProgress(cyclePercent);

      setTimeout(resolve, 1000);
    });

    await forwardAll;

    // 7. 全部动画结束：关闭加载动画 + 提示
    if (wageBox) wageBox.classList.remove('loading');
    if (refreshBtn) refreshBtn.classList.remove('spinning');
    showToast('数据刷新成功','success');
  });
});
