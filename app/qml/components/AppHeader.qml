import QtQuick
import ".." as Root

// 页面顶部栏：返回 + 标题 + 右侧操作（支持品牌渐变背景）
Item {
    id: root
    property string title: ""
    property bool showBack: false
    property string rightText: ""
    property bool gradientBg: false
    signal backClicked()
    signal rightClicked()

    height: 52
    // 宽度必须显式绑定：本组件总被放在页面的 Column 里，Column 只做纵向排布不会拉伸子项，
    // 不绑宽度则根宽度为 0，返回键和标题整体塌缩不可见
    width: parent.width

    Rectangle {
        anchors.fill: parent
        visible: root.gradientBg
        gradient: Root.Theme.brandGradient
        // 装饰光斑：让渐变头部更有质感
        Rectangle {
            width: 190; height: 190; radius: 95
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.rightMargin: -30
            anchors.topMargin: -70
            color: "#12FFFFFF"
        }
        Rectangle {
            width: 120; height: 120; radius: 60
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.rightMargin: 40
            anchors.topMargin: -50
            color: "#0DFFFFFF"
        }
    }

    Row {
        anchors.fill: parent
        leftPadding: 4
        rightPadding: 8
        spacing: 4

        // 返回键：圆形浅底 + 大号 ‹（作为 Row 流内元素占位，标题自然排到其后，
        // 不可用锚点定位——Row 内锚定子项会被排除出流导致与标题重叠）
        Rectangle {
            id: backBtn
            visible: root.showBack
            width: 44; height: 44
            radius: 22
            color: root.gradientBg ? "#22FFFFFF" : "#FFFFFF"
            border.width: root.gradientBg ? 0 : 1
            border.color: Root.Theme.line
            Text {
                anchors.centerIn: parent
                text: "‹"
                font.pixelSize: 24
                font.weight: Font.Medium
                color: root.gradientBg ? "#FFFFFF" : Root.Theme.primaryDark
                anchors.verticalCenterOffset: -1
            }
            MouseArea {
                anchors.fill: parent
                onClicked: root.backClicked()
            }
        }

        Text {
            id: titleText
            anchors.verticalCenter: parent.verticalCenter
            text: root.title
            font.pixelSize: 18
            font.weight: Font.Medium
            color: root.gradientBg ? "#FFFFFF" : Root.Theme.text
            elide: Text.ElideRight
            width: parent.width - backBtn.width - rightBtn.width - 16
        }

        AppButton {
            id: rightBtn
            visible: root.rightText.length > 0
            width: 64; height: 44
            variant: root.gradientBg ? "clear" : "ghost"
            text: root.rightText
            heightPx: 44
            anchors.verticalCenter: parent.verticalCenter
            onClicked: root.rightClicked()
        }
    }
}
