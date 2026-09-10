import QtQuick
import ".." as Root

// 主按钮：primary（渐变）/ secondary / ghost / danger，带按压反馈
Rectangle {
    id: root
    property string text: ""
    property string busyText: "处理中..." // busy 时展示的文案，可按场景覆盖（如"下载中..."）
    property string variant: "primary" // primary | secondary | ghost | danger
    property bool enabled: true
    property bool busy: false
    property int heightPx: 46
    signal clicked()

    width: parent ? parent.width : 0
    height: root.heightPx
    radius: Root.Theme.radiusBtn
    color: !enabled ? "#E4E7EB" :
           variant === "primary" ? "transparent" :
           variant === "secondary" ? Root.Theme.primarySoft :
           variant === "danger" ? Root.Theme.danger :
           variant === "clear" ? "transparent" :
           "#EEF0F3"

    // 主按钮渐变
    gradient: (!enabled || variant !== "primary") ? undefined : Root.Theme.brandGradient
    scale: btnMouse.pressed ? 0.97 : 1.0
    Behavior on scale { NumberAnimation { duration: 90 } }

    Text {
        anchors.centerIn: parent
        text: root.busy ? root.busyText : root.text
        color: !enabled ? "#A6ABB3" :
               variant === "primary" || variant === "danger" ? "#FFFFFF" :
               variant === "secondary" ? Root.Theme.primaryDark :
               variant === "clear" ? "#FFFFFF" : "#33383F"
        font.pixelSize: 16
        font.weight: Font.Medium
    }

    MouseArea {
        id: btnMouse
        anchors.fill: parent
        enabled: root.enabled && !root.busy
        onClicked: root.clicked()
    }
}
