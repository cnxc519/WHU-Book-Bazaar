.pragma library

// UI 桥：全局提示 / 确认弹窗 / 加载遮罩（由 Main.qml 注入实现）
var _impl = null;

function install(impl) { _impl = impl; }

function toast(msg) { if (_impl) _impl.toast(msg); }

// confirm({title, text, okText, cancelText, danger}) -> 回调 cb(ok)
function confirm(opts, cb) { if (_impl) _impl.confirm(opts, cb); }

// input({title, hint}) -> 回调 cb(文本；取消则空串)
function input(opts, cb) { if (_impl) _impl.input(opts, cb); }

function loading(show, text) { if (_impl) _impl.loading(show, text); }
