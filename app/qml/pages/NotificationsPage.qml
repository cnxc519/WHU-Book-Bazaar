import QtQuick
import LeLeBook 1.0
import ".." as Root
import "../js/util.js" as Util
import "../js/api.js" as Api
import "../js/ui.js" as Ui
import "../components"

// 消息通知（铃铛入口）：书市联系、邀请成功等通知
Item {
    id: page
    property var app: null
    property var list: []

    // 不透底：推入详情栈后浮在 Tab 页之上，根必须有不透明背景，否则下层页面内容会透出来
    Rectangle {
        anchors.fill: parent
        color: Root.Theme.bg
    }

    Column {
        anchors.fill: parent

        AppHeader {
            showBack: true
            title: "消息通知"
            onBackClicked: app.popPage()
        }

        Item {
            width: parent.width
            height: parent.height - 52
            ListView {
                id: listView
                anchors.fill: parent
                clip: true
                model: page.list
                spacing: 10
                topMargin: 10
                bottomMargin: 16
                leftMargin: 12
                rightMargin: 12

                delegate: AppCard {
                    width: listView.width - 24
                    height: col.implicitHeight + 24
                    Column {
                        id: col
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: 12
                        spacing: 8
                        property var outerN: modelData

                        Text {
                            width: parent.width
                            text: modelData.title
                            font.pixelSize: 14
                            font.weight: Font.Medium
                            color: Root.Theme.text
                            wrapMode: Text.Wrap
                        }
                        Text {
                            text: Util.tsShort(modelData.created_at)
                            font.pixelSize: 11
                            color: Root.Theme.textLight
                        }
                        Text {
                            width: parent.width
                            text: modelData.body
                            font.pixelSize: 12
                            color: Root.Theme.textSub
                            wrapMode: Text.Wrap
                            lineHeight: 1.45
                        }

                        // 操作区
                        Row {
                            width: parent.width
                            visible: page.actionsFor(modelData).length > 0
                            spacing: 8
                            Repeater {
                                model: page.actionsFor(modelData)
                                delegate: Rectangle {
                                    height: 32
                                    width: txt.implicitWidth + 20
                                    radius: 16
                                    color: modelData.kind === "danger" ? Root.Theme.dangerSoft : Root.Theme.primarySoft
                                    Text {
                                        id: txt
                                        anchors.centerIn: parent
                                        text: modelData.label
                                        font.pixelSize: 12
                                        color: modelData.kind === "danger" ? Root.Theme.danger : Root.Theme.primaryDark
                                    }
                                    MouseArea {
                                        anchors.fill: parent
                                        // 必须用 id 限定引用 col.outerN：裸写 outerN 在嵌套 Repeater
                                        // delegate 里无法解析（ReferenceError），点击会静默失效
                                        onClicked: page.doAction(modelData.action, col.outerN)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            EmptyState {
                anchors.centerIn: parent
                visible: page.list.length === 0
                text: "暂无消息"
            }
        }
    }

    function actionsFor(n) {
        if (n.type === "book_contact" || n.type === "book_msg") return [{ label: "去回复", action: "book_chat", kind: "primary" }]
        return []
    }

    function doAction(action, n) {
        if (action === "book_chat") {
            var d2 = n.data_json ? JSON.parse(n.data_json) : {}
            if (!d2.chat_id) { Ui.toast("会话不存在"); return }
            app.pushPage("BookChatPage.qml", { chatId: d2.chat_id })
            Api.post("/api/notifications/read", { id: n.id })
            load()
        }
    }

    function load() {
        Api.get("/api/notifications").then(function (d) {
            page.list = d.list
        }).catch(function (e) { Ui.toast(e.msg) })
    }

    property var _unsubNotif: null

    Component.onCompleted: {
        load()
        // 打开通知页即全部标为已读（红点清零），无需逐条点操作按钮
        Api.post("/api/notifications/read", {})
        // 页面停留时收到新通知即时刷新（登出/销毁必须注销，防止重复触发）
        page._unsubNotif = Realtime.on("notif", function () { page.load() })
    }

    Component.onDestruction: {
        if (page._unsubNotif) page._unsubNotif()
        // 进通知页会把全部通知标为已读：返回书市页时立刻刷新铃铛角标，不用等下次刷新
        if (app.refreshTab) app.refreshTab("book")
    }
}
