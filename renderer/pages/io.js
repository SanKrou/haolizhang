window.renderers = window.renderers || {};

window.renderers.io = async function (root) {
  root.innerHTML = `
    <div class="card">
      <h2>导入导出</h2>
      <h3>导入 Excel</h3>
      <label><input type="checkbox" id="io-create-cat" checked /> 自动创建缺失分类</label>
      <p style="margin:8px 0;color:var(--text-muted)">
        表头需包含：日期、类型（收入/支出）、金额、分类（可选）、备注（可选）、豁免（可选，填「是」）
      </p>
      <button class="btn" id="io-import">选择 Excel 文件并导入</button>
      <div id="io-result"></div>
      <h3 style="margin-top:20px">导出</h3>
      <button class="btn ghost" id="io-csv">导出 CSV（全部记录）</button>
      <button class="btn ghost" id="io-summary">导出当月汇总文本（给 AI 分析）</button>
      <div id="io-export-result"></div>
    </div>`;

  root.querySelector('#io-import').onclick = async () => {
    const res = document.getElementById('io-result');
    const path = await window.ledger.pickExcelFile();
    if (!path) return;
    res.textContent = '导入中…';
    const r = await window.ledger.importExcel(path,
      { createMissingCategories: root.querySelector('#io-create-cat').checked });
    if (!r.ok) { res.textContent = '导入失败：' + r.error; return; }
    res.innerHTML = `<p>成功导入 ${r.data.imported} 行，失败 ${r.data.failed} 行</p>` +
      (r.data.errors.length
        ? `<ul style="font-size:12px;color:var(--danger)">${r.data.errors.map(e =>
            `<li>第 ${e.row} 行：${e.message ?? '数据格式错误'}</li>`).join('')}</ul>` : '');
    document.getElementById('balance-value').textContent = '--';
  };

  root.querySelector('#io-csv').onclick = async () => {
    const out = document.getElementById('io-export-result');
    const r = await window.ledger.exportCsv();
    out.textContent = r.ok && r.data ? `已导出：${r.data}` : (r.ok ? '已取消' : '失败：' + r.error);
  };
  root.querySelector('#io-summary').onclick = async () => {
    const out = document.getElementById('io-export-result');
    const month = new Date().toISOString().slice(0, 7);
    const r = await window.ledger.exportSummary(month);
    out.textContent = r.ok && r.data ? `已导出：${r.data}` : (r.ok ? '已取消' : '失败：' + r.error);
  };
};
