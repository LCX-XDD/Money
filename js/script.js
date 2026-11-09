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
let currentCycleTotalWage = 0; // 本期悬赏金总额（真实计算值，供进度环/金币雨复用，避免读滚动中的文本）
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

// HTML 转义，避免备注里的 & < > " ' 破坏 DOM 或注入脚本
function escapeHtml(str) {
  return String(str === null || str === undefined ? '' : str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
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

// 涨水动画时长（毫秒）：水涨得慢一点更像真的漫上来，太短会显得只是整体平移
const PROGRESS_DURATION = 1200;
// 刷新时归零用的时长，短一些，避免刷新的等待感太重
const PROGRESS_RESET_DURATION = 360;

function calcWagePercent(totalWage) {
  return Math.max(0, Math.round(safeNum(totalWage) / BASE_SALARY * 100));
}

// ===== 环形进度条（对应 CSS 里 stroke-dasharray: 282.743，半径 45 的周长）=====
const RING_CIRC = 282.743;

function setRingProgress(el, percent) {
  if (!el) return;
  const bar = el.querySelector('.t-ring-bar');
  if (!bar) return;
  const p = Math.max(0, Math.min(100, safeNum(percent)));
  bar.style.strokeDashoffset = (RING_CIRC * (1 - p / 100)).toFixed(2);
}

// 从环上反读当前百分比：动画被打断时能接着涨，不会跳回 0
function getRingProgress(el) {
  if (!el) return 0;
  const bar = el.querySelector('.t-ring-bar');
  if (!bar) return 0;
  const off = parseFloat(bar.style.strokeDashoffset);
  if (!isFinite(off)) return 0;
  return Math.max(0, Math.min(100, (1 - off / RING_CIRC) * 100));
}

function runProgressAnim(circleEl, textEl, cssVar, targetPercent, timerRef, min = 0, max = Infinity, onFinish = null, duration = PROGRESS_DURATION) {
  if (!circleEl || !textEl) {
    onFinish?.();
    return;
  }

  // 取消上一个未完成的动画，以及它挂着的兜底定时器（否则旧目标会在 550ms 时把新值覆盖掉）
  if (timerRef.value) {
    cancelAnimationFrame(timerRef.value);
    timerRef.value = null;
  }
  if (timerRef.timeout) {
    clearTimeout(timerRef.timeout);
    timerRef.timeout = null;
  }

  // 原始目标值（可能 >100，用于判定“超标”），显示用的值再做范围限制
  const rawTarget = safeNum(targetPercent);
  targetPercent = Math.max(min, Math.min(max, rawTarget));
  // 从环上当前进度接着涨，动画被打断也不会跳回 0
  const startVal = Math.max(min, Math.min(max, getRingProgress(circleEl)));

  // 先落到起始角度，避免第一帧跳变
  setRingProgress(circleEl, startVal);
  if (cssVar === '--progress') {
    circleEl.dataset.progress = rawTarget > 100 ? 'over' : 'normal';
  }

  const startTime = performance.now();

  // 水位和数字一起逐帧推进：水层高度与计数完全同步，不再依赖 CSS transition
  function animateFrame(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // 正弦缓动：起步轻、中间匀速、收尾缓，比纯缓出更像水慢慢漫上来
    const eased = -(Math.cos(Math.PI * progress) - 1) / 2;
    const floatVal = startVal + (targetPercent - startVal) * eased;
    setRingProgress(circleEl, floatVal);
    // 当前实时百分比
    textEl.textContent = `${Math.round(floatVal)}%`;

    if (progress < 1) {
      timerRef.value = requestAnimationFrame(animateFrame);
    } else {
      timerRef.value = null;
      if (timerRef.timeout) {
        clearTimeout(timerRef.timeout);
        timerRef.timeout = null;
      }
      onFinish?.();
    }
  }

  timerRef.value = requestAnimationFrame(animateFrame);

  // 超时兜底：动画正常结束时会清掉，不会回头覆盖下一次动画
  timerRef.timeout = setTimeout(() => {
    timerRef.timeout = null;
    if (timerRef.value) {
      cancelAnimationFrame(timerRef.value);
      timerRef.value = null;
    }
    // 兜底时环也要落到终值，否则会出现“数字到头、环没满”的错位
    setRingProgress(circleEl, targetPercent);
    textEl.textContent = `${targetPercent}%`;
    if (cssVar === '--progress') {
      circleEl.dataset.progress = rawTarget > 100 ? 'over' : 'normal';
    }
    onFinish?.();
  }, duration + 50);
}


function animateProgress(targetPercent, duration = PROGRESS_DURATION) {
  return new Promise(resolve => {
    const circle = document.getElementById('bottom-progress');
    const text = document.getElementById('progress-text');
    
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    runProgressAnim(circle, text, '--progress', targetPercent, progressTimerObj, 0, Infinity, finish, duration);

    // 第二层终极兜底：动画时长之后仍没结束就强制完成，万无一失
    setTimeout(finish, duration + 400);
  });
}

function animateMiniProgress(targetPercent, duration = PROGRESS_DURATION) {
  return new Promise(resolve => {
    const circle = document.getElementById('top-progress');
    const text = document.getElementById('cycle-progress-text');
    
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };

    runProgressAnim(circle, text, '--mini-progress', targetPercent, miniProgressTimerObj, 0, 100, finish, duration);

    // 第二层终极兜底
    setTimeout(finish, duration + 400);
  });
}

// ========== 水面物理：重力方向驱动水面 ==========
// 水面是一条水平直线，倾角来自“重力方向”：
//   手机 / 平板 → 陀螺仪（左右侧倾 gamma），进页面就自动开
//   电脑        → 鼠标位置（鼠标在哪，哪边就是“下”）
// 每个球各记一套弹簧状态：鼠标模式下两个球离鼠标的位置不同，倾斜角也各自不同。
const waterLayers = [];
let waterRafId = null;
let lastWaterTs = 0;

const TILT_MAX = 34;          // 陀螺仪模式下的最大水面倾角（度）
const TILT_GAIN = 0.95;       // 陀螺仪灵敏度，1 表示完全跟随
const MOUSE_TILT_MAX = 52;    // 鼠标模式下的最大倾角，鼠标当重力源可以夸张一点
const TILT_STIFFNESS = 24;    // 弹簧刚度：越大跟手越紧
const TILT_DAMPING = 6.2;     // 阻尼：越小回摆越多，越大越黏

// 水层是球的 300%（球 100px → 水层 300px），旋转轴在水层中心、也就是水面以下 150px。
// 绕这么远的轴旋转会把水位整体抬起来，所以按 -150*(1-cosθ) 做位移补偿（体积不变，只改倾角）。
const WATER_PIVOT_DEPTH = 150;

const USE_GYRO = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
  || (navigator.maxTouchPoints > 0 && 'ontouchstart' in window);

let gyroTilt = 0;       // 陀螺仪算出的目标倾角（所有球共用）
let gyroStarted = false;

const pointerState = { x: 0, y: 0, has: false };

function initWaterLayers() {
  waterLayers.length = 0;
  document.querySelectorAll('.progress-circle').forEach(circle => {
    const el = circle.querySelector('.wave-layer');
    if (!el) return;
    waterLayers.push({
      el,
      circle,                 // 鼠标模式要用球心坐标算重力方向
      seed: Math.random() * 10,
      angle: 0,               // 当前渲染倾角
      vel: 0,                 // 角速度
      target: 0
    });
  });
  // 进度条已换成环形（没有水层），没有水面就没有重力可言，直接不启动感应，也避免无意义的陀螺仪授权
  if (!waterLayers.length) return;
  startWaterLoop();
  if (USE_GYRO) initGyro();
  else initPointerGravity();
}

function startWaterLoop() {
  if (waterRafId !== null || !waterLayers.length) return;
  lastWaterTs = performance.now();
  waterRafId = requestAnimationFrame(waterTick);
}

function stopWaterLoop() {
  if (waterRafId !== null) {
    cancelAnimationFrame(waterRafId);
    waterRafId = null;
  }
}

function waterTick(now) {
  // 帧间隔超过 60ms（切后台/掉帧）就按 60ms 算，避免水面跳一大下
  const dt = Math.min(now - lastWaterTs, 60) / 1000;
  lastWaterTs = now;

  // 电脑模式：每一帧都按鼠标当前位置重算两个球的重力方向
  if (!USE_GYRO) updatePointerGravity();

  const t = now / 1000;
  for (const w of waterLayers) {
    // 弹簧-阻尼：欠阻尼（阻尼比 ~0.63），方向一变就先冲过头再荡回来，像水
    w.vel += ((w.target - w.angle) * TILT_STIFFNESS - w.vel * TILT_DAMPING) * dt;
    w.angle += w.vel * dt;
    if (Math.abs(w.target - w.angle) < 0.02 && Math.abs(w.vel) < 0.05) {
      w.angle = w.target;
      w.vel = 0;
    }

    const rad = w.angle * Math.PI / 180;
    // 抵消绕远处轴心旋转带来的水位抬升
    const levelFix = -WATER_PIVOT_DEPTH * (1 - Math.cos(rad));
    // 水位轻微起伏，像被晃一下之后的余波
    const bob = Math.sin(t * 1.7 + w.seed) * 1.4;

    w.el.style.transform =
      `translate3d(0, ${(bob + levelFix).toFixed(2)}px, 0) rotate(${w.angle.toFixed(2)}deg)`;
  }

  waterRafId = requestAnimationFrame(waterTick);
}

// ========== 电脑：鼠标位置就是“下” ==========
function initPointerGravity() {
  window.addEventListener('pointermove', e => {
    pointerState.x = e.clientX;
    pointerState.y = e.clientY;
    pointerState.has = true;
  }, { passive: true });
}

// 重力方向 = 球心 → 鼠标；水面垂直于重力，所以
// 水面倾角 θ = atan2(-gx, gy)（屏幕坐标 y 向下为正）
//   鼠标在球正下方 → θ = 0（水面水平，水在下面）
//   鼠标在球右侧   → θ 为负（水往右边堆）
function updatePointerGravity() {
  if (!pointerState.has) return;
  for (const w of waterLayers) {
    const rect = w.circle.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const gx = pointerState.x - cx;
    const gy = pointerState.y - cy;
    const dist = Math.sqrt(gx * gx + gy * gy);
    // 鼠标几乎压在球心时方向没有意义，保持水平，避免来回乱抖
    const deg = dist < 10 ? 0 : Math.atan2(-gx, gy) * 180 / Math.PI;
    w.target = Math.max(-MOUSE_TILT_MAX, Math.min(MOUSE_TILT_MAX, deg));
  }
}

// 把 deviceorientation 的 beta/gamma 按当前屏幕方向换算成“屏幕上左右倾斜”的角度
// 取负号是因为水面要被重力拉住：手机往哪边倾，水面就朝相反方向倒（倾斜量随重力方向保持水平）
function onDeviceOrientation(e) {
  let roll = 0;
  const hasGamma = typeof e.gamma === 'number' && !Number.isNaN(e.gamma);
  const hasBeta = typeof e.beta === 'number' && !Number.isNaN(e.beta);
  // 没装陀螺仪的设备会派发三项全 null 的空事件，不能拿它把倾角归零
  if (!hasGamma && !hasBeta) return;

  const screenAngle = (screen.orientation && typeof screen.orientation.angle === 'number')
    ? screen.orientation.angle
    : (typeof window.orientation === 'number' ? window.orientation : 0);

  if (screenAngle === 90 || screenAngle === -270) {
    roll = hasBeta ? -e.beta : 0;          // 横屏（Home 键在右）
  } else if (screenAngle === -90 || screenAngle === 270) {
    roll = hasBeta ? e.beta : 0;           // 横屏（Home 键在左）
  } else if (Math.abs(screenAngle) === 180) {
    roll = hasGamma ? -e.gamma : 0;        // 倒置竖屏
  } else {
    roll = hasGamma ? e.gamma : 0;         // 正常竖屏：左右侧倾就是 gamma
  }

  gyroTilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, -roll * TILT_GAIN));
  // 事件驱动：一来数据就把每个球的目标倾角更新掉（不必等下一帧去读）
  for (const w of waterLayers) w.target = gyroTilt;
}

// 手机/平板：进页面就自动开，不需要按钮
function initGyro() {
  if (!('DeviceOrientationEvent' in window)) return;
  const DOE = window.DeviceOrientationEvent;

  if (typeof DOE.requestPermission === 'function') {
    // iOS 13+ 规定只能在用户手势里申请权限，所以在页面上的第一次触摸结束 / 点击时静默申请一次，
    // 之后不再打扰；用户允许后水面立刻跟着手机倾。（授权失败也静默，不弹提示）
    const ask = () => {
      document.removeEventListener('touchend', ask);
      document.removeEventListener('click', ask);
      DOE.requestPermission().then(state => {
        if (state === 'granted') startGyroListener();
      }).catch(() => {});
    };
    document.addEventListener('touchend', ask, { passive: true });
    document.addEventListener('click', ask);
  } else {
    // 安卓等浏览器不需要授权，直接开始监听
    startGyroListener();
  }
}

function startGyroListener() {
  if (gyroStarted) return;
  window.addEventListener('deviceorientation', onDeviceOrientation);
  gyroStarted = true;
}

// 页面切到后台暂停波纹循环，回来再继续（省电）
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopWaterLoop();
  else startWaterLoop();
});

function calculateCycleProgress() {
  const { cycleStart, cycleEnd } = getCycleRange();
  const totalMs = cycleEnd - cycleStart;
  const passedMs = Date.now() - cycleStart.getTime();
  return Math.min(Math.round((passedMs / totalMs) * 100), 100);
}

// ========== 金币雨背景 ==========
const MONEY_EMOJIS = ['💰', '💵', '💴', '💶', '💷', '🪙', '💸'];
let moneyRainTimer = null;

// ========== 工资数字滚动动画 ==========
let wageAnimId = null;
function animateWageNumber(target, duration = 1400) {
  const el = document.getElementById('total-wage-num');
  if (!el) return;
  if (wageAnimId) cancelAnimationFrame(wageAnimId);
  // 从目标值 55%~90% 之间随机起始，不是从 0 开始
  const startValue = target * (0.55 + Math.random() * 0.35);
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = startValue + (target - startValue) * eased;
    el.textContent = val.toFixed(2);
    if (t < 1) {
      wageAnimId = requestAnimationFrame(tick);
    } else {
      el.textContent = target.toFixed(2);
      wageAnimId = null;
    }
  };
  wageAnimId = requestAnimationFrame(tick);
}

function updateMoneyRain(totalWage) {
  const backLayer = document.getElementById('money-rain-back');
  const frontLayer = document.getElementById('money-rain-front');
  if (!backLayer || !frontLayer) return;
  // 数量随悬赏金额：每 60 块 1 个，最少 12 个，最多 60 个
  const total = Math.max(12, Math.min(60, Math.round(safeNum(totalWage) / 60) + 6));
  if (backLayer.dataset.count === String(total) && frontLayer.dataset.count === String(total)) return;
  backLayer.dataset.count = String(total);
  frontLayer.dataset.count = String(total);
  backLayer.innerHTML = '';
  frontLayer.innerHTML = '';

  // 动态计算卡片顶部位置和水平范围（比卡片略窄一点）
  const card = document.querySelector('.progress-window');
  let landLeftPct = 25, landRightPct = 75, landY = 26;
  if (card) {
    const r = card.getBoundingClientRect();
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    // 水平范围：卡片左右各向内缩 8%
    landLeftPct = (r.left / w * 100) + 2;
    landRightPct = (r.right / w * 100) - 2;
    // 垂直位置：卡片顶部（vh）
    landY = (r.top / h * 100);
  }

  // 80% 在卡片后面，20% 在卡片前面飘过
  const backCount = Math.floor(total * 0.8);
  const frontCount = total - backCount;

  function makeDrop() {
    const el = document.createElement('span');
    const leftPct = Math.random() * 100;
    el.className = 'money-drop';
    el.textContent = MONEY_EMOJIS[Math.floor(Math.random() * MONEY_EMOJIS.length)];
    el.style.left = leftPct + '%';
    el.style.fontSize = (18 + Math.random() * 22) + 'px';
    el.style.opacity = (0.45 + Math.random() * 0.35).toFixed(2);
    const dur = 6 + Math.random() * 9;
    el.style.animationDuration = dur + 's';
    el.style.animationDelay = (-Math.random() * dur) + 's';
    return el;
  }
  for (let i = 0; i < backCount; i++) backLayer.appendChild(makeDrop());
  for (let i = 0; i < frontCount; i++) frontLayer.appendChild(makeDrop());

  // 鼠标点击时在点击位置生成一个金钱图标（大小随机，从点击位置下落，8 秒后消失）
  if (!window._moneyClickBound) {
    window._moneyClickBound = true;
    document.addEventListener('click', function (e) {
      if (e.target.closest('button, input, select, textarea, a, #music-player, .modal-overlay, .drawer-overlay')) return;
      const sp = document.getElementById('money-rain-front');
      if (!sp) return;
      const el = document.createElement('span');
      el.className = 'money-drop';
      el.textContent = MONEY_EMOJIS[Math.floor(Math.random() * MONEY_EMOJIS.length)];
      el.style.left = (e.clientX - 10) + 'px';
      el.style.top = (e.clientY - 10) + 'px';
      el.style.fontSize = (18 + Math.random() * 22) + 'px';
      el.style.opacity = '1';
      el.style.animation = 'none';
      // 从点击位置开始下落，到底部停 2 秒后淡出
      sp.appendChild(el);
      const startY = e.clientY;
      const endY = window.innerHeight - 40;
      const dist = endY - startY;
      el.animate([
        { transform: 'translateY(0) rotate(0deg)', opacity: 1 },
        { transform: 'translateY(' + dist + 'px) rotate(180deg)', opacity: 1, offset: 0.8 },
        { transform: 'translateY(' + dist + 'px) rotate(180deg)', opacity: 1, offset: 0.95 },
        { transform: 'translateY(' + dist + 'px) rotate(180deg)', opacity: 0 }
      ], { duration: 8000, easing: 'ease-in', fill: 'forwards' });
      setTimeout(() => el.remove(), 8000);
    });
  }
}

// 切换设备/窗口尺寸变化时，重新散落金币位置
window.addEventListener('resize', () => {
  // 用真实计算值，不读正在滚动的数字文本
  updateMoneyRain(currentCycleTotalWage);
});
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    updateMoneyRain(currentCycleTotalWage);
  }, 300);
});

function initTopMiniCards() {
  const topCircle = document.getElementById('top-progress');
  const topText = document.getElementById('cycle-progress-text');

  // 这里只负责顶部“抓猪进度”（计薪周期已流过的时间百分比）
  // 底部“悬赏进度”统一由 renderTotalAndStat / 刷新按钮驱动，避免首次加载时读到滚动中的工资文本
  if (topCircle) {
    setRingProgress(topCircle, 0);
    topCircle.dataset.progress = 'normal';
  }
  if (topText) topText.textContent = '0%';

  setTimeout(() => {
    animateMiniProgress(calculateCycleProgress());
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

// ========== TDesign Alert 顶部警告提示 ==========
const ALERT_ICONS = {
  info: '<svg viewBox="0 0 24 24" fill="currentColor" class="alert-icon"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>',
  success: '<svg viewBox="0 0 24 24" fill="currentColor" class="alert-icon"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.5-3.2-3.2 1.4-1.4 1.8 1.8 4.6-4.6 1.4 1.4-6 6z"/></svg>',
  warning: '<svg viewBox="0 0 24 24" fill="currentColor" class="alert-icon"><path d="M12 2 1 21h22L12 2zm-1 14h2v2h-2v-2zm0-6h2v4h-2v-4z"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="currentColor" class="alert-icon"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.5 14.1L14.1 17.5 12 15.4l-2.1 2.1-1.4-1.4 2.1-2.1-2.1-2.1 1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1 2.1 2.1z"/></svg>'
};

function getAlertStack() {
  let stack = document.getElementById('alert-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'alert-stack';
    stack.className = 'alert-stack';
    document.body.appendChild(stack);
  }
  return stack;
}

// theme: info / success / warning / error；description 有值时显示二级描述
function showAlert(opts) {
  const { theme = 'info', title = '', description = '', duration = null, closable = true } = opts;
  const stack = getAlertStack();
  const el = document.createElement('div');
  el.className = `t-alert ${theme}`;
  const descHtml = description ? `<div class="alert-desc">${escapeHtml(description)}</div>` : '';
  const closeHtml = closable ? '<button class="alert-close" type="button" aria-label="关闭">×</button>' : '';
  el.innerHTML = `
    ${ALERT_ICONS[theme] || ALERT_ICONS.info}
    <div class="alert-main">
      <div class="alert-title">${escapeHtml(title)}</div>
      ${descHtml}
    </div>
    ${closeHtml}
  `;
  stack.appendChild(el);

  const remove = () => {
    if (!el.isConnected) return;
    el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-6px)';
    setTimeout(() => el.remove(), 200);
  };

  el.querySelector('.alert-close')?.addEventListener('click', remove);

  // 自动消失：成功/信息 2600ms；警告/错误 5000ms（有描述停留更久）
  const auto = duration ?? (theme === 'success' || theme === 'info' ? 2600 : (description ? 5200 : 3600));
  setTimeout(remove, auto);
  return el;
}

// ========== TDesign Popconfirm 气泡确认 ==========
let activePopconfirm = null;

function closePopconfirm() {
  if (activePopconfirm) {
    activePopconfirm.remove();
    activePopconfirm = null;
  }
}

// theme: warning（编辑，中等风险，黄色）/ danger（删除，高危，红色）
function popconfirm(opts) {
  closePopconfirm();
  const { anchor, theme = 'warning', title = '', description = '', confirmText = '确认', cancelText = '取消', onConfirm } = opts;

  const el = document.createElement('div');
  el.className = `t-popconfirm ${theme}`;
  const iconPath = theme === 'danger'
    ? '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 14h-2v2h2v-2zm0-9h-2v6h2V7z"/>'
    : '<path d="M12 2 1 21h22L12 2zm-1 14h2v2h-2v-2zm0-6h2v4h-2v-4z"/>';
  el.innerHTML = `
    <div class="t-popconfirm-head">
      <svg viewBox="0 0 24 24" fill="currentColor" class="pc-icon">${iconPath}</svg>
      <div class="pc-text">
        <div class="pc-title">${escapeHtml(title)}</div>
        ${description ? `<div class="pc-desc">${escapeHtml(description)}</div>` : ''}
      </div>
    </div>
    <div class="t-popconfirm-actions">
      <button class="pc-btn" type="button" data-act="cancel">${escapeHtml(cancelText)}</button>
      <button class="pc-btn primary" type="button" data-act="confirm">${escapeHtml(confirmText)}</button>
    </div>
  `;
  document.body.appendChild(el);

  // 定位：锚点按钮上方居中，放不下就翻到下方
  const rect = anchor.getBoundingClientRect();
  const ew = el.offsetWidth, eh = el.offsetHeight;
  let left = rect.left + rect.width / 2 - ew / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - ew - 12));
  let top = rect.top - eh - 10;
  if (top < 12) top = rect.bottom + 10;
  el.style.left = left + 'px';
  el.style.top = top + 'px';

  el.querySelector('[data-act="cancel"]').addEventListener('click', closePopconfirm);
  el.querySelector('[data-act="confirm"]').addEventListener('click', function () {
    closePopconfirm();
    onConfirm && onConfirm();
  });

  // 点气泡外任意处关闭
  setTimeout(() => {
    const onDocClick = (e) => {
      if (!el.isConnected) { document.removeEventListener('click', onDocClick, true); return; }
      if (!el.contains(e.target)) {
        closePopconfirm();
        document.removeEventListener('click', onDocClick, true);
      }
    };
    document.addEventListener('click', onDocClick, true);
  }, 0);

  activePopconfirm = el;
}

// ========== 表单初始化 ==========
function initTimeSelect() {
  const shiftSelect = document.getElementById('record-shift');
  const shiftStart = document.getElementById('shift-start');
  const shiftEnd = document.getElementById('shift-end');
  const shiftStart2 = document.getElementById('shift-start2');
  const shiftEnd2 = document.getElementById('shift-end2');
  const mealStart = document.getElementById('meal-start');
  const mealEnd = document.getElementById('meal-end');
  const workHoursTip = document.getElementById('work-hours-tip');
  const moneyInput = document.getElementById('record-money');
  const allowanceInput = document.getElementById('record-allowance');
  const dateInput = document.getElementById('record-date');
  if (!shiftSelect || !shiftStart || !shiftEnd || !shiftStart2 || !shiftEnd2 || !mealStart || !mealEnd || !workHoursTip || !moneyInput || !allowanceInput || !dateInput) return;
  const allHours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
  const allOpts = allHours.map(h => `<option value="${h}">${h}</option>`).join('');
  const workOpts = allHours.filter(h => parseInt(h) >= 8).map(h => `<option value="${h}">${h}</option>`).join('');
  const defaultOpt = '<option value="">请选择</option>';
  shiftStart.innerHTML = defaultOpt + workOpts;
  shiftStart2.innerHTML = defaultOpt + workOpts;
  shiftEnd.innerHTML = shiftEnd2.innerHTML = defaultOpt;
  shiftEnd.disabled = shiftEnd2.disabled = false;
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

  // 工具函数：时间字符串转总分钟
  function timeToMin(timeStr) {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
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

    // ==========【饭点扣除逻辑】==========
    // 直接读取开始/结束饭点时间；只填开始时默认按 1 小时饭点扣除
    const mealStartStr = mealStart.value || "";
    const mealEndStr = mealEnd.value || "";
    let mealMinusHour = 0;
    if (mealStartStr) {
      const sMin = timeToMin(mealStartStr);
      let eMin = timeToMin(mealEndStr);
      // 结束为空，默认+60分钟（1小时饭点）
      if (eMin === null) {
        eMin = sMin + 60;
      }
      if (eMin > sMin) {
        mealMinusHour = (eMin - sMin) / 60;
      }
    }
    if (mealStartStr) {
      total = Math.max(0, total - mealMinusHour);
    }

    // ======================================

    workHoursTip.textContent = `有效工时：${total} 小时`;
    const hourly = getBaseWageByDate(dateInput.value || formatDate(new Date()));
    // 后台计算保留3位精度，输入框展示四舍五入2位
    const calcVal = round3(total * hourly);
    moneyInput.dataset.raw = calcVal; // 隐藏原始高精度值，用于提交
    moneyInput.value = calcVal.toFixed(2);
  }

  // 饭点开始/结束时间变化时重算
  mealStart.addEventListener('change', calcWorkHours);
  mealEnd.addEventListener('change', calcWorkHours);

  shiftSelect.addEventListener('change', () => {
    const val = shiftSelect.value;
    ['normal-time-row', 'normal-end-row', 'part2-start-row', 'part2-end-row', 'meal-wrap'].forEach(id => {
      document.getElementById(id)?.classList.add('hidden');
    });
    if (val === '休息') {
      shiftStart.value = shiftStart2.value = '';
      shiftEnd.innerHTML = shiftEnd2.innerHTML = defaultOpt;
      moneyInput.value = '';
      allowanceInput.value = 0;
      calcWorkHours();
      return;
    }
    if (['早班', '中班', '晚班'].includes(val)) {
      document.getElementById('normal-time-row')?.classList.remove('hidden');
      document.getElementById('normal-end-row')?.classList.remove('hidden');
      document.getElementById('meal-wrap')?.classList.remove('hidden');
    }
    if (val === '拼班') {
      ['normal-time-row', 'normal-end-row', 'part2-start-row', 'part2-end-row'].forEach(id => {
        document.getElementById(id)?.classList.remove('hidden');
      });
    }
    calcWorkHours();
  });
  shiftStart.addEventListener('change', () => {
    if (!shiftStart.value) {
      shiftEnd.innerHTML = defaultOpt;
      calcWorkHours();
      return;
    }
    const startH = parseInt(shiftStart.value.split(':')[0]);
    const afterOpts = allHours.filter(h => parseInt(h.split(':')[0]) > startH).map(h => `<option value="${h}">${h}</option>`).join('');
    shiftEnd.innerHTML = defaultOpt + afterOpts;
    autoFillEnd(shiftStart, shiftEnd);
    calcWorkHours();
  });
  shiftEnd.addEventListener('change', () => {
    setAllowanceByHour(parseInt(shiftEnd.value.split(':')[0]));
    calcWorkHours();
  });
  shiftStart2.addEventListener('change', () => {
    if (!shiftStart2.value) {
      shiftEnd2.innerHTML = defaultOpt;
      calcWorkHours();
      return;
    }
    const startH = parseInt(shiftStart2.value.split(':')[0]);
    const afterOpts = allHours.filter(h => parseInt(h.split(':')[0]) > startH).map(h => `<option value="${h}">${h}</option>`).join('');
    shiftEnd2.innerHTML = defaultOpt + afterOpts;
    autoFillEnd(shiftStart2, shiftEnd2);
    calcWorkHours();
  });
  shiftEnd2.addEventListener('change', () => {
    setAllowanceByHour(parseInt(shiftEnd2.value.split(':')[0]));
    calcWorkHours();
  });
  window.calcWorkHours = calcWorkHours;
}


// ========== 数据加载 ==========
let pendingLoadArgs = null; // 加载进行中被拦下的请求，等当前结束后补跑一次

async function loadData(retryCount = 0, autoRender = true, showLoading = true, autoStopLoading = true) {
  // 已有请求在跑：排队等它结束再补跑，避免刷新/保存后的重载被静默丢弃
  if (isLoading) {
    pendingLoadArgs = { autoRender, showLoading, autoStopLoading };
    return null;
  }
  isLoading = true;

  const wageBox = document.querySelector('.total-wage-box');
  const refreshBtn = document.getElementById('refresh-data-btn');

  if (showLoading && wageBox) {
    wageBox.classList.add('loading');
    refreshBtn?.classList.add('spinning');
  }

  try {
    let res = null;
    // 用循环重试代替原来的递归：递归会把自己的加载锁当成并发请求，导致重试被直接丢弃
    for (let attempt = 0; attempt <= 3; attempt++) {
      try {
        const query = new AV.Query(Bill);
        query.descending('createdAt');
        query.limit(1000);
        res = await query.find();
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    allBillList = res;
    recordDates = new Set(res.map(i => i.get('date') || ''));

    if (autoRender) {
      renderData(res);
      const now = new Date();
      // 无选中日期时，强制切换到当前计薪周期
      if (!selectedDate) {
        selectedDate = formatDate(now);
        const currentCycle = getCycleRange(now);
        currentYear = currentCycle.cycleStart.getFullYear();
        currentMonth = currentCycle.cycleStart.getMonth();
      }
      renderUserCalendar();
      renderAdminCalendar();
      renderTotalAndStat();
    }
    return res;
  } catch (e) {
    showAlert({ theme:'error', title:'数据加载失败', description:'请检查网络后刷新重试' });
    return null;
  } finally {
    isLoading = false;
    if (autoStopLoading && wageBox) {
      wageBox.classList.remove('loading');
      refreshBtn?.classList.remove('spinning');
    }
    if (pendingLoadArgs) {
      const next = pendingLoadArgs;
      pendingLoadArgs = null;
      setTimeout(() => loadData(0, next.autoRender, next.showLoading, next.autoStopLoading), 0);
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
  ['record-shift', 'shift-start', 'shift-end', 'shift-start2', 'shift-end2', 'meal-start', 'meal-end', 'record-allowance', 'record-money', 'record-remark', 'edit-id'].forEach(id => {
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

// 管理员点日历日期：有记录 → 自动回填等同点编辑；无记录 → 空白表单进编辑
function enterEditModeForDate(dateStr) {
  const record = allBillList.find(item => item.get('date') === dateStr);

  const d = new Date(dateStr);
  const cyc = getCycleRange(d);
  currentYear = cyc.cycleStart.getFullYear();
  currentMonth = cyc.cycleStart.getMonth();
  selectedDate = dateStr;
  renderUserCalendar();
  renderAdminCalendar();

  const dateInput = document.getElementById('record-date');
  const shiftSelect = document.getElementById('record-shift');
  const shiftStart = document.getElementById('shift-start');
  const shiftEnd = document.getElementById('shift-end');
  const shiftStart2 = document.getElementById('shift-start2');
  const shiftEnd2 = document.getElementById('shift-end2');
  const mealStart = document.getElementById('meal-start');
  const mealEnd = document.getElementById('meal-end');
  const allowanceInput = document.getElementById('record-allowance');
  const moneyInput = document.getElementById('record-money');
  const remarkInput = document.getElementById('record-remark');
  const editIdInput = document.getElementById('edit-id');

  if (record) {
    // 有记录：直接回填表单（等同点编辑按钮），弹黄色编辑状态提示
    if (dateInput) dateInput.value = record.get('date') || dateStr;
    if (shiftSelect) {
      shiftSelect.value = record.get('shift') || '';
      shiftSelect.dispatchEvent(new Event('change'));
    }
    if (shiftStart) {
      shiftStart.value = record.get('shiftStart') || '';
      shiftStart.dispatchEvent(new Event('change'));
    }
    if (shiftEnd) shiftEnd.value = record.get('shiftEnd') || '';
    if (shiftStart2) shiftStart2.value = record.get('shiftStart2') || '';
    if (shiftEnd2) shiftEnd2.value = record.get('shiftEnd2') || '';
    if (mealStart) mealStart.value = record.get('mealStart') || '';
    if (mealEnd) mealEnd.value = record.get('mealEnd') || '';
    if (allowanceInput) allowanceInput.value = record.get('allowance') || 0;
    if (moneyInput) moneyInput.value = record.get('money') || '';
    if (remarkInput) remarkInput.value = record.get('title') || '';
    if (editIdInput) editIdInput.value = record.id;
    window.calcWorkHours?.();

    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn) {
      cancelBtn.style.display = 'block';
      isEditMode = true;
    }
    showAlert({ theme: 'warning', title: '当前是编辑状态', description: `正在编辑 ${dateStr}，请谨慎操作，修改后点击保存生效` });
  } else {
    // 无记录：清空表单，只填日期，正常新增模式（不弹警告）
    clearForm();
    if (dateInput) dateInput.value = dateStr;
    const cancelBtn = document.getElementById('cancel-edit-btn');
    if (cancelBtn) cancelBtn.style.display = 'none';
    isEditMode = false;
  }
}

// ========== 日历渲染（合并重复逻辑） ==========
function renderCalendar(bodyId, titleId, isAdmin = false) {
  const calendarBody = document.getElementById(bodyId);
  const calendarTitle = document.getElementById(titleId);
  const currentCycleEl = document.getElementById('current-cycle');
  if (!calendarBody || !calendarTitle) return;

  const { cycleStart, cycleEnd } = getCycleRange(new Date(currentYear, currentMonth, 26));
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
        // 管理员点日期：有记录 → 自动回填等同点编辑；无记录 → 空白表单进入编辑状态
        enterEditModeForDate(dateStr);
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

  // 新增：同步更新用户页周期文本
  const currentCycleEl = document.getElementById('current-cycle');
  if (currentCycleEl) {
    const { cycleStart, cycleEnd } = getCycleRange();
    currentCycleEl.innerText = `${formatDate(cycleStart)}~${formatDate(cycleEnd)}`;
  }

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

// 提取到外层
function timeToMin(timeStr) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// 2. 只做循环计算，不操作DOM
currentList.forEach(item => {
  const shift = item.get('shift') || '';
  if (shift === '休息') return;
  const money = safeNum(item.get('money'));
  const allow = safeNum(item.get('allowance'));
  const sEnd = item.get('shiftEnd') || '';
  const sEnd2 = item.get('shiftEnd2') || '';
  const mStart = item.get('mealStart') || '';
  const mEnd = item.get('mealEnd') || '';
  
  workDays++;
  totalBase += money;
  totalAllow += allow;
  totalWage += money + allow;

  // 工时计算
  let h = 0;
  const s = safeNum((item.get('shiftStart') || '00:00').split(':')[0]);
  const e = safeNum((sEnd || '00:00').split(':')[0]);
  if (e > s) h += e - s;
  if (shift === '拼班') {
    const s2 = safeNum((item.get('shiftStart2') || '00:00').split(':')[0]);
    const e2 = safeNum((sEnd2 || '00:00').split(':')[0]);
    if (e2 > s2) h += e2 - s2;
  }

  //饭扣逻辑：开始/结束都有就按区间，只填开始默认扣1小时
  if (mStart) {
    let mealMinusHour = 0;
    const sMin = timeToMin(mStart);
    let eMin = timeToMin(mEnd);
    if (eMin === null) {
      eMin = sMin + 60;
    }
    if (eMin > sMin) {
      mealMinusHour = (eMin - sMin) / 60;
    }
    h = Math.max(0, h - mealMinusHour);
  }
  totalHours += h;

  // 统计晚班天数
  const endHoursArr = [];
  if (sEnd) endHoursArr.push(safeNum(sEnd.split(':')[0]));
  if (shift === '拼班' && sEnd2) endHoursArr.push(safeNum(sEnd2.split(':')[0]));
  if(endHoursArr.length >0){
    const lastEndHour = Math.max(...endHoursArr);
    if (lastEndHour === 21) day21++;
    if (lastEndHour === 22) day22++;
    if (lastEndHour === 23) day23++;
  }
});

// ========== 【循环结束！一次性更新所有DOM】 ==========
const finalWage = trunc2(totalWage);
currentCycleTotalWage = finalWage;
if (updateMainCard) {
  animateWageNumber(finalWage, PROGRESS_DURATION);
  // 悬赏进度环与工资数字共用同一份计算结果，不再从页面文本反算，避免百分比漂移
  animateProgress(calcWagePercent(finalWage));
}
// 按当前悬赏金额刷新金币雨数量
updateMoneyRain(finalWage);
if (statEls['stat-work-hours']) statEls['stat-work-hours'].innerText = totalHours.toFixed(1) + ' 小时';
if (statEls['stat-work-days']) statEls['stat-work-days'].innerText = workDays + ' 天';
if (statEls['stat-21h-days']) statEls['stat-21h-days'].innerText = day21 + ' 天';
if (statEls['stat-22h-days']) statEls['stat-22h-days'].innerText = day22 + ' 天';
if (statEls['stat-23h-days']) statEls['stat-23h-days'].innerText = day23 + ' 天';
if (statEls['stat-base-money']) statEls['stat-base-money'].innerText = '¥' + totalBase.toFixed(2);
if (statEls['stat-allowance']) statEls['stat-allowance'].innerText = '¥' + totalAllow.toFixed(2);

// 周期列表渲染，放到循环外，只执行一次
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
// records：当前这一页要渲染的记录；allRecords：整个周期（供“查看本期总工资”统计用）
function buildDetailList(listEl, records, showActions = false, allRecords = null, showCalc = true) {
  const statRecords = allRecords || records;
  const calcBtn = document.createElement('button');
  calcBtn.innerText = '查看本期总工资';
  calcBtn.className = 'cycle-calc-btn';
calcBtn.onclick = function (e) {
  e.stopPropagation();
  e.preventDefault();
  this.blur();

  let totalHours = 0, totalBase = 0, totalAllow = 0, totalWage = 0, workDays = 0;
  statRecords.forEach(item => {
    const shift = item.get('shift') || '';
    if (shift === '休息') return;
    workDays++;

    const money = safeNum(item.get('money'));
    const allow = safeNum(item.get('allowance'));
    totalBase += money;
    totalAllow += allow;
    totalWage += money + allow;

    // ========== 新增：工时计算逻辑（和主统计页保持一致）==========
    const sEnd = item.get('shiftEnd') || '';
    const sEnd2 = item.get('shiftEnd2') || '';
    const mStart = item.get('mealStart') || '';

    let h = 0;
    const s = safeNum((item.get('shiftStart') || '00:00').split(':')[0]);
    const e = safeNum((sEnd || '00:00').split(':')[0]);
    if (e > s) h += e - s;

    if (shift === '拼班') {
      const s2 = safeNum((item.get('shiftStart2') || '00:00').split(':')[0]);
      const e2 = safeNum((sEnd2 || '00:00').split(':')[0]);
      if (e2 > s2) h += e2 - s2;
    }
// 饭点扣除逻辑：开始/结束都有就按区间，只填开始默认扣1小时
const mEnd = item.get('mealEnd') || '';
if (mStart) {
  function timeToMin(timeStr) {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }
  let mealMinusHour = 0;
  const sMin = timeToMin(mStart);
  let eMin = timeToMin(mEnd);
  if (eMin === null) {
    eMin = sMin + 60;
  }
  if (eMin > sMin) {
    mealMinusHour = (eMin - sMin) / 60;
  }
  h = Math.max(0, h - mealMinusHour);
}

    totalHours += h;
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
  if (showCalc) listEl.appendChild(calcBtn);

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
const mStart = item.get('mealStart') || '';
const mEnd = item.get('mealEnd') || '';
if(mStart){
  if(mEnd){
    mealLine = `<div class="info-line">饭点：${mStart}-${mEnd}</div>`;
  }else{
    // 只填开始，默认1小时
    const [h, m] = mStart.split(':').map(Number);
    mealLine = `<div class="info-line">饭点：${mStart}-${String(h+1).padStart(2,'0')}:${String(m).padStart(2,'0')}</div>`;
  }
}


    const itemEl = document.createElement('div');
    itemEl.className = 'cycle-detail-item';
    itemEl.innerHTML = `
      <span class="date-text">${escapeHtml(timeStr)}</span>
      <div class="info-line">班次：${escapeHtml(shift)} | 时间：${escapeHtml(timeInfo)}</div>
      ${mealLine}
      <div class="info-line">当日工资：<span class="money">¥${dailyTotal.toFixed(2)}</span> | 备注：${escapeHtml(remark)}</div>
      ${showActions ? `
        <div class="item-op" style="margin-top:12px;gap:12px;">
          <button class="btn-sm btn-edit">编辑</button>
          <button class="btn-sm btn-del">删除</button>
        </div>
      ` : ''}
    `;

    // 编辑/删除需要的数据统一走 dataset 赋值：
    // 备注里带英文引号也不会把 HTML 属性拼接打断，同时备注内容已被转义
    if (showActions) {
      const editBtn = itemEl.querySelector('.btn-edit');
      const delBtn = itemEl.querySelector('.btn-del');
      if (editBtn) {
        Object.assign(editBtn.dataset, {
          id: item.id,
          date,
          shift,
          shiftStart: s1,
          shiftEnd: e1,
          shiftStart2: s2,
          shiftEnd2: e2,
          mealStart: meal,
          mealEnd: item.get('mealEnd') || '',
          allowance: allow,
          money,
          remark
        });
      }
      if (delBtn) delBtn.dataset.id = item.id;
    }

    listEl.appendChild(itemEl);
  });
}

// ========== 周期详情分页（10 条/页，参考 TDesign Pagination） ==========
const PAGE_SIZE = 10;
let cycleDetailState = { key: '', records: [], showActions: false, page: 1 };

// 页码序列：首尾页 + 当前页相邻页，跳号处折叠成省略号（同 TDesign 的规则）
function buildPagerItems(current, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set([1, pages, current - 1, current, current + 1]);
  const nums = Array.from(keep).filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  const items = [];
  let prev = 0;
  nums.forEach(n => {
    if (prev && n - prev > 1) items.push('gap');
    items.push(n);
    prev = n;
  });
  return items;
}

function renderCyclePager() {
  const pager = document.getElementById('cycle-detail-pager');
  if (!pager) return;

  const total = cycleDetailState.records.length;
  if (!total) {
    pager.innerHTML = '';
    return;
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(cycleDetailState.page, pages);
  const pageBtns = buildPagerItems(current, pages).map(it => it === 'gap'
    ? '<span class="pg-gap">···</span>'
    : `<button class="pg-btn${it === current ? ' active' : ''}" data-page="${it}" type="button">${it}</button>`
  ).join('');

  pager.innerHTML = `
    <div class="t-pagination">
      <button class="pg-btn" data-page="${current - 1}" type="button"${current === 1 ? ' disabled' : ''}>‹</button>
      ${pageBtns}
      <button class="pg-btn" data-page="${current + 1}" type="button"${current === pages ? ' disabled' : ''}>›</button>
    </div>
    <div class="pg-total">共 ${total} 条记录 · 第 ${current}/${pages} 页</div>
  `;
}

function renderCycleDetailPage() {
  const list = document.getElementById('cycle-detail-record-list');
  if (!list) return;

  const st = cycleDetailState;
  const start = (st.page - 1) * PAGE_SIZE;
  const pageRecords = st.records.slice(start, start + PAGE_SIZE);

  list.innerHTML = '';
  list.dataset.cycle = st.key;
  // “查看本期总工资”只在第一页出现，统计始终按整个周期算
  buildDetailList(list, pageRecords, st.showActions, st.records, st.page === 1);
  renderCyclePager();
}

// ========== 回到顶部（参考 TDesign BackTop：圆形、只有图标） ==========
const backTopPairs = [];

// 自己实现缓动滚动：不依赖 scrollTo 的 smooth 参数（部分 WebView 声明支持却不生效）
function smoothScrollTop(scroller, duration = 420) {
  const start = scroller.scrollTop;
  if (start <= 0) return;
  const startTime = performance.now();

  function step(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    scroller.scrollTop = start * (1 - eased);
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      scroller.scrollTop = 0;
    }
  }
  requestAnimationFrame(step);
}

function setupBackTop(btnId, scrollerId) {
  const btn = document.getElementById(btnId);
  const scroller = document.getElementById(scrollerId);
  if (!btn || !scroller) return;

  const update = () => {
    btn.classList.toggle('show', scroller.scrollTop > 100);
  };

  scroller.addEventListener('scroll', update, { passive: true });
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    smoothScrollTop(scroller);
  });

  backTopPairs.push({ update });
  update();
}

function refreshBackTops() {
  backTopPairs.forEach(p => p.update());
}

function openCycleDetailPopup(cycleKey, records, showActions = false) {
  const title = document.getElementById('cycle-detail-title');
  const overlay = document.getElementById('cycle-detail-overlay');
  const body = document.getElementById('cycle-detail-body');
  if (!title || !overlay) return;

  cycleDetailState = { key: cycleKey, records: records || [], showActions: showActions, page: 1 };
  title.innerText = cycleKey;
  renderCycleDetailPage();

  if (body) body.scrollTop = 0;
  overlay.classList.add('show');
  requestAnimationFrame(refreshBackTops);
  disableBodyScroll();
}

function openAdminCycleDetailPopup(cycleKey, records) {
  openCycleDetailPopup(cycleKey, records, true);
}

// ========== 页面初始化 ==========
document.addEventListener('DOMContentLoaded', function () {
  // 编辑/删除事件委托
// 编辑：回填表单（从记录按钮点击里抽出来，日历点日期进编辑也复用）
function doEditRecord(editBtn) {
  document.getElementById('cycle-detail-overlay')?.classList.remove('show');
  enableBodyScroll();

  try {
    const data = editBtn.dataset;
    const targetDateStr = data.date;
    const targetDate = new Date(targetDateStr);

    const editCycle = getCycleRange(targetDate);
    currentYear = editCycle.cycleStart.getFullYear();
    currentMonth = editCycle.cycleStart.getMonth();
    selectedDate = targetDateStr;
    renderUserCalendar();
    renderAdminCalendar();

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
    const mealEndInput = document.getElementById('meal-end');
    if (mealEndInput) mealEndInput.value = data.mealEnd || '';

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
  showAlert({ theme: 'warning', title: '已进入编辑模式', description: '修改完成后点击保存即可生效' });

  setTimeout(() => {
    document.getElementById('record-money')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 350);
}

function doDeleteRecord(delBtn) {
  AV.Object.createWithoutData('Bill', delBtn.dataset.id).destroy()
    .then(() => {
      loadData();
      showAlert({ theme: 'success', title: '删除成功', description: '该条记录已从数据库移除' });
      document.getElementById('cycle-detail-overlay')?.classList.remove('show');
      enableBodyScroll();
    })
    .catch((err) => {
      showAlert({ theme: 'error', title: '删除失败', description: err?.message || '网络异常，请稍后重试' });
    });
}

const recordList = document.getElementById('cycle-detail-record-list');
if (recordList) {
  recordList.addEventListener('click', function (e) {
    const editBtn = e.target.closest('.btn-edit');
    if (editBtn) {
      e.stopPropagation();
      e.preventDefault();
      editBtn.blur();
      popconfirm({
        anchor: editBtn,
        theme: 'warning',
        title: '确认编辑这条记录？',
        description: '编辑后将覆盖原数据，保存前可随时取消',
        confirmText: '编辑',
        onConfirm: () => doEditRecord(editBtn)
      });
      return;
    }

    const delBtn = e.target.closest('.btn-del');
    if (delBtn) {
      e.stopPropagation();
      e.preventDefault();
      delBtn.blur();
      popconfirm({
        anchor: delBtn,
        theme: 'danger',
        title: '确认删除这条记录？',
        description: '删除后无法恢复，请谨慎操作',
        confirmText: '删除',
        onConfirm: () => doDeleteRecord(delBtn)
      });
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
  showAlert({ theme:'success', title:'欢迎回来，管理员' });
} else {
      showAlert({ theme:'error', title:'密码错误', description:'请输入正确的管理员密码' });
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
  showAlert({ theme:'info', title:'已返回用户页面' });

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
      showAlert({ theme:'warning', title:'请选择日期和班次' });
      return;
    }

const data = {
  date, shift,
  shiftStart: document.getElementById('shift-start')?.value,
  shiftEnd: document.getElementById('shift-end')?.value,
  shiftStart2: document.getElementById('shift-start2')?.value,
  shiftEnd2: document.getElementById('shift-end2')?.value,
  mealStart: document.getElementById('meal-start')?.value,
  mealEnd: document.getElementById('meal-end')?.value,
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
        showAlert({ theme:'success', title:'修改成功', description:'记录已更新保存' });
      } else {
        const bill = new Bill();
        Object.entries(data).forEach(([k, v]) => bill.set(k, v));
        await bill.save();
        showAlert({ theme:'success', title:'保存成功', description:'新记录已写入数据库' });
      }
      clearForm();
      const cancelBtn = document.getElementById('cancel-edit-btn');
      if (cancelBtn) cancelBtn.style.display = 'none';
      isEditMode = false;
      loadData(0, true, false, true);
    } catch (err) {
      showAlert({ theme:'error', title:'保存失败', description: (err && err.message) || '网络异常，请稍后重试' });
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
  showAlert({ theme:'info', title:'已取消编辑', description:'表单已清空，未做任何修改' });
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
  const resetCycle = getCycleRange(today);
  currentYear = resetCycle.cycleStart.getFullYear();
  currentMonth = resetCycle.cycleStart.getMonth();
  selectedDate = todayStr;

  // 重绘日历
  renderUserCalendar();
  renderAdminCalendar();
});

  // 详情弹窗
  const detailOverlay = document.getElementById('detail-overlay');
  const detailBody = document.getElementById('detail-body');

  function openDetailDrawer() {
    if (detailBody) detailBody.scrollTop = 0;
    detailOverlay?.classList.add('show');
    requestAnimationFrame(refreshBackTops);
    disableBodyScroll();
  }

  document.getElementById('detail-btn')?.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    this.blur();
    openDetailDrawer();
  });
  document.getElementById('detail-close')?.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    this.blur();
    detailOverlay?.classList.remove('show');
    enableBodyScroll();
  });
  document.getElementById('detail-x')?.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
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
  document.getElementById('cycle-detail-x')?.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    cycleDetailOverlay?.classList.remove('show');
    enableBodyScroll();
  });

  // 面包屑：点“本期详情”退回上一层抽屉（body 滚动锁保持不变）
  document.getElementById('cycle-crumb-back')?.addEventListener('click', function (e) {
    e.stopPropagation();
    e.preventDefault();
    cycleDetailOverlay?.classList.remove('show');
    detailOverlay?.classList.add('show');
    requestAnimationFrame(refreshBackTops);
  });

  // 分页：只换页，不动抽屉
  document.getElementById('cycle-detail-pager')?.addEventListener('click', function (e) {
    const btn = e.target.closest('.pg-btn');
    if (!btn || btn.disabled) return;
    e.stopPropagation();

    const pages = Math.max(1, Math.ceil(cycleDetailState.records.length / PAGE_SIZE));
    const page = parseInt(btn.dataset.page, 10);
    if (!isFinite(page) || page < 1 || page > pages || page === cycleDetailState.page) return;

    cycleDetailState.page = page;
    renderCycleDetailPage();

    const body = document.getElementById('cycle-detail-body');
    if (body) body.scrollTop = 0;
    refreshBackTops();
  });

  // 两个抽屉里的“回到顶部”（滚动超过 100px 才浮现）
  setupBackTop('detail-backtop', 'detail-body');
  setupBackTop('cycle-detail-backtop', 'cycle-detail-body');

  // 进度卡片：默认只显示居中标题，点击展开环形进度，再点收起
  document.querySelectorAll('.progress-window').forEach(win => {
    win.addEventListener('click', function (e) {
      win.classList.toggle('expanded');
    });
  });

  // 背景音乐播放器：可拖动圆形按钮（位置持久化），面板方向自适应屏幕边缘
  (function initMusicPlayer() {
    const player = document.getElementById('music-player');
    const toggle = document.getElementById('music-toggle');
    const audio = document.getElementById('music-audio');
    const panel = document.getElementById('music-panel');
    const progressBar = document.getElementById('music-progress-bar');
    const progressFill = document.getElementById('music-progress-fill');
    const prevBtn = document.getElementById('music-prev');
    const nextBtn = document.getElementById('music-next');
    const playPauseBtn = document.getElementById('music-play-pause');
    const iconPlay = document.getElementById('icon-play');
    const iconPause = document.getElementById('icon-pause');
    const timeEl = document.getElementById('music-time');
    const listEl = document.getElementById('music-list');
    if (!player || !toggle || !audio) return;

    // 音乐文件列表：优先从 music-list.json 读取（双击"更新歌曲列表.bat"自动生成）
    // 读不到则用默认列表
    let playlist = [
      { src: './music/M1.mp3', name: 'M1' }
    ];
    let currentIdx = 0;

    let isPlaying = false;
    let panelOpen = false;
    let dragging = false;
    let dragMoved = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    let seeking = false;

    function fmtTime(s) {
      if (!isFinite(s) || s < 0) return '00:00';
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
    }

    // 根据按钮位置自动决定面板弹出方向：靠右则面板在左，靠左则面板在右；靠下则面板在上，靠上则面板在下
    function updatePanelPosition() {
      const rect = player.getBoundingClientRect();
      const pw = 240; // 面板宽
      const ph = panel.offsetHeight || 140; // 面板高
      const margin = 8;

      // 水平：按钮在右半屏 → 面板在按钮左边（right:0）；按钮在左半屏 → 面板在按钮右边（left:0）
      if (rect.left + 48 + margin + pw > window.innerWidth) {
        // 右边放不下，面板在按钮左侧
        panel.style.left = 'auto';
        panel.style.right = '0';
      } else if (rect.left - margin - pw < 0) {
        // 左边放不下，面板在按钮右侧
        panel.style.right = 'auto';
        panel.style.left = '0';
      } else {
        // 中间位置：默认面板在按钮左侧（靠右弹出）
        panel.style.right = '0';
        panel.style.left = 'auto';
      }

      // 垂直：按钮靠近底部 → 面板在按钮上方（bottom:58px）；按钮靠近顶部 → 面板在按钮下方（top:58px）
      if (rect.top + 48 + margin + ph > window.innerHeight) {
        // 下方放不下，面板在按钮上方
        panel.style.top = 'auto';
        panel.style.bottom = '58px';
      } else if (rect.top - margin - ph < 0) {
        // 上方放不下，面板在按钮下方
        panel.style.bottom = 'auto';
        panel.style.top = '58px';
      } else {
        // 默认在按钮上方
        panel.style.bottom = '58px';
        panel.style.top = 'auto';
      }
    }

    // 动态生成歌曲列表
    function renderList() {
      listEl.innerHTML = '';
      playlist.forEach((t, i) => {
        const item = document.createElement('div');
        item.className = 'music-item' + (i === currentIdx ? ' active' : '');

        const nameWrap = document.createElement('div');
        nameWrap.className = 'music-name-wrap';
        const nameEl = document.createElement('span');
        nameEl.className = 'music-item-name';
        nameEl.textContent = t.name;
        nameWrap.appendChild(nameEl);

        const timeEl = document.createElement('span');
        timeEl.className = 'music-item-time';
        timeEl.textContent = '00:00 / 00:00';

        item.appendChild(nameWrap);
        item.appendChild(timeEl);
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          loadTrack(i);
        });
        listEl.appendChild(item);

        // 歌名过长时加跑马灯
        requestAnimationFrame(() => {
          if (nameEl.scrollWidth > nameWrap.clientWidth + 2) {
            nameEl.classList.add('marquee');
          }
        });
      });
    }
    renderList();

    function loadTrack(idx) {
      currentIdx = idx;
      audio.src = playlist[idx].src;
      audio.play().then(() => {
        isPlaying = true;
        toggle.classList.add('playing');
      }).catch(() => { isPlaying = false; });
      renderList();
    }

    function updateProgress() {
      if (audio.duration) {
        progressFill.style.width = (audio.currentTime / audio.duration * 100) + '%';
      }
      if (timeEl) timeEl.textContent = fmtTime(audio.currentTime) + ' / ' + fmtTime(audio.duration);
      // 同步当前列表项的时间
      const activeItem = listEl.querySelector('.music-item.active .music-item-time');
      if (activeItem) activeItem.textContent = fmtTime(audio.currentTime) + ' / ' + fmtTime(audio.duration);
    }
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', updateProgress);
    audio.addEventListener('ended', function () {
      loadTrack((currentIdx + 1) % playlist.length);
    });

    function play() {
      audio.play().then(() => {
        isPlaying = true;
        toggle.classList.add('playing');
        if (iconPlay) iconPlay.style.display = 'none';
        if (iconPause) iconPause.style.display = '';
      }).catch(() => { isPlaying = false; });
    }
    function pause() {
      audio.pause();
      isPlaying = false;
      toggle.classList.remove('playing');
      if (iconPlay) iconPlay.style.display = '';
      if (iconPause) iconPause.style.display = 'none';
    }

    // 恢复上次位置（校验在屏幕内）
    try {
      const saved = localStorage.getItem('music-player-pos');
      if (saved) {
        const pos = JSON.parse(saved);
        const vw = window.innerWidth || 400;
        const vh = window.innerHeight || 800;
        const safeLeft = Math.max(8, Math.min(pos.left, vw - 56));
        const safeTop = Math.max(8, Math.min(pos.top, vh - 56));
        player.style.left = safeLeft + 'px';
        player.style.top = safeTop + 'px';
        player.style.right = 'auto';
        player.style.bottom = 'auto';
      }
    } catch (e) {}

    // 窗口尺寸变化时（如 DevTools 切换手机模拟），把按钮夹回屏幕内
    window.addEventListener('resize', () => {
      const vw = window.innerWidth || 400;
      const vh = window.innerHeight || 800;
      const rect = player.getBoundingClientRect();
      const safeLeft = Math.max(8, Math.min(rect.left, vw - 56));
      const safeTop = Math.max(8, Math.min(rect.top, vh - 56));
      player.style.left = safeLeft + 'px';
      player.style.top = safeTop + 'px';
    });

    function savePos() {
      const rect = player.getBoundingClientRect();
      try {
        localStorage.setItem('music-player-pos', JSON.stringify({
          left: rect.left, top: rect.top
        }));
      } catch (e) {}
    }

    // 点击切换播放/暂停 + 面板
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      if (dragMoved) { dragMoved = false; return; }
      if (isPlaying) pause(); else play();
      panelOpen = !panelOpen;
      panel.classList.toggle('hidden', !panelOpen);
      if (panelOpen) {
        updatePanelPosition();
        // 面板展开后重新检测歌名是否需要跑马灯（hidden 时宽度为 0 检测不到）
        requestAnimationFrame(() => {
          listEl.querySelectorAll('.music-item-name').forEach(nameEl => {
            const wrap = nameEl.parentElement;
            if (wrap && nameEl.scrollWidth > wrap.clientWidth + 2) {
              nameEl.classList.add('marquee');
            } else {
              nameEl.classList.remove('marquee');
            }
          });
        });
      }
    });

    // 进度条拖动/点击
    function seekTo(clientX) {
      const rect = progressBar.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      if (audio.duration) {
        audio.currentTime = ratio * audio.duration;
        updateProgress();
      }
    }
    progressBar.addEventListener('pointerdown', function (e) {
      seeking = true;
      seekTo(e.clientX);
      e.stopPropagation();
    });
    document.addEventListener('pointermove', function (e) {
      if (seeking) seekTo(e.clientX);
    });
    document.addEventListener('pointerup', function () { seeking = false; });

    // 上一首/下一首
    prevBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      loadTrack((currentIdx - 1 + playlist.length) % playlist.length);
    });
    nextBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      loadTrack((currentIdx + 1) % playlist.length);
    });

    // 面板里的播放/暂停按钮
    playPauseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (isPlaying) pause(); else play();
    });

    // 拖动按钮位置
    player.addEventListener('pointerdown', function (e) {
      dragging = true;
      dragMoved = false;
      const rect = player.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      player.style.transition = 'none';
      e.preventDefault();
    });
    document.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;
      const newLeft = Math.max(0, Math.min(window.innerWidth - 48, startLeft + dx));
      const newTop = Math.max(0, Math.min(window.innerHeight - 48, startTop + dy));
      player.style.left = newLeft + 'px';
      player.style.top = newTop + 'px';
      player.style.right = 'auto';
      player.style.bottom = 'auto';
      if (panelOpen) updatePanelPosition();
    });
    document.addEventListener('pointerup', function () {
      if (dragging) {
        dragging = false;
        player.style.transition = '';
        if (dragMoved) {
          savePos();
          updatePanelPosition();
        }
      }
    });

    // 窗口大小变化时重新计算面板方向
    window.addEventListener('resize', function () {
      if (panelOpen) updatePanelPosition();
    });

    // 先从 LeanCloud 的 Music 类读取歌单，失败再 fallback 到 music-list.json
    async function loadPlaylist() {
      try {
        if (typeof AV !== 'undefined' && AV.Query) {
          const Music = AV.Object.extend('Music');
          const q = new AV.Query(Music);
          q.ascending('order');
          q.limit(50);
          const res = await q.find();
          if (res && res.length > 0) {
            playlist = res.map(m => ({
              src: m.get('url'),
              name: m.get('name')
            }));
            renderList();
            return;
          }
        }
      } catch (e) {
        console.warn('从 LeanCloud 读取歌单失败，用本地 json', e);
      }
      // fallback 到本地 music-list.json
      try {
        const r = await fetch('music-list.json?_=' + Date.now());
        if (r.ok) {
          const list = await r.json();
          if (Array.isArray(list) && list.length > 0) {
            playlist = list;
            renderList();
          }
        }
      } catch (e) {}
    }

    // 自动播放：页面加载尝试播放，被浏览器拦截则等首次交互
    function tryAutoPlay() {
      audio.src = playlist[currentIdx].src;
      audio.play().then(() => {
        isPlaying = true;
        toggle.classList.add('playing');
      }).catch(() => {
        const onFirstInteract = function () {
          play();
          document.removeEventListener('click', onFirstInteract);
          document.removeEventListener('touchstart', onFirstInteract);
          document.removeEventListener('keydown', onFirstInteract);
        };
        document.addEventListener('click', onFirstInteract);
        document.addEventListener('touchstart', onFirstInteract);
        document.addEventListener('keydown', onFirstInteract);
      });
    }

    loadPlaylist().finally(() => {
      if (document.readyState === 'complete') {
        setTimeout(function () { tryAutoPlay(); updatePanelPosition(); }, 200);
      } else {
        window.addEventListener('load', function () {
          setTimeout(function () { tryAutoPlay(); updatePanelPosition(); }, 200);
        });
      }
    });
  })();

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
        animateProgress(0, PROGRESS_RESET_DURATION),
        animateMiniProgress(0, PROGRESS_RESET_DURATION)
      ]);

      // 3. 加载最新数据
      const data = await loadData(0, false, false, false);
      if (!data) {
        showAlert({ theme:'error', title:'数据加载失败', description:'请检查网络后点击刷新按钮重试' });
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

      // 6. 进度条从0增长到目标值，同时数字滚动（并行，时长同步）
      animateWageNumber(trunc2(totalWage), PROGRESS_DURATION);
      await Promise.all([
        animateProgress(targetProgress),
        animateMiniProgress(targetMiniProgress)
      ]);

      // 7. 同步周期文本 + 弹出成功提示
      const { cycleStart: curStart, cycleEnd: curEnd } = getCycleRange();
const cycleEl = document.getElementById('current-cycle');
if (cycleEl) cycleEl.innerText = `${formatDate(curStart)}~${formatDate(curEnd)}`;
showAlert({ theme:'success', title:'刷新成功', description:'已同步最新数据' });

    } catch (err) {
      showAlert({ theme:'error', title:'刷新失败', description: (err && err.message) || '网络异常，请稍后重试' });
      console.error('刷新异常：', err);
    } finally {
      // 统一清理所有状态，确保锁一定释放
      wageBox?.classList.remove('loading');
      refreshBtn.classList.remove('spinning');
      isRefreshing = false;
    }
  });

  // 初始化登录状态
const isAdmin = localStorage.getItem('isAdminLoggedIn') === 'true';
const today = new Date();
const todayStr = formatDate(today);
// 强制对齐【计薪周期】，无数据也会显示新周期日历
const currentCycle = getCycleRange(today);
selectedDate = todayStr;
// 用周期起始日期的年月作为日历基准，而非单纯今天的年月
currentYear = currentCycle.cycleStart.getFullYear();
currentMonth = currentCycle.cycleStart.getMonth();

// 先把正确的计薪周期写进卡片，避免数据加载失败时还显示 HTML 里写死的旧周期
const initialCycleEl = document.getElementById('current-cycle');
if (initialCycleEl) {
  initialCycleEl.innerText = `${formatDate(currentCycle.cycleStart)}~${formatDate(currentCycle.cycleEnd)}`;
}

// 水面波动循环（手机跟陀螺仪、电脑跟鼠标）
initWaterLayers();

if (isAdmin) {
  document.body.classList.add('admin-active');
  userView?.classList.add('hidden');
  adminView?.classList.remove('hidden');
  adminEntrance?.classList.add('hidden');
  const dateInput = document.getElementById('record-date');
  if (dateInput) dateInput.value = todayStr;

  // 新增：管理员登录强制刷新为当前计薪周期
  const loginCycle = getCycleRange(new Date());
  currentYear = loginCycle.cycleStart.getFullYear();
  currentMonth = loginCycle.cycleStart.getMonth();

  renderUserCalendar();
  renderAdminCalendar();
  loadData(0, true, false, true);
  showAlert({ theme:'success', title:'欢迎回来，管理员' });
} else {
  document.body.classList.remove('admin-active');
  userView?.classList.remove('hidden');
  adminView?.classList.add('hidden');
  adminEntrance?.classList.remove('hidden');
  loadData(0, true, false, true).then(() => {
    renderUserCalendar();
    // 主动更新用户页悬赏金卡片的周期文本（不依赖日历渲染）
    const { cycleStart, cycleEnd } = getCycleRange();
    const cycleText = `${formatDate(cycleStart)}~${formatDate(cycleEnd)}`;
    const currentCycleEl = document.getElementById('current-cycle');
    if (currentCycleEl) currentCycleEl.innerText = cycleText;
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
  // 切换月份后，自动对齐对应周期
  const tempDate = new Date(currentYear, currentMonth, 26);
  const targetCycle = getCycleRange(tempDate);
  currentYear = targetCycle.cycleStart.getFullYear();
  currentMonth = targetCycle.cycleStart.getMonth();

  renderUserCalendar();
  renderAdminCalendar();
  renderTotalAndStat();
  initTopMiniCards();
}

(function () {
  initTopMiniCards();

  prevMonthBtn?.addEventListener('click', function (e) {
    e.preventDefault();
    this.blur();
    changeMonth(-1);
  });

  nextMonthBtn?.addEventListener('click', function (e) {
    e.preventDefault();
    this.blur();
    changeMonth(1);
  });

  initTimeSelect();

  const cancelBtn = document.getElementById('cancel-edit-btn');
  if (cancelBtn) {
    cancelBtn.style.display = 'none';
  }
})();
});