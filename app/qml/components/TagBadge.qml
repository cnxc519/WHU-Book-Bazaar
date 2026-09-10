import QtQuick
import ".." as Root

// 小标签
Rectangle {
    id: root
    property string text: ""
    property color fg: Root.Theme.textSub
    property color bg: "#EEF0F3"

    height: 20
    width: content.width + 12
    radius: 6
    color: root.bg

    Text {
        id: content
        anchors.centerIn: parent
        text: root.text
        color: root.fg
        font.pixelSize: 11
    }
}
