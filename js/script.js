const LC_APP_ID = "PkkbpTxYiRWgHbA8h0noWSwh-gzGzoHsz";
const LC_APP_KEY = "suQbFb5BnNKjjSIEPlxfr7BW";
const LC_SERVER = "https://pkkbptxy.lc-cn-n1-shared.com";

// 只在未初始化时执行，避免重复定义
if (!AV.applicationId) {
  AV.init({
    appId: LC_APP_ID,
    appKey: LC_APP_KEY,
    serverURL: LC_SERVER
  });
}

const Bill = AV.Object.extend('Bill');
const HOURLY_WAGE = 2700 / 208; // 基础时薪公式

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

  if (!shiftSelect || !shiftStart || !shiftEnd || !shiftStart2 || !shiftEnd2 || !mealStart || !workHoursTip || !moneyInput || !allowanceInput) return;

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

  // 初始化：全部禁用置灰
  shiftEnd.disabled = true;
  shiftEnd2.disabled = true;
  mealStart.disabled = true;

  // 初始化时，所有时间行都隐藏
  document.getElementById('normal-time-row').classList.add('hidden');
  document.getElementById('normal-end-row').classList.add('hidden');
  document.getElementById('part2-start-row').classList.add('hidden');
  document.getElementById('part2-end-row').classList.add('hidden');
  document.getElementById('meal-wrap').classList.add('hidden');

  function updateMealStartState() {
    // 有下班时间才启用饭点
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

    // 第一段
    if (shiftStart.value && shiftEnd.value) {
      let s = parseInt(shiftStart.value.split(':')[0]);
      let e = parseInt(shiftEnd.value.split(':')[0]);
      if (e > s) totalHour += e - s;
    }

    // 拼班才加第二段
    if (shiftSelect.value === '拼班' && shiftStart2.value && shiftEnd2.value) {
      let s2 = parseInt(shiftStart2.value.split(':')[0]);
      let e2 = parseInt(shiftEnd2.value.split(':')[0]);
      if (e2 > s2) totalHour += e2 - s2;
    }

    // 非拼班才扣饭点
    if (shiftSelect.value !== '拼班' && mealStart.value) {
      totalHour = Math.max(0, totalHour - 1);
    }

    workHoursTip.textContent = `有效工时：${totalHour} 小时`;

    const dailyWage = Math.round(totalHour * HOURLY_WAGE * 1000) / 1000;
    moneyInput.value = dailyWage.toFixed(2);
  }

  shiftSelect.addEventListener('change', () => {
    const val = shiftSelect.value;

    // 先隐藏所有时间行
    document.getElementById('normal-time-row').classList.add('hidden');
    document.getElementById('normal-end-row').classList.add('hidden');
    document.getElementById('part2-start-row').classList.add('hidden');
    document.getElementById('part2-end-row').classList.add('hidden');
    document.getElementById('meal-wrap').classList.add('hidden');

    // 重置所有输入框的disabled状态
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
      // 显示第一段和饭点
      document.getElementById('normal-time-row').classList.remove('hidden');
      document.getElementById('normal-end-row').classList.remove('hidden');
      document.getElementById('meal-wrap').classList.remove('hidden');
      
      // 启用上班，下班/饭点仍由「是否选上班」控制
      shiftEnd.disabled = !shiftStart.value;
      mealStart.disabled = !shiftEnd.value;
    }

    if (val === '拼班') {
      // 显示第一段和第二段
      document.getElementById('normal-time-row').classList.remove('hidden');
      document.getElementById('normal-end-row').classList.remove('hidden');
      document.getElementById('part2-start-row').classList.remove('hidden');
      document.getElementById('part2-end-row').classList.remove('hidden');
      
      // 启用两段上班，下班由对应上班控制
      shiftEnd.disabled = !shiftStart.value;
      shiftStart2.disabled = false;
      shiftEnd2.disabled = !shiftStart2.value;
    }

    calcWorkHours();
  });

  // ========= 核心修复：上班时间改变时联动禁用下班/饭点 =========
  shiftStart.addEventListener('change', () => {
    // 没选上班时间：清空+禁用下班、饭点
    if (!shiftStart.value) {
      shiftEnd.innerHTML = defaultOpt;
      shiftEnd.disabled = true;

      mealStart.innerHTML = defaultOpt;
      mealStart.disabled = true;

      calcWorkHours();
      return;
    }
    // 选了上班时间：生成后续时段 + 启用下班
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

  // 第二段上班 → 联动第二段下班
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
}

// 防重复请求 + 自动重试，解决首次打开加载失败
let isLoading = false;
async function loadData(retryCount = 0) {
  if (isLoading) return;
  isLoading = true;

  // 显示加载动画
  document.querySelectorAll('.loading-spinner').forEach(el => el.style.display = 'inline-block');
  document.getElementById('total-wage-num').style.opacity = '0.5';
  document.getElementById('current-cycle').style.opacity = '0.5';

  try {
    const query = new AV.Query(Bill);
    query.descending('createdAt');
    const res = await query.find();
    
    allBillList = res;
    recordDates = new Set(res.map(i => i.get('date') || ''));
    renderData(res);
    renderSalaryCalendar();
    renderTotalAndStat();

    // 隐藏加载动画
    document.querySelectorAll('.loading-spinner').forEach(el => el.style.display = 'none');
    document.getElementById('total-wage-num').style.opacity = '1';
    document.getElementById('current-cycle').style.opacity = '1';
  } catch (e) {
    if (retryCount < 3) {
      setTimeout(() => {
        loadData(retryCount + 1);
      }, 1000);
      return;
    }
    showToast('数据加载失败，请刷新', 'error');
    document.querySelectorAll('.loading-spinner').forEach(el => el.style.display = 'none');
    document.getElementById('total-wage-num').style.opacity = '1';
    document.getElementById('current-cycle').style.opacity = '1';
  } finally {
    isLoading = false;
  }
}

function renderData(list) {
  const adminList = document.getElementById('admin-list');
  if (!adminList) return;
  adminList.innerHTML = '';
  if (!list.length) return;

  list.forEach(item => {
    const d = item.get('date') || '';
    const shift = item.get('shift') || '';
    const sStart = item.get('shiftStart') || '';
    const sEnd = item.get('shiftEnd') || '';
    const sStart2 = item.get('shiftStart2') || '';
    const sEnd2 = item.get('shiftEnd2') || '';
    const mStart = item.get('mealStart') || '';
    const allowance = parseFloat(item.get('allowance')) || 0;
    const money = parseFloat(item.get('money')) || 0;
    const r = item.get('title') || '';
    const id = item.id;

    // 拼班强制显示两段，哪怕空
    let timeInfo = '';
    if (shift === '拼班') {
      const t1 = (sStart && sEnd) ? `${sStart}-${sEnd}` : '未设置';
      const t2 = (sStart2 && sEnd2) ? `${sStart2}-${sEnd2}` : '未设置';
      timeInfo = t1 + ' / ' + t2;
    } else {
      timeInfo = (sStart && sEnd) ? `${sStart}-${sEnd}` : '未设置时间';
    }

    const mealInfo = mStart ? `饭点开始：${mStart}（1小时）` : '未设置饭点';

    adminList.innerHTML += `
      <div class="item">
        <div class="item-date">${d}</div>
        <div class="item-extra">班次：${shift}｜时间：${timeInfo}｜${mealInfo}</div>
        <div class="item-extra">加班补贴：¥${allowance.toFixed(2)}</div>
        <div class="item-money">基本工资：¥${money.toFixed(2)}</div>
        <div class="item-remark">备注：${r}</div>
        <div class="item-op">
          <button class="btn-sm btn-edit" 
            data-id="${id}" 
            data-date="${d}" 
            data-shift="${shift}"
            data-shiftStart="${sStart}" 
            data-shiftEnd="${sEnd}"
            data-shiftStart2="${sStart2}" 
            data-shiftEnd2="${sEnd2}"
            data-mealStart="${mStart}"
            data-allowance="${allowance}"
            data-money="${money}"
            data-remark="${r}"
          >编辑</button>
          <button class="btn-sm btn-del" data-id="${id}">删除</button>
        </div>
      </div>`;
  });

  document.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', function () {
      const dateInput = document.getElementById('record-date');
      const shiftSelect = document.getElementById('record-shift');
      if (dateInput) dateInput.value = this.dataset.date;
      if (shiftSelect) shiftSelect.value = this.dataset.shift;

      const shiftStart = document.getElementById('shift-start');
      const shiftEnd = document.getElementById('shift-end');
      const shiftStart2 = document.getElementById('shift-start2');
      const shiftEnd2 = document.getElementById('shift-end2');
      const mealStart = document.getElementById('meal-start');
      const allowanceInput = document.getElementById('record-allowance');
      const moneyInput = document.getElementById('record-money');
      const remarkInput = document.getElementById('record-remark');
      const editId = document.getElementById('edit-id');

      if (shiftStart) shiftStart.value = this.dataset.shiftStart;
      if (shiftEnd) shiftEnd.value = this.dataset.shiftEnd;
      if (shiftStart2) shiftStart2.value = this.dataset.shiftStart2;
      if (shiftEnd2) shiftEnd2.value = this.dataset.shiftEnd2;
      if (mealStart) mealStart.value = this.dataset.mealStart;
      if (allowanceInput) allowanceInput.value = this.dataset.allowance;
      if (moneyInput) moneyInput.value = this.dataset.money;
      if (remarkInput) remarkInput.value = this.dataset.remark;
      if (editId) editId.value = this.dataset.id;
      selectedDate = this.dataset.date;
      renderSalaryCalendar();
    });
  });

  document.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('确定删除该条记录？')) return;
      try {
        await AV.Object.createWithoutData('Bill', btn.dataset.id).destroy();
        loadData();
        showToast('删除成功', 'success');
      } catch (e) {
        showToast('删除失败', 'error');
      }
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

// ========== 渲染工资日历和计薪周期 ==========
function renderSalaryCalendar() {
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
      el.classList.add('has-record');
      const shift = record.get('shift') || '';
      el.innerHTML = `${date.getDate()}<div class="shift-tag">${shift}</div>`;
    } else {
      el.textContent = date.getDate();
    }

    if (selectedDate === dateStr) el.classList.add('selected');
    el.addEventListener('click', () => {
      selectedDate = dateStr;
      const dateInput = document.getElementById('record-date');
      if (dateInput) dateInput.value = dateStr;
      renderSalaryCalendar();
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

  if (!totalWageNum || !statWorkHours || !statWorkDays || !stat21hDays || !stat22hDays || !stat23hDays || !statBaseMoney || !statAllowance || !cycleGroupList) return;

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

  cycleGroupList.innerHTML = '';
  Object.keys(cycleMap).forEach(cycleKey => {
    const group = document.createElement('div');
    group.className = 'cycle-group';
    group.innerHTML = `
      <div class="cycle-header" data-cycle="${cycleKey}">
        <span>${cycleKey}</span>
        <span class="arrow">▶</span>
      </div>
    `;
    cycleGroupList.appendChild(group);
    group.querySelector('.cycle-header').addEventListener('click', () => {
      openCycleDetailPopup(cycleKey, cycleMap[cycleKey]);
    });
  });

  totalWageNum.innerText = totalWage.toFixed(2);
  statWorkHours.innerText = totalWorkHours.toFixed(1);
  statWorkDays.innerText = workDays;
  stat21hDays.innerText = day21;
  stat22hDays.innerText = day22;
  stat23hDays.innerText = day23;
  statBaseMoney.innerText = totalBase.toFixed(2);
  statAllowance.innerText = totalAllow.toFixed(2);
}

// ========== 周期明细弹窗 ==========
function openCycleDetailPopup(cycleKey, records) {
  const cycleDetailTitle = document.getElementById('cycle-detail-title');
  const list = document.getElementById('cycle-detail-record-list');
  const cycleDetailOverlay = document.getElementById('cycle-detail-overlay');

  if (!cycleDetailTitle || !list || !cycleDetailOverlay) return;

  cycleDetailTitle.innerText = cycleKey;
  list.innerHTML = '';

  const btnBox = document.createElement('div');
  btnBox.style.textAlign = 'center';
  btnBox.style.marginBottom = '10px';
  
  const calcBtn = document.createElement('button');
  calcBtn.innerText = '查看本期总工资';
  calcBtn.className = 'btn-primary';
  calcBtn.style.padding = '6px 14px';
  calcBtn.style.borderRadius = '4px';
  calcBtn.style.cursor = 'pointer';
  
  calcBtn.onclick = function () {
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
      <hr style="margin:8px 0">
      <strong>本期总工资：¥${totalWage.toFixed(2)}</strong>
    `;

    document.getElementById('cycle-total-overlay').classList.add('show');
  };

  btnBox.appendChild(calcBtn);
  list.appendChild(btnBox);

  records.forEach(item => {
    const workDate = item.get('date') || '';
    const createdTime = new Date(item.createdAt);
    const timeStr = `${workDate} ${String(createdTime.getHours()).padStart(2, '0')}:${String(createdTime.getMinutes()).padStart(2, '0')}:${String(createdTime.getSeconds()).padStart(2, '0')}`;

    const shift = item.get('shift') || '';
    const sStart = item.get('shiftStart') || '';
    const sEnd = item.get('shiftEnd') || '';
    const sStart2 = item.get('shiftStart2') || '';
    const sEnd2 = item.get('shiftEnd2') || '';
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

    list.insertAdjacentHTML('beforeend', `
      <div class="cycle-detail-item">
        <span class="date-text">${timeStr}</span>
        <div class="info-line">班次：${shift} | 时间：${timeInfo}</div>
        <div class="info-line">当日工资：<span class="money">¥${(money + allow).toFixed(2)}</span> | 备注：${r}</div>
      </div>
    `);
  });

  cycleDetailOverlay.classList.add('show');
}

document.addEventListener('DOMContentLoaded', function () {
  const adminEntrance = document.getElementById('admin-entrance');
  const loginOverlay = document.getElementById('login-overlay');
  const adminPwdInput = document.getElementById('admin-pwd-input');
  const loginCancelBtn = document.getElementById('login-cancel');
  const loginConfirmBtn = document.getElementById('login-confirm');
  const userView = document.getElementById('user-view');
  const adminView = document.getElementById('admin-view');

  const isAdminLoggedIn = localStorage.getItem('isAdminLoggedIn');
  if (isAdminLoggedIn === 'true' && userView && adminView && adminEntrance) {
    userView.classList.add('hidden');
    adminView.classList.remove('hidden');
    adminEntrance.classList.add('hidden');
    const now = new Date();
    selectedDate = formatDate(now);
    const dateInput = document.getElementById('record-date');
    if (dateInput) dateInput.value = selectedDate;
    loadData();
  }

  initTimeSelect();

  if (adminEntrance && loginOverlay && adminPwdInput && loginCancelBtn && loginConfirmBtn && userView && adminView) {
    adminEntrance.addEventListener('click', () => {
      loginOverlay.classList.add('show');
      adminPwdInput.value = '';
      adminPwdInput.focus();
    });

    loginCancelBtn.addEventListener('click', () => {
      loginOverlay.classList.remove('show');
    });

    loginConfirmBtn.addEventListener('click', () => {
      const pwd = adminPwdInput.value.trim();
      if (pwd === 'admin123') {
        localStorage.setItem('isAdminLoggedIn', 'true');
        loginOverlay.classList.remove('show');
        userView.classList.add('hidden');
        adminView.classList.remove('hidden');
        adminEntrance.classList.add('hidden');
        const now = new Date();
        selectedDate = formatDate(now);
        const dateInput = document.getElementById('record-date');
        if (dateInput) dateInput.value = selectedDate;
        setTimeout(() => loadData(), 300);
      } else {
        showToast('密码错误', 'error');
      }
    });

    adminPwdInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') loginConfirmBtn.click();
    });
  }

  const backUserBtn = document.getElementById('back-user');
  if (backUserBtn && adminView && userView && adminEntrance) {
    backUserBtn.addEventListener('click', () => {
      localStorage.removeItem('isAdminLoggedIn');
      adminView.classList.add('hidden');
      userView.classList.remove('hidden');
      adminEntrance.classList.remove('hidden');
      clearForm();
      renderTotalAndStat();
    });
  }

  const saveBtn = document.getElementById('save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
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
  bill.set('shiftEnd2', sEnd2);   // ✅ 修复这里！
  bill.set('mealStart', mStart);
  bill.set('allowance', allowance);
  bill.set('money', money);
  bill.set('title', r);
  bill.set('type', 'income');
  await bill.save();
  clearForm();
  loadData();
  showToast('保存成功', 'success');
} catch (e) {
  showToast('保存失败', 'error');
  console.error(e);
}
    });
  }

  const prevMonthBtn = document.getElementById('prev-month');
  const nextMonthBtn = document.getElementById('next-month');
  if (prevMonthBtn && nextMonthBtn) {
    prevMonthBtn.addEventListener('click', () => { currentMonth--; renderSalaryCalendar(); });
    nextMonthBtn.addEventListener('click', () => { currentMonth++; renderSalaryCalendar(); });
  }

  const detailBtn = document.getElementById('detail-btn');
  const detailOverlay = document.getElementById('detail-overlay');
  const detailClose = document.getElementById('detail-close');
  if (detailBtn && detailOverlay && detailClose) {
    detailBtn.addEventListener('click', () => {
      renderTotalAndStat();
      detailOverlay.classList.add('show');
    });
    detailClose.addEventListener('click', () => {
      detailOverlay.classList.remove('show');
    });
  }

  const cycleDetailClose = document.getElementById('cycle-detail-close');
  const cycleDetailOverlay = document.getElementById('cycle-detail-overlay');
  if (cycleDetailClose && cycleDetailOverlay) {
    cycleDetailClose.addEventListener('click', () => {
      cycleDetailOverlay.classList.remove('show');
    });
  }

  const cycleTotalClose = document.getElementById('cycle-total-close');
  const cycleTotalOverlay = document.getElementById('cycle-total-overlay');
  if (cycleTotalClose && cycleTotalOverlay) {
    cycleTotalClose.addEventListener('click', () => {
      cycleTotalOverlay.classList.remove('show');
    });
  }

// 延迟 500 毫秒加载，解决 SDK 未初始化完成导致的失败
setTimeout(() => {
  loadData();
}, 500);
});
// 首页刷新按钮点击事件
document.getElementById('refresh-data-btn').addEventListener('click',async ()=>{
  // 1. 还原加载动画
  document.querySelector('#current-cycle').innerHTML = '<span class="loading-spinner"></span>';
  document.querySelector('#total-wage-num').innerHTML = '<span class="loading-spinner"></span>';
  // 2. 重新拉取数据
  await loadData();
  // 3. 弹窗提示刷新成功
  showToast('数据刷新成功','success');
})
// ==============================================
// 最终稳定版 · 日历左右滑动（不空白、不报错、不消失）
// ==============================================
function initCalendarSwipe() {
  const slider = document.getElementById('calTrack');
  if (!slider) return;

  let startX = 0;
  let moveX = 0;
  let isTouch = false;

  slider.addEventListener('touchstart', (e) => {
    startX = e.touches[0].clientX;
    slider.style.transition = 'none';
    isTouch = true;
  }, { passive: true });

  slider.addEventListener('touchmove', (e) => {
    if (!isTouch) return;
    moveX = e.touches[0].clientX - startX;
    slider.style.transform = `translateX(calc(-100% + ${moveX}px))`;
  }, { passive: true });

  slider.addEventListener('touchend', () => {
    isTouch = false;
    slider.style.transition = 'transform 0.3s ease';
    const w = window.innerWidth / 3;

    if (moveX > w) {
      currentMonth--;
    } else if (moveX < -w) {
      currentMonth++;
    }

    renderSalaryCalendar();
    slider.style.transform = 'translateX(-100%)';
    moveX = 0;
  });
}

// 页面加载完成后初始化滑动
window.addEventListener('load', () => {
  initCalendarSwipe();
});
