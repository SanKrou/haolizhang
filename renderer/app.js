const views = ['add', 'ledger', 'stats', 'budget', 'io', 'manage'];
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
  document.dispatchEvent(new CustomEvent('view:change', { detail: name }));
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => renderView(btn.dataset.view));
});

window.showView = renderView;
window.ledger.getStatistics({ period: 'month', date: new Date().toISOString().slice(0, 10) })
  .then(r => {
    if (r.ok) {
      document.getElementById('balance-value').textContent =
        (r.data.balance / 100).toFixed(2) + ' 元';
    }
  });

renderView('add');
