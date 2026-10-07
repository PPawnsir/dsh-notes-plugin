// 节 100. 0.4.6-I check.js 节注册自动发现（notes-046-check-autodiscovery：消批次共享锁）
// 常驻看守 check/discover.cjs：排序契约边界（数值元组）+ 注册契约（形状 + 文件名首段≡title 首号）+
// 行为级「新增节文件零改动 check.js 即被注册」（临时探针建删闭环）+ 反硬编码锚（check.js 不得回退逐节 require 清单）。
// 本节自身即机制实证：落地时零改动 check.js 被自动发现注册（一次性对照脚本已断言自动发现序列 ≡ 原硬编码 114 节清单，验证后移除）。
module.exports = {
  id: "100",
  title: "100. 0.4.6-I check.js 节注册自动发现（排序契约 + 注册契约 + 临时节零改动注册 + 反硬编码锚，notes-046-check-autodiscovery）",
  async run(H, S) {
  const { t, section, assert, fsNative, path, DIR } = H
  section('100. 0.4.6-I check.js 节注册自动发现（排序契约 + 注册契约 + 临时节零改动注册 + 反硬编码锚，notes-046-check-autodiscovery）')
  const DISCOVER = require('../discover.cjs')
  const SEC_DIR = path.join(DIR, 'check', 'sections')

  await t('排序契约边界：数值元组序（1-2 ≺ 1-10 ≺ 2）+ 前缀短者在前（[35]≺[35,5]）+ 等值/无数字字典序兜底', () => {
    const cmp = DISCOVER.compareSectionNames
    // 数值序而非字典序（字典序会得 1-10 ≺ 1-2 的错序）
    assert(cmp('1-2-a.cjs', '1-10-b.cjs') < 0 && cmp('1-10-b.cjs', '2-c.cjs') < 0 && cmp('1-2-a.cjs', '2-c.cjs') < 0, '数值元组逐段比较：1-2 ≺ 1-10 ≺ 2')
    // 互为他方前缀短者在前：35-splitter ≺ 35-5-img-path-hint（35 序号撞车历史次序消化点，零容忍漂移红线）
    assert(cmp('35-splitter.cjs', '35-5-img-path-hint.cjs') < 0, '[35] ≺ [35,5] 前缀短者在前')
    assert(cmp('8-archive-smoke.cjs', '8-5-archive-matrix.cjs') < 0 && cmp('8-5-archive-matrix.cjs', '9-startup-perf.cjs') < 0, '8 ≺ 8-5 ≺ 9')
    assert(cmp('1-8-new-note-modal.cjs', '2-host-mock.cjs') < 0, '[1,8] ≺ [2] 跨段比较')
    // 等值元组字典序兜底 + 无数字前缀兜底 + 自反为零
    assert(cmp('1-5-aaa.cjs', '1-5-bbb.cjs') < 0, '等值元组按文件名全串字典序兜底')
    assert(cmp('abc.cjs', 'abd.cjs') < 0 && cmp('1-static.cjs', '1-static.cjs') === 0, '无数字前缀字典序兜底 + 自反为零')
  })

  await t('注册契约：全部节导出 {id,title,run} 且文件名首段数字 ≡ title 首号（防错号/漂移）', () => {
    const files = DISCOVER.listSectionFiles(SEC_DIR)
    assert(files.length > 100, '节文件数 >100（实得 ' + files.length + '）')
    for (const f of files) {
      const mod = require(path.join(SEC_DIR, f))
      assert(typeof mod.id === 'string' && typeof mod.title === 'string' && typeof mod.run === 'function', f + ' 导出形状须为 {id,title,run}')
      assert.strictEqual(DISCOVER.numTuple(f)[0], parseInt(mod.title, 10), f + ' 文件名首段须等于 title 首号（实得 title="' + mod.title + '"）')
    }
  })

  await t('行为级：新增临时节文件零改动 check.js 即被自动发现注册（探针建删全闭环）', () => {
    const probe = path.join(SEC_DIR, '0-autodiscovery-probe.cjs')
    const junk = path.join(SEC_DIR, '0-autodiscovery-probe.txt')
    assert(!fsNative.existsSync(probe) && !fsNative.existsSync(junk), '探针文件不应预存')
    try {
      fsNative.writeFileSync(probe, 'module.exports = { id: "0-probe", title: "0. 自动发现探针", async run() {} }\n')
      fsNative.writeFileSync(junk, 'not a section\n')
      const files = DISCOVER.listSectionFiles(SEC_DIR)
      assert.strictEqual(files[0], '0-autodiscovery-probe.cjs', '探针（0 前缀）重新扫盘后应排首位——零改动 check.js 即被注册')
      assert(files.indexOf('0-autodiscovery-probe.txt') < 0, '非 .cjs 文件被过滤')
      const mods = DISCOVER.discoverSections(SEC_DIR)
      assert.strictEqual(mods[0].id, '0-probe', '探针模块被加载且位于执行序列首位')
      assert.strictEqual(typeof mods[0].run, 'function', '探针模块形状合法')
    } finally {
      if (fsNative.existsSync(probe)) fsNative.unlinkSync(probe)
      if (fsNative.existsSync(junk)) fsNative.unlinkSync(junk)
    }
    assert(DISCOVER.listSectionFiles(SEC_DIR).indexOf('0-autodiscovery-probe.cjs') < 0, '删除后重新发现即消失（无残留注册）')
  })

  await t('反硬编码锚：check.js 节注册走 discover.cjs 自动发现，无逐节 require 硬编码清单回退', () => {
    const checkSrc = fsNative.readFileSync(path.join(DIR, 'check.js'), 'utf8')
    assert(checkSrc.indexOf('discover.cjs') >= 0, 'check.js 节注册须经 check/discover.cjs 自动发现')
    assert(checkSrc.indexOf("require('./check/sections/") < 0, 'check.js 不得再出现逐节 require 硬编码清单（批次共享锁回退）')
  })
  }
}
