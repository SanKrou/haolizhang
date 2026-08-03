window.renderers = window.renderers || {};

window.renderers.ledger = async function (root) {
  let month = window.localDateStr().slice(0, 7);
  let page = 1;
  const pageSize = 100;
  let typeFilter = '';    // '' | 'income' | 'expense'
  let exemptFilter = '';  // '' | '0' | '1'
  let sortBy = 'date-desc';

  async function render() {
    const r = await window.ledger.listTransactions({
      page, pageSize, month,
      type: typeFilter || undefined,
      exempt: exemptFilter === '' ? undefined : Number(exemptFilter),
      sort: sortBy,
    });
    if (!r.ok) { root.innerHTML = `<div class="card">加载失败：${window.escapeHtml(r.error)}</div>`; return; }
    const { items, total } = r.data;
    const rows = items.map(t => `
      <tr data-id="${t.id}">
        <td>${window.escapeHtml(t.date)}</td>
        <td>${t.type === 'income' ? '收入' : '支出'}${t.exempt ? ' <span class="badge">豁免</span>' : ''}</td>
        <td>${(t.amount / 100).toFixed(2)} 元</td>
        <td>${window.escapeHtml(t.note)}</td>
        <td>
          <button class="btn ghost edit-btn">编辑</button>
          <button class="btn danger del-btn">删除</button>
        </td>
      </tr>`).join('');
    root.innerHTML = `
      <div class="cols">
        <div class="col-main">
          <div class="card">
            <h2>账本</h2>
            <div class="row" style="margin-bottom:10px">
              <input type="month" id="g-month" value="${window.escapeHtml(month)}" />
              <select id="g-type">
                <option value="" ${typeFilter === '' ? 'selected' : ''}>全部类型</option>
                <option value="expense" ${typeFilter === 'expense' ? 'selected' : ''}>支出</option>
                <option value="income" ${typeFilter === 'income' ? 'selected' : ''}>收入</option>
              </select>
              <select id="g-exempt">
                <option value="" ${exemptFilter === '' ? 'selected' : ''}>豁免：全部</option>
                <option value="1" ${exemptFilter === '1' ? 'selected' : ''}>仅豁免</option>
                <option value="0" ${exemptFilter === '0' ? 'selected' : ''}>不含豁免</option>
              </select>
              <select id="g-sort">
                <option value="date-desc" ${sortBy === 'date-desc' ? 'selected' : ''}>日期 新→旧</option>
                <option value="date-asc" ${sortBy === 'date-asc' ? 'selected' : ''}>日期 旧→新</option>
                <option value="amount-desc" ${sortBy === 'amount-desc' ? 'selected' : ''}>金额 大→小</option>
                <option value="amount-asc" ${sortBy === 'amount-asc' ? 'selected' : ''}>金额 小→大</option>
                <option value="category" ${sortBy === 'category' ? 'selected' : ''}>按分类</option>
              </select>
            </div>
            <table style="width:100%;border-collapse:collapse">
              <thead><tr><th>日期</th><th>类型</th><th>金额</th><th>备注</th><th>操作</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="5">本月暂无记录</td></tr>'}</tbody>
            </table>
            <div style="margin-top:12px;display:flex;gap:10px;align-items:center">
              <button class="btn ghost" id="g-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
              <span>第 ${page} 页 / 共 ${Math.max(1, Math.ceil(total / pageSize))} 页（${total} 条）</span>
              <button class="btn ghost" id="g-next" ${page * pageSize >= total ? 'disabled' : ''}>下一页</button>
            </div>
          </div>
        </div>
        <div class="col-side">
          <details class="card" id="io-box">
            <summary>导入 / 导出</summary>
            <div id="io-content">
              <h3>导入</h3>
              <div class="row">
                <select id="io-import-format">
                  <option value="xlsx">Excel（.xlsx）</option>
                </select>
                <button class="btn" id="io-import">导入…</button>
              </div>
              <label style="font-size:12px;margin-top:6px;display:inline-block">
                <input type="checkbox" id="io-create-cat" checked /> 自动创建缺失分类
              </label>
              <div id="io-result" class="muted" style="font-size:12px;margin-top:6px"></div>
              <h3 style="margin-top:16px">导出</h3>
              <div class="row">
                <select id="io-export-format">
                  <option value="csv">CSV（全部记录）</option>
                  <option value="summary">汇总文本（当月 · 给 AI 分析）</option>
                </select>
                <button class="btn ghost" id="io-export">导出</button>
              </div>
              <div id="io-export-result" class="muted" style="font-size:12px;margin-top:6px"></div>
            </div>
          </details>
          <details class="card" id="manage-box">
            <summary>分类与标签管理</summary>
            <div id="manage-content"></div>
          </details>
        </div>
      </div>`;
    root.querySelector('#g-month').onchange = (e) => { month = e.target.value; page = 1; render(); };
    root.querySelector('#g-type').onchange = (e) => { typeFilter = e.target.value; page = 1; render(); };
    root.querySelector('#g-exempt').onchange = (e) => { exemptFilter = e.target.value; page = 1; render(); };
    root.querySelector('#g-sort').onchange = (e) => { sortBy = e.target.value; page = 1; render(); };
    root.querySelector('#g-prev').onclick = () => { page--; render(); };
    root.querySelector('#g-next').onclick = () => { page++; render(); };

    // ── 导入/导出（原「导入导出」页并入） ──
    root.querySelector('#io-import').onclick = async () => {
      const res = root.querySelector('#io-result');
      const p = await window.ledger.pickExcelFile();
      if (!p || !p.ok || !p.data) return; // 取消选择
      const path = p.data;
      res.textContent = '导入中…';
      const r = await window.ledger.importExcel(path,
        { createMissingCategories: root.querySelector('#io-create-cat').checked });
      if (!r.ok) { res.textContent = '导入失败：' + r.error; return; }
      res.innerHTML = `成功导入 ${r.data.imported} 行，失败 ${r.data.failed} 行` +
        (r.data.errors.length
          ? `<ul style="font-size:12px;color:var(--danger);margin-top:4px">${r.data.errors.map(e =>
              `<li>第 ${e.row} 行：${window.escapeHtml(e.message ?? '数据格式错误')}</li>`).join('')}</ul>` : '');
      if (window.refreshBalance) window.refreshBalance();
      render();
    };
    root.querySelector('#io-export').onclick = async () => {
      const out = root.querySelector('#io-export-result');
      const fmt = root.querySelector('#io-export-format').value;
      if (fmt === 'csv') {
        const r = await window.ledger.exportCsv();
        out.textContent = r.ok && r.data ? `已导出：${r.data}` : (r.ok ? '已取消' : '失败：' + r.error);
      } else if (fmt === 'summary') {
        const m = window.localDateStr().slice(0, 7);
        const r = await window.ledger.exportSummary(m);
        out.textContent = r.ok && r.data ? `已导出：${r.data}` : (r.ok ? '已取消' : '失败：' + r.error);
      }
    };

    // ── 编辑/删除 ──
    root.querySelectorAll('.edit-btn').forEach(b =>
      b.onclick = () => editForm(root.querySelector(`tr[data-id="${b.closest('tr').dataset.id}"]`)));
    root.querySelectorAll('.del-btn').forEach(b =>
      b.onclick = async () => {
        const id = b.closest('tr').dataset.id;
        if (!(await window.ui.confirm('确认删除这条记录？'))) return;
        await window.ledger.deleteTransaction(Number(id));
        render();
      });

    // ── 分类/标签管理（改名/删除；新增在「记一笔」输入时自动创建） ──
    await renderManage();
  }

  async function renderManage() {
    const content = root.querySelector('#manage-content');
    if (!content) return;
    const [catsR, tagsR] = await Promise.all([
      window.ledger.listCategories(), window.ledger.listTags()]);
    const cats = catsR.ok ? catsR.data : [];
    const tags = tagsR.ok ? tagsR.data : [];
    const group = (type, label) => `
      <h3>${label}</h3>
      ${cats.filter(c => c.type === type).map(c => `
        <div style="display:flex;gap:6px;align-items:center;margin:6px 0">
          <input class="m-cat-name" data-id="${c.id}" value="${window.escapeHtml(c.name)}" style="flex:1;min-width:0" />
          <button class="btn ghost m-cat-save" data-id="${c.id}" style="padding:5px 10px">改名</button>
          <button class="btn danger m-cat-del" data-id="${c.id}" style="padding:5px 10px">删除</button>
        </div>`).join('')}`;
    content.innerHTML = `
      ${group('expense', '支出分类')}
      ${group('income', '收入分类')}
      <h3 style="margin-top:14px">标签</h3>
      <div id="m-tags">
        ${tags.map(t => `
          <span class="badge" style="margin:3px">${window.escapeHtml(t.name)}
            <button class="m-tag-del" data-id="${t.id}" style="border:none;background:none;cursor:pointer;color:inherit">×</button>
          </span>`).join('')}
      </div>
      <p class="muted" style="font-size:11px;margin-top:8px">新分类/标签在「记一笔」输入保存时自动创建</p>`;
    content.querySelectorAll('.m-cat-save').forEach(b =>
      b.onclick = async () => {
        const inp = content.querySelector(`.m-cat-name[data-id="${b.dataset.id}"]`);
        const cat = cats.find(c => String(c.id) === b.dataset.id);
        if (!inp.value.trim()) return;
        await window.ledger.updateCategory(Number(b.dataset.id),
          { name: inp.value.trim(), type: cat.type, sort_order: cat.sort_order });
        renderManage(); render();
      });
    content.querySelectorAll('.m-cat-del').forEach(b =>
      b.onclick = async () => {
        if (!(await window.ui.confirm('确认删除该分类？历史记录的分类将变为未分类'))) return;
        const r = await window.ledger.deleteCategory(Number(b.dataset.id));
        if (!r.ok) { window.ui.alert(r.error); return; }
        renderManage(); render();
      });
    content.querySelectorAll('.m-tag-del').forEach(b =>
      b.onclick = async () => {
        await window.ledger.deleteTag(Number(b.dataset.id));
        renderManage(); render();
      });
  }


  async function editForm(tr) {
    const id = Number(tr.dataset.id);
    const r = await window.ledger.getTransaction(id);
    if (!r.ok) return;
    const t = r.data;
    const cats = await window.ledger.listCategories(t.type);
    tr.innerHTML = `
      <td><input type="date" value="${window.escapeHtml(t.date)}" class="e-date" /></td>
      <td><select class="e-type">
        <option value="expense" ${t.type === 'expense' ? 'selected' : ''}>支出</option>
        <option value="income" ${t.type === 'income' ? 'selected' : ''}>收入</option>
      </select></td>
      <td><input type="number" step="0.01" value="${(t.amount / 100).toFixed(2)}" class="e-amount" /></td>
      <td><input value="${window.escapeHtml(t.note)}" class="e-note" /></td>
      <td><button class="btn e-save">保存</button> <button class="btn ghost e-cancel">取消</button></td>`;
    tr.querySelector('.e-save').onclick = async () => {
      const amt = Math.round(parseFloat(tr.querySelector('.e-amount').value) * 100);
      if (!amt || amt <= 0) { window.ui.alert('请输入有效金额'); return; }
      const r = await window.ledger.updateTransaction(id, {
        type: tr.querySelector('.e-type').value,
        amount: amt,
        date: tr.querySelector('.e-date').value,
        categoryId: t.category_id,
        note: tr.querySelector('.e-note').value,
        exempt: t.exempt, exemptNote: t.exempt_note, tagIds: t.tags.map(x => x.id),
      });
      if (!r.ok) { window.ui.alert(r.error); return; }
      render();
    };
    tr.querySelector('.e-cancel').onclick = render;
  }

  await render();
};
