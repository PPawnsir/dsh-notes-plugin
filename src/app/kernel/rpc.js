/* ================= 数据层：/dsh-notes RPC（与 lib/client.js 同模式） ================= */
function rpc(method, args) {
  return fetch('/dsh-notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: method, args: args || {} })
  }).then(function (r) { return r.json() })
}

