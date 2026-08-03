window.renderers = window.renderers || {};

window.renderers.add = async function (root) {
  root.innerHTML = `
    <div class="cols">
      <div class="col-main">
        <div class="card">
          <h2>记一笔</h2>
          <div class="form">
            <div class="row">
              <button class="btn" id="type-expense" type="button">支出</button>
              <button class="btn ghost" id="type-income" type="button">收入</button>
            </div>
            <div class="row">
              <div class="field" style="max-width:180px"><label>金额（元）</label><input id="f-amount" type="number" min="0.01" step="0.01" /></div>
              <div class="field" style="min-width:170px"><label>日期</label><input id="f-date" type="date" /></div>
            </div>
            <div class="row">
              <div class="field flex1"><label>分类</label><select id="f-category" style="width:100%"></select></div>
              <div class="field flex1">
                <label>标签</label>
                <div class="row">
                  <div id="f-tags"></div>
                  <input id="f-newtag" class="flex1" placeholder="新标签回车添加" />
                </div>
              </div>
            </div>
            <div class="field"><label>备注</label><input id="f-note" /></div>
            <div class="field">
              <label><input type="checkbox" id="f-exempt" /> 豁免（不计入当月支出/预算）</label>
              <input id="f-exemptnote" placeholder="豁免原因（如：大额/报销）" />
            </div>
            <div id="f-errors" class="field-error"></div>
            <button class="btn" id="f-save">保存</button>
          </div>
        </div>
      </div>
      <div class="col-side">
        <details class="card" id="manage-box">
          <summary>分类与标签管理</summary>
          <div id="manage-content"></div>
        </details>
      </div>
    </div>`;

  let type = 'expense';
  const catSel = root.querySelector('#f-category');
  const tagBox = root.querySelector('#f-tags');
  const errBox = root.querySelector('#f-errors');
  root.querySelector('#f-date').value = window.localDateStr();

  async function loadCats() {
    const r = await window.ledger.listCategories(type);
    catSel.innerHTML = '<option value="">（未分类）</option>' +
      (r.ok ? r.data.map(c => `<option value="${c.id}">${window.escapeHtml(c.name)}</option>`).join('') : '');
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
      `<button type="button" class="badge" data-tag="${t.id}">${window.escapeHtml(t.name)}</button>`).join('');
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

  // ── 分类/标签管理（原「管理」页并入） ──
  async function renderManage() {
    const content = root.querySelector('#manage-content');
    const [catsR, tagsR] = await Promise.all([
      window.ledger.listCategories(), window.ledger.listTags()]);
    const cats = catsR.ok ? catsR.data : [];
    const tags = tagsR.ok ? tagsR.data : [];
    const group = (type, label) => `
      <h3>${label}</h3>
      <div id="m-${type}">
        ${cats.filter(c => c.type === type).map(c => `
          <div style="display:flex;gap:8px;align-items:center;margin:6px 0">
            <input class="m-cat-name" data-id="${c.id}" value="${window.escapeHtml(c.name)}" />
            <button class="btn ghost m-cat-save" data-id="${c.id}">改名</button>
            <button class="btn danger m-cat-del" data-id="${c.id}">删除</button>
          </div>`).join('')}
        <div style="display:flex;gap:8px;margin-top:8px">
          <input id="m-new-${type}" placeholder="新${label}" />
          <button class="btn m-cat-add" data-type="${type}">添加</button>
        </div>
      </div>`;
    content.innerHTML = `
      ${group('expense', '支出分类')}
      ${group('income', '收入分类')}
      <h3 style="margin-top:16px">标签</h3>
      <div id="m-tags">
        ${tags.map(t => `
          <span class="badge" style="margin:4px">${window.escapeHtml(t.name)}
            <button class="m-tag-del" data-id="${t.id}" style="border:none;background:none;cursor:pointer;color:inherit">×</button>
          </span>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <input id="m-new-tag" placeholder="新标签" />
        <button class="btn m-tag-add">添加</button>
      </div>`;
    content.querySelectorAll('.m-cat-add').forEach(b =>
      b.onclick = async () => {
        const inp = content.querySelector(`#m-new-${b.dataset.type}`);
        if (!inp.value.trim()) return;
        await window.ledger.createCategory({ name: inp.value.trim(), type: b.dataset.type });
        loadCats(); renderManage();
      });
    content.querySelectorAll('.m-cat-save').forEach(b =>
      b.onclick = async () => {
        const inp = content.querySelector(`.m-cat-name[data-id="${b.dataset.id}"]`);
        const cat = cats.find(c => String(c.id) === b.dataset.id);
        await window.ledger.updateCategory(Number(b.dataset.id),
          { name: inp.value.trim(), type: cat.type, sort_order: cat.sort_order });
        loadCats(); renderManage();
      });
    content.querySelectorAll('.m-cat-del').forEach(b =>
      b.onclick = async () => {
        const r = await window.ledger.deleteCategory(Number(b.dataset.id));
        if (!r.ok) { window.ui.alert(r.error); return; }
        loadCats(); renderManage();
      });
    content.querySelector('.m-tag-add').onclick = async () => {
      const inp = content.querySelector('#m-new-tag');
      if (!inp.value.trim()) return;
      await window.ledger.createTag(inp.value.trim());
      loadTags(); renderManage();
    };
    content.querySelectorAll('.m-tag-del').forEach(b =>
      b.onclick = async () => { await window.ledger.deleteTag(Number(b.dataset.id)); loadTags(); renderManage(); });
  }

  await Promise.all([loadCats(), loadTags()]);
  await renderManage();
};
