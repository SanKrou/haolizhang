/**
 * renderer/ui.js — 水墨 UI 组件（替代原生弹窗与右键菜单）
 *  - window.ui.alert(msg)  → Promise<void>
 *  - window.ui.confirm(msg) → Promise<boolean>
 *  - 自定义右键菜单：输入类元素显示 剪切/复制/粘贴/全选，其余区域禁用默认菜单
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── 水墨模态框 ── */
  let modalRoot = null;
  function ensureRoot() {
    if (modalRoot) return modalRoot;
    modalRoot = document.createElement('div');
    modalRoot.className = 'ui-modal-root';
    document.body.appendChild(modalRoot);
    return modalRoot;
  }
  function showModal({ title, message, okText, cancelText, danger }) {
    return new Promise((resolve) => {
      const root = ensureRoot();
      const wrap = document.createElement('div');
      wrap.className = 'ui-modal';
      wrap.innerHTML = `
        <div class="ui-modal-card">
          <div class="ui-modal-title">${esc(title)}</div>
          <div class="ui-modal-msg"></div>
          <div class="ui-modal-btns">
            ${cancelText ? `<button class="btn ghost ui-cancel">${esc(cancelText)}</button>` : ''}
            <button class="btn ui-ok ${danger ? 'danger' : ''}">${esc(okText)}</button>
          </div>
        </div>`;
      root.appendChild(wrap);
      wrap.querySelector('.ui-modal-msg').textContent = message; // textContent 防注入
      let done = false;
      const close = (val) => {
        if (done) return;
        done = true;
        wrap.classList.add('out');
        setTimeout(() => wrap.remove(), 160);
        resolve(val);
      };
      wrap.querySelector('.ui-ok').onclick = () => close(true);
      const cancelBtn = wrap.querySelector('.ui-cancel');
      if (cancelBtn) cancelBtn.onclick = () => close(false);
      wrap.querySelector('.ui-modal-card').addEventListener('click', (e) => e.stopPropagation());
      wrap.addEventListener('click', () => { if (cancelBtn) close(false); });
      document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); close(false); }
      });
      requestAnimationFrame(() => wrap.classList.add('in'));
    });
  }

  window.ui = {
    alert: (msg) => showModal({ title: '提示', message: msg, okText: '知道了' }),
    confirm: (msg) => showModal({ title: '确认', message: msg, okText: '确认', cancelText: '取消' }),
  };

  /* ── 自定义右键菜单 ── */
  let ctxEl = null;
  function closeCtx() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
  function showCtx(x, y, editable) {
    closeCtx();
    ctxEl = document.createElement('div');
    ctxEl.className = 'ui-ctx';
    const items = [];
    if (editable) {
      items.push(
        ['剪切', () => document.execCommand('cut')],
        ['复制', () => document.execCommand('copy')],
        ['粘贴', async () => {
          try {
            const text = window.clip ? window.clip.readText() : '';
            if (!text) return;
            const el = editable;
            const start = el.selectionStart ?? el.value.length;
            const end = el.selectionEnd ?? el.value.length;
            el.setRangeText(text, start, end, 'end');
            el.dispatchEvent(new Event('input', { bubbles: true }));
          } catch { /* 忽略 */ }
        }],
        ['全选', () => editable.select && editable.select()],
      );
    }
    if (items.length === 0) return;
    ctxEl.innerHTML = items.map(([label, fn], i) =>
      `<button class="ui-ctx-item" data-i="${i}">${esc(label)}</button>`).join('');
    document.body.appendChild(ctxEl);
    // 定位（防溢出）
    const rw = ctxEl.offsetWidth, rh = ctxEl.offsetHeight;
    ctxEl.style.left = Math.min(x, window.innerWidth - rw - 6) + 'px';
    ctxEl.style.top = Math.min(y, window.innerHeight - rh - 6) + 'px';
    ctxEl.querySelectorAll('.ui-ctx-item').forEach((b) => {
      b.onclick = () => { items[Number(b.dataset.i)][1](); closeCtx(); };
    });
  }
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const t = e.target.closest('input, textarea, select, [contenteditable]');
    showCtx(e.clientX, e.clientY, t);
  });
  document.addEventListener('click', (e) => {
    // 点击面板外关闭（右键菜单 + 选择面板）
    if (CAL.panel && !CAL.panel.contains(e.target) && !(CAL.input && CAL.input.contains(e.target))) closePanel();
    closeCtx();
  });
  document.addEventListener('blur', closeCtx);
  window.addEventListener('resize', closeCtx);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closePanel(); closeCtx(); } });
  window.addEventListener('scroll', closePanel, true);

  /* ── 原生日期/月份/下拉 → 水墨自绘组件 ── */
  const CAL = { panel: null, input: null, rectEl: null };
  function closePanel() { if (CAL.panel) { CAL.panel.remove(); CAL.panel = null; CAL.input = null; CAL.rectEl = null; } }
  function openPanel(input, html, bind, rectEl) {
    closePanel();
    const panel = document.createElement('div');
    panel.className = 'ink-panel';
    panel.innerHTML = html;
    document.body.appendChild(panel);
    CAL.panel = panel; CAL.input = input; CAL.rectEl = rectEl || input;
    positionPanel();
    if (bind) bind(panel);
  }
  function positionPanel() {
    if (!CAL.panel || !CAL.rectEl) return;
    const rect = CAL.rectEl.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return; // 不可见元素不定位
    let left = rect.left, top = rect.bottom + 6;
    if (left + CAL.panel.offsetWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - CAL.panel.offsetWidth - 8);
    if (top + CAL.panel.offsetHeight > window.innerHeight - 8) top = Math.max(8, rect.top - CAL.panel.offsetHeight - 6);
    CAL.panel.style.left = left + 'px';
    CAL.panel.style.top = top + 'px';
  }
  function parseDateStr(v) {
    if (!v) return null;
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  const fmtDate = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const fmtMonth = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1);

  function initDate(input) {
    if (input.dataset.inkDone) return;
    input.dataset.inkDone = '1';
    input.readOnly = true;
    input.classList.add('ink-native');
    input.addEventListener('click', (e) => {
      e.preventDefault();
      if (CAL.panel && CAL.input === input) { closePanel(); return; }
      const sel = parseDateStr(input.value) || new Date();
      let vy = sel.getFullYear(), vm = sel.getMonth();
      const render = () => {
        const first = new Date(vy, vm, 1);
        const start = (first.getDay() + 6) % 7;
        const days = new Date(vy, vm + 1, 0).getDate();
        const now = new Date();
        let cells = '';
        for (let i = 0; i < start; i++) cells += '<span class="cal-blank"></span>';
        for (let d = 1; d <= days; d++) {
          const isT = now.getFullYear() === vy && now.getMonth() === vm && now.getDate() === d;
          const isS = sel.getFullYear() === vy && sel.getMonth() === vm && sel.getDate() === d;
          cells += `<button type="button" class="cal-day${isT ? ' today' : ''}${isS ? ' sel' : ''}" data-d="${d}">${d}</button>`;
        }
        CAL.panel.innerHTML = `
          <div class="cal-head">
            <button type="button" class="cal-nav" data-m="-1">◀</button>
            <span class="cal-title">${vy} 年 ${vm + 1} 月</span>
            <button type="button" class="cal-nav" data-m="1">▶</button>
          </div>
          <div class="cal-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
          <div class="cal-grid">${cells}</div>`;
        CAL.panel.querySelectorAll('.cal-nav').forEach((b) => b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          vm += Number(b.dataset.m);
          if (vm < 0) { vm = 11; vy--; }
          if (vm > 11) { vm = 0; vy++; }
          render();
        }));
        CAL.panel.querySelectorAll('.cal-day').forEach((b) => b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const d = new Date(vy, vm, Number(b.dataset.d));
          input.value = fmtDate(d);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          closePanel();
        }));
        positionPanel();
      };
      openPanel(input, '', render);
    });
  }

  function initMonth(input) {
    if (input.dataset.inkDone) return;
    input.dataset.inkDone = '1';
    input.readOnly = true;
    input.classList.add('ink-native');
    input.addEventListener('click', (e) => {
      e.preventDefault();
      if (CAL.panel && CAL.input === input) { closePanel(); return; }
      const now = new Date();
      const selM = input.value || fmtMonth(now);
      let vy = now.getFullYear();
      const render = () => {
        const selY = +selM.slice(0, 4), selMo = +selM.slice(5, 7);
        let items = '';
        for (let m = 1; m <= 12; m++) {
          const isT = now.getFullYear() === vy && now.getMonth() === m - 1;
          const isS = selY === vy && selMo === m;
          items += `<button type="button" class="month-item${isT ? ' today' : ''}${isS ? ' sel' : ''}" data-m="${m}">${m} 月</button>`;
        }
        CAL.panel.innerHTML = `
          <div class="cal-head">
            <button type="button" class="cal-nav" data-y="-1">◀</button>
            <span class="cal-title">${vy} 年</span>
            <button type="button" class="cal-nav" data-y="1">▶</button>
          </div>
          <div class="month-grid">${items}</div>`;
        CAL.panel.querySelectorAll('.cal-nav').forEach((b) => b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          vy += Number(b.dataset.y);
          render();
        }));
        CAL.panel.querySelectorAll('.month-item').forEach((b) => b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          input.value = vy + '-' + pad2(Number(b.dataset.m));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          closePanel();
        }));
        positionPanel();
      };
      openPanel(input, '', render);
    });
  }

  function initSelect(select) {
    if (select.dataset.inkDone) return;
    select.dataset.inkDone = '1';
    select.classList.add('ink-hidden');
    const box = document.createElement('button');
    box.type = 'button';
    box.className = 'ink-select';
    const label = document.createElement('span');
    label.className = 'ink-select-label';
    const arrow = document.createElement('span');
    arrow.className = 'ink-select-arrow';
    arrow.textContent = '▾';
    box.append(label, arrow);
    select.insertAdjacentElement('afterend', box);
    const sync = () => {
      const o = select.options[select.selectedIndex];
      label.textContent = o ? o.text : '';
    };
    sync();
    select.addEventListener('change', sync);
    box.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (CAL.panel && CAL.input === select) { closePanel(); return; }
      openPanel(select,
        `<div class="ink-select-panel">${[...select.options].map((o, i) =>
          `<button type="button" class="ink-opt${o.selected ? ' sel' : ''}" data-i="${i}">${esc(o.text)}</button>`).join('')}</div>`,
        (panel) => {
          panel.querySelectorAll('.ink-opt').forEach((b) => b.addEventListener('click', (ev) => {
            ev.stopPropagation();
            select.selectedIndex = Number(b.dataset.i);
            select.dispatchEvent(new Event('change', { bubbles: true }));
            closePanel();
          }));
        }, box); // 用可见按钮定位，避免隐藏 select 的零矩形
    });
  }

  // 自动接管：初始 + 动态渲染（MutationObserver）
  function scan(root) {
    root.querySelectorAll('input[type="date"], input[type="month"], select').forEach((el) => {
      if (el.dataset.inkDone) return;
      if (el.type === 'date') initDate(el);
      else if (el.type === 'month') initMonth(el);
      else initSelect(el);
    });
  }
  scan(document);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType === 1 && !n.dataset.inkDone) scan(n);
    }
  }).observe(document.body, { childList: true, subtree: true });
})();
