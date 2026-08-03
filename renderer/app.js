// ---- 全局工具（final review 修复：本地时区日期 + HTML 转义） ----
// 各 pages/*.js 在 app.js 之前加载，但只在运行时（render 调用时）使用这两个 helper，
// 而 render 触发时 app.js 已执行完毕，因此无时序问题。
function localDateStr(offset = 0) { // offset 天偏移，返回 YYYY-MM-DD（本地时区）
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
window.localDateStr = localDateStr;

window.escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const views = ['add', 'ledger', 'stats'];
const PAGE_NAMES = { add: '记一笔', ledger: '账本', stats: '统计' };
let currentView = 'add';

function renderView(name) {
  const root = document.getElementById('view-root');
  root.innerHTML = '';
  if (window.renderers && window.renderers[name]) {
    window.renderers[name](root);
  } else {
    root.innerHTML = `<div class="card">视图 ${name} 尚未实现（Task 10-15）</div>`;
  }
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  currentView = name;
  document.getElementById('tb-page').textContent = PAGE_NAMES[name] || name;
  document.dispatchEvent(new CustomEvent('view:change', { detail: name }));
}

// 自绘标题栏窗口控制
document.getElementById('tb-min').addEventListener('click', () => window.winctl.minimize());
document.getElementById('tb-max').addEventListener('click', () => window.winctl.maximize());
document.getElementById('tb-close').addEventListener('click', () => window.winctl.close());

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => renderView(btn.dataset.view));
});

window.showView = renderView;

// ── 底部悬浮结余卡（竖式 · 大写为主体） ──
const CN_D = '零壹贰叁肆伍陆柒捌玖';
function numToCn(n) { // 分 → 中文大写金额
  const neg = n < 0; n = Math.abs(n);
  const intPart = Math.floor(n / 100);
  const dec = n % 100;
  const U = ['', '拾', '佰', '仟'];
  const B = ['', '万', '亿', '万亿'];
  let s = '';
  if (intPart === 0) s = '零';
  else {
    const g = [];
    let v = intPart;
    while (v > 0) { g.push(v % 10000); v = Math.floor(v / 10000); }
    for (let gi = g.length - 1; gi >= 0; gi--) {
      const grp = g[gi];
      let gs = '', zero = false;
      for (let i = 3; i >= 0; i--) {
        const d = Math.floor(grp / Math.pow(10, i)) % 10;
        if (d === 0) { if (gs) zero = true; }
        else { if (zero) { gs += '零'; zero = false; } gs += CN_D[d] + U[i]; }
      }
      if (gs) s += gs + B[gi];
      else if (s) s += '零';
    }
    s = s.replace(/零+$/, '');
  }
  s += '元';
  if (dec === 0) s += '整';
  else {
    const j = Math.floor(dec / 10), f = dec % 10;
    if (j > 0) s += CN_D[j] + '角';
    if (f > 0) s += CN_D[f] + '分';
  }
  return neg ? '负' + s : s;
}
window.numToCn = numToCn;
const fmtMoney = (v) => (v / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/* ── 通栏结余条（竖式 | 诗句 | 日历范围） ── */
const DEFAULT_POEMS = [
  ['一粥一饭，当思来处不易', '朱柏庐'],
  ['谁知盘中餐，粒粒皆辛苦', '李绅'],
  ['由俭入奢易，由奢入俭难', '司马光'],
  ['君子爱财，取之有道', '《论语》'],
  ['不积跬步，无以至千里', '荀子'],
  ['日进斗金，亦须细水长流', '民间'],
  ['锱铢必较，方寸之间', '毫厘账'],
  ['绳锯木断，水滴石穿', '班固'],
  ['量入为出，守其常也', '《礼记》'],
  ['一毫不差，乃成大事', '毫厘账'],
];
const POEMS_KEY = 'haoli-poems';
let POEMS;
try {
  const saved = localStorage.getItem(POEMS_KEY);
  POEMS = saved ? JSON.parse(saved) : null;
} catch { POEMS = null; }
if (!Array.isArray(POEMS) || !POEMS.length) {
  POEMS = DEFAULT_POEMS;
  try { localStorage.setItem(POEMS_KEY, JSON.stringify(POEMS)); } catch { /* 忽略 */ }
}
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
const pad2 = (n) => String(n).padStart(2, '0');
const fmtDate = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());

let dockStart = null, dockEnd = null; // 日历范围选择（Date）
const now0 = new Date();
let calY = now0.getFullYear(), calM = now0.getMonth();

async function renderBalanceDock() {
  const body = document.getElementById('bd-body');
  const rangeEl = document.getElementById('bd-range');
  if (!body) return;
  let query, rangeTxt = '';
  if (dockStart && dockEnd) {
    const a = dockStart < dockEnd ? dockStart : dockEnd;
    const b = dockStart < dockEnd ? dockEnd : dockStart;
    query = { period: 'range', dateStart: fmtDate(a), dateEnd: fmtDate(b) };
    rangeTxt = '当前范围 <b>' + fmtDate(a) + '</b> ~ <b>' + fmtDate(b) + '</b>';
  } else if (dockStart) {
    query = { period: 'day', date: fmtDate(dockStart) };
    rangeTxt = '已选 <b>' + fmtDate(dockStart) + '</b>';
  } else {
    query = { period: 'day', date: window.localDateStr() };
  }
  rangeEl.innerHTML = rangeTxt;
  const r = await window.ledger.getStatistics(query);
  if (!r.ok) { body.innerHTML = ''; return; }
  const s = r.data;
  const bal = s.balance;
  const row = (cap, v) => '<div class="bd-row"><span class="cap">' + cap + '</span>' +
    '<span class="cn">' + numToCn(v) + '</span><span class="note-box">' + fmtMoney(v) + '</span></div>';
  const total = (cap, v) => '<div class="bd-row total"><span class="cap">' + cap + '</span>' +
    '<span class="cn">' + numToCn(v) + '</span><span class="note-box" style="' + (v < 0 ? 'color:#b3452f' : '') + '">' + fmtMoney(v) + '</span></div>';
  body.innerHTML = row('收入', s.income) + row('支出', s.expense) +
    '<div class="bd-rule"></div>' + total('结余', bal);
}
window.refreshBalance = renderBalanceDock;

function renderDockCal() {
  const grid = document.getElementById('cal-grid');
  if (!grid) return;
  const inpY = document.getElementById('inp-year');
  const inpM = document.getElementById('inp-month');
  if (inpY) inpY.value = calY;
  if (inpM) inpM.value = calM + 1;
  const first = new Date(calY, calM, 1);
  const start = (first.getDay() + 6) % 7;
  const days = new Date(calY, calM + 1, 0).getDate();
  const todayStr = window.localDateStr();
  let cells = '';
  for (let i = 0; i < start; i++) cells += '<span class="cal-blank"></span>';
  for (let d = 1; d <= days; d++) {
    const cur = new Date(calY, calM, d);
    const cs = fmtDate(cur);
    let cls = '';
    if (dockStart && dockEnd) {
      const a = dockStart < dockEnd ? dockStart : dockEnd;
      const b = dockStart < dockEnd ? dockEnd : dockStart;
      const as = fmtDate(a), bs = fmtDate(b);
      if (cs === as) cls += ' sel-start';
      else if (cs === bs) cls += ' sel-end';
      else if (cs > as && cs < bs) cls += ' in-range';
    } else if (dockStart && cs === fmtDate(dockStart)) {
      cls += ' sel-start';
    }
    if (cs === todayStr) cls += ' today';
    cells += '<button type="button" class="cal-day' + cls + '" data-d="' + d + '">' + d + '</button>';
  }
  grid.innerHTML = cells;
  grid.querySelectorAll('.cal-day').forEach((b) => b.onclick = () => {
    const cur = new Date(calY, calM, Number(b.dataset.d));
    if (!dockStart || (dockStart && dockEnd)) { dockStart = cur; dockEnd = null; }
    else dockEnd = cur;
    renderDockCal();
    renderBalanceDock();
  });
}
document.getElementById('inp-year').onchange = (e) => {
  const v = parseInt(e.target.value, 10);
  if (v >= 1900 && v <= 2100) { calY = v; renderDockCal(); }
};
document.getElementById('inp-month').onchange = (e) => {
  const v = parseInt(e.target.value, 10);
  if (v >= 1 && v <= 12) { calM = v - 1; renderDockCal(); }
};
document.getElementById('cal-prev').onclick = () => { calM--; if (calM < 0) { calM = 11; calY--; } renderDockCal(); };
document.getElementById('cal-next').onclick = () => { calM++; if (calM > 11) { calM = 0; calY++; } renderDockCal(); };

/* ── 诗句：每天一句（日期决定），点击临时切换，池存本地 ── */
let poemIdx = -1, poemOverride = null;
const poemLine = document.getElementById('poem-line');
const poemSrc = document.getElementById('poem-src');
function dayPoemIndex() { return hashStr(window.localDateStr()) % POEMS.length; }
function showPoem(idx) {
  poemIdx = idx;
  poemLine.classList.add('fade');
  setTimeout(() => {
    poemLine.textContent = POEMS[idx][0];
    poemSrc.textContent = '—— ' + POEMS[idx][1];
    poemLine.classList.remove('fade');
  }, 350);
}
document.getElementById('bb-poem').addEventListener('click', () => {
  let i;
  do { i = Math.floor(Math.random() * POEMS.length); } while (i === poemIdx);
  poemOverride = i;
  showPoem(i);
});
showPoem(poemOverride !== null && poemOverride < POEMS.length ? poemOverride : dayPoemIndex());

renderDockCal();
renderBalanceDock();

renderView('add');
