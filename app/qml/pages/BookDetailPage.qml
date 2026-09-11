import QtQuick
import QtQuick.Controls
import LeLeBook 1.0
import ".." as Root
import "../js/util.js" as Util
import "../js/api.js" as Api
import "../js/ui.js" as Ui
import "../components"

// 书详情：封面大图、定价与成色、卖家信息、联系卖家（线下当面交易）
Item {
    id: page
    property var app: null
    property int bookId: 0
    property var detail: null // 注意：不能叫 data —— 那是 Item 内置默认属性（存子对象），遮蔽它会静默丢弃整棵 UI 树

    // 不透底：推入详情栈后浮在 Tab 页之上，根必须有不透明背景，否则下层 Tab 内容会透出来
    Rectangle {
        anchors.fill: parent
        color: Root.Theme.bg
    }

    Column {
        anchors.fill: parent

        AppHeader {
            showBack: true
            title: "书籍详情"
            onBackClicked: app.popPage()
        }

        Flickable {
            width: parent.width
            height: parent.height - 52
            contentHeight: col.implicitHeight + 30
            clip: true
            boundsBehavior: Flickable.StopAtBounds

            Column {
                id: col
                width: parent.width - 32
                anchors.horizontalCenter: parent.horizontalCenter
                spacing: 12

                // ---------- 封面 ----------
                Rectangle {
                    id: cover
                    width: parent.width
                    // 高度随封面真实比例自适应：PreserveAspectCrop 会把海报/宽图裁到只剩中间一条，
                    // 这里按图片宽高比撑高（190~430 之间收口，防止极端长图占满整页）；
                    // 图片未加载完时 implicitWidth 为 0，自然回落到下限 190
                    height: page.detail && page.detail.photo
                            ? Math.max(190, Math.min(430, width * coverImg.implicitHeight / Math.max(1, coverImg.implicitWidth)))
                            : 190
                    radius: 14
                    color: page.detail && page.detail.photo ? "transparent" : "#EFF3FA"
                    clip: true
                    Image {
                        id: coverImg
                        anchors.fill: parent
                        visible: page.detail && page.detail.photo
                        // source 必须随 photo 置空：Image 不可见时仍会加载 source，photo=0 也去请求会刷 404
                        source: page.detail && page.detail.photo ? Session.baseUrl + "/files/books/" + page.detail.id + ".jpg" : ""
                        fillMode: Image.PreserveAspectFit
                    }
                    Column {
                        anchors.centerIn: parent
                        visible: !(page.detail && page.detail.photo)
                        spacing: 8
                        Text { text: "📖"; font.pixelSize: 52 }
                        Text {
                            text: page.detail ? page.detail.title : ""
                            color: Root.Theme.textSub
                            font.pixelSize: 14
                            font.weight: Font.Medium
                            wrapMode: Text.Wrap
                            horizontalAlignment: Text.AlignHCenter
                            width: parent.width
                        }
                    }
                }

                // ---------- 标题 / 价格 / 状态 ----------
                // 注意：Row 内子项禁止锚定（anchors.right/verticalCenter 会让 Row 放弃布局，
                // 整行渲染不出来——此前标题价格行一直没显示就是这个原因），贴右靠宽度计算
                Row {
                    width: parent.width
                    spacing: 8
                    Text {
                        width: parent.width - 130
                        text: page.detail ? page.detail.title : ""
                        font.pixelSize: 20
                        font.weight: Font.Bold
                        color: Root.Theme.text
                        wrapMode: Text.Wrap
                    }
                    Text {
                        width: page.detail && page.detail.price_cents > 0 ? Math.min(implicitWidth + 2, 122) : 122
                        horizontalAlignment: Text.AlignRight
                        wrapMode: Text.Wrap
                        lineHeight: 1.3
                        // 批量发的书 price_cents=0，价格位显示卖家的文字描述
                        text: !page.detail ? "" : (page.detail.price_cents > 0 ? Util.yuan(page.detail.price_cents) : (page.detail.price_note || "价格面议"))
                        font.pixelSize: page.detail && page.detail.price_cents > 0 ? 22 : 13
                        font.weight: Font.Bold
                        color: Root.Theme.primary
                    }
                }

                Row {
                    width: parent.width
                    spacing: 6
                    TagBadge {
                        visible: page.detail && page.detail.status === "on"
                        text: "在售"
                        fg: Root.Theme.primaryDark
                        bg: Root.Theme.primarySoft
                    }
                    TagBadge {
                        visible: page.detail && page.detail.status !== "on"
                        text: page.detail && page.detail.status === "sold" ? "已售出" : "已下架"
                        fg: Root.Theme.textLight
                    }
                    TagBadge {
                        visible: page.detail && !!page.detail.cond_cn
                        text: page.detail ? page.detail.cond_cn : ""
                        fg: Root.Theme.primaryDark
                        bg: Root.Theme.primarySoft
                    }
                    TagBadge {
                        visible: page.detail && !!page.detail.course
                        text: "📘 " + (page.detail ? page.detail.course : "")
                        fg: Root.Theme.blue
                        bg: Root.Theme.blueSoft
                    }
                    TagBadge {
                        visible: page.detail && !!page.detail.school
                        text: page.detail ? page.detail.school : ""
                        fg: Root.Theme.textSub
                    }
                    TagBadge {
                        visible: page.detail && !!page.detail.location
                        text: "📍 " + (page.detail ? page.detail.location : "")
                        fg: Root.Theme.primaryDark
                        bg: Root.Theme.primarySoft
                    }
                }

                NoticeBar {
                    width: parent.width
                    visible: page.detail && !page.detail.is_seller && page.detail.status !== "sold"
                    text: "平台仅提供信息展示与联系，不参与交易：请先聊好价格与地点，见面当面验书、满意再付款。"
                }
                NoticeBar {
                    width: parent.width
                    visible: page.detail && page.detail.is_seller
                    text: "这是你发布的书籍。被询问时会收到消息提醒，谈妥并完成交易后请及时「标记已售出」。"
                    fg: Root.Theme.blue
                    bg: Root.Theme.blueSoft
                }

                // ---------- 补充说明 ----------
                AppCard {
                    width: parent.width
                    visible: page.detail && !!page.detail.note
                    height: noteCol.implicitHeight + 22
                    Column {
                        id: noteCol
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: 11
                        spacing: 6
                        Text { text: "卖家说"; font.pixelSize: 12; font.weight: Font.Medium; color: Root.Theme.textSub }
                        Text {
                            width: parent.width
                            text: page.detail ? page.detail.note : ""
                            font.pixelSize: 13
                            color: Root.Theme.text
                            wrapMode: Text.Wrap
                            lineHeight: 1.5
                        }
                    }
                }

                // ---------- 卖家 ----------
                AppCard {
                    width: parent.width
                    height: 82
                    Row {
                        anchors.fill: parent
                        anchors.margins: 14
                        spacing: 12
                        Avatar {
                            anchors.verticalCenter: parent.verticalCenter
                            size: 46
                            nickname: page.detail && page.detail.seller ? page.detail.seller.nickname : ""
                            photo: page.detail && page.detail.seller && page.detail.seller.avatar === 1
                            photoUrl: page.detail && page.detail.seller && page.detail.seller.avatar === 1 ? Session.baseUrl + "/files/avatars/" + page.detail.seller.id + ".jpg" : ""
                        }
                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 3
                            Text {
                                text: page.detail && page.detail.seller ? (page.detail.seller.nickname + (page.detail.is_seller ? "（我）" : "")) : ""
                                font.pixelSize: 14
                                font.weight: Font.Medium
                                color: Root.Theme.text
                            }
                            Text {
                                text: page.detail && page.detail.seller ? ("注册 " + Util.isoDate(page.detail.seller.created_at)) : ""
                                font.pixelSize: 11
                                color: Root.Theme.textSub
                            }
                        }
                        Item { width: 4 }
                        Rectangle {
                            anchors.verticalCenter: parent.verticalCenter
                            width: 72; height: 32
                            radius: 16
                            color: page.detail && page.detail.is_seller ? "#EEF0F3" : Root.Theme.primarySoft
                            Text {
                                anchors.centerIn: parent
                                text: page.detail && page.detail.is_seller ? "我发布的" : "看主页"
                                font.pixelSize: 12
                                color: page.detail && page.detail.is_seller ? Root.Theme.textLight : Root.Theme.primaryDark
                            }
                            MouseArea {
                                anchors.fill: parent
                                enabled: page.detail && !page.detail.is_seller && page.detail.seller
                                onClicked: app.pushPage("ProfilePage.qml", { userId: page.detail.seller.id })
                            }
                        }
                    }
                }

                Text {
                    width: parent.width
                    text: "发布于 " + (page.detail ? Util.isoShort(page.detail.created_at) : "")
                    color: Root.Theme.textLight
                    font.pixelSize: 11
                    horizontalAlignment: Text.AlignHCenter
                }

                // ---------- 联系卖家 ----------
                AppButton {
                    width: parent.width
                    visible: page.detail && !page.detail.is_seller && page.detail.status !== "sold"
                    text: page.detail && page.detail.my_thread ? "继续和卖家聊" : "💬 联系卖家"
                    onClicked: page.contact()
                }

                // ---------- 卖家操作 ----------
                AppButton {
                    width: parent.width
                    variant: "secondary"
                    visible: page.detail && page.detail.is_seller && page.detail.status === "sold"
                    text: "重新上架（恢复在售）"
                    onClicked: page.setStatus("on")
                }
                Row {
                    width: parent.width
                    visible: page.detail && page.detail.is_seller && page.detail.status !== "sold"
                    spacing: 10
                    AppButton {
                        width: (parent.width - 10) / 2
                        variant: "secondary"
                        text: page.detail && page.detail.status === "off" ? "重新上架" : "暂时下架"
                        onClicked: page.setStatus(page.detail && page.detail.status === "on" ? "off" : "on")
                    }
                    AppButton {
                        width: (parent.width - 10) / 2
                        variant: "danger"
                        text: "标记已售出"
                        onClicked: page.setStatus("sold")
                    }
                }

                // ---------- 举报 ----------
                AppButton {
                    width: parent.width
                    variant: "ghost"
                    text: "🚩 举报该书籍（虚假信息等提交平台审核）"
                    visible: page.detail && !page.detail.is_seller
                    onClicked: page.report()
                }
            }
        }
    }

    function setStatus(st) {
        var doIt = function () {
            Api.post("/api/books/" + page.bookId + "/status", { status: st }).then(function () {
                load()
            }).catch(function (e) { Ui.toast(e.msg) })
        }
        if (st === "sold") {
            Ui.confirm({
                title: "标记为已售出？",
                text: "标记后本书不再在书市展示，已联系的买家仍可继续沟通。确认已完成当面交易后再操作。",
                okText: "已售出",
                danger: true
            }, function (ok) { if (ok) doIt() })
        } else {
            doIt()
        }
    }

    function contact() {
        if (page.detail.my_thread) {
            app.pushPage("BookChatPage.qml", { chatId: page.detail.my_thread.chat_id })
            return
        }
        Ui.loading(true, "正在发起会话...")
        Api.post("/api/books/" + page.bookId + "/contact").then(function (d) {
            Ui.loading(false)
            app.pushPage("BookChatPage.qml", { chatId: d.chat_id })
        }).catch(function (e) {
            Ui.loading(false)
            Ui.toast(e.msg)
        })
    }

    function report() {
        Ui.input({ title: "举报原因（5-200 字）", hint: "例如：盗版/内容与描述严重不符/非本校人员" }, function (reason) {
            if (!reason) return
            if (reason.length < 5) { Ui.toast("请填写至少 5 字的原因"); return }
            Api.post("/api/books/" + page.bookId + "/report", { reason: reason }).then(function (d) {
                Ui.toast(d.msg || "举报已提交")
            }).catch(function (e) { Ui.toast(e.msg) })
        })
    }

    function load() {
        Api.get("/api/books/" + page.bookId).then(function (d) {
            page.detail = d
        }).catch(function (e) {
            Ui.toast(e.msg)
            app.popPage()
        })
    }

    Component.onCompleted: load()
}
