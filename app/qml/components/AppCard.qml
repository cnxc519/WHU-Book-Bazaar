import QtQuick
import QtQuick.Effects
import ".." as Root

// 卡片容器（带柔和阴影与按压反馈）；color 可覆盖背景色，阴影随卡片内容自动
Item {
    id: root
    property color color: Root.Theme.card
    property bool tappable: false
    signal clicked()

    // 阴影
    MultiEffect {
        anchors.fill: parent
        source: cardRect
        shadowEnabled: true
        shadowColor: Root.Theme.shadowColor
        shadowBlur: 0.35
        shadowVerticalOffset: 2
        visible: root.visible
    }

    Rectangle {
        id: cardRect
        anchors.fill: parent
        radius: Root.Theme.radiusCard
        color: root.color
        scale: root.tappable && cardMouse.pressed ? 0.985 : 1.0
        Behavior on scale { NumberAnimation { duration: 100 } }

        MouseArea {
            id: cardMouse
            anchors.fill: parent
            visible: root.tappable
            onClicked: root.clicked()
        }
    }
}
