// ========== 全局变量 ==========
let savedScrollTop = 0;
let clickBlocker = null;
// 进度条定时器容器（对象引用，确保动画函数能正确修改状态）
const progressTimerObj = { value: null };
const miniProgressTimerObj = { value: null };
let isLoading = false;
let isRefreshing = false; // 刷新全流程锁，动画未完成前禁止重复点击

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let recordDates = new Set();
let selectedDate = '';
let allBillList = [];
let bodyScrollLockCount = 0; // 滚动锁计数，嵌套弹窗累加，归0才恢复滚动
let isEditMode = false; // 标记是否处于编辑模式

const LC_APP_ID = "PkkbpTxYiRWgHbA8h0noWSwh-gzGzoHsz";
const LC_APP_KEY = "suQbFb5BnNKjjSIEPlxfr7BW";
const LC_SERVER = "https://pkkbptxy.lc-cn-n1-shared.com";
const BASE_SALARY = 2900;

// ========== 通用工具函数 ==========

// 时薪计算：BASE_SALARY 月薪 2900，按每月标准工时折算
function getBaseWageByDate(dateStr) {
  const monthTotalHours = 208; // 月度标准计薪工时，可按需修改
  return BASE_SALARY / monthTotalHours;
}

function safeNum(val, fallback = 0) {
  const num = Number(val);
  return isNaN(num) ? fallback : num;
}

// 单日工资保留3位小数（四舍五入，用于计算与存储，保证累加精度）
function round3(num) {
  return Math.round((safeNum(num) + Number.EPSILON) * 1000) / 1000;
}

// 总工资截断到2位小数，不四舍五入（直接舍去第三位及以后，最终显示用）
function trunc2(num) {
  const n = safeNum(num);
  return Math.floor(n * 100) / 100;
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

function runProgressAnim(circleEl, textEl, cssVar, targetPercent, timerRef, min = 0, max = Infinity, onFinish = null) {
  if (!circleEl || !textEl) {
    onFinish?.();
    return;
  }

  // 取消上一个未完成的动画
  if (timerRef.value) {
    cancelAnimationFrame(timerRef.value);
    timerRef.value = null;
  }

  // 限制数值范围
  targetPercent = Math.max(min, Math.min(max, safeNum(targetPercent)));
  const rawVal = circleEl.style.getPropertyValue(cssVar);
  const startVal = Math.max(min, Math.min(max, safeNum(parseInt(rawVal) || 0)));

  // 初始赋值进度变量
  circleEl.style.setProperty(cssVar, targetPercent);

  const duration = 500;
  const startTime = performance.now();

  // 逐帧更新数字 + 实时判断样式（关键：跨过100才变色）
  function animateFrame(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // 当前实时百分比
    const current = Math.round(startVal + (targetPercent - startVal) * progress);
    textEl.textContent = `${current}%`;

    // 仅主进度条做红蓝判断，顶部迷你进度固定 normal
    if (cssVar === '--progress') {
      // 实时判断：当前数值 >100 红色，否则白色
      circleEl.dataset.progress = current > 100 ? 'over' : 'normal';
    } else {
      circleEl.dataset.progress = 'normal';
    }

    if (progress < 1) {
      timerRef.value = requestAnimationFrame(animateFrame);
    } else {
      // 动画结束，最终状态兜底
      if (cssVar === '--progress') {
        circleEl.dataset.progress = targetPercent > 100 ? 'over' : 'normal';
      }
      timerRef.value = null;
      onFinish?.();
    }
  }

  timerRef.value = requestAnimationFrame(animateFrame);

  // 超时兜底
  setTimeout(() => {
    if (timerRef.value) {
      cancelAnimationFrame(timerRef.value);
      timerRef.value = null;
    }
    textEl.textContent = `${targetPercent}%`;
    if (cssVar === '--progress') {
      circleEl.dataset.progress = targetPercent > 100 ? 'over' : 'normal';
    }
    onFinish?.();
  }, duration + 50);
}


function animateProgress(targetPercent) {
  return new Promise(resolve => {
    const circle = document.getElementById('bottom-progress');
    const text = document.getElementById('progress-text');
    
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    runProgressAnim(circle, text, '--progress', targetPercent, progressTimerObj, 0, Infinity, finish);

    // 第二层终极兜底：1秒后强制完成，万无一失
    setTimeout(finish, 1000);
  });
}

function animateMiniProgress(targetPercent) {
  return new Promise(resolve => {
    const circle = document.getElementById('top-progress');
    const text = document.getElementById('cycle-progress-text');
    
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    runProgressAnim(circle, text, '--mini-progress', targetPercent, miniProgressTimerObj, 0, 100, finish);

    // 第二层终极兜底：1秒强制完成
    setTimeout(finish, 1000);
  });
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

  // 初始重置为 0，强制正常白色状态
  if (bottomCircle) {
    bottomCircle.style.setProperty('--progress', 0);
    bottomCircle.dataset.progress = 'normal';
  }
  if (bottomText) bottomText.textContent = '0%';

  if (topCircle) {
    topCircle.style.setProperty('--mini-progress', 0);
    topCircle.dataset.progress = 'normal';
  }
  if (topText) topText.textContent = '0%';

  setTimeout(() => {
    // 顶部周期进度
    animateMiniProgress(calculateCycleProgress());
    
    // 工资进度
    const wageText = document.getElementById('total-wage-num')?.textContent || '0';
    const totalWage = parseFloat(wageText) || 0;
    animateProgress(calcWagePercent(totalWage));
  }, 200);
}

// ========== 滚动控制 ==========
function disableBodyScroll() {
  bodyScrollLockCount++;
  // 已经处于锁定状态，直接返回，不重复修改位置和样式
  if (bodyScrollLockCount > 1) return;

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
  bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
  // 还有弹窗未关闭，不恢复滚动
  if (bodyScrollLockCount > 0) return;

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
    // 后台计算保留3位精度，输入框展示四舍五入2位
    const calcVal = round3(total * hourly);
    moneyInput.dataset.raw = calcVal; // 隐藏原始高精度值，用于提交
    moneyInput.value = calcVal.toFixed(2);
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
  const now = new Date();
  // 只在【没有选中日期】时，才重置为当前年月+今日，不干扰手动切月
  if (!selectedDate) {
    selectedDate = formatDate(now);
    // 注释掉下面两行：不再强制覆盖 currentYear / currentMonth
    // currentYear = now.getFullYear();
    // currentMonth = now.getMonth();
  }
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
  ['record-shift', 'shift-start', 'shift-end', 'shift-start2', 'shift-end2', 'meal-start', 'record-allowance', 'record-money', 'record-remark', 'edit-id'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // 日期框保留当前选中日期（如果有），没有则用今天
  const dateInput = document.getElementById('record-date');
  if (dateInput) {
    dateInput.value = selectedDate || formatDate(new Date());
  }

  // 重置班次下拉并触发change事件，恢复到初始隐藏状态
  const shiftSelect = document.getElementById('record-shift');
  if (shiftSelect) {
    shiftSelect.value = '';
    shiftSelect.dispatchEvent(new Event('change'));
  }
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

// 精准匹配选中日期，多次渲染也保留样式
if (dateStr === selectedDate) {
  el.classList.add('selected');
} else {
  el.classList.remove('selected');
}

    el.addEventListener('click', () => {
      selectedDate = dateStr;
      if (isAdmin) {
        const dateInput = document.getElementById('record-date');
        if (dateInput) dateInput.value = dateStr;
      }
      // 点击日历只刷新样式，不切换月份
      renderUserCalendar();
      renderAdminCalendar();
    });
    calendarBody.appendChild(el);
  });
}

function renderUserCalendar() { renderCalendar('calendar-body', 'calendar-title', false); }
function renderAdminCalendar() { renderCalendar('admin-calendar-body', 'admin-calendar-title', true); }

// ========== 统计与进度更新 ==========
function renderTotalAndStat(updateMainCard = true) {
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
    totalWage += money + allow; // 直接累加数据库存储值，和表格明细完全一致

    // 工时统计保持不变
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

    const endHour = safeNum(sEnd.split(':')[0]);
    if (endHour === 21) day21++;
    if (endHour === 22) day22++;
    if (endHour === 23) day23++;
  });

  // 只更新数字，不操作进度条
  // 总工资四舍五入保留2位小数后显示
  if (updateMainCard) {
    totalWageNum.innerText = trunc2(totalWage).toFixed(2);
  }
  if (statEls['stat-work-hours']) statEls['stat-work-hours'].innerText = totalHours.toFixed(1) + ' 小时';
  if (statEls['stat-work-days']) statEls['stat-work-days'].innerText = workDays + ' 天';
  if (statEls['stat-21h-days']) statEls['stat-21h-days'].innerText = day21 + ' 天';
  if (statEls['stat-22h-days']) statEls['stat-22h-days'].innerText = day22 + ' 天';
  if (statEls['stat-23h-days']) statEls['stat-23h-days'].innerText = day23 + ' 天';
  if (statEls['stat-base-money']) statEls['stat-base-money'].innerText = '¥' + totalBase.toFixed(2);
  if (statEls['stat-allowance']) statEls['stat-allowance'].innerText = '¥' + totalAllow.toFixed(2);

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
        const money = safeNum(item.get('money'));
        const allow = safeNum(item.get('allowance'));
        totalBase += money;
        totalAllow += allow;
        totalWage += money + allow;
      });

      document.getElementById('cycle-total-title').innerText = `${listEl.dataset.cycle} 工资统计`;
      document.getElementById('cycle-total-info').innerHTML = `
        出勤天数：${workDays} 天<br>
        总工时：${totalHours.toFixed(2)} 小时<br>
        总基本工资：¥${totalBase.toFixed(2)}<br>
        总加班补贴：¥${totalAllow.toFixed(2)}<br>
        <hr style="margin:8px 0;border:1px solid rgba(0,0,0,0.1);">
        <strong>本期总工资：¥${trunc2(totalWage).toFixed(2)}</strong>
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
    const money = safeNum(item.get('money')); // 补全：读取数据库存储的基本工资
    const allow = safeNum(item.get('allowance'));
    const remark = item.get('title') || '无';

    // 直接用数据库存储的基本工资+补贴，和表格明细完全一致
    const dailyTotal = trunc2(money + allow);

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
      <div class="info-line">当日工资：<span class="money">¥${dailyTotal.toFixed(2)}</span> | 备注：${remark}</div>
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

      // 关闭弹窗
      document.getElementById('cycle-detail-overlay')?.classList.remove('show');
      enableBodyScroll();

      try {
        const data = editBtn.dataset;
        const targetDateStr = data.date;
        const targetDate = new Date(targetDateStr);

        // 1. 优先切换日历全局年月（必须最先执行）
        currentYear = targetDate.getFullYear();
        currentMonth = targetDate.getMonth();
        // 2. 赋值全局选中日期
        selectedDate = targetDateStr;

        // 3. 立刻渲染日历 → 实现【自动跳月 + 自动选中】
        renderUserCalendar();
        renderAdminCalendar();

        // 表单回填逻辑
        const shiftSelect = document.getElementById('record-shift');
        const shiftStart = document.getElementById('shift-start');
        const shiftEnd = document.getElementById('shift-end');
        const shiftStart2 = document.getElementById('shift-start2');
        const shiftEnd2 = document.getElementById('shift-end2');
        const mealStart = document.getElementById('meal-start');

        const dateInput = document.getElementById('record-date');
        if (dateInput) dateInput.value = targetDateStr;
        
        if (shiftSelect) {
          shiftSelect.value = data.shift;
          shiftSelect.dispatchEvent(new Event('change'));
        }

        if (shiftStart) {
          shiftStart.value = data.shiftStart;
          shiftStart.dispatchEvent(new Event('change'));
        }

        if (shiftEnd) shiftEnd.value = data.shiftEnd;
        if (mealStart) mealStart.value = data.mealStart;

        if (data.shift === '拼班' && shiftStart2) {
          shiftStart2.value = data.shiftStart2;
          shiftStart2.dispatchEvent(new Event('change'));
          if (shiftEnd2) shiftEnd2.value = data.shiftEnd2;
        }

        const allowanceInput = document.getElementById('record-allowance');
        const moneyInput = document.getElementById('record-money');
        const remarkInput = document.getElementById('record-remark');
        const editIdInput = document.getElementById('edit-id');
        if (allowanceInput) allowanceInput.value = data.allowance;
        if (moneyInput) moneyInput.value = data.money;
        if (remarkInput) remarkInput.value = data.remark;
        if (editIdInput) editIdInput.value = data.id;

        window.calcWorkHours?.();

      } catch (err) {
        console.error('编辑回填异常：', err);
      }

      const cancelBtn = document.getElementById('cancel-edit-btn');
      if (cancelBtn) {
        cancelBtn.style.display = 'block';
        isEditMode = true;
      }
      showToast('已进入编辑模式，修改完成后点击保存即可', 'success');
      
      setTimeout(() => {
        const targetEl = document.getElementById('record-money');
        if (targetEl) {
          targetEl.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
          });
        }
      }, 350);
      
      return;
    }

    // 删除逻辑保持不变
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

  // ✅ 新增：进入管理员页面时，强制重置取消按钮和编辑状态
  const cancelBtn = document.getElementById('cancel-edit-btn');
  if (cancelBtn) {
    cancelBtn.style.display = 'none'; // 隐藏取消按钮
  }
  clearForm(); // 清空表单和编辑状态

  setTimeout(() => loadData(), 300);
  showToast('🎉欢迎回来!管理员!🎉', 'success');
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
  initTopMiniCards();
  showToast('已返回用户页面', 'success');

  // ✅ 新增：离开管理员页面时，强制重置取消按钮状态（可选，双重保险）
  const cancelBtn = document.getElementById('cancel-edit-btn');
  if (cancelBtn) {
    cancelBtn.style.display = 'none';
  }
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
  money: round3(safeNum(
    document.getElementById('record-money')?.dataset.raw ||
    document.getElementById('record-money')?.value || 0
  )),
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
      const cancelBtn = document.getElementById('cancel-edit-btn');
      if (cancelBtn) cancelBtn.style.display = 'none';
      isEditMode = false;
      loadData();
    } catch (err) {
      showToast('保存失败', 'error');
    }
  });
// 取消编辑按钮
const cancelEditBtn = document.getElementById('cancel-edit-btn');
cancelEditBtn?.addEventListener('click', function (e) {
  e.stopPropagation();
  e.preventDefault();
  this.blur();

  clearForm();
  this.style.display = 'none';
  showToast('已取消编辑', 'error');
  // 新增
isEditMode = false;

  // 重置为今日
  const today = new Date();
  const todayStr = formatDate(today);
  const dateInput = document.getElementById('record-date');
  if (dateInput) {
    dateInput.value = todayStr;
  }

  // 切换到当前年月 + 选中今日
  currentYear = today.getFullYear();
  currentMonth = today.getMonth();
  selectedDate = todayStr;

  // 重绘日历
  renderUserCalendar();
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

    // 全流程锁：刷新中（含动画）禁止重复点击
    if (isRefreshing || isLoading) return;
    isRefreshing = true;

    const wageBox = document.querySelector('.total-wage-box');
    const refreshBtn = this;
    const wageNumEl = document.getElementById('total-wage-num');

    try {
      // 1. 进入加载状态：工资卡片显示加载遮罩
      wageBox?.classList.add('loading');
      refreshBtn.classList.add('spinning');

      // 2. 等待两个进度条全部归0完成
      await Promise.all([
        animateProgress(0),
        animateMiniProgress(0)
      ]);

      // 3. 加载最新数据
      const data = await loadData(0, false, false, false);
      if (!data) {
        showToast('数据加载失败，请重试', 'error');
        return;
      }

      // 4. 渲染日历、列表、详情统计（不更新主卡片工资数字）
      renderData(data);
      renderUserCalendar();
      renderAdminCalendar();
      renderTotalAndStat(false);

      // 5. 计算目标进度和最终工资（和主页面统计逻辑完全统一）
      // 5. 计算目标进度和最终工资（和表格明细逻辑完全一致）
      const { cycleStart, cycleEnd } = getCycleRange();
      const startStr = formatDate(cycleStart);
      const endStr = formatDate(cycleEnd);
      let totalWage = 0;

      allBillList.forEach(item => {
        const d = item.get('date') || '';
        if (d < startStr || d > endStr) return;
        if (item.get('shift') === '休息') return;
        totalWage += safeNum(item.get('money')) + safeNum(item.get('allowance'));
      });

      const targetProgress = calcWagePercent(trunc2(totalWage));
      const targetMiniProgress = calculateCycleProgress();

      // 6. 等待两个进度条从0增长到目标值
      await Promise.all([
        animateProgress(targetProgress),
        animateMiniProgress(targetMiniProgress)
      ]);

      // 7. 动画全部完成后：同步更新工资数字 + 移除加载遮罩 + 弹出成功提示
      wageNumEl.innerText = trunc2(totalWage).toFixed(2);
      showToast('数据刷新成功', 'success');

    } catch (err) {
      showToast('刷新失败，请重试', 'error');
      console.error('刷新异常：', err);
    } finally {
      // 统一清理所有状态，确保锁一定释放
      wageBox?.classList.remove('loading');
      refreshBtn.classList.remove('spinning');
      isRefreshing = false;
    }
  });

  // 初始化登录状态
// 初始化登录状态
const isAdmin = localStorage.getItem('isAdminLoggedIn') === 'true';
const today = new Date();
const todayStr = formatDate(today);
// 全局初始化：强制选中今日 + 锁定当前年月
selectedDate = todayStr;
currentYear = today.getFullYear();
currentMonth = today.getMonth();

if (isAdmin) {
  document.body.classList.add('admin-active');
  userView?.classList.add('hidden');
  adminView?.classList.remove('hidden');
  adminEntrance?.classList.add('hidden');
  const dateInput = document.getElementById('record-date');
  if (dateInput) dateInput.value = todayStr;
  // 先渲染一次日历，再加载数据
  renderUserCalendar();
  renderAdminCalendar();
  loadData();
  showToast('🎉欢迎回来!管理员!🎉', 'success');
} else {
  document.body.classList.remove('admin-active');
  userView?.classList.remove('hidden');
  adminView?.classList.add('hidden');
  adminEntrance?.classList.remove('hidden');
  loadData().then(() => {
    renderUserCalendar();
    initTopMiniCards();
  });
}
// ========== 日历 上一月 / 下一月 切换按钮 ==========
// 修正为 HTML 实际 ID
const prevMonthBtn = document.getElementById('admin-prev-month-btn');
const nextMonthBtn = document.getElementById('admin-next-month-btn');

function changeMonth(offset) {
  currentMonth += offset;
  // 跨年处理
  while (currentMonth < 0) {
    currentMonth += 12;
    currentYear -= 1;
  }
  while (currentMonth > 11) {
    currentMonth -= 12;
    currentYear += 1;
  }
  // 切换月份保留选中日期
  // selectedDate = '';
  renderUserCalendar();
  renderAdminCalendar();
  // 同步刷新统计和进度条
  renderTotalAndStat();
  initTopMiniCards();
}

// 绑定点击事件
prevMonthBtn?.addEventListener('click', function(e) {
  e.preventDefault();
  this.blur();
  changeMonth(-1);
});

nextMonthBtn?.addEventListener('click', function(e) {
  e.preventDefault();
  this.blur();
  changeMonth(1);
});

  initTimeSelect();
    // ========== 新增：全局初始化兜底 ==========
  const cancelBtn = document.getElementById('cancel-edit-btn');
  if (cancelBtn) {
    cancelBtn.style.display = 'none';
  }
});
