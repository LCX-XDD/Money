const LC_APP_ID = "PkkbpTxYiRWgHbA8h0noWSwh-gzGzoHsz";
const LC_APP_KEY = "suQbFb5BnNKjjSIEPlxfr7BW";
const LC_SERVER = "https://pkkbptxy.lc-cn-n1-shared.com";

try { AV.init({ appId: LC_APP_ID, appKey: LC_APP_KEY, serverURL: LC_SERVER }); } catch (e) {}

const Bill = AV.Object.extend('Bill');
const HOURLY_WAGE = 12.981;

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

  shiftEnd.disabled = true;
  shiftEnd2.disabled = true;
  mealStart.disabled = true;

  // 默认全部隐藏
  document.getElementById('normal-time-row').style.display = 'none';
  document.getElementById('normal-end-row').style.display = 'none';
  document.getElementById('part2-start-row').style.display = 'none';
  document.getElementById('part2-end-row').style.display = 'none';
  document.getElementById('meal-wrap').style.display = 'none';

  function updateMealStartState() {
    mealStart.disabled = !shiftEnd.value;
  }

  // 自动填充下班 + 补贴（按上班时间+9小时）
  function autoFillEndAndAllowance(startEl, endEl) {
    if (!startEl.value) return;
    const startHour = parseInt(startEl.value.split(':')[0]);
    const endHour = (startHour + 9) % 24;
    endEl.value = `${String(endHour).padStart(2, '0')}:00`;
    setAllowanceByEndHour(endHour);
  }

  // 手动改下班时，只改补贴
  function updateAllowanceByEndTime(endEl) {
    if (!endEl.value) return;
    const endHour = parseInt(endEl.value.split(':')[0]);
    setAllowanceByEndHour(endHour);
  }

  // 补贴规则统一放这里
  function setAllowanceByEndHour(endHour) {
    if (endHour === 21) allowanceInput.value = 15;
    else if (endHour === 22) allowanceInput.value = 20;
    else if (endHour === 23) allowanceInput.value = 25;
    else allowanceInput.value = 0;
  }

  // 计算工时 + 工资
  function calcWorkHours() {
    let totalHour = 0;

    // 第一段
    if (shiftStart.value && shiftEnd.value) {
      let s = parseInt(shiftStart.value.split(':')[0]);
      let e = parseInt(shiftEnd.value.split(':')[0]);
      if (e > s) totalHour += e - s;
    }

    // 拼班第二段
    if (shiftSelect.value === '拼班' && shiftStart2.value && shiftEnd2.value) {
      let s2 = parseInt(shiftStart2.value.split(':')[0]);
      let e2 = parseInt(shiftEnd2.value.split(':')[0]);
      if (e2 > s2) totalHour += e2 - s2;
    }

    // 非拼班且有饭点：减1小时
    if (shiftSelect.value !== '拼班' && mealStart.value) {
      totalHour = Math.max(0, totalHour - 1);
    }

    workHoursTip.textContent = `有效工时：${totalHour} 小时`;
    moneyInput.value = (totalHour * HOURLY_WAGE).toFixed(2);
  }

  // ========== 班次切换：核心修复拼班/早班/中班/晚班显隐 ==========
  shiftSelect.addEventListener('change', () => {
    const val = shiftSelect.value;

    // 先全部隐藏
    document.getElementById('normal-time-row').style.display = 'none';
    document.getElementById('normal-end-row').style.display = 'none';
    document.getElementById('part2-start-row').style.display = 'none';
    document.getElementById('part2-end-row').style.display = 'none';
    document.getElementById('meal-wrap').style.display = 'none';

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

    // ✅ 早班/中班/晚班：显示【第一段时间 + 饭点】
    if (val === '早班' || val === '中班' || val === '晚班') {
      document.getElementById('normal-time-row').style.display = 'flex';
      document.getElementById('normal-end-row').style.display = 'flex';
      document.getElementById('meal-wrap').style.display = 'block';
    }

    // ✅ 拼班：显示【两段时间】，隐藏饭点
    if (val === '拼班') {
      document.getElementById('normal-time-row').style.display = 'flex';
      document.getElementById('normal-end-row').style.display = 'flex';
      document.getElementById('part2-start-row').classList.remove('hidden'); // 移除hidden类
      document.getElementById('part2-start-row').style.display = 'flex';
      document.getElementById('part2-end-row').classList.remove('hidden'); // 移除hidden类
      document.getElementById('part2-end-row').style.display = 'flex';
    }

    calcWorkHours();
  });

  // ========== 第一段上班时间 ==========
  shiftStart.addEventListener('change', () => {
    if (!shiftStart.value) {
      shiftEnd.innerHTML = defaultOpt; shiftEnd.disabled = true;
      mealStart.innerHTML = defaultOpt; mealStart.disabled = true;
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

  // ========== 第一段下班时间（手动改 → 重算补贴） ==========
  shiftEnd.addEventListener('change', () => {
    updateMealStartState();
    updateAllowanceByEndTime(shiftEnd);
    calcWorkHours();
  });

  // ========== 拼班第二段上班时间 ==========
  shiftStart2.addEventListener('change', () => {
    if (!shiftStart2.value) {
      shiftEnd2.innerHTML = defaultOpt; shiftEnd2.disabled = true;
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

  // ========== 拼班第二段下班时间 ==========
  shiftEnd2.addEventListener('change', () => {
    updateAllowanceByEndTime(shiftEnd2);
    calcWorkHours();
  });

  // ========== 饭点改变 → 重算工时 ==========
  mealStart.addEventListener('change', calcWorkHours);
}

// ========== 加载数据（修复：统一用 .get()） ==========
async function loadData() {
  const query = new AV.Query(Bill);
  query.descending('createdAt');
  try {
    const res = await query.find();
    allBillList = res;
    recordDates = new Set(res.map(i => i.get('date') || ''));
    renderData(res);
    renderSalaryCalendar();
    renderTotalAndStat(); // 每次加载都刷新统计
  } catch (e) {
    showToast('数据加载失败', 'error');
    console.error(e);
  }
}

// ========== 渲染列表 ==========
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

    const timeInfo = shift === '拼班' ? `${sStart}-${sEnd} / ${sStart2}-${sEnd2}` : (sStart && sEnd ? `${sStart}-${sEnd}` : '未设置时间');
    const mealInfo = mStart ? `饭点开始：${mStart}（1小时）` : '未设置饭点';

    adminList.innerHTML += `
      <div class="item">
        <div class="item-date">${d}</div>
        <div class="item-extra">班次：${shift}｜时间：${timeInfo}｜${mealInfo}</div>
        <div class="item-extra">加班补贴：¥${allowance.toFixed(2)}</div>
        <div class="item-money">基本工资：¥${money.toFixed(2)}</div>
        <div class="item-remark">备注：${r}</div>
        <div class="item-op">
          <button class="btn-sm btn-edit" data-id="${id}" data-date="${d}" data-shift="${shift}" data-shiftStart="${sStart}" data-shiftEnd="${sEnd}" data-shiftStart2="${sStart2}" data-shiftEnd2="${sEnd2}" data-mealStart="${mStart}" data-allowance="${allowance}" data-money="${money}" data-remark="${r}">编辑</button>
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

// ========== 清空表单 ==========
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
  handleShiftChange();
}


// ========== 日历渲染 ==========
// ========== 日历渲染（自动显示班次） ==========
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

  calendarTitle.innerText = `${formatDate(cycleStart)} ~ ${formatDate(cycleEnd)}`;
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

    // ==========================================
    // 自动查找当天班次 → 自动显示
    // ==========================================
    const record = allBillList.find(item => item.get('date') === dateStr);
    if (record) {
      el.classList.add('has-record');
      const shift = record.get('shift') || '';
      // 日期 + 小字号班次
      el.innerHTML = `
        ${date.getDate()}
        <div class="shift-tag">${shift}</div>
      `;
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
  currentCycle.innerText = calendarTitle.innerText;
}

// ========== 统计（修复：全用 .get()，不报错） ==========
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

  let totalWage = 0, totalWorkHours = 0, workDays = 0;
  let day21 = 0, day22 = 0, day23 = 0;
  let totalBase = 0, totalAllow = 0;
  const cycleMap = {};

  allBillList.forEach(item => {
    const dateStr = item.get('date') || '';
    if (!dateStr) return;

    const d = new Date(dateStr);
    let cycleStart, cycleEnd;
    if (d.getDate() >= 26) {
      cycleStart = new Date(d.getFullYear(), d.getMonth(), 26);
      cycleEnd = new Date(d.getFullYear(), d.getMonth() + 1, 25);
    } else {
      cycleStart = new Date(d.getFullYear(), d.getMonth() - 1, 26);
      cycleEnd = new Date(d.getFullYear(), d.getMonth(), 25);
    }
    const cycleKey = `${formatDate(cycleStart)} ~ ${formatDate(cycleEnd)}`;
    if (!cycleMap[cycleKey]) cycleMap[cycleKey] = [];
    cycleMap[cycleKey].push(item);

    const shift = item.get('shift') || '';
    const money = parseFloat(item.get('money')) || 0;
    const allow = parseFloat(item.get('allowance')) || 0;
    const sEnd = item.get('shiftEnd') || '';
    const mStart = item.get('mealStart') || '';
    if (shift === '休息') return;

    workDays++;
    totalBase += money;
    totalAllow += allow;
    totalWage += money + allow;

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

    const endHour = parseInt(sEnd.split(':')[0]);
    if (endHour === 21) day21++;
    if (endHour === 22) day22++;
    if (endHour === 23) day23++;
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
  list.innerHTML = ''; // 先清空列表

  records.forEach(item => {
    const workDate = item.get('date') || '';
    const createdTime = new Date(item.createdAt);
    const timeStr = `${workDate} ${String(createdTime.getHours()).padStart(2,'0')}:${String(createdTime.getMinutes()).padStart(2,'0')}:${String(createdTime.getSeconds()).padStart(2,'0')}`;

    const shift = item.get('shift') || '';
    const sStart = item.get('shiftStart') || '';
    const sEnd = item.get('shiftEnd') || '';
    const sStart2 = item.get('shiftStart2') || '';
    const sEnd2 = item.get('shiftEnd2') || '';
    const money = parseFloat(item.get('money')) || 0;
    const allow = parseFloat(item.get('allowance')) || 0;
    const r = item.get('title') || '无';

    let timeInfo = '';
    if(shift === '拼班'){
      timeInfo = `${sStart}-${sEnd} / ${sStart2}-${sEnd2}`;
    }else{
      timeInfo = `${sStart}-${sEnd}`;
    }

    // 日期单独一行加粗，其他信息分行显示
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

// ========== DOM 加载完再绑定事件（关键！） ==========
document.addEventListener('DOMContentLoaded', function () {
  // 1. 【先把所有 DOM 元素全部拿到】
  const adminEntrance = document.getElementById('admin-entrance');
  const loginOverlay = document.getElementById('login-overlay');
  const adminPwdInput = document.getElementById('admin-pwd-input');
  const loginCancelBtn = document.getElementById('login-cancel');
  const loginConfirmBtn = document.getElementById('login-confirm');
  const userView = document.getElementById('user-view');
  const adminView = document.getElementById('admin-view');

  // 2. 【再做登录态恢复】
  const isAdminLoggedIn = localStorage.getItem('isAdminLoggedIn');
  if (isAdminLoggedIn === 'true' && userView && adminView && adminEntrance) {
    userView.classList.add('hidden');
    adminView.classList.remove('hidden');
    adminEntrance.classList.add('hidden');
    const now = new Date();
    selectedDate = formatDate(now);
    const dateInput = document.getElementById('record-date');
    if (dateInput) dateInput.value = selectedDate;
    loadData(); // 这里可以放心 loadData
  }

  // 3. 【再执行初始化和事件绑定】
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
        // 保存登录状态
        localStorage.setItem('isAdminLoggedIn', 'true');

        loginOverlay.classList.remove('show');
        userView.classList.add('hidden');
        adminView.classList.remove('hidden');
        adminEntrance.classList.add('hidden');

        const now = new Date();
        selectedDate = formatDate(now);
        const dateInput = document.getElementById('record-date');
        if (dateInput) dateInput.value = selectedDate;

        loadData();
      } else {
        showToast('密码错误', 'error');
      }
    });

    adminPwdInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') loginConfirmBtn.click();
    });
  }

  // 返回用户页
  const backUserBtn = document.getElementById('back-user');
  if (backUserBtn && adminView && userView && adminEntrance) {
backUserBtn.addEventListener('click', () => {
  // 退出时清除登录状态（关键！）
  localStorage.removeItem('isAdminLoggedIn');

  adminView.classList.add('hidden');
  userView.classList.remove('hidden');
  adminEntrance.classList.remove('hidden');
  clearForm();
  renderTotalAndStat();
});
  }

  // 保存
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
      } catch (e) {
        showToast('保存失败', 'error');
        console.error(e);
      }
    });
  }

  // 日历切换
  const prevMonthBtn = document.getElementById('prev-month');
  const nextMonthBtn = document.getElementById('next-month');
  if (prevMonthBtn && nextMonthBtn) {
    prevMonthBtn.addEventListener('click', () => { currentMonth--; renderSalaryCalendar(); });
    nextMonthBtn.addEventListener('click', () => { currentMonth++; renderSalaryCalendar(); });
  }

  // 详情按钮（重点：现在能打开弹窗了）
  const detailBtn = document.getElementById('detail-btn');
  const detailOverlay = document.getElementById('detail-overlay');
  const detailClose = document.getElementById('detail-close');
  if (detailBtn && detailOverlay && detailClose) {
    detailBtn.addEventListener('click', () => {
      renderTotalAndStat(); // 先刷新统计
      detailOverlay.classList.add('show');
    });
    detailClose.addEventListener('click', () => {
      detailOverlay.classList.remove('show');
    });
  }

  // 子弹窗关闭
  const cycleDetailClose = document.getElementById('cycle-detail-close');
  const cycleDetailOverlay = document.getElementById('cycle-detail-overlay');
  if (cycleDetailClose && cycleDetailOverlay) {
    cycleDetailClose.addEventListener('click', () => {
      cycleDetailOverlay.classList.remove('show');
    });
  }

  // 初始加载数据
  loadData();
});