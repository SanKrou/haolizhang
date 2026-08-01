window.renderers = window.renderers || {};

window.renderers.budget = async function (root) {
  let month = new Date().toISOString().slice(0, 7);

  async function render() {
    const [catsR, budR, sumR] = await Promise.all([
      window.ledger.listCategories('expense'),
      window.ledger.getBudgets(month),
      window.ledger.getBudgetSummary(month),
    ]);
    if (!budR.ok) { root.innerHTML = `<div class="card">加载失败：${budR.error}</div>`; return; }
    const cats = catsR.ok ? catsR.data : [];
    const budgets = budR.data;
    const sum = sumR.ok ? sumR.data : null;
    const total = budgets.find(b => b.categoryId === null);

    const bar = (b) => {
      const pct = b.amount > 0 ? Math.min(100, Math.round((b.spent / b.amount) * 100)) : 0;
      const color = b.over ? 'var(--danger)' : (pct >= 80 ? 'var(--warn)' : 'var(--accent)');
      return `<div style="height:8px;background:#eef1f8;border-radius:99px;margin:6px 0">
        <div style="height:8px;width:${pct}%;background:${color};border-radius:99px;transition:width .4s ease"></div>
      </div>
      <span style="font-size:12px;color:var(--text-muted)">
        ${(b.spent / 100).toFixed(2)} / ${(b.amount / 100).toFixed(2)} 元（${pct}%）
        ${b.over ? '<span class="badge" style="background:var(--danger);color:#fff">已超支</span>' : ''}
      </span>`;
    };

    root.innerHTML = `
      <div class="card">
        <h2>预算</h2>
        <input type="month" id="b-month" value="${month}" />
        <h3 style="margin-top:16px">总额预算</h3>
        ${total ? bar(total) : '<p style="color:var(--text-muted)">未设置</p>'}
        <input id="b-total" type="number" step="0.01" placeholder="每月总支出预算（元）"
          value="${total ? (total.amount / 100).toFixed(2) : ''}" />
        <button class="btn" id="b-save-total">保存总额预算</button>
        <h3 style="margin-top:16px">分类预算</h3>
        ${cats.map(c => {
          const b = budgets.find(x => x.categoryId === c.id);
          return `<div style="margin-bottom:10px">
            <span>${c.name}</span> ${b ? bar(b) : ''}
            <input class="b-cat" data-cat="${c.id}" type="number" step="0.01"
              placeholder="分类预算（元）" value="${b ? (b.amount / 100).toFixed(2) : ''}" />
          </div>`;
        }).join('')}
        <button class="btn" id="b-save-cats">保存分类预算</button>
      </div>`;

    root.querySelector('#b-month').onchange = (e) => { month = e.target.value; render(); };
    root.querySelector('#b-save-total').onclick = async () => {
      const v = parseFloat(root.querySelector('#b-total').value);
      if (!v || v <= 0) return;
      await window.ledger.setBudget({ categoryId: null, month, amount: Math.round(v * 100) });
      render();
    };
    root.querySelector('#b-save-cats').onclick = async () => {
      for (const inp of root.querySelectorAll('.b-cat')) {
        const v = parseFloat(inp.value);
        await window.ledger.setBudget({
          categoryId: Number(inp.dataset.cat), month,
          amount: Math.round(v * 100),
        });
      }
      render();
    };
  }

  await render();
};
