import QtQuick
import ".." as Root
import "../js/util.js" as Util
import "../js/api.js" as Api
import "../js/ui.js" as Ui
import "../components"

// 公告中心：平台发布的公告列表（标题 + 发布时间 + 完整正文）
Item {
    id: page
    property var app: null
    property var list: []

    // 不透底：推入详情栈后浮在 Tab 页之上，根必须有不透明背景，否则下层页面内容会透出来（头、返回键像"没渲染"）
    Rectangle {
        anchors.fill: parent
        color: Root.Theme.bg
    }

    Column {
        anchors.fill: parent
        AppHeader {
            showBack: true
            title: "公告中心"
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
                spacing: 8
                topMargin: 10
                leftMargin: 12
                rightMargin: 12
                bottomMargin: 12
                delegate: AppCard {
                    width: listView.width - 24
                    height: col.implicitHeight + 20
                    Column {
                        id: col
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: 12
                        spacing: 6
                        // 标题
                        Text {
                            width: parent.width
                            text: "📢 " + modelData.title
                            font.pixelSize: 15
                            font.weight: Font.Bold
                            color: Root.Theme.text
                            wrapMode: Text.Wrap
                        }
                        // 正文（完整换行显示）
                        Text {
                            width: parent.width
                            text: modelData.content
                            font.pixelSize: 13
                            color: Root.Theme.textSub
                            wrapMode: Text.Wrap
                            lineHeight: 1.5
                        }
                        // 发布时间
                        Text {
                            text: Util.tsShort(modelData.created_at)
                            font.pixelSize: 11
                            color: Root.Theme.textLight
                        }
                    }
                }
            }

            EmptyState {
                anchors.centerIn: parent
                visible: page.list.length === 0
                text: "暂无公告"
            }
        }
    }

    function load() {
        Api.get("/api/notices").then(function (d) {
            page.list = d.list
        }).catch(function () {})
    }

    Component.onCompleted: load()
}
