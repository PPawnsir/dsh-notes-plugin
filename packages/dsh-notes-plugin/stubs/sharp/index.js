// sharp 空桩（0.5.0 R1 notes-051-host-embedder）：npm overrides 整包替换位。
// host embedder 只做文本嵌入（feature-extraction），transformers.js 的图像解码通道（RawImage→sharp）永不触达；
// 桩体保留可 import 的合法模块形态（防 transformers.node 静态 import 链炸模块加载），调用即抛错显性化。
module.exports = function sharpStub() { throw new Error('sharp 已被桩化（0.5.0 R1 host embedder：onnxruntime-web 纯 wasm 路线，原生 sharp 不进安装树）') }
