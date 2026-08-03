window.renderers = window.renderers || {};

// 模块级持有本视图创建的 ECharts 实例：切换 period 会重建 DOM，切出视图时 app.js renderView
// 会 root.innerHTML='' 清空旧 DOM，但旧实例仍被 ECharts 全局实例表持有无法 GC；
// 保存引用供 render 开头统一 dispose，同时覆盖「切 period」与「重进视图」两种累积场景。
let statsCharts = [];

window.renderers.stats = async function (root) {
  let period = 'month';
  const today = window.localDateStr();
  let budgetMonth = today.slice(0, 7);
  // 自定义区间：默认本月 1 日 → 今天
  let rangeStart = today.slice(0, 8) + '01';
  let rangeEnd = today;

  // ── 预算（原「预算」页并入） ──
  async function renderBudget() {
    const box = root.querySelector('#budget-content');
    if (!box) return;
    const [catsR, budR, sumR] = await Promise.all([
      window.ledger.listCategories('expense'),
      window.ledger.getBudgets(budgetMonth),
      window.ledger.getBudgetSummary(budgetMonth),
    ]);
    if (!budR.ok) { box.innerHTML = `<p style="color:var(--danger)">预算加载失败</p>`; return; }
    const cats = catsR.ok ? catsR.data : [];
    const budgets = budR.data;
    const total = budgets.find(b => b.categoryId === null);
    const bar = (b) => {
      const pct = b.amount > 0 ? Math.min(100, Math.round((b.spent / b.amount) * 100)) : 0;
      const color = b.over ? 'var(--danger)' : (pct >= 80 ? 'var(--warn)' : 'var(--ok)');
      return `<div style="height:6px;background:#ece5d3;margin:6px 0">
        <div style="height:6px;width:${pct}%;background:${color};transition:width .4s ease"></div>
      </div>
      <span class="b-num" style="font-size:12px;color:var(--text-muted)">
        ${(b.spent / 100).toFixed(2)} / ${(b.amount / 100).toFixed(2)} 元（${pct}%）
        ${b.over ? '<span class="badge" style="background:var(--danger);color:#fff">已超支</span>' : ''}
      </span>`;
    };
    box.innerHTML = `
      <h3 style="margin-top:8px">总额预算</h3>
      ${total ? bar(total) : '<p class="muted">未设置</p>'}
      <div class="row" style="margin:6px 0">
        <input id="b-total" type="number" step="0.01" placeholder="每月总支出预算（元）"
          value="${total ? (total.amount / 100).toFixed(2) : ''}" />
        <button class="btn" id="b-save-total">保存</button>
      </div>
      <h3 style="margin-top:16px">分类预算</h3>
      <table class="b-table">
        <tbody>
          ${cats.map(c => {
            const b = budgets.find(x => x.categoryId === c.id);
            const pct = b && b.amount > 0 ? Math.min(100, Math.round((b.spent / b.amount) * 100)) : 0;
            const fillColor = b && b.over ? 'var(--danger)' : (pct >= 80 ? 'var(--warn)' : 'var(--ok)');
            return `<tr>
              <td class="t-name">${window.escapeHtml(c.name)}</td>
              <td class="t-bar">
                ${b ? `<div class="progress"><div class="progress-fill" style="width:${pct}%;background:${fillColor}"></div></div>
                <span class="b-num t-num">${(b.spent / 100).toFixed(2)} / ${(b.amount / 100).toFixed(2)} 元（${pct}%）</span>`
                : '<span class="muted" style="font-size:12px">未设置</span>'}
              </td>
              <td class="t-input"><input class="b-cat" data-cat="${c.id}" type="number" step="0.01"
                placeholder="0.00" value="${b ? (b.amount / 100).toFixed(2) : ''}" /></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <button class="btn" id="b-save-cats" style="margin-top:10px">保存分类预算</button>`;
    box.querySelector('#b-save-total').onclick = async () => {
      const v = parseFloat(box.querySelector('#b-total').value);
      if (!v || v <= 0) return;
      await window.ledger.setBudget({ categoryId: null, month: budgetMonth, amount: Math.round(v * 100) });
      renderBudget();
    };
    box.querySelector('#b-save-cats').onclick = async () => {
      for (const inp of box.querySelectorAll('.b-cat')) {
        const v = parseFloat(inp.value);
        if (!v || v <= 0) continue;
        await window.ledger.setBudget({
          categoryId: Number(inp.dataset.cat), month: budgetMonth,
          amount: Math.round(v * 100),
        });
      }
      renderBudget();
    };
  }

  async function render() {
    // 先释放上一轮实例再重建 DOM/init，避免 ECharts 全局实例表持引用导致内存泄漏；
    // dispose 后立刻清空数组，不会对同一实例重复 dispose
    for (const inst of statsCharts) { try { inst.dispose(); } catch (e) {} }
    statsCharts = [];

    const query = period === 'range'
      ? { period: 'range', dateStart: rangeStart, dateEnd: rangeEnd }
      : { period, date: today };
    const r = await window.ledger.getStatistics(query);
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
      <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
        <button class="btn ${period === 'day' ? '' : 'ghost'}" data-p="day">日</button>
        <button class="btn ${period === 'month' ? '' : 'ghost'}" data-p="month">月</button>
        <button class="btn ${period === 'year' ? '' : 'ghost'}" data-p="year">年</button>
        <button class="btn ${period === 'range' ? '' : 'ghost'}" data-p="range">区间</button>
      </div>
      ${period === 'range' ? `
      <div class="row" style="margin-bottom:14px">
        <input type="date" id="rs-start" value="${window.escapeHtml(rangeStart)}" />
        <span class="muted">至</span>
        <input type="date" id="rs-end" value="${window.escapeHtml(rangeEnd)}" />
        <button class="btn ghost" id="rs-apply">应用</button>
      </div>` : ''}
      <div class="cols">
        <div class="col-main">
          <div class="card"><h3>分类占比</h3><div id="pie" style="height:280px"></div></div>
          <div class="card"><h3>收支趋势</h3><div id="line" style="height:280px"></div></div>
          ${exemptSection}
        </div>
        <div class="col-side">
          <div class="stat-row">
            <div class="card"><div class="label" style="color:var(--text-muted)">收入</div><div class="stat-num" style="font-size:20px;font-weight:700;color:var(--ok)">${fmt(s.income)}</div></div>
            <div class="card"><div class="label" style="color:var(--text-muted)">常规支出</div><div class="stat-num" style="font-size:20px;font-weight:700">${fmt(s.expense)}</div></div>
            <div class="card"><div class="label" style="color:var(--text-muted)">豁免支出</div><div class="stat-num" style="font-size:20px;font-weight:700;color:var(--warn)">${fmt(s.exemptExpense)}</div></div>
            <div class="card"><div class="label" style="color:var(--text-muted)">结余</div><div class="stat-num" style="font-size:20px;font-weight:700;color:${s.balance >= 0 ? 'var(--ok)' : 'var(--danger)'}">${fmt(s.balance)}</div></div>
          </div>
          <div class="card">
            <h3>本月预算</h3>
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
              <input type="month" id="b-month" value="${window.escapeHtml(budgetMonth)}" />
            </div>
            <div id="budget-content"></div>
          </div>
        </div>
      </div>`;
    root.querySelectorAll('[data-p]').forEach(b =>
      b.onclick = () => { period = b.dataset.p; render(); });
    if (period === 'range') {
      root.querySelector('#rs-start').onchange = (e) => { rangeStart = e.target.value; };
      root.querySelector('#rs-end').onchange = (e) => { rangeEnd = e.target.value; };
      root.querySelector('#rs-apply').onclick = () => {
        if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) {
          window.ui.alert('请选择有效的日期区间');
          return;
        }
        render();
      };
    }

    const pie = echarts.init(root.querySelector('#pie'));
    const line = echarts.init(root.querySelector('#line'));
    statsCharts.push(pie, line);
    pie.setOption({
      color: ['#a57f5f', '#c9a94f', '#6f8f6f', '#5f7f9f', '#a86f6f', '#9f9a8f'],
      tooltip: { trigger: 'item', backgroundColor: '#fdfbf5', borderColor: '#e6ddc8', textStyle: { color: '#33302a' } },
      series: [{
        type: 'pie', radius: ['40%', '70%'],
        data: s.byCategory.map(c => ({ name: c.name, value: c.amount / 100 })),
        label: { formatter: '{b}: {d}%' },
      }],
    });
    line.setOption({
      color: ['#5f7f5f', '#b3452f'],
      tooltip: { trigger: 'axis', backgroundColor: '#fdfbf5', borderColor: '#e6ddc8', textStyle: { color: '#33302a' } },
      legend: { data: ['收入', '支出'], textStyle: { color: '#33302a' } },
      xAxis: { type: 'category', data: s.trend.map(t => t.label) },
      yAxis: [
        { type: 'value', scale: true, name: '支出（元）', nameTextStyle: { color: '#9a9182' } },
        { type: 'value', scale: true, name: '收入（元）', nameTextStyle: { color: '#9a9182' }, splitLine: { show: false } },
      ],
      series: [
        { name: '收入', type: 'line', smooth: true, yAxisIndex: 1, data: s.trend.map(t => t.income / 100) },
        { name: '支出', type: 'line', smooth: true, yAxisIndex: 0, data: s.trend.map(t => t.expense / 100) },
      ],
    });

    root.querySelector('#b-month').onchange = (e) => { budgetMonth = e.target.value; renderBudget(); };
    await renderBudget();
  }

  await render();
};
