// onnxruntime-node 空桩（0.5.0 R1 notes-051-host-embedder）：npm overrides 整包替换位。
// transformers.js backends/onnx.js 在 globalThis[Symbol.for('onnxruntime')] 已注入时短路，永不 import 本包；
// 桩体仅在「槽位注入失效」的异常路径被触达——导出空对象，绝不加载任何 .node 原生 binding。
module.exports = {}
