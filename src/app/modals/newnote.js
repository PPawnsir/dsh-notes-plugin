/* ================= 新建笔记 ================= */
$('btnNew').addEventListener('click', function () {
  var seedFolder = view.type === 'folder' ? view.id : '';
  var seedTopic = view.type === 'topic' ? view.id : '';
  var kind0 = filters.kinds.length === 1 ? filters.kinds[0] : 'note';
  /* 二期 kind 模板骨架：筛选中心类型组恰选 1 个时按该 kind 预填（note=空自由格式） */
  var payload = { title: '', body: KIND_TEMPLATES[kind0] || '', kind: kind0 };
  if (seedFolder) payload.folder = seedFolder;
  if (seedTopic) payload.topic = seedTopic;
  rpc('notes-create', payload).then(function (res) {
    if (res && res.error) { toast(res.error); return }
    toast(KIND_TEMPLATES[kind0] ? '已创建笔记（含' + KIND[kind0] + '模板骨架）' : '已创建笔记（主题/文件夹随当前视图）');
    loadNotes(true).then(function () { if (res && res.id) selectNote(res.id) });
  }).catch(function (e) { toast('创建失败：' + (e && e.message || e)) });
});

