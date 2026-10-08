/* ================= 0.4.8 双链 [[ 输入补全（源码模式，notes-048-wiki-autocomplete；client panel/editor.js 同构一份）=================
   触发：源码 textarea 输入「[[」开下拉，后续字符为 query（到 ]] 或换行为止——内核 wikiAcTrigger 纯函数判定窗口）。
   数据源零 RPC：候选 = 内存 notes 缓存经内核 wikiAcFilter 过滤（标题子串+id 前缀双匹配，剔除软删/sys，updatedAt 倒序前 8）。
   插入产物 = [[id]]（id 最稳：渲染层 wikiResolve 把 id 链显示为标题，无需插标题）；选中后光标落闭合括号后。
   弹层定位选型 = mirror-div 光标跟随（弃「textarea 底部固定」：编辑器 textarea 通栏高、长文滚动后底部固定与光标视线脱节；
   mirror-div 复制排版属性 + 同步 scrollTop 量测光标视口坐标是 textarea 场景通用解，双端同一份逻辑两处落地）。
   键盘事件边界：下拉开时 ↑↓/Enter/Tab/Esc 归下拉（preventDefault + stopPropagation，不冒泡到 document 的列表导航/Esc 分层栈）；
   关时零介入（j/k/↑↓ 在 textarea 内本就归原生光标移动，列表导航由 keyboard.js 的 inField 闸拦截，与本功能互不感知）。
   零命中：渲染空态行（不可选，Enter/Tab 穿透默认行为并关下拉）。IME 组合中（isComposing）方向键/Enter 让位输入法。
   富文本模式 v1 不做（[[标题]] 纯文本敲入渲染照常解析 = 退路存在）；v2 挂点：bindRich 内同款 input/keydown 侦测 + DOM Range 量测。 */
var wikiAc = null;   /* null=关闭；{ el, items, active, start } = 开（start = 当前触发窗「[[」首字符下标，随输入逐键刷新） */
function wikiAcClose() { if (wikiAc) { try { wikiAc.el.remove() } catch (e) {} wikiAc = null } }
/* 每次 input/光标移动重估：窗口失配（]]/换行/选区）→ 关；命中 → 开/刷候选并重定位 */
function wikiAcRefresh() {
  var ta = $('edSrc');
  if (!ta || edMode !== 'source' || !edNote) { wikiAcClose(); return }
  if (ta.selectionStart !== ta.selectionEnd) { wikiAcClose(); return }   /* 有选区不弹（插入覆盖选区语义混，交给用户明确操作） */
  var trig = wikiAcTrigger(ta.value, ta.selectionStart);
  if (!trig) { wikiAcClose(); return }
  var items = wikiAcFilter(notes, trig.query);
  if (!wikiAc) {
    var el = document.createElement('div');
    el.className = 'wiki-ac';
    /* mousedown 拦默认：保住 textarea 焦点/光标（点候选不 blur，点击插入后焦点仍在编辑区；点外关闭由 blur 承担） */
    el.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    document.body.appendChild(el);
    wikiAc = { el: el, items: [], active: 0, start: trig.start };
  }
  wikiAc.start = trig.start; wikiAc.items = items;
  if (wikiAc.active >= items.length) wikiAc.active = 0;
  wikiAcRender(ta);
}
function wikiAcRender(ta) {
  if (!wikiAc) return;
  var items = wikiAc.items, h = '';
  if (!items.length) {
    h = '<div class="wiki-ac-empty">' + esc(t('editor.wikiAcEmpty')) + '</div>';
  } else {
    for (var i = 0; i < items.length; i++) {
      var n = items[i];
      h += '<div class="wiki-ac-item' + (i === wikiAc.active ? ' on' : '') + '" data-i="' + i + '" role="option" aria-selected="' + (i === wikiAc.active) + '">'
        + '<span class="dot" style="background:' + (KCOLOR[n.kind] || KCOLOR.note) + '"></span>'
        + '<span class="ti">' + esc(n.title || t('tree.untitled')) + '</span>'
        + '<span class="id">' + esc(n.id) + '</span></div>';
    }
  }
  wikiAc.el.innerHTML = h;
  wikiAc.el.querySelectorAll('.wiki-ac-item').forEach(function (row) {
    row.addEventListener('click', function () { wikiAcApply(items[+row.getAttribute('data-i')]) });
  });
  wikiAcPosition(ta);
}
/* mirror-div 量测：复制 textarea 排版属性进隐藏 div，文本截到光标 + 零宽 marker 量坐标，换算回 textarea 视口系 */
function wikiAcPosition(ta) {
  if (!wikiAc || !ta) return;
  var caret = ta.selectionStart;
  var cs = getComputedStyle(ta);
  var div = document.createElement('div');
  var props = ['boxSizing', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textIndent', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'tabSize'];
  div.style.position = 'fixed'; div.style.visibility = 'hidden'; div.style.left = '-9999px'; div.style.top = '0';
  div.style.whiteSpace = 'pre-wrap'; div.style.wordWrap = 'break-word'; div.style.overflowWrap = 'break-word'; div.style.overflow = 'hidden';
  for (var i = 0; i < props.length; i++) { var p = props[i]; div.style[p] = cs[p]; }
  div.style.width = ta.clientWidth + 'px'; div.style.height = ta.clientHeight + 'px';   /* 定高 + overflow:hidden → scrollTop 可编程（与源滚动对齐的前提） */
  div.textContent = ta.value.slice(0, caret);
  var marker = document.createElement('span'); marker.textContent = '​' /* 零宽占位 */;
  div.appendChild(marker);
  document.body.appendChild(div);
  div.scrollTop = ta.scrollTop;   /* 与源 textarea 同滚动：marker rect 随滚动位移 = 光标可视坐标 */
  var taR = ta.getBoundingClientRect(), mk = marker.getBoundingClientRect(), dv = div.getBoundingClientRect();
  var lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6 || 20;
  var x = taR.left + (mk.left - dv.left), y = taR.top + (mk.top - dv.top) + lh + 2;
  div.remove();
  var el = wikiAc.el, pw = el.offsetWidth || 240, ph = el.offsetHeight || 200;
  x = Math.max(8, Math.min(x, window.innerWidth - pw - 8));   /* 视口夹紧不溢出（面板窄宽同护；selection.js showCap 同纪律） */
  y = Math.max(8, Math.min(y, window.innerHeight - ph - 8));
  el.style.left = x + 'px'; el.style.top = y + 'px';
}
function wikiAcMove(delta) {
  if (!wikiAc || !wikiAc.items.length) return;
  var n = wikiAc.items.length;
  wikiAc.active = (wikiAc.active + delta + n) % n;
  var rows = wikiAc.el.querySelectorAll('.wiki-ac-item');
  rows.forEach(function (row, i) { row.classList.toggle('on', i === wikiAc.active); row.setAttribute('aria-selected', i === wikiAc.active ? 'true' : 'false') });
  if (rows[wikiAc.active] && rows[wikiAc.active].scrollIntoView) rows[wikiAc.active].scrollIntoView({ block: 'nearest' });
}
/* 选中插入：[[query 窗口整体替换为 [[id]]（闭合），光标落闭合括号后（红线）；走既有 input 链路等价动作（triggerSave 900ms 口径不动） */
function wikiAcApply(n) {
  if (!wikiAc || !n) return;
  var ta = $('edSrc'), start = wikiAc.start;
  wikiAcClose();
  if (!ta) return;
  var caret = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
  var ins = '[[' + n.id + ']]';
  var next = ta.value.slice(0, start) + ins + ta.value.slice(caret);
  ta.value = next;
  if (edNote) edNote.body = next;
  triggerSave(); scheduleDegAnalyze();
  var pos = start + ins.length;
  try { ta.focus(); ta.setSelectionRange(pos, pos); } catch (e) {}
}
/* 下拉键盘流（textarea keydown 挂点；关时首行即 return 零介入）。开时 ↑↓ 导航 / Enter·Tab 选中 / Esc 零副作用关闭 */
function wikiAcKeydown(ev) {
  if (!wikiAc) return;
  if (ev.isComposing) return;   /* IME 组合中：Enter/方向键归输入法候选窗 */
  if (ev.key === 'ArrowDown') { ev.preventDefault(); ev.stopPropagation(); wikiAcMove(1); return }
  if (ev.key === 'ArrowUp') { ev.preventDefault(); ev.stopPropagation(); wikiAcMove(-1); return }
  if (ev.key === 'Enter' || ev.key === 'Tab') {
    if (wikiAc.items.length) { ev.preventDefault(); ev.stopPropagation(); wikiAcApply(wikiAc.items[wikiAc.active]); }
    else wikiAcClose();   /* 零命中空态行不可选：不拦默认（Enter 换行/Tab 移焦），仅关下拉 */
    return;
  }
  if (ev.key === 'Escape') {
    /* Esc 零副作用：关下拉即止——stopPropagation 防冒泡到 document Esc 分层栈（误清搜索/误关弹层） */
    ev.preventDefault(); ev.stopPropagation(); wikiAcClose(); return;
  }
}
/* renderEd 重建 DOM 后重挂（bindEditorArea 调用点）；元素级监听随重建不累积 */
function bindWikiAc(ta) {
  ta.addEventListener('input', wikiAcRefresh);
  ta.addEventListener('keydown', wikiAcKeydown);
  ta.addEventListener('blur', wikiAcClose);
  ta.addEventListener('scroll', function () { if (wikiAc) wikiAcPosition(ta) });   /* 滚动跟随重定位（mirror-div 同 scrollTop 口径） */
  /* 光标被方向键/鼠标挪动时不发 input：开态下重估触发窗（失配即关/重定位）；关态绝不自开（触发只认输入） */
  ta.addEventListener('keyup', function (ev) { if (wikiAc && (ev.key.indexOf('Arrow') === 0 || ev.key === 'Home' || ev.key === 'End' || ev.key === 'PageUp' || ev.key === 'PageDown')) wikiAcRefresh() });
  ta.addEventListener('click', function () { if (wikiAc) wikiAcRefresh() });
}
