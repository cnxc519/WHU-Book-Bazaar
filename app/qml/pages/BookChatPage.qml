import QtQuick
import LeLeBook 1.0
import QtQuick.Controls
import QtPositioning
import ".." as Root
import "../js/util.js" as Util
import "../js/api.js" as Api
import "../js/ui.js" as Ui
import "../components"

// 书市私聊：买家 <-> 卖家。聊价格、验书与交易地点；会话长期保留
Item {
    id: page
    property var app: null
    property int chatId: 0
    property var messages: []
    property var meta: null // { book, other, role, unread }（来自会话列表）
    property var _unsubChat: null // Realtime 订阅注销函数，页面销毁时调用防泄漏

    // 不透底：推入详情栈后浮在 Tab 页之上，根必须有不透明背景，否则下层页面内容会透出来
    Rectangle {
        anchors.fill: parent
        color: Root.Theme.bg
    }

    Column {
        anchors.fill: parent

        AppHeader {
            showBack: true
            title: page.meta && page.meta.other ? page.meta.other.nickname : "书市聊天"
            onBackClicked: app.popPage()
        }

        // 书信息条（点按回到该书详情）
        Rectangle {
            id: bookBar
            width: parent.width
            visible: page.meta && page.meta.book
            height: visible ? 46 : 0
            color: Root.Theme.primarySoft
            // Row 内的 MouseArea 不能 anchors.fill（Row 禁止子项这类锚定，会静默失效），
            // 外包一层 Item 承载整条点击区域
            // Row 内子项禁止 left/right/fill/centerIn 等横向锚定（一旦出现，Row 整体
            // 放弃布局，所有子项叠回原点 —— 之前价格叠在书名上就是这个原因）。
            // 改为纯流式：书名宽度 = 剩余空间，价格与「书详情›」自然排到其右
            Row {
                anchors.fill: parent
                anchors.margins: 10
                spacing: 8
                Rectangle {
                    id: barCover
                    width: 26; height: 32
                    radius: 5
                    // meta 来自异步的会话列表请求，加载完成前是 null —— 每处访问都必须先判空，
                    // 否则绑定求值时 TypeError，书信息条渲染中断
                    color: page.meta && page.meta.book && page.meta.book.photo ? "transparent" : "#FFFFFF"
                    clip: true
                    Image {
                        anchors.fill: parent
                        visible: page.meta && page.meta.book && page.meta.book.photo
                        source: page.meta && page.meta.book && page.meta.book.photo ? Session.baseUrl + "/files/books/" + page.meta.book.id + ".jpg" : ""
                        fillMode: Image.PreserveAspectCrop
                    }
                    Text { anchors.centerIn: parent; visible: !(page.meta && page.meta.book && page.meta.book.photo); text: "📖"; font.pixelSize: 13 }
                }
                Text {
                    id: barTitle
                    width: parent.width - barCover.width - 24 - barPrice.width - barMore.implicitWidth
                    anchors.verticalCenter: parent.verticalCenter
                    text: page.meta && page.meta.book ? "《" + page.meta.book.title + "》" : ""
                    font.pixelSize: 12
                    color: Root.Theme.text
                    elide: Text.ElideRight
                    font.weight: Font.Medium
                }
                Text {
                    id: barPrice
                    anchors.verticalCenter: parent.verticalCenter
                    // 文字价格可能较长：限宽省略，标题宽度按实际占用计算，不会挤出信息条
                    width: Math.min(implicitWidth + 2, parent.width * 0.4)
                    elide: Text.ElideRight
                    text: page.meta && page.meta.book ? (page.meta.book.price_cents > 0 ? Util.yuan(page.meta.book.price_cents) : (page.meta.book.price_note || "价格面议")) : ""
                    font.pixelSize: 14
                    font.weight: Font.Bold
                    color: Root.Theme.primary
                }
                Text {
                    id: barMore
                    anchors.verticalCenter: parent.verticalCenter
                    text: "书详情 ›"
                    font.pixelSize: 11
                    color: Root.Theme.primaryDark
                }
            }
            // 整条点击区域：作为 Row 的兄弟（而不是子项）就可以合法 anchors.fill
            MouseArea {
                anchors.fill: parent
                onClicked: if (page.meta && page.meta.book) app.pushPage("BookDetailPage.qml", { bookId: page.meta.book.id })
            }
        }

        // 消息列表
        Item {
            width: parent.width
            height: parent.height - 52 - (bookBar.visible ? bookBar.height : 0) - 56
            clip: true

            ListView {
                id: listView
                anchors.fill: parent
                spacing: 8
                topMargin: 10
                leftMargin: 12
                rightMargin: 12
                boundsBehavior: Flickable.StopAtBounds
                model: page.messages

                // 用户上翻查看历史时暂停粘底，拖动结束若仍在底部则恢复
                property bool stick: true
                onDragEnded: stick = atYEnd
                onCountChanged: page.scrollToEnd()
                onContentHeightChanged: page.scrollToEnd()

                // 注意：不能用 Loader+Component 按 modelData 选模板 —— Component 实例化后
                // 拿不到 delegate 作用域的 modelData（ReferenceError，气泡全部渲染成空壳）。
                // 单 delegate 内放两套布局，按消息类型切 visible（Positioner 会跳过隐藏项）
                delegate: Column {
                    width: listView.width - 24
                    spacing: 2

                    // 系统消息（sender_id=0）：居中灰字
                    Text {
                        visible: modelData.type === "system" || modelData.sender_id === 0
                        width: parent.width
                        horizontalAlignment: Text.AlignHCenter
                        text: modelData.type === "location" ? "📍 对方分享了一个位置" : modelData.text
                        color: Root.Theme.textLight
                        font.pixelSize: 11
                        wrapMode: Text.Wrap
                        lineHeight: 1.4
                    }

                    // 普通消息气泡：我的靠右（绿色），对方的靠左（白色）
                    Row {
                        id: bubbleRow
                        visible: !(modelData.type === "system" || modelData.sender_id === 0)
                        width: parent.width
                        layoutDirection: modelData.sender_id === Session.myId ? Qt.RightToLeft : Qt.LeftToRight
                        spacing: 8

                        Rectangle {
                            // 位置消息的坐标行比正文宽：气泡按两者较宽者取值，
                            // 否则自己(右侧)的气泡贴屏幕边时打开地图链接会被裁出屏幕外
                            width: modelData.type === "location"
                                   ? Math.max(bubbleText.implicitWidth + 24, locFlow.implicitWidth + 16)
                                   : Math.min(bubbleText.implicitWidth + 24, bubbleRow.width - 60)
                            height: bubbleCol.implicitHeight + 16
                            radius: 12
                            color: modelData.sender_id === Session.myId ? Root.Theme.primary : "#FFFFFF"
                            border.color: Root.Theme.line
                            border.width: modelData.sender_id === Session.myId ? 0 : 1
                            Column {
                                id: bubbleCol
                                anchors.fill: parent
                                anchors.margins: 8
                                spacing: 4
                                Text {
                                    id: bubbleText
                                    width: parent.width
                                    text: modelData.type === "location" ? ("📍 " + (modelData.text || "位置")) : modelData.text
                                    color: modelData.sender_id === Session.myId ? "#FFFFFF" : Root.Theme.text
                                    font.pixelSize: 14
                                    wrapMode: Text.Wrap
                                }
                                // 注意：Flow 内子项禁止 anchors（Qt6 会报
                                // "Cannot specify anchors for items inside Flow. Flow will not function."
                                // 整个 Flow 直接不布局，"打开地图"蓝字因此消失）
                                Flow {
                                    id: locFlow
                                    width: parent.width
                                    visible: modelData.type === "location"
                                    spacing: 6
                                    Text {
                                        text: "交易碰头点 ·"
                                        color: modelData.sender_id === Session.myId ? Qt.rgba(1,1,1,0.85) : Root.Theme.textSub
                                        font.pixelSize: 11
                                    }
                                    Text {
                                        text: "打开地图"
                                        color: modelData.sender_id === Session.myId ? "#FFFFFF" : Root.Theme.blue
                                        font.pixelSize: 12
                                        font.underline: true
                                        MouseArea {
                                            anchors.fill: parent
                                            onClicked: {
                                                var url = "https://uri.amap.com/marker?position=" + modelData.lon + "," + modelData.lat + "&name=交易点"
                                                Qt.openUrlExternally(url)
                                            }
                                        }
                                    }
                                }
                                Text {
                                    text: Util.tsHHMM(modelData.created_at)
                                    color: modelData.sender_id === Session.myId ? Qt.rgba(1,1,1,0.7) : Root.Theme.textLight
                                    font.pixelSize: 10
                                }
                            }
                        }
                    }
                }
            }

            EmptyState {
                anchors.centerIn: parent
                visible: page.messages.length === 0
                text: "打个招呼吧"
                subText: "可以聊聊价格、书的新旧和见面交易地点"
            }
        }

        // 输入区
        Rectangle {
            width: parent.width
            height: 56
            color: "#FFFFFF"
            border.color: Root.Theme.line
            border.width: 1
            Row {
                anchors.fill: parent
                anchors.margins: 8
                spacing: 8
                // 发送位置（面交碰头点）
                Rectangle {
                    width: 42; height: 42
                    radius: 21
                    color: Root.Theme.primarySoft
                    Text { anchors.centerIn: parent; text: "📍"; font.pixelSize: 18 }
                    MouseArea {
                        anchors.fill: parent
                        onClicked: locationSheet.visible = true
                    }
                }
                TextField {
                    id: msgInput
                    width: parent.width - 42 - 56 - 24
                    height: 42
                    anchors.verticalCenter: parent.verticalCenter
                    padding: 12
                    font.pixelSize: 14
                    placeholderText: "输入消息..."
                    placeholderTextColor: Root.Theme.textLight
                    color: Root.Theme.text
                    background: Rectangle { radius: 21; color: "#F5F6F8" }
                    // 部分安卓 ROM 首次聚焦的弹键盘请求会被窗口 resize 吞掉，显式拉起兜底
                    onActiveFocusChanged: if (activeFocus) Qt.inputMethod.show()
                    Keys.onReturnPressed: page.send()
                }
                AppButton {
                    width: 56; heightPx: 42
                    anchors.verticalCenter: parent.verticalCenter
                    text: "发送"
                    onClicked: page.send()
                }
            }
        }
    }

    // 位置发送面板（自绘弹层：Qt Popup 在部分真机上 open() 无反应，弃用 Sheet）
    Rectangle {
        id: locationSheet
        anchors.fill: parent
        visible: false
        z: 300
        color: Qt.rgba(0, 0, 0, 0.35)
        MouseArea { anchors.fill: parent } // 拦截穿透点击
        Rectangle {
            anchors.centerIn: parent
            width: Math.min(340, parent.width - 48)
            height: locCol.implicitHeight + 44
            radius: 16
            color: "#FFFFFF"
            Column {
                id: locCol
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.top: parent.top
                anchors.margins: 20
                spacing: 12
                Text {
                    text: "发送位置"
                    font.pixelSize: 16
                    font.weight: Font.Medium
                    color: Root.Theme.text
                }
                AppButton {
                    width: parent.width
                    text: "发送我的当前位置"
                    onClicked: { locationSheet.visible = false; page.sendLocation() }
                }
                Text {
                    width: parent.width
                    text: "位置信息用于当面交易碰头，请描述准确。"
                    color: Root.Theme.textLight
                    font.pixelSize: 11
                }
            }
        }
    }

    // 定位（信号是 onPositionChanged —— 没有 onUpdate 信号，connect 会 TypeError 炸断 onCompleted）
    PositionSource {
        id: posSrc
        updateInterval: 1000
        active: false
        onPositionChanged: {
            if (!page.waitingPos) return
            var p = posSrc.position
            if (!p.latitudeValid) return
            // 首包常是网络缓存定位，误差可达数公里：精度不够就再等一两帧
            page.posTries++
            if (page.posTries < 3 && !Util.accuracyOk(p.horizontalAccuracy)) return
            page.waitingPos = false
            active = false
            posTimer.stop()
            Ui.loading(false)
            // 系统定位是 WGS-84，高德按 GCJ-02 解释，不转换会偏几百米到一公里
            var c = Util.wgs2gcj(p.coordinate.latitude, p.coordinate.longitude)
            Api.post("/api/book-chats/" + page.chatId + "/messages", {
                type: "location", text: "我的位置", lat: c.lat, lon: c.lon
            }).then(function () { page.load() }).catch(function (e) { Ui.toast(e.msg) })
        }
    }
    property bool waitingPos: false
    property int posTries: 0
    // 发位置：先申请定位权限（Android 6+ 动态权限），授权后再取位置
    property bool waitingPerm: false
    function sendLocation() {
        page.waitingPerm = true
        Permissions.requestLocation()
    }
    Connections {
        target: Permissions
        function onLocationResult(granted) {
            if (!page.waitingPerm) return
            page.waitingPerm = false
            if (granted) page.beginSendLocation()
            else Ui.toast("未获得定位权限，请在系统设置中允许定位后重试")
        }
    }
    function beginSendLocation() {
        Ui.loading(true, "获取定位中...")
        page.waitingPos = true
        page.posTries = 0
        posSrc.active = true
        posSrc.update()
        posTimer.start()
    }
    Timer {
        id: posTimer
        interval: 10000 // 等精度的重试帧也算在内，给 GPS 冷启动留够时间
        repeat: false
        onTriggered: {
            if (page.waitingPos) {
                page.waitingPos = false
                posSrc.active = false
                Ui.loading(false)
                Ui.toast("定位超时，请稍后重试")
            }
        }
    }

    // 滚动到底部：delegates 异步实例化，须等布局完成后再滚，否则停在列表顶部
    function scrollToEnd() {
        if (!listView.stick) return
        Qt.callLater(function () { listView.positionViewAtEnd() })
    }

    function send() {
        var t = msgInput.text.trim()
        if (!t) return
        msgInput.text = ""
        listView.stick = true
        Api.post("/api/book-chats/" + page.chatId + "/messages", { type: "text", text: t }).then(function (d) {
            page.messages.push(d.m)
            page.messages = page.messages.slice()
            page.scrollToEnd()
            Api.post("/api/book-chats/" + page.chatId + "/read")
        }).catch(function (e) { Ui.toast(e.msg) })
    }

    function loadMeta() {
        Api.get("/api/book-chats").then(function (c) {
            var chat = null
            for (var i = 0; i < c.list.length; i++) if (c.list[i].id === page.chatId) chat = c.list[i]
            if (chat) page.meta = chat
        }).catch(function () {})
    }

    function load() {
        listView.stick = true // 打开会话总是定位到最新一条
        Api.get("/api/book-chats/" + page.chatId + "/messages").then(function (d) {
            page.messages = d.list
            page.scrollToEnd()
            Api.post("/api/book-chats/" + page.chatId + "/read")
        }).catch(function (e) { Ui.toast(e.msg) })
        loadMeta()
    }

    function refresh() { load() }

    Component.onCompleted: {
        load()
        // 记录注销函数：页面销毁时解除订阅，否则每推入一次就多一份 handler，
        // 同一条实时消息会被重复 push N 次
        page._unsubChat = Realtime.on("bchat", function (m) {
            if (m.chat_id === page.chatId) {
                page.messages.push(m.m)
                page.messages = page.messages.slice()
                page.scrollToEnd()
                Api.post("/api/book-chats/" + page.chatId + "/read")
            }
        })
    }

    Component.onDestruction: if (page._unsubChat) page._unsubChat()
}
