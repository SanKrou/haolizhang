window.renderers = window.renderers || {};

window.renderers.ledger = async function (root) {
  let month = new Date().toISOString().slice(0, 7);
  let page = 1;
  const pageSize = 100;

  async function render() {
    const r = await window.ledger.listTransactions({ page, pageSize, month });
    if (!r.ok) { root.innerHTML = `<div class="card">加载失败：${r.error}</div>`; return; }
    const { items, total } = r.data;
    const rows = items.map(t => `
      <tr data-id="${t.id}">
        <td>${t.date}</td>
        <td>${t.type === 'income' ? '收入' : '支出'}${t.exempt ? ' <span class="badge">豁免</span>' : ''}</td>
        <td>${(t.amount / 100).toFixed(2)} 元</td>
        <td>${t.note || ''}</td>
        <td>
          <button class="btn ghost edit-btn">编辑</button>
          <button class="btn danger del-btn">删除</button>
        </td>
      </tr>`).join('');
    root.innerHTML = `
      <div class="card">
        <h2>账本</h2>
        <input type="month" id="g-month" value="${month}" />
        <table style="width:100%;border-collapse:collapse;margin-top:12px">
          <thead><tr><th>日期</th><th>类型</th><th>金额</th><th>备注</th><th>操作</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5">本月暂无记录</td></tr>'}</tbody>
        </table>
        <div style="margin-top:12px;display:flex;gap:10px;align-items:center">
          <button class="btn ghost" id="g-prev" ${page <= 1 ? 'disabled' : ''}>上一页</button>
          <span>第 ${page} 页 / 共 ${Math.max(1, Math.ceil(total / pageSize))} 页（${total} 条）</span>
          <button class="btn ghost" id="g-next" ${page * pageSize >= total ? 'disabled' : ''}>下一页</button>
        </div>
      </div>`;
    root.querySelector('#g-month').onchange = (e) => { month = e.target.value; page = 1; render(); };
    root.querySelector('#g-prev').onclick = () => { page--; render(); };
    root.querySelector('#g-next').onclick = () => { page++; render(); };
    root.querySelectorAll('.edit-btn').forEach(b =>
      b.onclick = () => editForm(root.querySelector(`tr[data-id="${b.closest('tr').dataset.id}"]`)));
    root.querySelectorAll('.del-btn').forEach(b =>
      b.onclick = async () => {
        const id = b.closest('tr').dataset.id;
        if (!confirm('确认删除这条记录？')) return;
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
      <td><input type="date" value="${t.date}" class="e-date" /></td>
      <td><select class="e-type">
        <option value="expense" ${t.type === 'expense' ? 'selected' : ''}>支出</option>
        <option value="income" ${t.type === 'income' ? 'selected' : ''}>收入</option>
      </select></td>
      <td><input type="number" step="0.01" value="${(t.amount / 100).toFixed(2)}" class="e-amount" /></td>
      <td><input value="${t.note}" class="e-note" /></td>
      <td><button class="btn e-save">保存</button> <button class="btn ghost e-cancel">取消</button></td>`;
    tr.querySelector('.e-save').onclick = async () => {
      await window.ledger.updateTransaction(id, {
        type: tr.querySelector('.e-type').value,
        amount: Math.round(parseFloat(tr.querySelector('.e-amount').value) * 100),
        date: tr.querySelector('.e-date').value,
        categoryId: t.category_id,
        note: tr.querySelector('.e-note').value,
        exempt: t.exempt, exemptNote: t.exempt_note, tagIds: t.tags.map(x => x.id),
      });
      render();
    };
    tr.querySelector('.e-cancel').onclick = render;
  }

  await render();
};
