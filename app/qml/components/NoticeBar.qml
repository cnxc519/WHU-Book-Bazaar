import QtQuick
import ".." as Root

// 提示条（重要说明 / 警告）
Rectangle {
    id: root
    property string text: ""
    property color fg: Root.Theme.warning
    property color bg: Root.Theme.warningSoft

    width: parent ? parent.width : 0
    radius: 10
    color: root.bg
    visible: root.text.length > 0
    // 高度声明式绑定文本实际高度（含 1.4 倍行距）：此前 onTextChanged 一次性赋值，
    // 构造期父链宽度/行距未就绪按单行算死，文字换成两行后高度不重算，末行溢出压到下方内容
    height: visible ? txt.implicitHeight + 20 : 0

    Text {
        id: txt
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.margins: 10
        y: 10
        text: root.text
        color: root.fg
        font.pixelSize: 12
        wrapMode: Text.Wrap
        lineHeight: 1.4
        visible: parent.visible
    }
}
