#!/usr/bin/env node
/**
 * make-demo.cjs — README 交互演示 GIF 录制（素材：定稿原型 design/notes-ui-v2.html）
 *
 * 技术路线：puppeteer-core 驱动本机 Edge（零浏览器下载）以 file:// 加载原型，
 * page.evaluate 逐段驱动 8 个交互场景，page.screenshot 逐帧取 PNG，
 * pngjs 解码 + gifenc 量化合成 packages/dsh-notes-plugin/docs/demo.gif（<8MB、循环）。
 *
 * 复跑：npm i && node scripts/make-demo.cjs
 * 环境变量：
 *   EDGE_PATH=<path>   覆盖 Edge 可执行文件路径
 *   DEMO_OUT=<path>    自定义 GIF 输出路径
 *   DEMO_KEEP_FRAMES=0 不保留逐帧 PNG（默认保留到 %TEMP%\dsh-notes-demo-frames-* 便于抽查）
 *
 * 场景（与 design/notes-ui-v2.html 原生事件监听一一对应）：
 *   ①暗色全景 → ②点开笔记(n8) → ③正文划选→快速记录卡片→输入备注→「记录」→toast+新笔记打开
 *   → ④搜索 "todo" 过滤 → ⑤清空搜索 → ⑥拖拽 n9 入文件夹 f2（HTML5 DnD 合成 DragEvent）
 *   → ⑦右键文件夹 f1 菜单 → ⑧「+ 新建」直建空白笔记 → ⑨切换亮色收尾
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer-core');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..');
const PROTO = path.join(ROOT, 'design', 'notes-ui-v2.html');
const OUT = process.env.DEMO_OUT || path.join(ROOT, 'packages', 'dsh-notes-plugin', 'docs', 'demo.gif');
const VIEW = { width: 880, height: 700, deviceScaleFactor: 1 };
const COLORS = 128;
const MAX_BYTES = 8 * 1024 * 1024;

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const EDGE = EDGE_CANDIDATES.find((p) => { try { return fs.existsSync(p) } catch (e) { return false } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frames = [];   // { buf: Buffer(PNG), delay: ms }
const checks = [];   // { name, ok, info }

function check(name, ok, info) {
  checks.push({ name, ok: !!ok, info: info || '' });
  console.log(`  [${ok ? 'OK' : 'FAIL'}] ${name}${info ? ' — ' + info : ''}`);
}

async function main() {
  if (!fs.existsSync(PROTO)) throw new Error('原型不存在: ' + PROTO);
  if (!EDGE) throw new Error('未找到本机 Edge（可用 EDGE_PATH 指定）');
  console.log('[demo] Edge =', EDGE);
  console.log('[demo] 原型 =', PROTO);

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notes-demo-prof-')); // 全新 profile：localStorage 空 → 默认暗色
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-notes-demo-frames-'));
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    userDataDir: profile,
    args: ['--allow-file-access-from-files', '--force-device-scale-factor=1', '--mute-audio'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEW);
    page.on('pageerror', (e) => console.warn('  [pageerror]', e.message));

    const shot = async (delay) => {
      const buf = await page.screenshot({ type: 'png' });
      frames.push({ buf, delay });
    };
    const url = 'file:///' + PROTO.replace(/\\/g, '/');
    await page.goto(url, { waitUntil: 'load' });
    /* 隐藏原型专属装饰（app.html 无此二元素）：Shell 入口演示条、顶栏「交互原型 · 内存 mock 数据」标注；hintbar 属正装 UI 保留 */
    await page.addStyleTag({ content: '.shell-demo{display:none!important} .topbar .tbtn:not(button){display:none!important}' });
    await page.waitForSelector('.note-row', { timeout: 8000 });
    await sleep(400);

    /* ① 暗色两栏全景 */
    console.log('[demo] ① 初始暗色全景');
    const rowCount0 = await page.$$eval('.note-row', (els) => els.length);
    check('初始列表渲染', rowCount0 >= 10, rowCount0 + ' 行');
    check('默认暗色主题', await page.evaluate(() => document.documentElement.dataset.theme === 'dark'));
    await shot(500); await shot(500);

    /* ② 点开笔记 n8（带派发记录的 todo）→ 编辑器加载 */
    console.log('[demo] ② 点开笔记');
    await page.click('[data-note="n8"]');
    await sleep(520); // mock rpc 30ms + notes-get 回填
    check('编辑器加载 n8', await page.evaluate(() => {
      const t = document.getElementById('edTitle');
      return t && t.textContent.indexOf('oabanner') >= 0;
    }));
    await shot(600); await shot(600);

    /* ③ 正文划选 → 快速记录卡片 → 备注 → 记录 → toast + 新笔记打开 */
    console.log('[demo] ③ 划选速记');
    await page.evaluate(() => {
      const el = document.getElementById('edBody');
      const t = el.firstChild;
      const full = t.textContent;
      let i = full.indexOf('检查 ingest.py'); if (i < 0) i = 0;
      const r = document.createRange();
      r.setStart(t, i); r.setEnd(t, Math.min(i + 22, full.length));
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); // 原型监听挂在 document.mouseup
    });
    await sleep(220);
    check('快速记录卡片弹出', await page.evaluate(() => !!document.querySelector('.cap')));
    await shot(1100);
    for (const ch of '兼容性要点') { await page.keyboard.type(ch); await shot(130); } // capInput 已被 showCap 聚焦
    await shot(300);
    await page.click('#capSave');
    await sleep(460);
    check('记录 toast', await page.evaluate(() => {
      const t = document.getElementById('toast');
      return t && t.classList.contains('show') && t.textContent.indexOf('已记录') >= 0;
    }), await page.$eval('#toast', (e) => e.textContent.trim()).catch(() => ''));
    await shot(600);
    await sleep(500); // loadNotes → selectNote(新速记)
    await shot(600);

    /* ④ 搜索 "todo" → 本地即时 + 250ms 防抖全文并集过滤 */
    console.log('[demo] ④ 搜索过滤');
    await page.click('#q');
    for (const ch of 'todo') { await page.keyboard.type(ch); await shot(190); }
    await sleep(400); // 250ms 防抖 + mock rpc 30ms → 全文兜底并集回填
    await shot(850);
    const todoRows = await page.$$eval('.note-row', (els) => els.length);
    check('搜索 todo 过滤为 3 条', todoRows === 3, todoRows + ' 行');

    /* ⑤ 清空搜索 */
    console.log('[demo] ⑤ 清空搜索');
    await page.evaluate(() => {
      const q = document.getElementById('q');
      q.value = '';
      q.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(320);
    check('清空后恢复全量', (await page.$$eval('.note-row', (els) => els.length)) > todoRows);
    await shot(500);

    /* ⑥ 拖拽 n9 → 文件夹 f2（HTML5 DnD：合成 DragEvent，dragId 由原型 dragstart 闭包维护） */
    console.log('[demo] ⑥ 拖拽入夹');
    await page.evaluate(() => {
      const tree = document.getElementById('tree');
      const f = document.querySelector('[data-fold="f2"]');
      tree.scrollTop += f.getBoundingClientRect().top - tree.getBoundingClientRect().top - 56; // rect 相对差：让 f2 与未分类 n9 同框
    });
    await sleep(160);
    await shot(350);
    await page.evaluate(() => {
      const row = document.querySelector('[data-note="n9"]');
      row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: new DataTransfer() }));
    });
    await sleep(130);
    check('dragstart 拖拽态', await page.evaluate(() => !!document.querySelector('.note-row.drag')));
    await shot(450);
    await page.evaluate(() => {
      const f = document.querySelector('[data-fold="f2"]');
      f.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
    });
    await sleep(130);
    check('dragover 放置高亮', await page.evaluate(() => !!document.querySelector('[data-fold="f2"].drop')));
    await shot(850);
    await page.evaluate(() => {
      const row = document.querySelector('[data-note="n9"]');
      const f = document.querySelector('[data-fold="f2"]');
      f.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
      row.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    });
    await sleep(680); // notes-update + toast + 静默重拉
    check('n9 已移入 f2', await page.evaluate(() => {
      const n = (window._mockNotes || []).find((x) => x.id === 'n9');
      return n && n.folder === 'f2';
    }));
    await shot(1200);

    /* ⑦ 右键文件夹 f1 → 右键菜单（重命名/上移/下移/删除）→ Esc 关闭 */
    console.log('[demo] ⑦ 右键菜单');
    await page.evaluate(() => {
      document.getElementById('tree').scrollTop = 0;
      const f = document.querySelector('[data-fold="f1"]');
      const r = f.getBoundingClientRect();
      f.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 80, clientY: r.top + r.height / 2 }));
    });
    await sleep(180);
    check('右键菜单出现', await page.evaluate(() => !!document.querySelector('.ctxmenu')));
    await shot(1250);
    await page.keyboard.press('Escape');
    await sleep(160);
    check('Esc 关闭菜单', await page.evaluate(() => !document.querySelector('.ctxmenu')));
    await shot(250);

    /* ⑧ 「+ 新建」→ 直建空白笔记并选中（toast + 编辑器无标题态） */
    console.log('[demo] ⑧ 新建笔记');
    await page.click('#btnNew');
    await sleep(720); // create + loadNotes + selectNote + notes-get
    check('新建 toast + 空标题编辑器', await page.evaluate(() => {
      const toast = document.getElementById('toast');
      const t = document.getElementById('edTitle');
      return toast && toast.textContent.indexOf('已创建') >= 0 && t && !t.textContent.trim();
    }));
    await shot(700); await shot(600);

    /* ⑨ 切换主题 → 亮色全景收尾 */
    console.log('[demo] ⑨ 切换亮色');
    await page.click('#btnTheme');
    await sleep(220);
    check('切换为亮色主题', await page.evaluate(() => document.documentElement.dataset.theme === 'light'));
    await shot(900); await shot(900);

    /* 逐帧 PNG 落盘（抽查用） */
    if (process.env.DEMO_KEEP_FRAMES !== '0') {
      for (let i = 0; i < frames.length; i++) {
        fs.writeFileSync(path.join(framesDir, `frame-${String(i).padStart(2, '0')}-${frames[i].delay}ms.png`), frames[i].buf);
      }
      console.log('[demo] 逐帧 PNG：', framesDir);
    }

    /* gifenc 合成 */
    console.log('[demo] 合成 GIF（' + frames.length + ' 帧 / colors=' + COLORS + '）…');
    const gif = GIFEncoder();
    let totalMs = 0;
    for (const f of frames) {
      const png = PNG.sync.read(f.buf);
      const palette = quantize(png.data, COLORS); // 默认 rgb565 量化
      const index = applyPalette(png.data, palette);
      gif.writeFrame(index, png.width, png.height, { palette, delay: f.delay }); // repeat 默认 0 = 循环
      totalMs += f.delay;
    }
    gif.finish();
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, Buffer.from(gif.bytes()));

    const size = fs.statSync(OUT).size;
    console.log(`[demo] 输出 ${OUT}  ${(size / 1024 / 1024).toFixed(2)}MB  ${frames.length} 帧  时长 ~${(totalMs / 1000).toFixed(1)}s`);
    check('GIF < 8MB', size < MAX_BYTES, (size / 1024 / 1024).toFixed(2) + 'MB');
  } finally {
    await browser.close().catch(() => {});
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch (e) {}
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.error('[demo] 失败检查点：' + failed.map((c) => c.name).join('、'));
    process.exit(1);
  }
  console.log('[demo] 全部检查点通过 ✔');
}

main().catch((e) => { console.error('[demo] 录制失败：', e && e.stack || e); process.exit(1) });
