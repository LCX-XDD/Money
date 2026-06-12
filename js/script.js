// ========== 禁止/恢复页面滚动 ==========
let savedScrollTop = 0;
let clickBlocker = null;
let currentProgress = 0; // 保存当前进度百分比



// 圆形进度条逐帧动画（和参考的线性进度条逻辑一致）
function animateProgress(targetPercent) {
  const progressCircle = document.querySelector('.progress-circle');
  const progressText = document.getElementById('progress-text');
  if (!progressCircle || !progressText) return;

  let current = parseInt(progressCircle.style.getPropertyValue('--progress')) || 0;
  const step = targetPercent > current ? 1 : -1;
  const interval = setInterval(() => {
    current += step;
    progressCircle.style.setProperty('--progress', current);
    progressText.textContent = `${current}%`;

    if (current === targetPercent) {
      clearInterval(interval);
    }
  }, 10); // 动画速度，和参考代码一致
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
  if (isLoading) return;
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
    if (retryCount < 3) {
      setTimeout(() => {
        loadData(retryCount + 1, autoRender, showLoading, autoStopLoading);
      }, 1000);
      return;
    }
    showToast('数据加载失败，请刷新', 'error');
  } finally {
    isLoading = false;
    if (autoStopLoading) {
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

// ✅ 更新圆形进度条
// ✅ 更新圆形进度条（逐帧动画）
const progressText = document.getElementById('progress-text');
const progressCircle = document.querySelector('.progress-circle');
if (progressText && progressCircle) {
  // 计算百分比（取整，最大100%）
  const percentage = Math.min(Math.round(totalWage / 2900 * 100), 100);
  currentProgress = percentage;
  
  // 先重置为0，再播放动画
  progressCircle.style.setProperty('--progress', 0);
  progressText.textContent = '0%';
  animateProgress(percentage);
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

itemEl.querySelector('.btn-edit').addEventListener('click', function (e) {
  e.stopPropagation();
  e.preventDefault();
  this.blur();

  cycleDetailOverlay.classList.remove('show');
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

  if (dateInput) dateInput.value = this.dataset.date;
  if (shiftSelect) shiftSelect.value = this.dataset.shift;

  shiftSelect.dispatchEvent(new Event('change'));

  if (shiftStart) shiftStart.value = this.dataset.shiftStart;
  if (shiftStart.value) shiftStart.dispatchEvent(new Event('change'));
  if (shiftEnd) shiftEnd.value = this.dataset.shiftEnd;
  if (mealStart) mealStart.value = this.dataset.mealStart;

  if (shiftStart2) shiftStart2.value = this.dataset.shiftStart2;
  if (shiftStart2.value) shiftStart2.dispatchEvent(new Event('change'));
  if (shiftEnd2) shiftEnd2.value = this.dataset.shiftEnd2;

  if (allowanceInput) allowanceInput.value = this.dataset.allowance;
  if (moneyInput) moneyInput.value = this.dataset.money;
  if (remarkInput) remarkInput.value = this.dataset.remark;
  if (editId) editId.value = this.dataset.id;
  
  window.calcWorkHours();

  selectedDate = this.dataset.date;
  renderUserCalendar();
  renderAdminCalendar();

  setTimeout(() => {
    // 自动滚动到班次选择框
    const formTarget = document.getElementById('record-shift');
    if (formTarget) {
      formTarget.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
    showToast('已进入编辑模式，修改后点击保存即可', 'normal', 2000);
  }, 100);
});

    itemEl.querySelector('.btn-del').addEventListener('click', async function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.blur();

      if (!confirm('确定删除该条记录？')) return;
      try {
        await AV.Object.createWithoutData('Bill', id).destroy();
        loadData();
        showToast('删除成功', 'success');
        cycleDetailOverlay.classList.remove('show');
        enableBodyScroll();
      } catch (e) {
        showToast('删除失败', 'error');
      }
    });
  });

  cycleDetailOverlay.classList.add('show');
  disableBodyScroll();
}

document.addEventListener('DOMContentLoaded', function () {
  // 第一步：先获取所有元素
  const adminEntrance = document.getElementById('admin-entrance');
  const loginOverlay = document.getElementById('login-overlay');
  const adminPwdInput = document.getElementById('admin-pwd-input');
  const loginCancelBtn = document.getElementById('login-cancel');
  const loginConfirmBtn = document.getElementById('login-confirm');
  const userView = document.getElementById('user-view');
  const adminView = document.getElementById('admin-view');

  // ✅ 先绑定管理员入口点击事件（放在最前面，不包裹任何条件）
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

  // 第二步：执行原来的登录状态判断和初始化
  const isAdminLoggedIn = localStorage.getItem('isAdminLoggedIn');
  const now = new Date();
  const todayStr = formatDate(now);

  selectedDate = todayStr;

  if (isAdminLoggedIn === 'true' && userView && adminView && adminEntrance) {
    document.body.classList.add('admin-active');
    userView.classList.add('hidden');
    adminView.classList.remove('hidden');
    adminEntrance.classList.add('hidden');
    const dateInput = document.getElementById('record-date');
    if (dateInput) dateInput.value = todayStr;
    loadData();
  } else {
    document.body.classList.remove('admin-active');
    loadData().then(() => {
      renderUserCalendar();
    });
  }

  initTimeSelect();

  // 第三步：单独绑定每个登录相关事件（分开判断，避免互相影响）
  if (loginCancelBtn && loginOverlay) {
    loginCancelBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      this.blur();

      loginOverlay.classList.remove('show');
      enableBodyScroll();
    });
  }

  // ✅ 登录确认按钮单独绑定，确保一定生效
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
  if (backUserBtn && adminView && userView && adminEntrance) {
backUserBtn.addEventListener('click', function (e) {
  e.stopPropagation();
  e.preventDefault();
  this.blur();

  localStorage.removeItem('isAdminLoggedIn');
  // ✅ 返回用户页面移除管理员模式类，恢复垂直居中
  document.body.classList.remove('admin-active');
  adminView.classList.add('hidden');
  userView.classList.remove('hidden');
  adminEntrance.classList.remove('hidden');
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
      const allowanceInput = document.getElementById('record-allowance');
      const moneyInput = document.getElementById('record-money');
      const remarkInput = document.getElementById('record-remark');
      const editId = document.getElementById('edit-id');

      if (!dateInput || !shiftSelect || !shiftStart || !shiftEnd || !moneyInput) return;

      const d = dateInput.value.trim();
      const shift = shiftSelect.value.trim();
      const sStart = shiftStart.value;
      const sEnd = shiftEnd.value;
      const sStart2 = shiftStart2 ? shiftStart2.value : '';
      const sEnd2 = shiftEnd2 ? shiftEnd2.value : '';
      const mStart = mealStart ? mealStart.value : '';
      const allowance = parseFloat(allowanceInput ? allowanceInput.value : 0) || 0;
      const money = parseFloat(moneyInput.value);
      const r = remarkInput ? remarkInput.value.trim() : '';
      const editIdVal = editId ? editId.value : '';

      if (!d || !shift) { showToast('请选择日期和班次', 'error'); return; }
      if (shift !== '休息' && (isNaN(money) || money <= 0)) { showToast('工时或工资异常', 'error'); return; }

      try {
        const bill = editIdVal ? AV.Object.createWithoutData('Bill', editIdVal) : new Bill();
        bill.set('date', d);
        bill.set('shift', shift);
        bill.set('shiftStart', sStart);
        bill.set('shiftEnd', sEnd);
        bill.set('shiftStart2', sStart2);
        bill.set('shiftEnd2', sEnd2);
        bill.set('mealStart', mStart);
        bill.set('allowance', allowance);
        bill.set('money', money);
        bill.set('title', r);
        bill.set('type', 'income');
        await bill.save();
        clearForm();
        loadData();
        showToast('保存成功', 'success');

        if (shiftSelect) {
          shiftSelect.value = '';
          shiftSelect.dispatchEvent(new Event('change'));
        }
      } catch (e) {
        showToast('保存失败', 'error');
        console.error(e);
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
      if (e.target === this) {
        e.preventDefault();
      }
    }, { passive: false });
  });

  // ✅ 已删除重复的loadData调用，彻底解决刷新页面加载两次的问题
});

// ✅ 修复：刷新按钮点击后立即显示Toast，不再延迟
// ✅ 完美修复：数据加载完成立即显示Toast，动画单独保证时长
// 刷新按钮
// 刷新按钮
document.getElementById('refresh-data-btn').addEventListener('click',async function (e) {
  e.stopPropagation();
  e.preventDefault();
  this.blur();

  if (this.classList.contains('spinning') || isLoading) return;

  const startTime = Date.now();
  const minAnimationDuration = 1000;
  const progressCircle = document.querySelector('.progress-circle');
  const progressText = document.getElementById('progress-text');

// ✅ 第一步：进度条从当前值逐帧回退到0
if (progressCircle && progressText) {
  await new Promise(resolve => {
    animateProgress(0);
    // 等待回退动画完成（10ms/帧 * 100帧 = 1秒）
    setTimeout(resolve, 1000);
  });
}

  // 第二步：加载数据
  const data = await loadData(0, false, true, false);
  
  // 第三步：渲染数据（自动触发进度条从0到新值的1秒动画）
  if (data) {
    renderData(data);
    renderUserCalendar();
    renderAdminCalendar();
    renderTotalAndStat();
  }

  // 等待所有动画完成
  const elapsed = Date.now() - startTime;
  if (elapsed < 2000) { // 回退1秒+前进1秒=总2秒
    await new Promise(resolve => setTimeout(resolve, 2000 - elapsed));
  }

  // 停止加载动画
  const wageBox = document.querySelector('.total-wage-box');
  const refreshBtn = document.getElementById('refresh-data-btn');
  if (wageBox) wageBox.classList.remove('loading');
  if (refreshBtn) refreshBtn.classList.remove('spinning');

  // 最后显示Toast（和进度条动画完成同时出现）
  showToast('数据刷新成功','success');
});
