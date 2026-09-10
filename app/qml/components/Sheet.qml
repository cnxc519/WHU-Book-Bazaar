import QtQuick
import QtQuick.Controls
import ".." as Root

// 底部弹出面板：标题栏 + 内容区（内容由使用者填写）
Popup {
    id: root
    default property alias content: contentArea.data
    property string title: ""
    property int contentH: 400

    modal: true
    dim: true
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside
    x: 0
    width: root.parent ? root.parent.width : 0
    height: 0
    y: root.parent ? root.parent.height - root.height : 0
    padding: 0
    background: Rectangle { color: Root.Theme.card }

    onOpened: { height = root.contentH + 56 }
    onClosed: { height = 0 }
    Behavior on height { NumberAnimation { duration: 220; easing.type: Easing.OutCubic } }

    Column {
        width: parent.width
        spacing: 0

        Rectangle {
            width: parent.width
            height: 56
            color: Root.Theme.card
            Text {
                anchors.left: parent.left
                anchors.leftMargin: 16
                anchors.verticalCenter: parent.verticalCenter
                text: root.title
                font.pixelSize: 16
                font.weight: Font.Medium
                color: Root.Theme.text
                elide: Text.ElideRight
                width: parent.width - 90
            }
            Text {
                anchors.right: parent.right
                anchors.rightMargin: 16
                anchors.verticalCenter: parent.verticalCenter
                color: Root.Theme.primary
                font.pixelSize: 14
                font.weight: Font.Medium
                text: "完成"
                visible: root.enableDone
                MouseArea {
                    anchors.fill: parent
                    anchors.margins: -8
                    onClicked: root.doneClicked()
                }
            }
        }
        Rectangle { width: parent.width; height: 1; color: Root.Theme.line }

        Item {
            id: contentArea
            width: parent.width
            height: root.contentH
            clip: true
        }
    }

    property bool enableDone: false
    signal doneClicked()
}
