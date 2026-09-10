import QtQuick
import QtQuick.Controls
import ".." as Root

// 圆角输入框（带可选密码/数字键盘类型）
TextField {
    id: root
    property string hint: ""
    property bool pw: false

    width: parent ? parent.width : 0
    height: 48
    padding: 14
    font.pixelSize: 15
    color: Root.Theme.text
    placeholderText: root.hint
    placeholderTextColor: Root.Theme.textLight
    echoMode: root.pw ? TextInput.Password : TextInput.Normal
    // 触屏上禁用鼠标选择：selectByMouse 会让部分安卓机型把首次点击当"移动光标"
    // 处理（只出光标不弹键盘，点第二次才弹），且触屏本来用不上鼠标选择
    selectByMouse: Qt.platform.os !== "android"
    inputMethodHints: root.pw ? Qt.ImhHiddenText : Qt.ImhNone
    // 兜底：部分 ROM 上窗口 resize 会吞掉首次弹键盘请求，聚焦时显式拉起
    onActiveFocusChanged: if (activeFocus) Qt.inputMethod.show()

    background: Rectangle {
        radius: Root.Theme.radiusBtn
        color: Root.Theme.card
        border.color: root.activeFocus ? Root.Theme.primary : Root.Theme.line
        border.width: root.activeFocus ? 1.6 : 1
    }
}
