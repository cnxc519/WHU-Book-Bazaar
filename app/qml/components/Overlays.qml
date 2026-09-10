import QtQuick
import QtQuick.Controls
import ".." as Root

// 全局覆盖层集合：Toast / 确认弹窗 / 加载遮罩
// Main.qml 实例化一份，并注册到 js/ui.js

Item {
    id: root
    anchors.fill: parent

    // ---------- Toast ----------
    Rectangle {
        id: toastBox
        visible: false
        anchors.horizontalCenter: parent.horizontalCenter
        y: 60
        z: 100
        radius: 10
        color: Qt.rgba(0, 0, 0, 0.78)
        width: Math.min(toastText.implicitWidth + 36, root.width - 48)
        height: toastText.implicitHeight + 20
        Text {
            id: toastText
            anchors.centerIn: parent
            text: ""
            color: "#FFFFFF"
            font.pixelSize: 14
            wrapMode: Text.Wrap
            width: parent.width - 24
            horizontalAlignment: Text.AlignHCenter
        }
    }
    Timer {
        id: toastTimer
        interval: 2200
        repeat: false
        onTriggered: toastBox.visible = false
    }

    function showToast(msg) {
        toastText.text = msg
        toastBox.visible = true
        toastBox.opacity = 1
        toastTimer.restart()
    }

    // ---------- 确认弹窗 ----------
    // 自绘弹层：QQC Dialog 的尺寸依赖 contentItem 的 implicit 尺寸，遇到自绘控件
    // （无 implicitWidth）会坍缩成不可见/极小白块，且受平台样式影响，故全部显式布局。
    property var confirmCb: null
    Rectangle {
        id: confirmMask
        objectName: "confirmMask"
        anchors.fill: parent
        visible: false
        color: Qt.rgba(0, 0, 0, 0.35)
        // 拦截弹窗外点击，防止穿透到下层页面
        MouseArea { anchors.fill: parent; onClicked: {} }
        Rectangle {
            objectName: "confirmCard"
            anchors.centerIn: parent
            width: Math.min(320, parent.width - 60)
            height: confirmCol.implicitHeight + 44
            radius: 16
            color: "#FFFFFF"
            Column {
                id: confirmCol
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.leftMargin: 20
                anchors.rightMargin: 20
                spacing: 14
                Text {
                    text: confirmTitle.text
                    font.pixelSize: 17
                    font.weight: Font.Medium
                    color: Root.Theme.text
                    wrapMode: Text.Wrap
                    width: parent.width
                }
                Text {
                    text: confirmBody.text
                    font.pixelSize: 14
                    color: Root.Theme.textSub
                    wrapMode: Text.Wrap
                    width: parent.width
                    lineHeight: 1.45
                }
                Row {
                    spacing: 10
                    width: parent.width
                    AppButton {
                        text: confirmCancel.text
                        variant: "ghost"
                        heightPx: 40
                        width: (parent.width - 10) / 2
                        onClicked: { confirmMask.visible = false; if (root.confirmCb) root.confirmCb(false) }
                    }
                    AppButton {
                        text: confirmOk.text
                        variant: confirmDanger.value
                        heightPx: 40
                        width: (parent.width - 10) / 2
                        onClicked: { confirmMask.visible = false; if (root.confirmCb) root.confirmCb(true) }
                    }
                }
            }
        }
    }
    property var confirmTitle: QtObject { property string text: "提示" }
    property var confirmBody: QtObject { property string text: "" }
    property var confirmOk: QtObject { property string text: "确定" }
    property var confirmCancel: QtObject { property string text: "取消" }
    property var confirmDanger: QtObject { property bool value: false }

    function showConfirm(opts, cb) {
        confirmTitle.text = opts.title || "提示"
        confirmBody.text = opts.text || ""
        confirmOk.text = opts.okText || "确定"
        confirmCancel.text = opts.cancelText || "取消"
        confirmDanger.value = !!opts.danger
        confirmCb = cb
        confirmMask.visible = true
    }

    // ---------- 文本输入弹窗 ----------
    property var inputCb: null
    Rectangle {
        id: inputMask
        objectName: "inputMask"
        anchors.fill: parent
        visible: false
        color: Qt.rgba(0, 0, 0, 0.35)
        MouseArea { anchors.fill: parent; onClicked: {} }
        Rectangle {
            objectName: "inputCard"
            anchors.centerIn: parent
            width: Math.min(340, parent.width - 48)
            height: inputCol.implicitHeight + 44
            radius: 16
            color: "#FFFFFF"
            Column {
                id: inputCol
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.leftMargin: 20
                anchors.rightMargin: 20
                spacing: 12
                Text {
                    text: inputTitle.text
                    font.pixelSize: 16
                    font.weight: Font.Medium
                    color: Root.Theme.text
                    wrapMode: Text.Wrap
                    width: parent.width
                }
                TextField {
                    id: inputField
                    width: parent.width
                    height: 46
                    padding: 12
                    placeholderText: inputHint.text
                    font.pixelSize: 14
                    color: Root.Theme.text
                    // 部分安卓 ROM 首次聚焦的弹键盘请求会被吞掉，显式拉起兜底
                    onActiveFocusChanged: if (activeFocus) Qt.inputMethod.show()
                    background: Rectangle {
                        radius: 10
                        color: "#F5F6F8"
                        border.color: "#D9DDE3"
                    }
                }
                Row {
                    spacing: 10
                    width: parent.width
                    AppButton {
                        text: "取消"
                        variant: "ghost"
                        heightPx: 40
                        width: (parent.width - 10) / 2
                        onClicked: { inputMask.visible = false; if (root.inputCb) root.inputCb("") }
                    }
                    AppButton {
                        text: "确定"
                        heightPx: 40
                        width: (parent.width - 10) / 2
                        onClicked: {
                            var v = inputField.text.trim()
                            inputMask.visible = false
                            if (root.inputCb) root.inputCb(v)
                        }
                    }
                }
            }
        }
    }
    property var inputTitle: QtObject { property string text: "请输入" }
    property var inputHint: QtObject { property string text: "" }

    function showInput(opts, cb) {
        inputTitle.text = opts.title || "请输入"
        inputHint.text = opts.hint || ""
        inputField.text = ""
        inputCb = cb
        inputMask.visible = true
        inputField.forceActiveFocus()
    }

    // ---------- 加载遮罩 ----------
    Rectangle {
        id: loadingBox
        anchors.fill: parent
        color: Qt.rgba(0, 0, 0, 0.35)
        visible: false
        z: 200
        Rectangle {
            anchors.centerIn: parent
            width: 96
            height: 96
            radius: 16
            color: "#FFFFFF"
            BusyIndicator { anchors.centerIn: parent; running: loadingBox.visible }
            Text {
                anchors.bottom: parent.bottom
                anchors.bottomMargin: 12
                anchors.horizontalCenter: parent.horizontalCenter
                text: loadingText.text
                color: Root.Theme.textSub
                font.pixelSize: 12
            }
        }
    }
    property var loadingText: QtObject { property string text: "" }

    // Android 返回键联动：是否有可见弹层 + 逐层关闭（确认/输入回调以"取消"收尾）
    function anyVisible() {
        return confirmMask.visible || inputMask.visible || loadingBox.visible
    }
    function closeTop() {
        if (confirmMask.visible) {
            confirmMask.visible = false
            if (root.confirmCb) { var cb = root.confirmCb; root.confirmCb = null; cb(false) }
        } else if (inputMask.visible) {
            inputMask.visible = false
            if (root.inputCb) { var cb2 = root.inputCb; root.inputCb = null; cb2("") }
        }
        loadingBox.visible = false
    }

    function showLoading(show, text) {
        loadingText.text = text || "加载中..."
        loadingBox.visible = !!show
    }
}
