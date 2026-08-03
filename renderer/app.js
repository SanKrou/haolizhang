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
window.ledger.getStatistics({ period: 'month', date: window.localDateStr() })
  .then(r => {
    if (r.ok) {
      document.getElementById('balance-value').textContent =
        (r.data.balance / 100).toFixed(2) + ' 元';
    }
  });

renderView('add');
