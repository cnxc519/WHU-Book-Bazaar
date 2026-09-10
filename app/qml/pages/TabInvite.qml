import QtQuick
import QtQuick.Controls
import LeLeBook 1.0
import ".." as Root
import "../js/util.js" as Util
import "../js/api.js" as Api
import "../js/ui.js" as Ui
import "../components"

// 邀请：邀请码 + 已邀请好友（纯互助推荐，无经济奖励）
Item {
    id: page
    property var app: null
    property var detail: null // 注意：不能叫 data —— 那是 Item 内置默认属性（存子对象），遮蔽它会静默丢弃整棵 UI 树

    Flickable {
        anchors.fill: parent
        contentHeight: col.implicitHeight + 116
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: col
            width: parent.width - 32
            anchors.horizontalCenter: parent.horizontalCenter
            y: 12
            spacing: 14

            // 邀请码卡片
            AppCard {
                width: parent.width
                height: 190
                color: Root.Theme.primary
                Column {
                    anchors.centerIn: parent
                    spacing: 10
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: "我的邀请码"
                        color: Qt.rgba(1, 1, 1, 0.8)
                        font.pixelSize: 13
                    }
                    Text {
                        anchors.horizontalCenter: parent.horizontalCenter
                        text: page.detail ? page.detail.invite_code : "--------"
                        color: "#FFFFFF"
                        font.pixelSize: 32
                        font.weight: Font.Bold
                        font.letterSpacing: 4
                    }
                    Rectangle {
                        anchors.horizontalCenter: parent.horizontalCenter
                        width: 120; height: 36
                        radius: 18
                        color: "#FFFFFF"
                        Text {
                            anchors.centerIn: parent
                            text: "📋 复制邀请码"
                            color: Root.Theme.primaryDark
                            font.pixelSize: 13
                        }
                        MouseArea {
                            anchors.fill: parent
                            onClicked: {
                                Clipboard.text = page.detail.invite_code
                                Ui.toast("邀请码已复制，快分享给同学吧！")
                            }
                        }
                    }
                }
            }

            // 面对面邀请：展示下载海报（含安装二维码），朋友扫码即可下载
            AppCard {
                width: parent.width
                height: inviteCol.implicitHeight + 24 // AppCard 是纯容器不会自适应内容，必须显式设高
                Column {
                    id: inviteCol
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 14
                    spacing: 10
                    Text {
                        text: "📞 面对面邀请"
                        font.pixelSize: 15
                        font.weight: Font.Bold
                        color: Root.Theme.text
                    }
                    Text {
                        width: parent.width
                        text: "点开海报给同学扫一扫即可下载；注册时填写你的邀请码「" + (page.detail ? page.detail.invite_code : "") + "」就是好友啦"
                        wrapMode: Text.Wrap
                        font.pixelSize: 12
                        color: Root.Theme.textSub
                    }
                    Rectangle {
                        width: parent.width
                        height: width * 1.42
                        radius: 12
                        color: "#F0F1F3"
                        clip: true
                        Image {
                            anchors.fill: parent
                            source: Qt.resolvedUrl("../../posters/invite_poster.png")
                            fillMode: Image.PreserveAspectCrop
                        }
                        Text {
                            anchors.bottom: parent.bottom
                            anchors.right: parent.right
                            anchors.margins: 8
                            text: "点开查看大图 ▶"
                            color: "#FFFFFF"
                            font.pixelSize: 11
                            style: Text.Outline
                            styleColor: Qt.rgba(0, 0, 0, 0.6)
                        }
                        MouseArea {
                            anchors.fill: parent
                            onClicked: page.posterOpen = true
                        }
                    }
                    AppButton {
                        width: parent.width
                        text: page.posterSaving ? "保存中..." : "⬇ 保存海报到相册"
                        busy: page.posterSaving
                        onClicked: page.savePoster()
                    }
                }
            }

            // 已邀请人数
            AppCard {
                width: parent.width
                height: 76
                Column {
                    anchors.centerIn: parent
                    spacing: 4
                    Text {
                        text: page.detail ? String(page.detail.invited_count) : "0"
                        color: Root.Theme.blue
                        font.pixelSize: 22
                        font.weight: Font.Bold
                    }
                    Text {
                        text: "已邀请的同学"
                        color: Root.Theme.textSub
                        font.pixelSize: 12
                    }
                }
            }

            // 说明
            AppCard {
                width: parent.width
                height: rules.implicitHeight + 24
                Column {
                    id: rules
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 14
                    spacing: 8
                    Text {
                        text: "🎁 邀请说明"
                        font.pixelSize: 15
                        font.weight: Font.Bold
                        color: Root.Theme.text
                    }
                    Text {
                        width: parent.width
                        text: "· 把邀请码发给同学，TA 注册时填写后即为好友关系"
                        color: Root.Theme.textSub
                        font.pixelSize: 13
                        wrapMode: Text.Wrap
                        lineHeight: 1.5
                    }
                    Text {
                        width: parent.width
                        text: "· 和朋友一起用乐乐书市，好书流转更安心～"
                        color: Root.Theme.textSub
                        font.pixelSize: 13
                        wrapMode: Text.Wrap
                        lineHeight: 1.5
                    }
                }
            }

            // 好友列表
            Text {
                text: "我邀请的同学"
                font.pixelSize: 15
                font.weight: Font.Bold
                color: Root.Theme.text
            }
            Repeater {
                model: page.detail ? page.detail.friends : []
                delegate: AppCard {
                    width: parent.width
                    height: 56
                    Row {
                        anchors.fill: parent
                        anchors.margins: 12
                        spacing: 10
                        Avatar {
                            anchors.verticalCenter: parent.verticalCenter
                            size: 36
                            nickname: modelData.nickname
                            photo: modelData.avatar === 1
                            photoUrl: modelData.avatar === 1 ? Session.baseUrl + "/files/avatars/" + modelData.id + ".jpg" : ""
                        }
                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 2
                            Text {
                                text: modelData.nickname
                                font.pixelSize: 13
                                color: Root.Theme.text
                            }
                            Text {
                                text: Util.isoShort(modelData.created_at) + " 加入"
                                font.pixelSize: 11
                                color: Root.Theme.textLight
                            }
                        }
                    }
                }
            }
            EmptyState {
                width: parent.width
                visible: page.detail && page.detail.friends.length === 0
                text: "还没有邀请同学"
                subText: "把邀请码分享给室友，一起淘好书吧"
            }
        }
    }

    function refresh() { load() }

    function load() {
        Api.get("/api/invite").then(function (d) {
            page.detail = d
        }).catch(function () {})
    }

    Component.onCompleted: load()

    // 海报全屏浮层：整幅海报铺满宽度，长图可上下滚动，方便朋友扫二维码
    property bool posterOpen: false
    property bool posterSaving: false
    function savePoster() {
        if (page.posterSaving) return
        page.posterSaving = true
        var ok = ImageUtil.savePosterToGallery(Session.baseUrl + "/poster.png")
        page.posterSaving = false
        Ui.toast(ok ? "海报已保存到相册" : "保存失败，请检查网络后重试")
    }
    Rectangle {
        anchors.fill: parent
        visible: page.posterOpen
        z: 100
        color: "#E9ECEF"
        Flickable {
            anchors.fill: parent
            contentHeight: posterCol.implicitHeight + 120
            clip: true
            boundsBehavior: Flickable.StopAtBounds
            Column {
                id: posterCol
                width: parent.width
                spacing: 10
                Text {
                    width: parent.width
                    horizontalAlignment: Text.AlignHCenter
                    text: "让朋友扫海报上的二维码下载，注册时填写你的邀请码"
                    font.pixelSize: 12
                    color: Root.Theme.textSub
                }
                Image {
                    id: posterFull
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: parent.width
                    source: Qt.resolvedUrl("../../posters/invite_poster.png")
                    fillMode: Image.PreserveAspectFit
                }
                Item { width: 1; height: 30 }
            }
        }
        // 保存海报到相册：方便发朋友圈/群里传播（走 MediaStore，免存储权限）
        AppButton {
            anchors.bottom: parent.bottom
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.bottomMargin: 24
            width: parent.width - 120
            text: "保存海报到相册"
            busy: page.posterSaving
            onClicked: page.savePoster()
        }
        Rectangle {
            anchors.top: parent.top
            anchors.topMargin: 12
            anchors.right: parent.right
            anchors.rightMargin: 16
            width: 96; height: 36
            radius: 18
            color: Qt.rgba(0, 0, 0, 0.55)
            Text { anchors.centerIn: parent; text: "✕ 关闭"; color: "#FFFFFF"; font.pixelSize: 13 }
            MouseArea { anchors.fill: parent; onClicked: page.posterOpen = false }
        }
    }
}
