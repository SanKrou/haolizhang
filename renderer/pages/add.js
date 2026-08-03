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
              <div class="field flex1">
                <label>分类（输入或选择现有）</label>
                <input id="f-category" placeholder="输入新分类，或点选现有" autocomplete="off" />
              </div>
              <div class="field flex1">
                <label>标签（输入后回车添加）</label>
                <div class="row">
                  <div id="f-tags"></div>
                  <input id="f-newtag" class="flex1" placeholder="如：午餐 / 通勤" autocomplete="off" />
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
        <div class="card">
          <h3>填写提示</h3>
          <p class="muted" style="font-size:12px;line-height:1.9">
            分类 / 标签输入时自动匹配现有项，点选即可；<br>
            输入不存在的名称，保存这笔记录时会自动建档；<br>
            删除或改名请到「账本」页右下角的分类与标签管理。
          </p>
        </div>
      </div>
    </div>`;

  let type = 'expense';
  const catInput = root.querySelector('#f-category');
  const tagInput = root.querySelector('#f-newtag');
  const tagBox = root.querySelector('#f-tags');
  const errBox = root.querySelector('#f-errors');
  root.querySelector('#f-date').value = window.localDateStr();

  /* ── 分类：输入匹配 + 自动建档 ── */
  let catCache = [];     // [{id, name}] 当前 type
  let selCatId = null;   // 选中现有分类的 id（null = 新分类）
  let catPanel = null;
  function closeCatPanel() { if (catPanel) { catPanel.remove(); catPanel = null; } }
  function showCatPanel() {
    closeCatPanel();
    const kw = catInput.value.trim();
    const list = catCache.filter(c => !kw || c.name.includes(kw)).slice(0, 8);
    if (!list.length) return;
    catPanel = document.createElement('div');
    catPanel.className = 'ink-panel';
    catPanel.innerHTML = list.map(c =>
      `<button type="button" class="ink-opt" data-id="${c.id}">${window.escapeHtml(c.name)}</button>`).join('');
    document.body.appendChild(catPanel);
    const rect = catInput.getBoundingClientRect();
    let left = rect.left, top = rect.bottom + 6;
    if (left + catPanel.offsetWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - catPanel.offsetWidth - 8);
    if (top + catPanel.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - catPanel.offsetHeight - 6);
    catPanel.style.left = left + 'px';
    catPanel.style.top = top + 'px';
    catPanel.querySelectorAll('.ink-opt').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      const c = catCache.find(x => String(x.id) === b.dataset.id);
      if (c) { catInput.value = c.name; selCatId = c.id; }
      closeCatPanel();
    });
  }
  catInput.addEventListener('focus', showCatPanel);
  catInput.addEventListener('input', () => { selCatId = null; showCatPanel(); });
  catInput.addEventListener('blur', () => setTimeout(closeCatPanel, 150));

  /* ── 标签：待保存文本集，保存时自动建档 ── */
  const pendingTags = new Set(); // 文本集合
  let tagCache = [];             // [{id, name}]
  let tagPanel = null;
  function closeTagPanel() { if (tagPanel) { tagPanel.remove(); tagPanel = null; } }
  function renderTags() {
    tagBox.innerHTML = [...pendingTags].map(t =>
      `<button type="button" class="badge tag-chip" data-t="${window.escapeHtml(t)}">${window.escapeHtml(t)} ×</button>`).join('');
    tagBox.querySelectorAll('.tag-chip').forEach(b => b.onclick = () => {
      pendingTags.delete(b.dataset.t);
      renderTags();
    });
  }
  function showTagPanel() {
    closeTagPanel();
    const kw = tagInput.value.trim();
    const list = tagCache.filter(t => !pendingTags.has(t.name) && (!kw || t.name.includes(kw))).slice(0, 8);
    if (!list.length) return;
    tagPanel = document.createElement('div');
    tagPanel.className = 'ink-panel';
    tagPanel.innerHTML = list.map(t =>
      `<button type="button" class="ink-opt">${window.escapeHtml(t.name)}</button>`).join('');
    document.body.appendChild(tagPanel);
    const rect = tagInput.getBoundingClientRect();
    let left = rect.left, top = rect.bottom + 6;
    if (left + tagPanel.offsetWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - tagPanel.offsetWidth - 8);
    if (top + tagPanel.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - tagPanel.offsetHeight - 6);
    tagPanel.style.left = left + 'px';
    tagPanel.style.top = top + 'px';
    tagPanel.querySelectorAll('.ink-opt').forEach(b => b.onclick = (e) => {
      e.stopPropagation();
      pendingTags.add(b.textContent.trim());
      tagInput.value = '';
      renderTags();
      closeTagPanel();
    });
  }
  tagInput.addEventListener('focus', showTagPanel);
  tagInput.addEventListener('input', showTagPanel);
  tagInput.addEventListener('blur', () => setTimeout(closeTagPanel, 150));
  tagInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = tagInput.value.trim();
    if (!v) return;
    pendingTags.add(v);
    tagInput.value = '';
    renderTags();
    closeTagPanel();
  });

  /* ── 数据加载与类型切换 ── */
  async function loadCats() {
    const r = await window.ledger.listCategories(type);
    catCache = r.ok ? r.data : [];
  }
  async function loadTags() {
    const r = await window.ledger.listTags();
    tagCache = r.ok ? r.data : [];
  }
  const toggleType = (t) => {
    if (t === type) return;
    type = t;
    root.querySelector('#type-expense').className = t === 'expense' ? 'btn' : 'btn ghost';
    root.querySelector('#type-income').className = t === 'income' ? 'btn' : 'btn ghost';
    catInput.value = ''; selCatId = null;
    loadCats();
  };
  root.querySelector('#type-expense').onclick = () => toggleType('expense');
  root.querySelector('#type-income').onclick = () => toggleType('income');

  /* ── 保存：分类/标签不存在则自动建档 ── */
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
    // 分类：选中 id → 同名现有 → 自动创建
    let categoryId = null;
    const catName = catInput.value.trim();
    if (selCatId) categoryId = selCatId;
    else if (catName) {
      const hit = catCache.find(c => c.name === catName);
      if (hit) categoryId = hit.id;
      else {
        const cr = await window.ledger.createCategory({ name: catName, type });
        if (!cr.ok) { errBox.textContent = '分类创建失败：' + cr.error; return; }
        categoryId = cr.data.id;
        loadCats();
      }
    }
    // 标签：逐个自动创建（createTag 自带查重）
    const tagIds = [];
    for (const t of pendingTags) {
      const tr = await window.ledger.createTag(t);
      if (tr.ok) tagIds.push(tr.data.id);
    }
    const r = await window.ledger.createTransaction({
      type, amount, date,
      categoryId,
      note: root.querySelector('#f-note').value.trim(),
      exempt, exemptNote: root.querySelector('#f-exemptnote').value.trim(),
      tagIds,
    });
    if (!r.ok) { errBox.textContent = r.error; return; }
    // 清空表单
    root.querySelector('#f-amount').value = '';
    root.querySelector('#f-note').value = '';
    root.querySelector('#f-exempt').checked = false;
    root.querySelector('#f-exemptnote').value = '';
    catInput.value = ''; selCatId = null;
    pendingTags.clear(); renderTags();
    Promise.all([loadCats(), loadTags()]);
    if (window.refreshBalance) window.refreshBalance();
  };

  await Promise.all([loadCats(), loadTags()]);
};
