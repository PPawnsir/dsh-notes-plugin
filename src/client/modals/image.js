    // ===== modal: image —— 图片插入弹窗（architecture-modular §6 步骤 D1，自 panels/whole.js 拆出）=====
    // provides: store.modal.image / imgModalRef / imgFileInputRef / setImgModal / openImgModal / pickImageFile / ImageModal
    //   （IMG_COMPRESS_THRESHOLD/compressImageData 仅服务 pickImageFile，随弹窗同域迁入；insertImageMd 是编辑器域，滞留 whole.js 经 panelBridge 中转）
    // needs: kernel/state.js（store/createStore/panelBridge）、kernel/icons.js（e/I）、kernel/format.js（fmtBytes）、kernel/bus.js（showToast）
    // state 托管：imgModal（null | { name, dataURL, mime, size, alt, uploading, error }）迁入 store.modal.image 切片（modal 字段）；
    // imgModalRef 为 Esc 栈/Ctrl+/ 守卫的同步镜像（模块级单例，与昔日 FloatingPanel 内 useRef 等价）
    store.modal.image = createStore({ modal: null })
    const imgModalRef = { current: null }
    const imgFileInputRef = { current: null }   // 图片弹窗隐藏 file input
    // setter 别名与昔日 useState setter 同形（值或 updater 函数均可）：同步写 ref 镜像 + store（订阅方 = ImageModal）
    function setImgModal(v) { const nv = typeof v === 'function' ? v(imgModalRef.current) : v; imgModalRef.current = nv; store.modal.image.set({ modal: nv }) }
    // ---- 二期 图片压缩：>1MB 的 PNG/JPEG 上传前前端 canvas 降质转 JPEG（GIF/WebP 不动，保动画/透明语义）----
    // 策略：长边封顶 2560px → 质量阶梯 0.85→0.45 逐档试；仍超 1MB 则长边 0.8 递减（下限 800px）；
    // PNG 透明底刷白（JPEG 无 alpha）；任何一步失败 → cb(null) 回退原图上传。压缩产物 <1MB 即收。
    const IMG_COMPRESS_THRESHOLD = 1024 * 1024
    function compressImageData(dataURL, cb) {
      try {
        const img = new Image()
        img.onload = () => {
          try {
            let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height
            if (!w || !h) { cb(null); return }
            const MAX_DIM = 2560
            if (Math.max(w, h) > MAX_DIM) { const r = MAX_DIM / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r) }
            const canvas = document.createElement('canvas')
            const c2d = canvas.getContext('2d')
            if (!c2d) { cb(null); return }
            const qs = [0.85, 0.75, 0.65, 0.55, 0.45]
            let out = '', bytes = 0, round = 0
            while (round < 8) {
              canvas.width = w; canvas.height = h
              c2d.fillStyle = '#ffffff'; c2d.fillRect(0, 0, w, h)
              c2d.drawImage(img, 0, 0, w, h)
              out = canvas.toDataURL('image/jpeg', qs[Math.min(round, qs.length - 1)])
              bytes = Math.max(0, Math.round((out.length - 23) * 3 / 4))   // 去掉 data:image/jpeg;base64, 头估算字节
              if (bytes <= IMG_COMPRESS_THRESHOLD) { cb({ dataURL: out, bytes: bytes }); return }
              round++
              if (round >= qs.length && (w > 800 || h > 800)) { w = Math.max(800, Math.round(w * 0.8)); h = Math.max(800, Math.round(h * 0.8)); round = qs.length - 1 }
            }
            cb(out ? { dataURL: out, bytes: bytes } : null)   // 兜底：尽力压缩产物（可能仍 >1MB，5MB 上限内可用）
          } catch (err) { cb(null) }
        }
        img.onerror = () => cb(null)
        img.src = dataURL
      } catch (err) { cb(null) }
    }
    // 图片文件校验 + 读 dataURL → 打开插入弹窗（mime 白名单 png/jpeg/gif/webp、≤5MB，与 host 口径一致）
    // 二期：>1MB 的 PNG/JPEG 先走 compressImageData 压缩转 JPEG 再进弹窗（弹窗大小行显示「已压缩 原 → 现」）
    function pickImageFile(f) {
      if (!f) return
      const MIME_OK = { 'image/png': 1, 'image/jpeg': 1, 'image/gif': 1, 'image/webp': 1 }
      if (!MIME_OK[f.type]) { showToast('仅支持 PNG/JPEG/GIF/WebP 图片'); return }
      if (f.size > 5 * 1024 * 1024) { showToast('图片超过 5MB 上限'); return }
      const rd = new FileReader()
      rd.onload = () => {
        const base = { name: f.name || ('pasted-' + Date.now() + '.png'), dataURL: String(rd.result), mime: f.type, size: f.size, alt: (f.name || '').replace(/\.[^.]+$/, ''), uploading: false, error: '' }
        if (f.size > IMG_COMPRESS_THRESHOLD && (f.type === 'image/png' || f.type === 'image/jpeg')) {
          compressImageData(base.dataURL, (res) => {
            if (res && res.dataURL) setImgModal(Object.assign({}, base, { name: base.name.replace(/\.[^.]+$/, '') + '.jpg', dataURL: res.dataURL, mime: 'image/jpeg', size: res.bytes, origSize: f.size }))
            else setImgModal(base)   // 压缩失败回退原图（不阻塞上传）
          })
        } else setImgModal(base)
      }
      rd.onerror = () => showToast('图片读取失败')
      rd.readAsDataURL(f)
    }
    // 图片入口③：工具栏按钮 → 弹窗选文件（draft=null 时打开空弹窗）
    function openImgModal(draft) { setImgModal(draft || { name: '', dataURL: '', mime: '', size: 0, alt: '', uploading: false, error: '' }) }
    // 图片插入弹窗宿主（v3 三入口共用：粘贴/拖拽/工具栏按钮）：选文件 → 预览 + alt → 上传 → 光标处插入
    function ImageModal() {
      const imgModal = store.modal.image.useSel(s => s.modal)
      // 上传并插入：notes-asset-upload RPC → assets/<ts>-<安全名>；成功 → 光标处插入 ![](assets/…)；失败留在弹窗内报错可重试 + toast
      // 插入动作是编辑器域能力（insertImageMd 滞留 whole.js），经 panelBridge 中转
      function doUploadImage() {
        const m = imgModalRef.current
        if (!m || !m.dataURL || m.uploading) return
        setImgModal(Object.assign({}, m, { uploading: true, error: '' }))
        host.call('notes-asset-upload', { name: m.name, data: m.dataURL, mime: m.mime }).then(res => {
          if (res && res.error) {
            showToast('图片上传失败：' + res.error)
            const cur = imgModalRef.current
            if (cur) setImgModal(Object.assign({}, cur, { uploading: false, error: res.error }))
            return
          }
          const file = res && res.file
          if (!file) {
            const cur2 = imgModalRef.current
            if (cur2) setImgModal(Object.assign({}, cur2, { uploading: false, error: '上传返回异常（缺 file 字段）' }))
            return
          }
          const alt = (m.alt || '').trim()
          setImgModal(null)
          panelBridge.insertImageMd(file, alt)
          showToast('已插入图片：' + file)
        }).catch(err => {
          showToast('图片上传失败：' + String(err.message || err))
          const cur = imgModalRef.current
          if (cur) setImgModal(Object.assign({}, cur, { uploading: false, error: String(err.message || err) }))
        })
      }
      return imgModal ? e('div', { className: 'dsh-notes-settings-mask', onMouseDown: (ev) => { if (ev.target === ev.currentTarget && !imgModal.uploading) setImgModal(null) } },
        e('div', { className: 'dsh-notes-settings-modal dsh-notes-data-modal' },
          e('div', { className: 'dsh-notes-settings-modal-t' }, I('image', 14), ' 插入图片', e('span', { className: 'dsh-notes-imgup-sub' }, '上传到笔记库 assets/（PNG/JPEG/GIF/WebP，≤5MB；>1MB 的 PNG/JPG 自动压缩转 JPEG）')),
          imgModal.dataURL
            ? e(React.Fragment, null,
                e('div', { className: 'dsh-notes-imgup-pv' },
                  e('img', { src: imgModal.dataURL, alt: '' }),
                  e('div', null,
                    e('div', { className: 'dsh-notes-imgup-nm' }, imgModal.name),
                    e('div', { className: 'dsh-notes-imgup-sz' }, (imgModal.origSize ? '已压缩 ' + fmtBytes(imgModal.origSize) + ' → ' : '') + (imgModal.size ? fmtBytes(imgModal.size) + ' · ' : '') + (imgModal.mime || '')))),
                e('input', { className: 'dsh-notes-data-input', placeholder: '替代文本 alt（可留空）', value: imgModal.alt, autoFocus: true, onChange: (ev) => setImgModal(Object.assign({}, imgModal, { alt: ev.target.value })), onKeyDown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doUploadImage() } } }))
            : e('div', { className: 'dsh-notes-imgup-zone', onClick: () => { if (imgFileInputRef.current) imgFileInputRef.current.click() } },
                '点击选择本地图片文件（也可直接把图片文件拖进编辑区，或 Ctrl+V 粘贴）',
                e('input', { ref: imgFileInputRef, type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', style: { display: 'none' }, onChange: (ev) => { const f = ev.target.files && ev.target.files[0]; if (f) pickImageFile(f); ev.target.value = '' } })),
          imgModal.uploading ? e('div', { className: 'dsh-notes-imgup-prog on' }, e('i', null)) : null,
          imgModal.error ? e('div', { className: 'dsh-notes-dispatch-err' }, imgModal.error) : null,
          e('div', { className: 'dsh-notes-dispatch-actions' },
            e('button', { className: 'dsh-notes-dispatch-cancel', onClick: () => setImgModal(null), disabled: imgModal.uploading }, '取消'),
            e('button', { className: 'dsh-notes-dispatch-ok', onClick: doUploadImage, disabled: !imgModal.dataURL || imgModal.uploading }, imgModal.uploading ? '上传中…' : '上传并插入'))))
      : null
    }
