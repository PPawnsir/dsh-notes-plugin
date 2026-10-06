// 搜索关键词 <mark> 高亮（搜索体验升级；与原型 notes-ui-v2.html 同源，check.js 断言一致）。
// 安全红线：先 esc 再包 <mark>——标题/查询词都先经 esc 转义，正则只对转义后文本起作用，插入的仅 <mark> 标签本身；
// 禁止直接 innerHTML 拼原文（本函数输出可安全进 innerHTML：原文中的脚本标签/img onerror 等已被转义为纯文本）。
// （置于内核块外：内核三端逐字节一致断言不覆盖本函数）
function hl(text, q) {
  var s = esc(text == null ? '' : text);
  var qs = esc(String(q == null ? '' : q).trim());
  if (!s || !qs) return s;
  var re = new RegExp('(' + qs.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  return s.replace(re, '<mark>$1</mark>');
}
function icon(id, sz) { return '<svg class="ic"' + (sz ? ' style="width:' + sz + 'px;height:' + sz + 'px"' : '') + '><use href="#' + id + '"/></svg>' }
function fname(id) { var f = folders.find(function (x) { return x.id === id }); return f ? f.name : '' }
/* ===== 文件夹嵌套 helper（notes-nested-folder-ui；与 host folder-tree-helpers 同口径的本页版）=====
   folderKids(pid)=直接子级（folders 已由 host 按 order 排序，filter 保序）；folderSubtree(id)=子树 id 集合（含自身，BFS cycle 防御）；
   folderPath(id)=面包屑路径（根→…→当前，悬空/cycle 截断）；rootFolders()=根级清单（无 parent 或 parent 悬空按根级，与 host folderDepth 同口径） */
function folderKids(pid) { return folders.filter(function (x) { return (x.parent || '') === pid }) }
function folderSubtree(id) { var out = {}; out[id] = true; var q = [id]; while (q.length) { var c = q.shift(); folders.forEach(function (f) { if ((f.parent || '') === c && !out[f.id]) { out[f.id] = true; q.push(f.id) } }) } return out }
/* 0.4.4-D hidden（notes-044-hidden-attr）：fid 是否落在 hidden 文件夹链上（自身或任一祖先 hidden=true；parent 链上溯，cycle 防御 visited 截断） */
function folderHidden(fid) { var seen = {}; var f = folders.find(function (x) { return x.id === fid }); while (f && !seen[f.id]) { seen[f.id] = true; if (f.hidden === true) return true; f = f.parent ? folders.find(function (x) { return x.id === f.parent }) : null } return false }
function folderPath(id) { var byId = {}; folders.forEach(function (f) { byId[f.id] = f }); var path = [], cur = id, seen = {}; while (cur && byId[cur] && !seen[cur]) { seen[cur] = true; path.unshift(byId[cur]); cur = byId[cur].parent || '' } return path }
function rootFolders() { var byId = {}; folders.forEach(function (f) { byId[f.id] = f }); return folders.filter(function (f) { return !(f.parent || '') || !byId[f.parent || ''] }) }
function shortSid(sid) { return sid ? String(sid).replace(/^session-/, '').slice(0, 8) : '' }
/* injectTo 勾选态归一比对（notes-034-injectto-norm）：存量长 id 经 shortSid 约到短 id 再比——勾选渲染/范围文字/取消勾选三处同口径
   （host 写入路径已归一兜底，本函数兜住存量长 id 数据在浮层打开时显示为已勾选；client kernel/format.js 与原型 notes-ui-v2.html 同口径） */
function scopeHas(arr, short) { for (var i = 0; i < (arr || []).length; i++) { if (shortSid(arr[i]) === short) return true } return false }
/* P3 派发闭环：单条派发完成判定（dispatchStatus==='done' 或存量 done===true 向后兼容） */
function isDispDone(d) { return !!(d && (d.dispatchStatus === 'done' || d.done === true)) }
/* R-5 时区统一（n-mut3u5xghl1u）：host 落盘时间戳（createdAt/updatedAt/派发 at）均为 UTC ISO，前端渲染一律转本地时区——
   与自动保存指示（new Date().toTimeString() 本地 HH:mm）同区，消除同屏 8 小时差；格式化收口本对函数，调用点不再裸切 ISO 串。
   fmtDT=本地 YYYY-MM-DD HH:mm（编辑器底栏创建/更新、派发记录、modal 日期段取 slice(0,10)）；fmtD=本地 MM-DD（树列表更新时间）；
   无效/非 ISO 值回退旧切片行为（防御，不抛错） */
function fmtDT(iso) { if (!iso) return ''; var d = new Date(iso); if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' '); function p(x) { return ('0' + x).slice(-2) } return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) }
function fmtD(iso) { if (!iso) return ''; var d = new Date(iso); if (isNaN(d.getTime())) return String(iso).slice(5, 10); function p(x) { return ('0' + x).slice(-2) } return p(d.getMonth() + 1) + '-' + p(d.getDate()) }
/* ===== 定时派发·调度 helper（notes-034-sched-ui；与 host schedule.js 同口径的纯函数前端镜像——表单与 front-matter 同一数据源两个视图，无第二份存储） ===== */
/* every 声明 → 毫秒：number 直给（毫秒）；字符串 '<n>m|<n>h|<n>d|<n>w'（分钟/小时/天/周）。非法 → null（同 host schedEveryMs） */
function schedEveryMs(every) {
  if (typeof every === 'number' && isFinite(every) && every > 0) return Math.floor(every);
  if (typeof every === 'string') {
    var m = every.trim().match(/^(\d+)([mhdw])$/);
    if (m) { var n = parseInt(m[1], 10); var unit = { m: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2]]; return n * unit }
  }
  return null;
}
/* 锚定时刻（notes-034-sched-time）：'HH:MM' → 当日分钟偏移 ms（本地墙钟）；非法 → null（同 host 闸门 ^([01]\d|2[0-3]):[0-5]\d$） */
function schedAnchorMs(anchor) {
  var m = typeof anchor === 'string' ? anchor.match(/^([01]\d|2[0-3]):([0-5]\d)$/) : null;
  return m ? (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 60000 : null;
}
/* 锚定时刻序列（同 host schedDueAt 锚定分支口径）：触发时刻钉死本地 HH:MM，不随创建/触发时刻漂移——
   首触（fired=false，base=createdAt）= base 之后第一个锚定时刻（weekly 限定 dow 星期几）；
   后续（fired=true，base=lastFiredAt）= base + 间隔 所在本地日的锚定时刻（weekly = 下一个 dow 锚定时刻）。
   dow=0-6（0=周日，Date.getDay 口径）；ivMs 需整天倍数。非法 → null */
function schedAnchorNextMs(anchor, dow, ivMs, baseMs, fired) {
  var off = schedAnchorMs(anchor);
  if (off === null || !isFinite(baseMs) || !baseMs) return null;
  var b = new Date(baseMs), day0 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  if (typeof dow === 'number') {
    /* weekly：自 base 当日起逐日找首个 getDay()===dow 且锚定时刻 > base 的候选（已触发 → 下周同 dow；首触 → 下一个 dow） */
    for (var i = 0; i < 14; i++) { var dm = day0 + i * 86400000; if (new Date(dm).getDay() === dow && dm + off > baseMs) return dm + off }
    return null;
  }
  if (typeof ivMs !== 'number' || !isFinite(ivMs) || ivMs % 86400000 !== 0) return null;
  if (fired) { var f = new Date(baseMs + ivMs); return new Date(f.getFullYear(), f.getMonth(), f.getDate()).getTime() + off }
  return (day0 + off > baseMs ? day0 : day0 + 86400000) + off;
}
/* 频率人话：仅一次 <时间> / 每天 / 每周 / 每 N 天（锚定时刻声明带时刻后缀：每天 09:00 / 每周一 09:00 / 每 3 天 09:00）；非整天间隔（front-matter 裸编辑旁路值）兜底 每 N 小时/分钟/ms
   i18n 覆盖卡D：文案走 t() 字典 common.sched*（跨表面复用——注入管理 + 详情计划块；client kernel/format.js 同口径镜像）；星期名经 common.dowNames 管道分隔取值（en 多字符名 charAt 不可取） */
function schedFreqLabel(s) {
  if (!s) return '';
  if (s.at) return t('common.schedOnce', { time: fmtDT(s.at) });
  var ms = schedEveryMs(s.every);
  if (ms === null) return t('common.schedInvalid');
  var tail = s.anchor ? ' ' + s.anchor : '';   /* 锚定时刻（notes-034-sched-time）：周期 + 本地时刻 */
  if (ms === 86400000) return t('common.schedDaily') + tail;
  if (ms === 604800000) return (typeof s.dow === 'number' ? t('common.schedWeeklyDow', { dow: t('common.dowNames').split('|')[s.dow] || '' }) : t('common.schedWeekly')) + tail;
  if (ms % 86400000 === 0) return t('common.schedNDays', { n: ms / 86400000 }) + tail;
  if (ms % 3600000 === 0) return t('common.schedNHours', { n: ms / 3600000 });
  if (ms % 60000 === 0) return t('common.schedNMinutes', { n: ms / 60000 });
  return t('common.schedNMs', { n: ms });
}
/* 下次触发毫秒（与 host schedDueAt 锚点同口径：轮询 = lastFiredAt || createdAt + 间隔；单次 = at 本身；
   锚定时刻声明（notes-034-sched-time）= 锚定序列下一时刻）；非法 → null */
function schedNextMs(n) {
  var s = n && n.schedule; if (!s) return null;
  if (s.at) { var t = Date.parse(s.at); return isFinite(t) ? t : null }
  var iv = schedEveryMs(s.every); if (iv === null) return null;
  var firedMs = (s.lastFiredAt && Date.parse(s.lastFiredAt)) || 0;
  var base = firedMs || Date.parse(n.createdAt || '') || 0;
  if (!isFinite(base) || !base) base = Date.now();
  if (s.anchor) return schedAnchorNextMs(s.anchor, typeof s.dow === 'number' ? s.dow : undefined, iv, base, !!firedMs);
  return base + iv;
}
/* ISO → datetime-local 输入值（本地时区 YYYY-MM-DDTHH:mm；非法/空 → ''） */
function isoToLocalInput(iso) {
  var d = new Date(iso || ''); if (isNaN(d.getTime())) return '';
  function p(x) { return ('0' + x).slice(-2) }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function isPinned(n) { return n && n.status === 'pinned' }
function toast(m, act) {
  var t = $('toast');
  t.innerHTML = esc(m) + (act && act.label ? ' <a id="toastAct">' + esc(act.label) + '</a>' : '');
  t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show') }, act && act.label ? 4200 : 2200);
  if (act && act.label) $('toastAct').onclick = function () { t.classList.remove('show'); act.fn() };
}
function loadFoldOpen() { try { var v = localStorage.getItem('dsh-notes-app-foldopen'); return v ? JSON.parse(v) : {} } catch (e) { return {} } }
function saveFoldOpen() { try { localStorage.setItem('dsh-notes-app-foldopen', JSON.stringify(foldOpen)) } catch (e) {} }
/* ==== i18n-mech BEGIN ====（notes-042-i18n-mech：字典 + t() + 语言态——机制卡，纯机制不改现有文案）
   字典 src/i18n/zh.js+en.js（@i18n/ 前缀经 manifest 纳入，先于本文件）；语言态 localStorage 'dsh-notes-lang'（'zh' 缺省）。
   t(key,vars)：{name} 插值（禁拼接）；回退链 = 当前语言字典 → zh 全量基准字典 → key 本身（红线：永不裸 key，仅 zh 也缺才兜底露 key）。
   setLang(l)：校验 + 持久化 + 全量 render（kernel/bootstrap.js 收敛的 render 入口；覆盖卡逐表面搬串后切换即时生效）。
   （置于内核块外：内核三端逐字节一致断言不覆盖本区块） */
var NOTES_LANG_KEY = 'dsh-notes-lang'
var NOTES_LANG = (function () { try { var v = localStorage.getItem(NOTES_LANG_KEY); return v === 'en' ? 'en' : 'zh' } catch (e) { return 'zh' } })()
function t(key, vars) {
  var dict = NOTES_LANG === 'en' ? I18N_EN : I18N_ZH
  var s = dict[key]
  if (s == null) s = I18N_ZH[key]
  if (s == null) return key
  if (vars) s = s.replace(/\{(\w+)\}/g, function (m, n) { return vars[n] != null ? String(vars[n]) : m })
  return s
}
function setLang(l) {
  if (l !== 'zh' && l !== 'en') return
  NOTES_LANG = l
  try { localStorage.setItem(NOTES_LANG_KEY, l) } catch (e) {}
  render()
}
/* ==== i18n-mech END ==== */

