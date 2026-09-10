import QtQuick
import LeLeBook 1.0
import QtQuick.Controls
import ".." as Root
import "../js/util.js" as Util
import "../js/api.js" as Api
import "../js/ui.js" as Ui
import "../components"

// 书市消息：买家/卖家的会话列表（买书咨询与回复都在这里）
Item {
    id: page
    property var app: null
    property bool embedded: false // true=作为书市模式的「消息」Tab；false=从其他页推入
    property var _unsub: null // Realtime 订阅注销函数
    property var list: []

    Column {
        anchors.fill: parent

        AppHeader {
            showBack: !page.embedded
            title: "书市消息"
            gradientBg: page.embedded
            rightText: "🔄"
            onBackClicked: app.popPage()
            onRightClicked: page.load(true)
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
                bottomMargin: 32
                leftMargin: 12
                rightMargin: 12
                boundsBehavior: Flickable.DragAndOvershootBounds

                header: PullToRefresh {
                    id: pullRef
                    onRefresh: function () { page.load(true) }
                }

                delegate: AppCard {
                    width: listView.width - 24
                    height: col.implicitHeight + 22
                    tappable: true
                    onClicked: app.pushPage("BookChatPage.qml", { chatId: modelData.id })

                    Column {
                        id: col
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: 12
                        spacing: 7

                        Row {
                            width: parent.width
                            spacing: 6
                            // 书封面小图
                            Rectangle {
                                width: 34; height: 42
                                radius: 6
                                color: modelData.book && modelData.book.photo ? "transparent" : Root.Theme.primarySoft
                                clip: true
                                Image {
                                    anchors.fill: parent
                                    visible: modelData.book && modelData.book.photo
                                    source: modelData.book && modelData.book.photo ? Session.baseUrl + "/files/books/" + modelData.book.id + ".jpg" : ""
                                    fillMode: Image.PreserveAspectCrop
                                }
                                Text { anchors.centerIn: parent; visible: !(modelData.book && modelData.book.photo); text: "📖"; font.pixelSize: 16 }
                            }
                            Column {
                                width: parent.width - 40
                                spacing: 3
                                Text {
                                    width: parent.width
                                    text: "《" + (modelData.book ? modelData.book.title : "已删除的书") + "》"
                                    font.pixelSize: 14
                                    font.weight: Font.Bold
                                    color: Root.Theme.text
                                    elide: Text.ElideRight
                                }
                                Text {
                                    width: parent.width
                                    text: (modelData.role === "seller" ? "买家 " : "卖家 ") + (modelData.other ? modelData.other.nickname : "")
                                    font.pixelSize: 11
                                    color: Root.Theme.textSub
                                }
                            }
                            Item { width: 4 }
                            TagBadge {
                                visible: modelData.book && modelData.book.status !== "on"
                                text: modelData.book && modelData.book.status === "sold" ? "书已售出" : "书已下架"
                                fg: Root.Theme.textLight
                            }
                        }

                        Row {
                            width: parent.width
                            spacing: 8
                            Text {
                                // Row 内子项禁止 right 等锚定（会使 Row 整体放弃布局），
                                // 消息预览宽度 = 剩余空间，时间自然排到最右
                                width: parent.width - 8 - timeTxt.implicitWidth
                                text: modelData.last_message ? page.preview(modelData.last_message) : "还没有消息"
                                font.pixelSize: 12
                                color: modelData.unread > 0 ? Root.Theme.text : Root.Theme.textLight
                                elide: Text.ElideRight
                            }
                            Text {
                                id: timeTxt
                                text: modelData.last_message ? Util.tsShort(modelData.last_message.created_at).slice(5) : ""
                                font.pixelSize: 10
                                color: Root.Theme.textLight
                            }
                        }

                        Row {
                            width: parent.width
                            visible: modelData.unread > 0
                            Text {
                                text: "🔴 " + modelData.unread + " 条未读"
                                font.pixelSize: 11
                                color: Root.Theme.danger
                                font.weight: Font.Medium
                            }
                        }
                    }
                }
            }

            EmptyState {
                anchors.centerIn: parent
                visible: page.list.length === 0
                text: "暂无书市消息"
                subText: "去「书市」看中喜欢的书，点「联系卖家」就能在这里聊了"
            }
        }
    }

    function preview(m) {
        return (m.sender_id === Session.myId ? "我：" : "") + m.text
    }

    function load(reset) {
        Api.get("/api/book-chats").then(function (d) {
            page.list = d.list
            pullRef.finish()
        }).catch(function () {
            pullRef.finish()
        })
    }

    function refresh() { load(true) }

    Component.onCompleted: {
        load(true)
        pageTimer.start()
        // 登出时 Loader 卸载会销毁本页，handler 必须解除，否则重登后重复触发
        page._unsub = Realtime.on("bchat", function () { if (page.visible) page.load(false) })
    }

    Component.onDestruction: if (page._unsub) page._unsub()
    Timer {
        id: pageTimer
        interval: 30000
        repeat: true
        onTriggered: { if (page.visible) page.load(false) }
    }
}
