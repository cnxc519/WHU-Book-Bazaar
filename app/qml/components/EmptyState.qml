import QtQuick
import ".." as Root

// 空状态占位
Column {
    id: root
    property string text: "暂无内容"
    property string subText: ""
    width: parent ? parent.width : 0
    spacing: 8

    Text {
        anchors.horizontalCenter: parent.horizontalCenter
        text: "📭"
        font.pixelSize: 44
    }
    Text {
        anchors.horizontalCenter: parent.horizontalCenter
        text: root.text
        color: Root.Theme.textSub
        font.pixelSize: 14
    }
    Text {
        anchors.horizontalCenter: parent.horizontalCenter
        visible: root.subText.length > 0
        text: root.subText
        color: Root.Theme.textLight
        font.pixelSize: 12
        wrapMode: Text.Wrap
        horizontalAlignment: Text.AlignHCenter
        width: parent.width - 60
    }
}
