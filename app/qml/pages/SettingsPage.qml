import QtQuick
import LeLeBook 1.0
import ".." as Root
import "../js/util.js" as Util
import "../js/ui.js" as Ui
import "../components"

// 设置：服务器地址（测试联调用）
Item {
    id: page
    property var app: null

    // 不透底：推入详情栈后浮在 Tab 页之上，根必须有不透明背景，否则下层页面内容会透出来
    Rectangle {
        anchors.fill: parent
        color: Root.Theme.bg
    }

    Column {
        anchors.fill: parent
        AppHeader {
            showBack: true
            title: "服务器设置"
            onBackClicked: app.popPage()
        }

        Flickable {
            width: parent.width
            height: parent.height - 52
            contentHeight: col.implicitHeight + 40
            clip: true
            boundsBehavior: Flickable.StopAtBounds

            Column {
                id: col
                width: parent.width - 32
                anchors.horizontalCenter: parent.horizontalCenter
                y: 12
                spacing: 14

                Text {
                    width: parent.width
                    text: "服务器地址（默认 http://47.91.25.15:8899）。修改后立即生效，仅用于开发调试，请勿随意改动。"
                    color: Root.Theme.warning
                    font.pixelSize: 12
                    wrapMode: Text.Wrap
                    lineHeight: 1.5
                }
                AppInput {
                    id: urlInput
                    text: Session.baseUrl
                }
                AppButton {
                    width: parent.width
                    text: "保存并重连"
                    onClicked: {
                        var u = urlInput.text.trim().replace(/\/+$/, "")
                        if (!/^https?:\/\/.+/.test(u)) { Ui.toast("地址格式不正确"); return }
                        Session.setBaseUrl(u)
                        Realtime.disconnect()
                        Realtime.connect()
                        Ui.toast("已保存")
                        app.popPage()
                    }
                }
            }
        }
    }
}
