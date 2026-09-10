// 纯函数工具集（无内部状态；注意：QML 脚本文件不支持跨文件 import，需要 api/ui 的请直接在页面里 import）
// ---------- 通用工具 ----------
function isEmail(s) { return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s || ''); }

function fen2yuan(fen) { return (fen / 100).toFixed(2); }
function yuan(fen) { return '¥' + fen2yuan(fen); }

// 输入框金额（元，如 "3.5"）-> 分（整数），非法返回 NaN
function yuanToCents(s) {
    if (s === null || s === undefined) return NaN;
    var n = parseFloat(String(s).trim());
    if (!isFinite(n) || n < 0) return NaN;
    return Math.round(n * 100);
}

// 性别
function genderCN(g) { return g === 'male' ? '男' : '女'; }
// 时间戳 -> HH:mm（北京时间）
function tsHHMM(ts) {
    if (!ts) return '';
    var d = new Date(ts + 8 * 3600 * 1000);
    return ('0' + d.getUTCHours()).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2);
}

// 时间戳 -> MM-DD HH:mm
function tsShort(ts) {
    if (!ts) return '';
    var d = new Date(ts + 8 * 3600 * 1000);
    return ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2) + ' ' + tsHHMM(ts);
}

// ---------- 服务端 ISO 时间（UTC 存储：users/books/orders 的 created_at、runs.completed_at） ----------
// 与 nowTs() 的 epoch 毫秒是两套格式：ISO 串直接喂 tsShort 会发生字符串拼接（V4 宽容解析
// 出的是未加 8 小时的 UTC），直接 slice 显示的也是 UTC —— 都会差 8 小时，必须先转毫秒。
function isoMs(iso) {
    var t = Date.parse(iso);
    return isNaN(t) ? 0 : t;
}
// MM-DD HH:mm（北京时间）
function isoShort(iso) { return iso ? tsShort(isoMs(iso)) : ''; }
// MM-DD
function isoDate(iso) { return iso ? tsShort(isoMs(iso)).slice(0, 5) : ''; }
// YYYY-MM-DD
function isoDateFull(iso) {
    if (!iso) return '';
    return new Date(isoMs(iso) + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 默认头像文字：昵称首字符（字母取大写）
function avatarText(nickname) {
    if (!nickname) return '乐';
    var ch = nickname.charAt(0);
    return /[a-zA-Z]/.test(ch) ? ch.toUpperCase() : ch;
}

// ---------- 坐标系转换：WGS-84（系统定位）→ GCJ-02（高德/火星坐标） ----------
// Android 定位给出的是 WGS-84 真坐标，而高德地图（含 uri.amap.com 链接）按 GCJ-02
// 解释坐标——不转换直接发，地图上会整体偏移几百米到一公里（"十万八千里"的主因）。
function _transformLat(x, y) {
    var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
    return ret;
}
function _transformLon(x, y) {
    var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
    return ret;
}
// 返回 {lat:..., lon:...}；中国境外原样返回（GCJ 只在国内有意义）
function wgs2gcj(lat, lon) {
    if (lon < 72.004 || lon > 137.8347 || lat < 0.8293 || lat > 55.8271) return { lat: lat, lon: lon };
    var a = 6378245.0, ee = 0.00669342162296594323;
    var dLat = _transformLat(lon - 105.0, lat - 35.0);
    var dLon = _transformLon(lon - 105.0, lat - 35.0);
    var radLat = lat / 180.0 * Math.PI;
    var magic = Math.sin(radLat);
    magic = 1 - ee * magic * magic;
    var sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * Math.PI);
    dLon = (dLon * 180.0) / (a / sqrtMagic * Math.cos(radLat) * Math.PI);
    return { lat: lat + dLat, lon: lon + dLon };
}
// 定位精度是否可接受：拿不到精度值时视为可接受（不同平台/后端表现不一，不要卡死用户）
function accuracyOk(acc) {
    return (acc === undefined || acc === null || isNaN(acc) || acc <= 150);
}
