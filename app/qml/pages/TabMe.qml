import QtQuick
import LeLeBook 1.0
import QtQuick.Controls
import QtQuick.Dialogs
import ".." as Root
import "../js/util.js" as Util
import "../js/api.js" as Api
import "../js/ui.js" as Ui
import "../components"

// 我的：头像/昵称、数据统计、历史记录、设置与退出
Item {
    id: page
    property var app: null
    property var me: null
    property var _unsub: null // Realtime 订阅注销函数

    component MenuCard: AppCard {
        property var items: []
        width: parent.width
        height: items.length * 52
        Column {
            anchors.fill: parent
            Repeater {
                model: items
                delegate: Item {
                    width: parent.width
                    height: 52
                    Row {
                        anchors.left: parent.left
                        anchors.leftMargin: 16
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: 12
                        Text {
                            text: modelData.icon
                            font.pixelSize: 18
                        }
                        Text {
                            text: modelData.label
                            font.pixelSize: 14
                            color: modelData.danger ? Root.Theme.danger : Root.Theme.text
                        }
                    }
                    Text {
                        anchors.right: parent.right
                        anchors.rightMargin: 16
                        anchors.verticalCenter: parent.verticalCenter
                        text: "›"
                        color: Root.Theme.textLight
                        font.pixelSize: 18
                    }
                    MouseArea {
                        anchors.fill: parent
                        onClicked: page.onMenu(modelData)
                    }
                    Rectangle {
                        anchors.bottom: parent.bottom
                        width: parent.width - 32
                        anchors.horizontalCenter: parent.horizontalCenter
                        height: 1
                        color: Root.Theme.line
                        visible: index < items.length - 1
                    }
                }
            }
        }
    }

    // 分区小标题
    component SectionLabel: Text {
        width: parent.width
        text: label
        font.pixelSize: 12
        font.weight: Font.Medium
        color: Root.Theme.textLight
        leftPadding: 4
        topPadding: 6
        property string label: ""
    }

    Rectangle {
        anchors.fill: parent
        gradient: Root.Theme.pageGradient
    }

    Flickable {
        anchors.fill: parent
        contentHeight: col.implicitHeight + 136
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: col
            width: parent.width - 32
            anchors.horizontalCenter: parent.horizontalCenter
            y: 12
            spacing: 10

            // ---------- 渐变个人卡：头像 + 身份 + 数据 ----------
            Rectangle {
                width: parent.width
                height: 208
                radius: 22
                clip: true
                gradient: Root.Theme.brandGradient
                // 装饰光斑
                Rectangle {
                    width: 200; height: 200; radius: 100
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.rightMargin: -60
                    anchors.topMargin: -100
                    color: "#14FFFFFF"
                }
                Rectangle {
                    width: 110; height: 110; radius: 55
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.rightMargin: 30
                    anchors.topMargin: -55
                    color: "#0DFFFFFF"
                }
                Rectangle {
                    width: 150; height: 150; radius: 75
                    anchors.left: parent.left
                    anchors.bottom: parent.bottom
                    anchors.leftMargin: -50
                    anchors.bottomMargin: -80
                    color: "#0AFFFFFF"
                }

                Column {
                    anchors.fill: parent
                    anchors.margins: 18
                    spacing: 12

                    // 头像 + 昵称身份
                    Row {
                        width: parent.width
                        spacing: 16
                        Item {
                            width: 86; height: 86
                            Rectangle {
                                anchors.centerIn: parent
                                width: 86; height: 86
                                radius: 43
                                color: "#30FFFFFF"
                            }
                            Avatar {
                                id: myAvatar
                                anchors.centerIn: parent
                                size: 76
                                nickname: Session.nickname
                                photo: page.me && page.me.avatar === 1
                                photoUrl: page.me && page.me.avatar === 1 ? Session.baseUrl + "/files/avatars/" + Session.myId + ".jpg" : ""
                            }
                            MouseArea {
                                anchors.fill: parent
                                onClicked: page.choosePhoto()
                            }
                            Text {
                                anchors.bottom: parent.bottom
                                anchors.bottomMargin: 2
                                anchors.horizontalCenter: parent.horizontalCenter
                                text: "点击换照片"
                                color: "#FFFFFF"
                                font.pixelSize: 8
                                styleColor: Qt.rgba(0, 0, 0, 0.35)
                                style: Text.Outline
                            }
                        }
                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            width: parent.width - 102
                            spacing: 5
                            Text {
                                width: parent.width
                                text: Session.nickname
                                font.pixelSize: 20
                                font.weight: Font.Bold
                                color: "#FFFFFF"
                                elide: Text.ElideRight
                            }
                            Text {
                                width: parent.width
                                text: page.me ? ("🏫 " + page.me.school) : ""
                                font.pixelSize: 12
                                color: "#E6FFFFFF"
                                elide: Text.ElideRight
                            }
                            Text {
                                width: parent.width
                                text: (page.me ? ("👤 " + Util.genderCN(page.me.gender)) : "") + (page.me ? " · " + page.me.email : "")
                                font.pixelSize: 11
                                color: "#C9FFFFFF"
                                elide: Text.ElideRight
                            }
                        }
                    }

                    // 分隔
                    Rectangle {
                        width: parent.width
                        height: 1
                        color: "#26FFFFFF"
                    }

                    // 数据三格
                    Row {
                        width: parent.width
                        spacing: 8
                        Repeater {
                            model: [
                                { icon: "📚", v: page.me ? page.me.books_on : 0, l: "在售书籍" }
                            ]
                            delegate: Rectangle {
                                width: (parent.width - 16) / 3
                                height: 44
                                radius: 14
                                color: "#1FFFFFFF"
                                Row {
                                    anchors.centerIn: parent
                                    spacing: 6
                                    Text {
                                        anchors.verticalCenter: parent.verticalCenter
                                        text: modelData.icon
                                        font.pixelSize: 15
                                    }
                                    Column {
                                        anchors.verticalCenter: parent.verticalCenter
                                        spacing: 1
                                        Text {
                                            text: modelData.v
                                            font.pixelSize: 16
                                            font.weight: Font.Bold
                                            color: "#FFFFFF"
                                        }
                                        Text {
                                            text: modelData.l
                                            font.pixelSize: 9
                                            color: "#D9FFFFFF"
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // ---------- 记录与服务 ----------
            SectionLabel { label: "记录与服务" }
            MenuCard {
                items: [
                    { icon: "📢", label: "公告中心", page: "NoticesPage.qml" },
                    { icon: "💬", label: "意见反馈", action: "feedback" },
                    { icon: "🔔", label: "检查更新", action: "checkVersion" }
                ]
            }

            // ---------- 关于 ----------
            SectionLabel { label: "关于" }
            MenuCard {
                items: [
                    { icon: "ℹ️", label: "关于WHU二手书市", action: "about" },
                    { icon: "🚪", label: "退出登录", action: "logout", danger: true }
                ]
            }

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: "WHU二手书市 v1." + (Math.floor(Session.appVersionCode / 10) % 10) + "." + (Session.appVersionCode % 10) + " · 不碰钱 · 当面交易"
                color: Root.Theme.textLight
                font.pixelSize: 10
            }
        }
    }

    function onMenu(m) {
        if (m.action === "logout") {
            Ui.confirm({ title: "退出登录？", text: "退出后需要重新用邮箱验证码登录。", okText: "退出", danger: true }, function (ok) {
                if (!ok) return
                Session.clear()
                Realtime.disconnect()
                app.loggedIn = false
            })
        } else if (m.action === "feedback") {
            Ui.input({ title: "意见反馈", hint: "问题和建议（5-500 字）" }, function (text) {
                if (!text) return
                var t = text.trim()
                if (t.length < 5) { Ui.toast("反馈内容至少 5 个字"); return }
                if (t.length > 500) { Ui.toast("反馈内容最多 500 字"); return }
                Api.post("/feedback", { content: t }).then(function () {
                    Ui.toast("感谢反馈！已直达开发者")
                }).catch(function (e) { Ui.toast(e.msg) })
            })
        } else if (m.action === "checkVersion") {
            app.checkVersion(true)
        } else if (m.action === "about") {
            Ui.confirm({ title: "WHU二手书市 v1." + (Math.floor(Session.appVersionCode / 10) % 10) + "." + (Session.appVersionCode % 10), text: "校园二手书市平台\n· 无密码注册，仅邮箱验证码\n· 闲置教材信息展示，线下当面交易\n· 交易问题请走书籍详情内举报流程", okText: "知道了" }, function () {})
        } else if (m.page) {
            // 只传目标页确实声明的属性：HistoryPage 用 role，其余页面（公告中心/指南/设置等）没有，
            // 无脑传空 role 会让 push 对不存在属性赋值而中断，页面只显示一半内容
            var pushProps = {}
            if (m.role) pushProps.role = m.role
            app.pushPage(m.page, pushProps)
        }
    }

    // ---------- 头像上传（仅一张，≤200KB，自动压缩；用于双方相认） ----------
    FileDialog {
        id: photoDlg
        fileMode: FileDialog.OpenFile
        nameFilters: ["图片 (*.jpg *.jpeg *.png)"]
        onAccepted: page.uploadPhoto(photoDlg.selectedFile)
    }
    function choosePhoto() {
        Ui.confirm({
            title: "更换相认照片",
            text: "照片将展示给与你交易的同学，用于见面相认。仅支持一张，自动压缩到 200KB 以内；确认后立即生效。",
            okText: "选择照片"
        }, function (ok) {
            if (ok) photoDlg.open()
        })
    }
    function uploadPhoto(fileUrl) {
        Ui.loading(true, "压缩上传中...")
        var outUrl = ImageUtil.compress(fileUrl, 512, 200)
        if (!outUrl) { Ui.loading(false); Ui.toast("图片处理失败，请换一张"); return }
        Api.upload("/api/auth/me/avatar", outUrl, 60000).then(function () {
            Ui.loading(false)
            Ui.toast("头像已更新")
            load()
        }).catch(function (e) {
            Ui.loading(false)
            Ui.toast(e.msg)
        })
    }

    function refresh() { load() }

    function load() {
        Api.get("/api/auth/me").then(function (d) {
            page.me = d
        }).catch(function () {})
    }

    Component.onCompleted: {
        load()
        // 登出时 Loader 卸载会销毁本页，handler 必须解除，否则重登后重复触发
        page._unsub = Realtime.on("notif", function () { page.load() })
    }

    Component.onDestruction: if (page._unsub) page._unsub()
}
