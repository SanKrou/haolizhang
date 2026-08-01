window.renderers = window.renderers || {};

window.renderers.add = async function (root) {
  root.innerHTML = `
    <div class="card">
      <h2>记一笔</h2>
      <div class="form" style="display:grid;gap:14px;max-width:560px">
        <div>
          <button class="btn" id="type-expense" type="button">支出</button>
          <button class="btn ghost" id="type-income" type="button">收入</button>
        </div>
        <div><label>金额（元）</label><input id="f-amount" type="number" min="0.01" step="0.01" /></div>
        <div><label>日期</label><input id="f-date" type="date" /></div>
        <div><label>分类</label><select id="f-category"></select></div>
        <div><label>标签</label><div id="f-tags"></div><input id="f-newtag" placeholder="输入新标签后回车" /></div>
        <div><label>备注</label><input id="f-note" /></div>
        <div>
          <label><input type="checkbox" id="f-exempt" /> 豁免（不计入当月支出/预算）</label>
          <input id="f-exemptnote" placeholder="豁免原因（如：大额/报销）" style="margin-top:6px" />
        </div>
        <div id="f-errors" class="field-error"></div>
        <button class="btn" id="f-save">保存</button>
      </div>
    </div>`;

  let type = 'expense';
  const catSel = root.querySelector('#f-category');
  const tagBox = root.querySelector('#f-tags');
  const errBox = root.querySelector('#f-errors');
  root.querySelector('#f-date').value = new Date().toISOString().slice(0, 10);

  async function loadCats() {
    const r = await window.ledger.listCategories(type);
    catSel.innerHTML = '<option value="">（未分类）</option>' +
      (r.ok ? r.data.map(c => `<option value="${c.id}">${c.name}</option>`).join('') : '');
  }
  const toggleType = (t) => {
    type = t;
    root.querySelector('#type-expense').className = t === 'expense' ? 'btn' : 'btn ghost';
    root.querySelector('#type-income').className = t === 'income' ? 'btn' : 'btn ghost';
    loadCats();
  };
  root.querySelector('#type-expense').onclick = () => toggleType('expense');
  root.querySelector('#type-income').onclick = () => toggleType('income');

  const tags = new Set();
  async function loadTags() {
    const r = await window.ledger.listTags();
    if (!r.ok) return;
    tagBox.innerHTML = r.data.map(t =>
      `<button type="button" class="badge" data-tag="${t.id}">${t.name}</button>`).join('');
    tagBox.querySelectorAll('[data-tag]').forEach(b => {
      b.onclick = () => {
        const id = Number(b.dataset.tag);
        if (tags.has(id)) { tags.delete(id); b.style.opacity = '0.5'; }
        else { tags.add(id); b.style.opacity = '1'; }
      };
      b.style.opacity = tags.has(Number(b.dataset.tag)) ? '1' : '0.5';
    });
  }
  root.querySelector('#f-newtag').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    const r = await window.ledger.createTag(e.target.value.trim());
    if (r.ok) { e.target.value = ''; loadTags(); }
  });

  root.querySelector('#f-save').onclick = async () => {
    errBox.textContent = '';
    const amount = Math.round(parseFloat(root.querySelector('#f-amount').value) * 100);
    const date = root.querySelector('#f-date').value;
    if (!amount || amount <= 0) { errBox.textContent = '请输入有效金额'; return; }
    if (!date) { errBox.textContent = '请选择日期'; return; }
    const exempt = root.querySelector('#f-exempt').checked;
    if (exempt && !root.querySelector('#f-exemptnote').value.trim()) {
      errBox.textContent = '豁免需填写原因'; return;
    }
    const r = await window.ledger.createTransaction({
      type, amount, date,
      categoryId: catSel.value ? Number(catSel.value) : null,
      note: root.querySelector('#f-note').value.trim(),
      exempt, exemptNote: root.querySelector('#f-exemptnote').value.trim(),
      tagIds: [...tags],
    });
    if (!r.ok) { errBox.textContent = r.error; return; }
    root.querySelector('#f-amount').value = '';
    root.querySelector('#f-note').value = '';
    root.querySelector('#f-exempt').checked = false;
    root.querySelector('#f-exemptnote').value = '';
    tags.clear(); loadTags();
    const s = await window.ledger.getStatistics({ period: 'month', date });
    if (s.ok) {
      document.getElementById('balance-value').textContent =
        (s.data.balance / 100).toFixed(2) + ' 元';
    }
  };

  await Promise.all([loadCats(), loadTags()]);
};
