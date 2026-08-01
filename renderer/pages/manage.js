window.renderers = window.renderers || {};

window.renderers.manage = async function (root) {
  async function render() {
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
    root.innerHTML = `
      <div class="card">
        <h2>管理</h2>
        ${group('expense', '支出分类')}
        ${group('income', '收入分类')}
        <h3 style="margin-top:20px">标签</h3>
        <div id="m-tags">
          ${tags.map(t => `
            <span class="badge" style="margin:4px">${window.escapeHtml(t.name)}
              <button class="m-tag-del" data-id="${t.id}" style="border:none;background:none;cursor:pointer;color:inherit">×</button>
            </span>`).join('')}
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <input id="m-new-tag" placeholder="新标签" />
          <button class="btn m-tag-add">添加</button>
        </div>
      </div>`;

    root.querySelectorAll('.m-cat-add').forEach(b =>
      b.onclick = async () => {
        const inp = root.querySelector(`#m-new-${b.dataset.type}`);
        if (!inp.value.trim()) return;
        await window.ledger.createCategory({ name: inp.value.trim(), type: b.dataset.type });
        render();
      });
    root.querySelectorAll('.m-cat-save').forEach(b =>
      b.onclick = async () => {
        const inp = root.querySelector(`.m-cat-name[data-id="${b.dataset.id}"]`);
        const cat = cats.find(c => String(c.id) === b.dataset.id);
        await window.ledger.updateCategory(Number(b.dataset.id),
          { name: inp.value.trim(), type: cat.type, sort_order: cat.sort_order });
        render();
      });
    root.querySelectorAll('.m-cat-del').forEach(b =>
      b.onclick = async () => {
        const r = await window.ledger.deleteCategory(Number(b.dataset.id));
        if (!r.ok) { alert(r.error); return; }
        render();
      });
    root.querySelector('.m-tag-add').onclick = async () => {
      const inp = root.querySelector('#m-new-tag');
      if (!inp.value.trim()) return;
      await window.ledger.createTag(inp.value.trim());
      render();
    };
    root.querySelectorAll('.m-tag-del').forEach(b =>
      b.onclick = async () => { await window.ledger.deleteTag(Number(b.dataset.id)); render(); });
  }
  await render();
};
