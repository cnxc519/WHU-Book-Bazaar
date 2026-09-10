pragma Singleton
import QtQuick
import QtWebSockets
import LeLeBook 1.0

// 实时消息中心：WebSocket 长连接 + 自动重连 + 事件订阅分发
// 服务端事件类型: bchat(书市新消息) / notif(通知)
QtObject {
    id: root

    property var sock: null
    property bool connected: false
    property var handlers: []
    property int retryCount: 0

    // QtObject 无默认属性，Timer 需以带类型属性承载
    property Timer reconnectTimer: Timer {
        interval: 3000
        repeat: false
        onTriggered: root.doConnect()
    }

    function connect() {
        if (!Session.token) return;
        doConnect();
    }

    function doConnect() {
        if (sock) { try { sock.active = false; } catch (e) {} }
        var url = Session.baseUrl.replace(/^http/, 'ws') + '/ws?token=' + encodeURIComponent(Session.token);
        sock = Qt.createQmlObject('import QtWebSockets; WebSocket { active: false }', root, 'ws');
        sock.url = url;
        sock.active = true;
        // 动态创建对象的信号用 connect() 挂接：onXxx 赋值对动态对象会报 read-only TypeError
        sock.statusChanged.connect(function (status) {
            var opened = (status === WebSocket.Open);
            if (opened) {
                root.connected = true;
                root.retryCount = 0;
                root.handlers.forEach(function (h) { if (h.onConnect) { try { h.onConnect(); } catch (e) {} } });
            } else if (status === WebSocket.Error || status === WebSocket.Closed) {
                root.connected = false;
                if (Session.token) {
                    reconnectTimer.interval = Math.min(30000, 2000 * Math.pow(2, root.retryCount++));
                    reconnectTimer.start();
                }
            }
        });
        // Qt6 WebSocket 的文本消息信号是 textMessageReceived（旧名 messageReceived 已不存在）
        sock.textMessageReceived.connect(function (message) {
            var m = null;
            try { m = JSON.parse(message); } catch (e) { return; }
            root.handlers.forEach(function (h) {
                if (!h.type || h.type === m.t) { try { h.fn(m); } catch (e) {} }
            });
        });
    }

    function disconnect() {
        if (sock) { try { sock.active = false; } catch (e) {} }
        sock = null;
        connected = false;
        retryCount = 0;
        reconnectTimer.stop();
    }

    // 订阅事件：Realtime.on('chat', fn) / Realtime.on('', fn) 订阅全部
    // 返回注销函数：推入式页面（聊天页等）销毁时必须调用，否则 handler 残留 ——
    // 页面每推入一次就多注册一份，之后同一条实时消息会被重复处理 N 次
    function on(type, fn, onConnect) {
        var h = { type: type, fn: fn, onConnect: onConnect };
        handlers.push(h);
        return function () {
            var i = handlers.indexOf(h);
            if (i >= 0) handlers.splice(i, 1);
        };
    }
}
