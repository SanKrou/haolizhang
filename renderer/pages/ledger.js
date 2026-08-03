window.renderers = window.renderers || {};

window.renderers.ledger = async function (root) {
  let month = window.localDateStr().slice(0, 7);
  let page = 1;
  const pageSize = 100;

  async function render() {
    const r = await window.ledger.listTransactions({ page, pageSize, month });
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
            <input type="month" id="g-month" value="${window.escapeHtml(month)}" />
            <table style="width:100%;border-collapse:collapse;margin-top:12px">
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
              <h3>导入 Excel</h3>
              <label><input type="checkbox" id="io-create-cat" checked /> 自动创建缺失分类</label>
              <p style="margin:8px 0;color:var(--text-muted)">
                表头需包含：日期、类型（收入/支出）、金额、分类（可选）、备注（可选）、豁免（可选，填「是」）
              </p>
              <button class="btn" id="io-import">选择 Excel 文件并导入</button>
              <div id="io-result"></div>
              <h3 style="margin-top:16px">导出</h3>
              <button class="btn ghost" id="io-csv">导出 CSV（全部记录）</button>
              <button class="btn ghost" id="io-summary">导出当月汇总文本（给 AI 分析）</button>
              <div id="io-export-result"></div>
            </div>
          </details>
        </div>
      </div>`;
    root.querySelector('#g-month').onchange = (e) => { month = e.target.value; page = 1; render(); };
    root.querySelector('#g-prev').onclick = () => { page--; render(); };
    root.querySelector('#g-next').onclick = () => { page++; render(); };

    // ── 导入/导出（原「导入导出」页并入） ──
    root.querySelector('#io-import').onclick = async () => {
      const res = root.querySelector('#io-result');
      const path = await window.ledger.pickExcelFile();
      if (!path) return;
      res.textContent = '导入中…';
      const r = await window.ledger.importExcel(path,
        { createMissingCategories: root.querySelector('#io-create-cat').checked });
      if (!r.ok) { res.textContent = '导入失败：' + r.error; return; }
      res.innerHTML = `<p>成功导入 ${r.data.imported} 行，失败 ${r.data.failed} 行</p>` +
        (r.data.errors.length
          ? `<ul style="font-size:12px;color:var(--danger)">${r.data.errors.map(e =>
              `<li>第 ${e.row} 行：${window.escapeHtml(e.message ?? '数据格式错误')}</li>`).join('')}</ul>` : '');
      document.getElementById('balance-value').textContent = '--';
      render();
    };
    root.querySelector('#io-csv').onclick = async () => {
      const out = root.querySelector('#io-export-result');
      const r = await window.ledger.exportCsv();
      out.textContent = r.ok && r.data ? `已导出：${r.data}` : (r.ok ? '已取消' : '失败：' + r.error);
    };
    root.querySelector('#io-summary').onclick = async () => {
      const out = root.querySelector('#io-export-result');
      const m = window.localDateStr().slice(0, 7);
      const r = await window.ledger.exportSummary(m);
      out.textContent = r.ok && r.data ? `已导出：${r.data}` : (r.ok ? '已取消' : '失败：' + r.error);
    };
    root.querySelectorAll('.edit-btn').forEach(b =>
      b.onclick = () => editForm(root.querySelector(`tr[data-id="${b.closest('tr').dataset.id}"]`)));
    root.querySelectorAll('.del-btn').forEach(b =>
      b.onclick = async () => {
        const id = b.closest('tr').dataset.id;
        if (!(await window.ui.confirm('确认删除这条记录？'))) return;
        await window.ledger.deleteTransaction(Number(id));
        render();
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
