.pragma library

// REST API 封装：基于 QML 内置 XMLHttpRequest，统一携带 token、统一错误处理
// 注意：env(Main.qml onCompleted 注入)晚于页面 onCompleted 触发是常态，
// 页面早期请求必须能独立工作 —— 所以 baseUrl 在 env 缺失/为空时回退默认服务器。
var _env = null;
var DEFAULT_BASE = "http://47.91.25.15:8899";

function install(env) { _env = env; }

function getToken() { return _env && _env.token ? _env.token() : ''; }
function baseUrl() {
    var u = _env && _env.baseUrl ? _env.baseUrl() : '';
    return (u && u.length > 0) ? u : DEFAULT_BASE;
}

// ---------- 超时看门狗 ----------
// QML 的 XMLHttpRequest 只实现 W3C Level 1，不支持 timeout/ontimeout；
// 连不上服务器/丢包时可能无限挂起（onerror 不触发）。
// 由 Main.qml 注入一个 QML Timer 定期清扫：超时未完成的请求 abort 并以超时错误 reject。
var _watchdog = null;      // QML Timer（Main.qml 注入）
var _timeoutMs = 12000;
var _pending = {};         // id -> { xhr, start }
var _seq = 0;

function installWatchdog(timer) {
    _watchdog = timer;
    if (_watchdog) {
        _watchdog.interval = 500;
        _watchdog.repeat = true;
        _watchdog.triggered.connect(watchdogTick);
        _watchdog.running = false;
    }
}
function _track(xhr, timeoutMs) {
    if (!_watchdog) return 0;
    var id = ++_seq;
    _pending[id] = { xhr: xhr, start: Date.now(), timeoutMs: timeoutMs || _timeoutMs };
    _watchdog.running = true; // 有待完成的请求时保持看门狗运转
    return id;
}
function _untrack(id) {
    if (id && _pending[id]) delete _pending[id];
    if (_watchdog && !Object.keys(_pending).length) _watchdog.running = false;
}
function watchdogTick() {
    var now = Date.now(), toAbort = [];
    for (var k in _pending) {
        var p = _pending[k];
        if (now - p.start > _timeoutMs) toAbort.push(p);
    }
    toAbort.forEach(function (p) {
        // 先标记超时（settled=true），再 abort —— abort 会同步触发 readystatechange(status 0)，
        // 若反过来会被通用网络错误分支抢先，超时文案就丢了
        if (p._onTimeout) p._onTimeout();
        try { p.xhr.abort(); } catch (e) {}
    });
}

// request(path, {method, body, timeoutMs}) -> Promise(data)；失败 reject({code, msg, status})
// timeoutMs：单请求超时覆盖（默认 12s），文件上传等慢请求应传更大值。
// 注意：不支持 multipart 表单 —— QML 无 FormData，带文件的请求走 upload()（C++ 实现）
function request(path, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        var method = opts.method || (opts.body !== undefined ? 'POST' : 'GET');
        xhr.open(method, baseUrl() + path);
        if (getToken()) xhr.setRequestHeader('Authorization', 'Bearer ' + getToken());

        var body = null;
        if (opts.body !== undefined) {
            xhr.setRequestHeader('Content-Type', 'application/json');
            body = JSON.stringify(opts.body);
        }

        var settled = false;
        var wid = _track(xhr, opts.timeoutMs);
        function once(fn) {
            return function (v) {
                if (settled) return;
                settled = true;
                _untrack(wid);
                fn(v);
            };
        }
        if (wid) {
            var p = _pending[wid];
            p._onTimeout = once(function () {
                reject({ code: 'NETWORK', msg: '连接服务器超时，请检查网络或服务器地址', status: 0 });
            });
        }

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== XMLHttpRequest.DONE) return;
            var j = null;
            try { j = JSON.parse(xhr.responseText); } catch (e) {}
            if (xhr.status === 401) {
                console.log("[auth] 401 from " + path + " -> onUnauthorized")
                if (_env) _env.onUnauthorized(path);
            }
            if (xhr.status >= 200 && xhr.status < 300 && j && j.ok) {
                once(function (d) { resolve(d) })(j.data);
            } else {
                once(function () {
                    reject({
                        code: (j && j.error && j.error.code) || 'NETWORK',
                        msg: (j && j.error && j.error.msg) || '网络异常，请稍后重试',
                        status: xhr.status
                    });
                })();
            }
        };
        xhr.onerror = once(function () {
            reject({ code: 'NETWORK', msg: '网络异常，请检查网络或服务器地址', status: 0 });
        });
        xhr.send(body);
    });
}

// 便捷方法
function get(path) { return request(path); }
function post(path, body) { return request(path, { method: 'POST', body: body }); }
function put(path, body) { return request(path, { method: 'PUT', body: body }); }
function del(path) { return request(path, { method: 'DELETE' }); }

// ---------- 文件上传（multipart） ----------
// QML 的 XMLHttpRequest 没有 FormData，带文件的请求由 C++ Session.uploadFile 发送，
// 结果经 Session.uploadFinished 信号回到这里（Main.qml 启动时把信号接到 onUploadFinished）。
var _uploads = {}; // key -> { resolve, reject }

function onUploadFinished(key, ok, status, text) {
    var p = _uploads[key];
    if (!p) return;
    delete _uploads[key];
    var j = null;
    try { j = JSON.parse(text); } catch (e) {}
    if (ok && j && j.ok) { p.resolve(j.data); return }
    p.reject({
        code: (j && j.error && j.error.code) || (ok ? 'BAD_RESPONSE' : 'NETWORK'),
        msg: (j && j.error && j.error.msg) || (ok ? '响应格式异常，请稍后重试' : (status ? '上传失败（HTTP ' + status + '）' : '网络异常，请检查网络或服务器地址')),
        status: status
    });
}

// upload(path, fileUrl, timeoutMs, extraFields) -> Promise(data)
// fileUrl 为 file:/// 本地文件；extraFields 为随文件提交的文本字段（如批量发书的 titles/location）
function upload(path, fileUrl, timeoutMs, extraFields) {
    return new Promise(function (resolve, reject) {
        if (!_env || !_env.upload) { reject({ code: 'INTERNAL', msg: '上传组件未就绪', status: 0 }); return }
        var key = _env.upload(path, fileUrl, timeoutMs || 60000, extraFields || {});
        _uploads[key] = { resolve: resolve, reject: reject };
    });
}
