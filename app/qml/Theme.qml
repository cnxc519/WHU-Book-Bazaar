pragma Singleton
import QtQuick

// 全局主题：清新绿主色调 + 渐变 + 阴影，简洁卡片风格
QtObject {
    readonly property color primary: "#00A87E"
    readonly property color primaryDark: "#00875F"
    readonly property color primaryLight: "#34C79C"
    readonly property color primarySoft: "#E3F7EF"
    readonly property color accent: "#FFB800"
    readonly property color bg: "#F4F6F8"
    readonly property color card: "#FFFFFF"
    readonly property color text: "#1F2329"
    readonly property color textSub: "#7A8088"
    readonly property color textLight: "#A6ABB3"
    readonly property color line: "#EDEFF2"
    readonly property color danger: "#E5484D"
    readonly property color dangerSoft: "#FDE8E9"
    readonly property color warning: "#B26A00"
    readonly property color warningSoft: "#FFF3E0"
    readonly property color blue: "#1F6FC9"
    readonly property color blueSoft: "#E8F1FD"

    readonly property int radiusCard: 16
    readonly property int radiusBtn: 12
    readonly property int spacing: 12
    readonly property int pagePadding: 16

    // 主渐变（按钮 / 品牌区）
    readonly property Gradient brandGradient: Gradient {
        GradientStop { position: 0.0; color: "#00B893" }
        GradientStop { position: 1.0; color: "#00875F" }
    }

    // 页面底色渐变（列表页整页使用，比纯灰更有呼吸感）
    readonly property Gradient pageGradient: Gradient {
        GradientStop { position: 0.0; color: "#FAFCFA" }
        GradientStop { position: 1.0; color: "#EDF3EF" }
    }

    // 卡片阴影颜色（用于 MultiEffect dropShadow）
    readonly property color shadowColor: Qt.rgba(0, 0, 0, 0.08)
    readonly property color shadowColorStrong: Qt.rgba(0, 0, 0, 0.12)
}
