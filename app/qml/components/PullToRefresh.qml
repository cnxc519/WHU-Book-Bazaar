import QtQuick
import QtQuick.Controls

// 下拉刷新：作为 ListView 的 header 使用
//   header: PullToRefresh { onRefresh: function() { page.load(true) } }
// 刷新完成后在加载回调里调用 id.finish()（不调用会在 4 秒后自动复位兜底）
Item {
    id: root

    // 刷新回调（拉过阈值松手时触发一次）
    property var onRefresh: null
    // 触发阈值（px）
    readonly property int threshold: 50
    // 当前状态
    property bool refreshing: false
    property real pullDist: 0

    // header 的 parent 是 ListView 的 contentItem，contentItem 的 parent 即 ListView；
    // 直接放在 Flickable 的 Column 里时 parent.parent 同样是那个 Flickable。
    // 个别页面自动推导解析不到时，可显式传 lv（如 TabBookSell 的 lv: sellFlick）
    property var lv: parent ? parent.parent : null
    // ListView 有 topMargin（顶部留白计入 contentY），Flickable 没有
    readonly property real topInset: (lv && lv.topMargin !== undefined) ? lv.topMargin : 0

    width: parent ? parent.width : 1
    height: refreshing ? 48 : pullDist
    visible: height > 6

    onLvChanged: {
        // lv 必须是 ListView/Flickable：创建过程中 parent 可能短暂是别的 Item，
        // 没有 contentYChanged 信号就先不挂（onLvChanged 会在 parent 就位后再触发）
        if (!lv || lv.contentYChanged === undefined) {
            return
        }

        // 拖动中跟随下拉距离（contentY 低于 -topInset 的部分即下拉量）
        lv.contentYChanged.connect(function () {
            if (lv.dragging && !root.refreshing)
                root.pullDist = Math.max(0, -(lv.contentY + root.topInset))
        })
        // 松手：超阈值触发刷新，否则复位（DragAndOvershootBounds 松手即回弹，contentY 归位）
        lv.dragEnded.connect(function () {
            if (!root.refreshing && root.pullDist > root.threshold) {
                root.refreshing = true
                autoReset.restart()
                if (root.onRefresh) root.onRefresh()
            } else {
                root.pullDist = 0
            }
        })
    }

    // 兜底：页面刷新失败未调用 finish() 时自动复位，避免转圈卡死
    Timer {
        id: autoReset
        interval: 4000
        onTriggered: root.finish()
    }

    function finish() {
        refreshing = false
        pullDist = 0
    }

    Column {
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: 6
        spacing: 0
        BusyIndicator {
            anchors.horizontalCenter: parent.horizontalCenter
            width: 30; height: 30
            running: root.refreshing
            visible: root.refreshing
        }
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: root.refreshing ? "刷新中..." : (root.pullDist > root.threshold ? "松开刷新" : "下拉刷新")
            color: "#A6ABB3"
            font.pixelSize: 11
        }
    }
}
