window.renderers = window.renderers || {};

// 模块级持有本视图创建的 ECharts 实例：切换 period 会重建 DOM，切出视图时 app.js renderView
// 会 root.innerHTML='' 清空旧 DOM，但旧实例仍被 ECharts 全局实例表持有无法 GC；
// 保存引用供 render 开头统一 dispose，同时覆盖「切 period」与「重进视图」两种累积场景。
let statsCharts = [];

window.renderers.stats = async function (root) {
  let period = 'month';
  const today = window.localDateStr();

  async function render() {
    // 先释放上一轮实例再重建 DOM/init，避免 ECharts 全局实例表持引用导致内存泄漏；
    // dispose 后立刻清空数组，不会对同一实例重复 dispose
    for (const inst of statsCharts) { try { inst.dispose(); } catch (e) {} }
    statsCharts = [];

    const r = await window.ledger.getStatistics({ period, date: today });
    if (!r.ok) { root.innerHTML = `<div class="card">加载失败：${window.escapeHtml(r.error)}</div>`; return; }
    const s = r.data;
    const fmt = (v) => (v / 100).toFixed(2) + ' 元';
    let exemptSection = '';
    if (period === 'month') {
      const ex = await window.ledger.getExemptTransactions(today.slice(0, 7));
      exemptSection = `<div class="card"><h3>重大支出（豁免，不计入当月常规支出）</h3>
        ${ex.ok && ex.data.length ? ex.data.map(e =>
          `<p>${window.escapeHtml(e.date)} ${fmt(e.amount)} — ${window.escapeHtml(e.exempt_note)} ${window.escapeHtml(e.note)}</p>`).join('')
          : '<p>本月无豁免支出</p>'}</div>`;
    }
    root.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="btn ${period === 'day' ? '' : 'ghost'}" data-p="day">日</button>
        <button class="btn ${period === 'month' ? '' : 'ghost'}" data-p="month">月</button>
        <button class="btn ${period === 'year' ? '' : 'ghost'}" data-p="year">年</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:16px">
        <div class="card"><div class="label" style="color:var(--text-muted)">收入</div><div style="font-size:20px;font-weight:700;color:var(--accent)">${fmt(s.income)}</div></div>
        <div class="card"><div class="label" style="color:var(--text-muted)">常规支出</div><div style="font-size:20px;font-weight:700">${fmt(s.expense)}</div></div>
        <div class="card"><div class="label" style="color:var(--text-muted)">豁免支出</div><div style="font-size:20px;font-weight:700;color:var(--warn)">${fmt(s.exemptExpense)}</div></div>
        <div class="card"><div class="label" style="color:var(--text-muted)">结余</div><div style="font-size:20px;font-weight:700;color:${s.balance >= 0 ? 'var(--accent)' : 'var(--danger)'}">${fmt(s.balance)}</div></div>
      </div>
      <div class="card"><h3>分类占比</h3><div id="pie" style="height:280px"></div></div>
      <div class="card"><h3>收支趋势</h3><div id="line" style="height:280px"></div></div>
      ${exemptSection}`;
    root.querySelectorAll('[data-p]').forEach(b =>
      b.onclick = () => { period = b.dataset.p; render(); });

    const pie = echarts.init(root.querySelector('#pie'));
    const line = echarts.init(root.querySelector('#line'));
    statsCharts.push(pie, line);
    pie.setOption({
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie', radius: ['40%', '70%'],
        data: s.byCategory.map(c => ({ name: c.name, value: c.amount / 100 })),
        label: { formatter: '{b}: {d}%' },
      }],
    });
    line.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: ['收入', '支出'] },
      xAxis: { type: 'category', data: s.trend.map(t => t.label) },
      yAxis: { type: 'value' },
      series: [
        { name: '收入', type: 'line', smooth: true, data: s.trend.map(t => t.income / 100) },
        { name: '支出', type: 'line', smooth: true, data: s.trend.map(t => t.expense / 100) },
      ],
    });
  }

  await render();
};
