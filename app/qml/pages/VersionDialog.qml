import QtQuick
import LeLeBook 1.0
import ".." as Root
import "../js/ui.js" as Ui
import "../js/api.js" as Api
import "../components"

// 版本更新弹窗
// Android：应用内下载（流式落盘）→ FileProvider 调起安装；失败可转浏览器下载
// 桌面端：Updater 只支持 Android 安装，直接提供「打开下载地址」由浏览器下载
// 强制更新不可关闭（只有退出应用）
Item {
    id: page
    visible: false
    property var info: null
    property bool forced: false
    property string status: "idle" // idle | downloading | ready | error
    readonly property bool isAndroid: Qt.platform.os === "android"

    Rectangle {
        anchors.fill: parent
        color: Qt.rgba(0, 0, 0, 0.5)
        visible: page.visible
        // 遮罩必须挡住穿透点击：否则"需要更新才能继续使用"弹窗底下还能操作页面，
        // 观感很怪。非强制更新点遮罩等同于"稍后再说"，强制的只拦截不放行
        MouseArea {
            anchors.fill: parent
            enabled: page.visible
            onClicked: if (!page.forced) page.hide()
        }
    }

    function show(v, isForced) {
        page.info = v
        page.forced = isForced
        page.status = "idle"
        page.dlUrl = "" // 每次弹窗重新换取一次性下载链接（10 分钟有效）
        page.visible = true
    }
    function hide() { page.visible = false }

    property string dlUrl: "" // 一次性签名下载地址

    // 解析可用的下载地址：管理后台填了完整外链直接用；
    // 本地 APK 路径则向服务器换取一次性签名链接（/dl/apk），避免公开直链暴露服务器入口
    function ensureDlUrl(cb) {
        if (page.dlUrl) { cb(page.dlUrl); return }
        var u = page.info ? (page.info.url || "") : ""
        if (u.indexOf("http://") === 0 || u.indexOf("https://") === 0) { cb(u); return }
        Api.get("/api/apk-dl-url").then(function (d) {
            page.dlUrl = d.url
            cb(Session.baseUrl + d.url)
        }).catch(function (e) { Ui.toast(e.msg) })
    }

    function startDownload() {
        if (page.status === "downloading") return
        page.status = "downloading"
        ensureDlUrl(function (u) {
            page.dlUrl = u
            Updater.start(u)
        })
    }

    Connections {
        target: Updater
        function onProgressChanged() {
            // 进度/状态文本由属性绑定实时显示
        }
        function onFinished() {
            // 下载完成不自动安装也不自动关弹窗：装到一半失败时弹窗已消失会无从下手，
            // 停在「点击安装」状态由用户主动触发，失败也有 toast + 浏览器兜底
            page.status = "ready"
        }
        function onFailed(msg) {
            page.status = page.isAndroid ? "error" : "idle"
            Ui.toast(msg)
        }
    }

    Rectangle {
        anchors.centerIn: parent
        width: 310
        height: dlgCol.implicitHeight + 40 // 上下 padding 20×2；此前无高度 → 白底不可见、内容溢出成"透明弹窗"
        radius: 16
        color: "#FFFFFF"
        visible: page.visible
        clip: false

        Column {
            id: dlgCol
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.margins: 20
            spacing: 12

            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                text: page.forced ? "需要更新才能继续使用" : "发现新版本"
                font.pixelSize: 17
                font.weight: Font.Bold
                color: Root.Theme.text
            }
            Text {
                anchors.horizontalCenter: parent.horizontalCenter
                visible: page.info && page.info.code > 0
                text: page.info ? ("新版本 v" + page.info.code + " · 当前 v" + Session.appVersionCode) : ""
                font.pixelSize: 12
                color: Root.Theme.primaryDark
                font.weight: Font.Medium
            }
            Text {
                width: parent.width
                text: page.info ? (page.info.note || "新版本已发布，建议尽快更新。") : ""
                color: Root.Theme.textSub
                font.pixelSize: 13
                wrapMode: Text.Wrap
                lineHeight: 1.5
            }

            // 下载进度（仅 Android 应用内下载时出现）
            Column {
                width: parent.width
                visible: page.isAndroid && (page.status === "downloading" || page.status === "ready")
                spacing: 6
                Rectangle {
                    width: parent.width
                    height: 6
                    radius: 3
                    color: "#E9EBEF"
                    Rectangle {
                        width: parent.width * Updater.progress
                        height: 6
                        radius: 3
                        color: Root.Theme.primary
                    }
                }
                Text {
                    text: Updater.statusText
                    color: Root.Theme.textSub
                    font.pixelSize: 11
                }
            }
            Text {
                width: parent.width
                visible: page.isAndroid && page.status === "error"
                text: "应用内下载失败，请使用下方「浏览器下载」安装。"
                color: Root.Theme.danger
                font.pixelSize: 12
                wrapMode: Text.Wrap
            }

            // Android：应用内下载并安装
            AppButton {
                width: parent.width
                anchors.horizontalCenter: parent.horizontalCenter
                visible: page.isAndroid
                text: page.status === "downloading" ? "下载中..." : page.status === "ready" ? "点击安装" : "立即更新"
                busyText: "下载中..."
                busy: page.status === "downloading"
                enabled: page.status !== "downloading"
                onClicked: {
                    if (page.status === "ready") {
                        Updater.install()
                    } else {
                        page.startDownload()
                    }
                }
            }
            // Android 安装前提示
            Text {
                width: parent.width
                anchors.horizontalCenter: parent.horizontalCenter
                text: "首次安装新版本时系统会提示「允许安装未知应用」，请选择允许。"
                color: Root.Theme.textLight
                font.pixelSize: 10
                wrapMode: Text.Wrap
                visible: page.isAndroid && page.status === "ready"
            }

            // 桌面端 / Android 下载失败兜底：打开推广落地页（含安装指引，地址随 /api/version 下发），
            // 不再暴露带 IP:端口的签名直链
            AppButton {
                width: parent.width
                anchors.horizontalCenter: parent.horizontalCenter
                visible: !page.isAndroid || page.status === "error"
                text: page.isAndroid ? "浏览器下载" : "打开下载地址"
                onClicked: {
                    var landing = (page.info && page.info.dl_page) ? page.info.dl_page : (Session.baseUrl + "/d")
                    Qt.openUrlExternally(landing)
                    if (!page.forced) page.hide()
                }
            }
            AppButton {
                width: parent.width
                anchors.horizontalCenter: parent.horizontalCenter
                visible: !page.forced
                text: "稍后再说"
                variant: "ghost"
                onClicked: page.hide()
            }
            AppButton {
                width: parent.width
                anchors.horizontalCenter: parent.horizontalCenter
                visible: page.forced
                text: "退出应用"
                variant: "ghost"
                onClicked: Qt.quit()
            }
        }
    }
}
