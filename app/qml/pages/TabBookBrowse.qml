import QtQuick
import LeLeBook 1.0
import QtQuick.Controls
import ".." as Root
import "../js/util.js" as Util
import "../js/api.js" as Api
import "../js/ui.js" as Ui
import "../components"

// 书市模式·书市：搜索/浏览全校在售二手书（平台仅提供联系，线下当面交易）
Item {
    id: page
    property var app: null

    property var list: []
    property int listPage: 1
    property bool hasMore: false
    property bool loading: false
    property string q: ""          // 搜索词（书名/课程/备注）
    property string sort: "latest" // latest | price_asc | price_desc
    property int unread: 0
    property var _unsubs: null // Realtime 订阅注销函数列表

    Rectangle {
        anchors.fill: parent
        gradient: Root.Theme.pageGradient
    }

    Column {
        id: headCol
        anchors.top: parent.top
        anchors.left: parent.left
        anchors.right: parent.right
        spacing: 10

        // ---------- Hero 头图 ----------
        Item {
            width: parent.width
            height: 118
            Rectangle {
                anchors.fill: parent
                gradient: Root.Theme.brandGradient
                Rectangle {
                    width: 220; height: 220; radius: 110
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.rightMargin: -70
                    anchors.topMargin: -110
                    color: "#14FFFFFF"
                }
                Rectangle {
                    width: 120; height: 120; radius: 60
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.rightMargin: 20
                    anchors.topMargin: -60
                    color: "#0DFFFFFF"
                }
                Rectangle {
                    width: 170; height: 170; radius: 85
                    anchors.left: parent.left
                    anchors.bottom: parent.bottom
                    anchors.leftMargin: -70
                    anchors.bottomMargin: -100
                    color: "#0AFFFFFF"
                }
            }

            Column {
                anchors.left: parent.left
                anchors.leftMargin: 22
                anchors.verticalCenter: parent.verticalCenter
                spacing: 5
                Text {
                    text: "校园书市"
                    font.pixelSize: 25
                    font.weight: Font.Bold
                    color: "#FFFFFF"
                }
                Text {
                    text: "教材课本 · 一本好书流转一个学期"
                    font.pixelSize: 12
                    color: "#E0FFFFFF"
                }
            }

            // 通知铃铛
            Rectangle {
                anchors.right: parent.right
                anchors.rightMargin: 16
                anchors.verticalCenter: parent.verticalCenter
                width: 38; height: 38
                radius: 19
                color: "#26FFFFFF"
                Text {
                    anchors.centerIn: parent
                    text: "🔔"
                    font.pixelSize: 16
                }
                Rectangle {
                    visible: page.unread > 0
                    anchors.top: parent.top
                    anchors.right: parent.right
                    anchors.topMargin: -4
                    anchors.rightMargin: -4
                    width: 17; height: 17
                    radius: 8.5
                    color: "#FF3B30"
                    border.color: "#FFFFFF"
                    border.width: 1.5
                    Text {
                        anchors.centerIn: parent
                        text: page.unread > 99 ? "99" : page.unread
                        color: "#FFFFFF"
                        font.pixelSize: 8
                    }
                }
                MouseArea {
                    anchors.fill: parent
                    onClicked: app.pushPage("NotificationsPage.qml", {})
                }
            }
        }

        // ---------- 搜索 + 排序 合一卡片 ----------
        AppCard {
            width: parent.width - 24
            anchors.horizontalCenter: parent.horizontalCenter
            height: 96
            Column {
                anchors.fill: parent
                anchors.margins: 11
                spacing: 7

                // 搜索行
                Row {
                    width: parent.width
                    height: 38
                    spacing: 8
                    Rectangle {
                        width: parent.width - 70
                        height: 38
                        radius: 19
                        color: "#F2F4F5"
                        Row {
                            anchors.fill: parent
                            anchors.leftMargin: 12
                            spacing: 6
                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                text: "🔍"
                                font.pixelSize: 14
                            }
                            TextField {
                                id: qInput
                                width: parent.width - 24
                                height: 36
                                anchors.verticalCenter: parent.verticalCenter
                                padding: 0
                                font.pixelSize: 13
                                placeholderText: "搜书名 / 课程 / 备注"
                                placeholderTextColor: Root.Theme.textLight
                                color: Root.Theme.text
                                background: Rectangle { color: "transparent" }
                                Keys.onReturnPressed: page.doSearch()
                            }
                        }
                    }
                    Rectangle {
                        width: 62; height: 38
                        radius: 19
                        gradient: Root.Theme.brandGradient
                        Text {
                            anchors.centerIn: parent
                            text: "搜索"
                            font.pixelSize: 13
                            font.weight: Font.Medium
                            color: "#FFFFFF"
                        }
                        MouseArea {
                            anchors.fill: parent
                            onClicked: page.doSearch()
                        }
                    }
                }

                Rectangle {
                    width: parent.width
                    height: 1
                    color: Root.Theme.line
                }

                // 排序行
                Row {
                    width: parent.width
                    height: 30
                    spacing: 8
                    Text {
                        anchors.verticalCenter: parent.verticalCenter
                        text: "排序"
                        color: Root.Theme.textLight
                        font.pixelSize: 11
                    }
                    Repeater {
                        model: [
                            { v: "latest", l: "🆕 最新发布" },
                            { v: "price_asc", l: "价格 低→高" },
                            { v: "price_desc", l: "价格 高→低" }
                        ]
                        delegate: Rectangle {
                            height: 30
                            anchors.verticalCenter: parent.verticalCenter
                            width: sortTxt.implicitWidth + 16
                            radius: 15
                            color: page.sort === modelData.v ? Root.Theme.primarySoft : "transparent"
                            border.color: page.sort === modelData.v ? Root.Theme.primaryLight : "transparent"
                            border.width: 1
                            Text {
                                id: sortTxt
                                anchors.centerIn: parent
                                text: modelData.l
                                font.pixelSize: 11
                                font.weight: page.sort === modelData.v ? Font.Medium : Font.Normal
                                color: page.sort === modelData.v ? Root.Theme.primaryDark : Root.Theme.textSub
                            }
                            MouseArea {
                                anchors.fill: parent
                                onClicked: {
                                    if (page.sort !== modelData.v) { page.sort = modelData.v; page.load(true) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // ---------- 列表区 ----------
    Item {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.top: headCol.bottom
        anchors.bottom: parent.bottom

        ListView {
            id: listView
            anchors.fill: parent
            clip: true
            model: page.list
            spacing: 10
            topMargin: 4
            bottomMargin: 8
            leftMargin: 12
            rightMargin: 12
            boundsBehavior: Flickable.DragAndOvershootBounds

            header: PullToRefresh {
                id: pullRef
                onRefresh: function () { page.load(true) }
            }

            onAtYEndChanged: if (atYEnd) page.loadMore()

            delegate: AppCard {
                width: listView.width - 24
                height: cardRow.implicitHeight + 22
                tappable: true
                onClicked: app.pushPage("BookDetailPage.qml", { bookId: modelData.id })

                Row {
                    id: cardRow
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 11
                    spacing: 10

                    // 封面缩略图
                    Rectangle {
                        width: 56; height: 70
                        radius: 10
                        color: modelData.photo ? "transparent" : Root.Theme.primarySoft
                        clip: true
                        Image {
                            anchors.fill: parent
                            visible: modelData.photo
                            source: modelData.photo ? Session.baseUrl + "/files/books/" + modelData.id + ".jpg" : ""
                            fillMode: Image.PreserveAspectCrop
                        }
                        Text {
                            anchors.centerIn: parent
                            visible: !modelData.photo
                            text: "📖"
                            font.pixelSize: 24
                        }
                    }

                    Column {
                        width: parent.width - 66
                        spacing: 4
                        Row {
                            width: parent.width
                            spacing: 6
                            Text {
                                // Row 内子项禁止 right 等锚定，价格靠剩余宽度自然排到最右
                                // 用 priceTxt.width（已限幅）而非 implicitWidth：长价格描述不会把标题挤没
                                width: parent.width - 6 - priceTxt.width
                                text: modelData.title
                                font.pixelSize: 15
                                font.weight: Font.Bold
                                color: Root.Theme.text
                                elide: Text.ElideRight
                            }
                                    Text {
                                        id: priceTxt
                                        // 批量发的书 price_cents=0，价格位显示卖家的文字描述
                                        text: modelData.price_cents > 0 ? Util.yuan(modelData.price_cents) : (modelData.price_note || "价格面议")
                                        font.pixelSize: modelData.price_cents > 0 ? 15 : 12
                                        font.weight: Font.Bold
                                        color: Root.Theme.primary
                                        elide: Text.ElideRight
                                        width: Math.min(implicitWidth + 2, parent.width * 0.5)
                                    }
                        }
                        Row {
                            width: parent.width
                            spacing: 6
                            TagBadge {
                                visible: modelData.course
                                text: "📘 " + modelData.course
                                fg: Root.Theme.blue
                                bg: Root.Theme.blueSoft
                            }
                            TagBadge {
                                visible: !!modelData.cond_cn
                                text: modelData.cond_cn
                                fg: Root.Theme.primaryDark
                                bg: Root.Theme.primarySoft
                            }
                        }
                        Text {
                            width: parent.width
                            visible: !!modelData.note
                            text: modelData.note
                            font.pixelSize: 11
                            color: Root.Theme.textSub
                            wrapMode: Text.Wrap
                            maximumLineCount: 1
                            elide: Text.ElideRight
                        }
                        Text {
                            width: parent.width
                            visible: !!modelData.location
                            text: "📍 " + modelData.location
                            font.pixelSize: 11
                            color: Root.Theme.text
                            elide: Text.ElideRight
                        }
                        Text {
                            width: parent.width
                            text: "👤 " + (modelData.seller ? modelData.seller.nickname : "") + (modelData.school ? " · " + modelData.school : "") + " · " + Util.isoShort(modelData.created_at).slice(5)
                            font.pixelSize: 11
                            color: Root.Theme.textLight
                            elide: Text.ElideRight
                        }
                    }
                }
            }

            // 底部加载
            footer: Column {
                width: listView.width - 24
                visible: page.list.length > 0
                spacing: 6
                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: page.hasMore ? "上拉加载更多..." : "已加载全部"
                    color: Root.Theme.textLight
                    font.pixelSize: 11
                }
                Text {
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: "看中后点进详情联系卖家 · 线下当面验书付款"
                    color: Root.Theme.textLight
                    font.pixelSize: 9
                }
            }
        }

        EmptyState {
            anchors.centerIn: parent
            anchors.topMargin: -30
            visible: page.list.length === 0 && !page.loading
            text: page.q ? "没有找到相关书籍" : "书市暂时没有书"
            subText: page.q ? "换个关键词试试，比如搜书名或课程名" : "去「卖书」页发布你闲置的教材吧"
        }
    }

    // 标记搜索输入完成，自动带过滤重新加载
    function doSearch() {
        page.q = qInput.text
        page.load(true)
    }

    function loadUnread() {
        Api.get("/api/notifications").then(function (d) { page.unread = d.unread }).catch(function () {})
    }

    function load(reset) {
        if (page.loading) return
        if (reset) page.listPage = 1
        else if (!page.hasMore) return // 没有更多时禁止 append 模式拉取（定时器/实时事件曾借此重复拼接同页）
        page.loading = true
        var myPage = page.listPage
        var q = "/api/books?page=" + page.listPage + "&sort=" + page.sort
        if (page.q) q += "&q=" + encodeURIComponent(page.q)
        Api.get(q).then(function (d) {
            page.loading = false
            if (!reset && myPage !== page.listPage) return // 过期响应：期间已发生重置/翻页，直接丢弃
            if (reset) page.list = []
            // 追加时按 id 去重：分页窗口移动（新内容插入）可能让相邻页出现同一条
            var seen = {}
            page.list.forEach(function (b) { seen[b.id] = 1 })
            page.list = page.list.concat((d.list || []).filter(function (b) { return !seen[b.id] }))
            page.hasMore = d.has_more
            pullRef.finish()
        }).catch(function (e) {
            page.loading = false
            pullRef.finish()
            if (reset) Ui.toast(e.msg)
        })
    }

    function loadMore() {
        if (!page.hasMore || page.loading) return
        page.listPage++
        load(false)
    }

    function refresh() { load(true); loadUnread() }

    Component.onCompleted: {
        load(true)
        loadUnread()
        pageTimer.start()
        // 登出时 Loader 卸载会销毁本页，handler 必须解除，否则重登后重复触发
        page._unsubs = [
            Realtime.on("notif", function () { page.loadUnread() }),
            Realtime.on("bchat", function () { page.load(true) })
        ]
    }

    Component.onDestruction: {
        if (page._unsubs) for (var i = 0; i < page._unsubs.length; i++) page._unsubs[i]()
    }
    Timer {
        id: pageTimer
        interval: 30000
        repeat: true
        onTriggered: { if (page.visible) page.load(true); page.loadUnread() }
    }
}
