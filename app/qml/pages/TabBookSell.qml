import QtQuick
import LeLeBook 1.0
import QtQuick.Controls
import QtQuick.Dialogs
import ".." as Root
import "../js/util.js" as Util
import "../js/api.js" as Api
import "../js/ui.js" as Ui
import "../components"

// 书市模式·卖书：发布闲置书（书名/课程/成色/价格/封面）+ 我的书管理（上下架/标记已售）
Item {
    id: page
    property var app: null
    property var myBooks: []
    property var _unsubs: null // Realtime 订阅注销函数列表

    Flickable {
        id: sellFlick
        anchors.fill: parent
        contentHeight: col.implicitHeight + 140
        clip: true
        boundsBehavior: Flickable.DragAndOvershootBounds

        Column {
            id: col
            width: parent.width - 32
            anchors.horizontalCenter: parent.horizontalCenter
            y: 12
            spacing: 14

            // 顶部下拉刷新（本页是表单+列表混合页，借助 Flickable 顶部下拉触发）
            PullToRefresh {
                id: pullRef
                lv: sellFlick // 显式指定：此处自动推导（parent.parent）解析不到 Flickable
                width: col.width
                onRefresh: function () { page.loadMine() }
            }

            // ---------- 发布区 ----------
            AppCard {
                width: parent.width
                height: form.implicitHeight + 24
                Column {
                    id: form
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 14
                    spacing: 12

                    Text {
                        text: "发布闲置书"
                        font.pixelSize: 17
                        font.weight: Font.Bold
                        color: Root.Theme.text
                    }

                    // 发布方式切换：单本逐个填 / 一摞书拍一张照批量发
                    Row {
                        spacing: 8
                        Repeater {
                            model: [{ v: 0, l: "📖 单本发布" }, { v: 1, l: "📚 批量发书" }]
                            delegate: Rectangle {
                                height: 32
                                width: segTxt.implicitWidth + 24
                                radius: 16
                                color: page.postMode === modelData.v ? Root.Theme.primary : "#F0F1F3"
                                Text {
                                    id: segTxt
                                    anchors.centerIn: parent
                                    text: modelData.l
                                    font.pixelSize: 12
                                    font.weight: page.postMode === modelData.v ? Font.Bold : Font.Normal
                                    color: page.postMode === modelData.v ? "#FFFFFF" : Root.Theme.textSub
                                }
                                MouseArea {
                                    anchors.fill: parent
                                    onClicked: page.postMode = modelData.v
                                }
                            }
                        }
                    }

                    Text {
                        visible: page.postMode === 1
                        width: parent.width
                        text: "把要卖的书放一起拍一张照，AI 帮你认出书名，核对后一次全部上架；价格可以写一句描述（如：左边10r/本，右边20r/本）。"
                        color: Root.Theme.textSub
                        font.pixelSize: 11
                        wrapMode: Text.Wrap
                        lineHeight: 1.45
                    }

                    // ---------- 单本表单 ----------
                    Column {
                        id: singleCol
                        visible: page.postMode === 0
                        width: parent.width
                        spacing: 12

                    // 书名
                    Column {
                        width: parent.width
                        spacing: 8
                        Text { text: "书名（必填，1-40 字）"; color: Root.Theme.textSub; font.pixelSize: 12 }
                        AppInput { id: titleInput; hint: "例如：高等数学（第七版）下册 同济版" }
                    }

                    // 新旧程度
                    Column {
                        width: parent.width
                        spacing: 8
                        Text { text: "新旧程度（选填）"; color: Root.Theme.textSub; font.pixelSize: 12 }
                        Flow {
                            width: parent.width
                            spacing: 8
                            Repeater {
                                model: [{ v: 0, l: "不选" }, { v: 1, l: "全新未使用" }, { v: 2, l: "几乎全新" }, { v: 3, l: "有笔记划线" }, { v: 4, l: "使用痕迹较多" }]
                                delegate: Rectangle {
                                    height: 32
                                    width: txt.implicitWidth + 14
                                    radius: 16
                                    color: page.cond === modelData.v ? Root.Theme.primary : "#F0F1F3"
                                    Text {
                                        id: txt
                                        anchors.centerIn: parent
                                        text: modelData.l
                                        font.pixelSize: 11
                                        color: page.cond === modelData.v ? "#FFFFFF" : Root.Theme.textSub
                                    }
                                    MouseArea {
                                        anchors.fill: parent
                                        onClicked: page.cond = modelData.v
                                    }
                                }
                            }
                        }
                    }

                    // 价格
                    Column {
                        width: parent.width
                        spacing: 8
                        Text { text: "期望价格（必填）"; color: Root.Theme.textSub; font.pixelSize: 12 }
                        Row {
                            width: parent.width
                            spacing: 10
                            Rectangle {
                                width: 52; height: 48
                                radius: Root.Theme.radiusBtn
                                color: Root.Theme.primarySoft
                                Text { anchors.centerIn: parent; text: "¥"; font.pixelSize: 18; font.weight: Font.Bold; color: Root.Theme.primaryDark }
                            }
                            AppInput {
                                id: priceInput
                                width: parent.width - 62
                                hint: "如 15（0.01-999.99 元，见面一手交钱一手交书）"
                                onTextChanged: {
                                    var v = priceInput.text.replace(/[^0-9.]/g, '')
                                    if (v.split('.').length > 2) v = v.slice(0, v.length - 1)
                                    if (v !== priceInput.text) priceInput.text = v
                                }
                            }
                        }
                        Row {
                            spacing: 8
                            Repeater {
                                model: ["5", "10", "15", "20", "30"]
                                delegate: Rectangle {
                                    height: 28
                                    width: chipTxt.implicitWidth + 16
                                    radius: 14
                                    color: Root.Theme.primarySoft
                                    Text {
                                        id: chipTxt
                                        anchors.centerIn: parent
                                        text: "¥" + modelData
                                        font.pixelSize: 11
                                        color: Root.Theme.primaryDark
                                    }
                                    MouseArea {
                                        anchors.fill: parent
                                        onClicked: priceInput.text = modelData
                                    }
                                }
                            }
                            Text {
                                anchors.verticalCenter: parent.verticalCenter
                                text: "元"
                                color: Root.Theme.textLight
                                font.pixelSize: 11
                            }
                        }
                    }

                    // 交易地点（必填：线下交书面交用）
                    Column {
                        width: parent.width
                        spacing: 8
                        Text { text: "交易地点（必填）"; color: Root.Theme.textSub; font.pixelSize: 12 }
                        AppInput {
                            id: locationInput
                            width: parent.width
                            hint: "当面交书的地点，例如：樱园教学楼南门"
                        }
                    }

                    // ---------- 选填折叠区（课程/说明/封面默认收起，发布页更清爽） ----------
                    Rectangle {
                        width: parent.width
                        height: 36
                        radius: 10
                        color: "#F5F7F8"
                        Row {
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.left: parent.left
                            anchors.leftMargin: 12
                            spacing: 6
                            Text {
                                text: page.extraOpen ? "收起选填项 ▲" : "展开填写选填（课程 · 说明 · 封面照片）▼"
                                font.pixelSize: 12
                                color: Root.Theme.textSub
                            }
                            Text {
                                visible: page.photoFile !== ""
                                anchors.verticalCenter: parent.verticalCenter
                                text: "· 已选封面"
                                font.pixelSize: 12
                                color: Root.Theme.primary
                            }
                        }
                        MouseArea { anchors.fill: parent; onClicked: page.extraOpen = !page.extraOpen }
                    }

                    Column {
                        width: parent.width
                        visible: page.extraOpen
                        spacing: 12

                        // 课程名（选修该课的可直接搜到）
                        Column {
                            width: parent.width
                            spacing: 8
                            Text { text: "对应课程（选填）"; color: Root.Theme.textSub; font.pixelSize: 12 }
                            AppInput { id: courseInput; hint: "例如：大学英语 / 电路分析基础" }
                        }

                        // 补充说明
                        Column {
                            width: parent.width
                            spacing: 8
                            Text { text: "补充说明（选填，≤300 字）"; color: Root.Theme.textSub; font.pixelSize: 12 }
                            AppTextArea {
                                id: noteInput
                                width: parent.width
                                height: 70
                                hint: "例如：原价 60+，重点笔记齐全，无缺页；南门宿舍可面交"
                            }
                        }

                        // 封面图
                        Column {
                            width: parent.width
                            spacing: 8
                            Text { text: "封面照片（选填，一张；建议拍清书名）"; color: Root.Theme.textSub; font.pixelSize: 12 }
                            Row {
                                width: parent.width
                                spacing: 10
                                Rectangle {
                                    width: 84; height: 104
                                    radius: 10
                                    color: photoFile ? "transparent" : "#F0F1F3"
                                    border.color: Root.Theme.line
                                    clip: true
                                    Image {
                                        anchors.fill: parent
                                        visible: page.photoFile
                                        source: page.photoFile
                                        fillMode: Image.PreserveAspectCrop
                                    }
                                    Column {
                                        anchors.centerIn: parent
                                        visible: !page.photoFile
                                        spacing: 4
                                        Text { text: "📷"; font.pixelSize: 22 }
                                        Text { text: "加封面"; color: Root.Theme.textLight; font.pixelSize: 10 }
                                    }
                                    MouseArea {
                                        anchors.fill: parent
                                        onClicked: page.pickPhoto(null)
                                    }
                                }
                                Column {
                                    anchors.verticalCenter: parent.verticalCenter
                                    spacing: 4
                                    Text { text: page.photoFile ? "已选择封面，发布时一并上传" : "选一张封面，书市里更醒目"; color: Root.Theme.textSub; font.pixelSize: 11; wrapMode: Text.Wrap; width: parent.width }
                                    Rectangle {
                                        width: 72; height: 28
                                        radius: 14
                                        color: page.photoFile ? Root.Theme.dangerSoft : "#EEF0F3"
                                        visible: page.photoFile
                                        Text { anchors.centerIn: parent; text: "移除"; color: page.photoFile ? Root.Theme.danger : Root.Theme.textLight; font.pixelSize: 11 }
                                        MouseArea {
                                            anchors.fill: parent
                                            onClicked: page.photoFile = ""
                                        }
                                    }
                                }
                            }
                        }
                    }

                    AppButton {
                        width: parent.width
                        text: "发布到书市"
                        busy: page.publishing
                        busyText: "发布中..."
                        onClicked: page.publish()
                    }
                    } // 单本表单

                    // ---------- 批量发书 ----------
                    Column {
                        visible: page.postMode === 1
                        width: parent.width
                        spacing: 12

                        // 合照
                        Column {
                            width: parent.width
                            spacing: 8
                            Text { text: "合照（必选，一张）"; color: Root.Theme.textSub; font.pixelSize: 12 }
                            Row {
                                width: parent.width
                                spacing: 10
                                Rectangle {
                                    width: 120; height: 90
                                    radius: 10
                                    color: page.batchCover ? "transparent" : "#F0F1F3"
                                    border.color: Root.Theme.line
                                    clip: true
                                    Image {
                                        anchors.fill: parent
                                        visible: page.batchCover
                                        source: page.batchCover
                                        fillMode: Image.PreserveAspectCrop
                                    }
                                    Column {
                                        anchors.centerIn: parent
                                        visible: !page.batchCover
                                        spacing: 4
                                        Text { text: "📷"; font.pixelSize: 22 }
                                        Text { text: "拍合照"; color: Root.Theme.textLight; font.pixelSize: 10 }
                                    }
                                    MouseArea { anchors.fill: parent; onClicked: page.pickBatchPhoto() }
                                }
                                Column {
                                    width: parent.width - 130
                                    anchors.verticalCenter: parent.verticalCenter
                                    spacing: 8
                                    Text {
                                        width: parent.width
                                        text: "把要卖的书放一起拍一张，尽量让每个书名都拍清晰。这张照片会同时作为每本书的封面。"
                                        color: Root.Theme.textSub
                                        font.pixelSize: 11
                                        wrapMode: Text.Wrap
                                        lineHeight: 1.45
                                    }
                                    Rectangle {
                                        height: 34
                                        width: aiTxt.implicitWidth + 28
                                        radius: 17
                                        color: page.batchAiImg ? Root.Theme.primary : "#E4E7EC"
                                        Text {
                                            id: aiTxt
                                            anchors.centerIn: parent
                                            text: "🤖 AI 识别书名"
                                            font.pixelSize: 12
                                            font.weight: Font.Bold
                                            color: page.batchAiImg ? "#FFFFFF" : Root.Theme.textSub
                                        }
                                        MouseArea { anchors.fill: parent; onClicked: page.batchAnalyze() }
                                    }
                                }
                            }
                        }

                        // 书名列表（AI 识别结果可增删改）
                        Column {
                            width: parent.width
                            spacing: 8
                            Row {
                                width: parent.width
                                spacing: 8
                                Text {
                                    width: parent.width - 78
                                    text: "书名（识别后请核对，1-40 字）"
                                    color: Root.Theme.textSub
                                    font.pixelSize: 12
                                    anchors.verticalCenter: parent.verticalCenter
                                }
                                Rectangle {
                                    height: 26
                                    width: addTxt.implicitWidth + 18
                                    radius: 13
                                    color: Root.Theme.primarySoft
                                    anchors.verticalCenter: parent.verticalCenter
                                    Text {
                                        id: addTxt
                                        anchors.centerIn: parent
                                        text: "+ 添加一本"
                                        font.pixelSize: 11
                                        color: Root.Theme.primaryDark
                                    }
                                    MouseArea { anchors.fill: parent; onClicked: page.batchTitles = page.batchTitles.concat([""]) }
                                }
                            }
                            Repeater {
                                model: page.batchTitles
                                delegate: Row {
                                    width: parent.width
                                    spacing: 8
                                    property int rowIdx: index
                                    AppInput {
                                        width: parent.width - 40
                                        height: 42
                                        font.pixelSize: 14
                                        text: modelData
                                        onTextChanged: {
                                            if (rowIdx >= 0 && rowIdx < page.batchTitles.length)
                                                page.batchTitles[rowIdx] = text
                                        }
                                    }
                                    Rectangle {
                                        width: 32; height: 42
                                        radius: 10
                                        color: "#F0F1F3"
                                        Text { anchors.centerIn: parent; text: "✕"; font.pixelSize: 14; color: Root.Theme.textSub }
                                        MouseArea {
                                            anchors.fill: parent
                                            onClicked: {
                                                var a = page.batchTitles.slice()
                                                a.splice(rowIdx, 1)
                                                page.batchTitles = a
                                            }
                                        }
                                    }
                                }
                            }
                            Text {
                                visible: page.batchTitles.length === 0
                                width: parent.width
                                text: "还没添加书：选好合照后点「AI 识别书名」自动认出，也可以「+ 添加一本」手动填。"
                                color: Root.Theme.textLight
                                font.pixelSize: 11
                                wrapMode: Text.Wrap
                            }
                        }

                        // 地点（共用）
                        Column {
                            width: parent.width
                            spacing: 8
                            Text { text: "交易地点（必填，所有书共用）"; color: Root.Theme.textSub; font.pixelSize: 12 }
                            AppInput { id: batchLocInput; hint: "当面交书的地点，例如：樱园教学楼南门" }
                        }

                        // 价格描述（共用，文字）
                        Column {
                            width: parent.width
                            spacing: 8
                            Text { text: "价格描述（必填，1-60 字，所有书共用）"; color: Root.Theme.textSub; font.pixelSize: 12 }
                            AppInput { id: batchPriceInput; hint: "例如：左边10r/本，右边20r/本" }
                            Text { text: "买家浏览和详情页都会看到这句话，按图中的方位写清楚即可"; color: Root.Theme.textLight; font.pixelSize: 11 }
                        }

                        AppButton {
                            width: parent.width
                            text: page.batchTitles.filter(function (t) { return t.trim() }).length + " 本全部发布"
                            onClicked: page.batchPublish()
                        }
                    }
                }
            }

            // ---------- 我的书 ----------
            Text {
                text: "我的书（" + page.myBooks.length + "）"
                font.pixelSize: 15
                font.weight: Font.Bold
                color: Root.Theme.text
            }

            NoticeBar {
                width: parent.width
                text: "「暂时下架」只是不再在书市展示，已联系的买家仍可继续沟通；「标记已售出」会把本书从书市删除。交易请当面进行，平台不参与。有买家第一次联系你时会发送邮件提醒。"
            }

            Repeater {
                model: page.myBooks
                delegate: AppCard {
                    width: parent.width
                    height: mineCol.implicitHeight + 22
                    Column {
                        id: mineCol
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.top: parent.top
                        anchors.margins: 11
                        spacing: 8

                        Row {
                            width: parent.width
                            spacing: 10
                            // 封面（点击可更换）
                            Rectangle {
                                width: 46; height: 58
                                radius: 8
                                color: modelData.photo ? "transparent" : Root.Theme.primarySoft
                                clip: true
                                Image {
                                    anchors.fill: parent
                                    visible: modelData.photo
                                    source: modelData.photo ? Session.baseUrl + "/files/books/" + modelData.id + ".jpg" : ""
                                    fillMode: Image.PreserveAspectCrop
                                }
                                Text { anchors.centerIn: parent; visible: !modelData.photo; text: "📖"; font.pixelSize: 20 }
                                MouseArea {
                                    anchors.fill: parent
                                    onClicked: page.pickPhoto(modelData.id)
                                }
                            }
                            Column {
                                width: parent.width - 56 - 10
                                spacing: 4
                                Row {
                                    width: parent.width
                                    spacing: 6
                                    Text {
                                        // Row 内子项禁止 right 等锚定，价格靠剩余宽度自然排到最右
                                        // 用 priceTxt.width（已限幅）而非 implicitWidth：长价格描述不会把标题挤没
                                        width: parent.width - 6 - priceTxt.width
                                        text: modelData.title
                                        font.pixelSize: 14
                                        font.weight: Font.Bold
                                        color: Root.Theme.text
                                        elide: Text.ElideRight
                                    }
                                    Text {
                                        id: priceTxt
                                        // 批量发的书 price_cents=0，价格位显示卖家的文字描述
                                        text: modelData.price_cents > 0 ? Util.yuan(modelData.price_cents) : (modelData.price_note || "价格面议")
                                        font.pixelSize: modelData.price_cents > 0 ? 15 : 12
                                        font.weight: Font.Bold
                                        color: Root.Theme.primary
                                        elide: Text.ElideRight
                                        width: Math.min(implicitWidth + 2, parent.width * 0.5)
                                    }
                                }
                                Row {
                                    width: parent.width
                                    spacing: 6
                                    TagBadge {
                                        text: modelData.status === "on" ? "在售" : modelData.status === "off" ? "已下架" : "已售出"
                                        fg: modelData.status === "on" ? Root.Theme.primaryDark : Root.Theme.textLight
                                        bg: modelData.status === "on" ? Root.Theme.primarySoft : "#EEF0F3"
                                    }
                                    TagBadge {
                                        visible: !!modelData.cond_cn
                                        text: modelData.cond_cn
                                        fg: Root.Theme.textSub
                                    }
                                    TagBadge {
                                        visible: modelData.unread_chats > 0
                                        text: "💬 " + modelData.unread_chats + " 条未读"
                                        fg: Root.Theme.danger
                                        bg: Root.Theme.dangerSoft
                                    }
                                    Text {
                                        width: parent.width - 250
                                        visible: !!modelData.location
                                        text: "📍 " + modelData.location
                                        font.pixelSize: 11
                                        color: Root.Theme.textSub
                                        elide: Text.ElideRight
                                    }
                                }
                            }
                        }

                        Row {
                            width: parent.width
                            spacing: 8
                            Rectangle {
                                height: 28
                                width: 84
                                radius: 14
                                color: Root.Theme.blueSoft
                                Text {
                                    anchors.centerIn: parent
                                    text: "查看详情"
                                    font.pixelSize: 12
                                    color: Root.Theme.blue
                                }
                                MouseArea {
                                    anchors.fill: parent
                                    onClicked: app.pushPage("BookDetailPage.qml", { bookId: modelData.id })
                                }
                            }
                            Rectangle {
                                height: 28
                                width: 84
                                radius: 14
                                color: Root.Theme.dangerSoft
                                visible: modelData.status === "on"
                                Text {
                                    anchors.centerIn: parent
                                    text: "标记已售出"
                                    font.pixelSize: 12
                                    color: Root.Theme.danger
                                }
                                MouseArea {
                                    anchors.fill: parent
                                    onClicked: page.setStatus(modelData, "sold")
                                }
                            }
                            Rectangle {
                                height: 28
                                width: 84
                                radius: 14
                                color: "#EEF0F3"
                                Text {
                                    anchors.centerIn: parent
                                    text: modelData.status === "off" ? "重新上架" : "暂时下架"
                                    font.pixelSize: 12
                                    color: Root.Theme.textSub
                                }
                                MouseArea {
                                    anchors.fill: parent
                                    onClicked: page.setStatus(modelData, modelData.status === "off" ? "on" : "off")
                                }
                            }
                        }
                    }
                }
            }

            EmptyState {
                width: parent.width
                visible: page.myBooks.length === 0
                text: "还没有发布书"
                subText: "在上面填写书名、课程和价格发布第一本吧"
            }
        }
    }

    property int cond: 0
    property string photoFile: ""
    property bool extraOpen: false // 发布表单的选填折叠区（课程/说明/封面）默认收起

    // 发布方式：0 单本 / 1 批量。默认批量——用户反馈"一摞书拍一张"是主流发书方式
    property int postMode: 1
    // 批量发书：合照两个版本（AI 识别用高清大图，封面用标准压缩图）+ 书名列表
    property string batchCover: ""
    property string batchAiImg: ""
    property var batchTitles: []
    // 待上传目标：single=单本新书封面 / cover=换已有书封面 / batch=批量合照
    property string pendingKind: ""

    function pickPhoto(bookId) {
        Ui.confirm({
            title: "选择封面照片",
            text: "建议拍清书名与封面。仅支持一张，自动压缩到 200KB 以内。",
            okText: "选择照片"
        }, function (ok) {
            if (!ok) return
            page.pendingUploadBook = bookId
            page.pendingKind = bookId ? "cover" : "single"
            photoDlg.open()
        })
    }
    property var pendingUploadBook: null

    // 批量发书：选合照（书名拍清晰）
    function pickBatchPhoto() {
        Ui.confirm({
            title: "选择合照",
            text: "把要卖的书放一起拍一张：尽量让每个书名都拍清晰、朝向镜头。这张照片会同时作为每本书的封面，AI 识别约需 20 秒。",
            okText: "选择照片"
        }, function (ok) {
            if (!ok) return
            page.pendingKind = "batch"
            photoDlg.open()
        })
    }

    // AI 识别合照里的书名（服务端转调 GLM 视觉，key 不落客户端）
    function batchAnalyze() {
        if (!page.batchAiImg) { Ui.toast("请先选合照"); return }
        var go = function () {
            Ui.loading(true, "图片识别处理中，约需 20 秒，请耐心等待...")
            Api.upload("/api/books/batch/analyze", page.batchAiImg, 120000).then(function (d) {
                Ui.loading(false)
                page.batchTitles = d.titles.map(function (t) { return t })
                Ui.toast("识别出 " + d.titles.length + " 本，请核对增删改")
            }).catch(function (e) {
                Ui.loading(false)
                Ui.toast(e.msg)
            })
        }
        var hasContent = page.batchTitles.some(function (t) { return t.trim() })
        if (hasContent) {
            Ui.confirm({
                title: "重新识别？",
                text: "识别结果会覆盖你现在填写的书名列表。",
                okText: "覆盖并识别"
            }, function (ok) { if (ok) go() })
        } else {
            go()
        }
    }

    function batchPublish() {
        var titles = page.batchTitles.map(function (t) { return t.trim() }).filter(function (t) { return t })
        if (!titles.length) { Ui.toast("请至少填写一个书名"); return }
        if (titles.length > 20) { Ui.toast("一次最多发布 20 本"); return }
        if (titles.some(function (t) { return t.length > 40 })) { Ui.toast("有书名超过 40 字，请修改"); return }
        if (!page.batchCover) { Ui.toast("请先选合照（会作为每本书的封面）"); return }
        var location = batchLocInput.text.trim()
        if (location.length < 2 || location.length > 30) { Ui.toast("请填写交易地点（2-30 字）"); return }
        var priceNote = batchPriceInput.text.trim()
        if (!priceNote) { Ui.toast("请填写价格描述，例如：左边10r/本，右边20r/本"); return }
        if (priceNote.length > 60) { Ui.toast("价格描述最长 60 字"); return }

        Ui.confirm({
            title: "批量发布 " + titles.length + " 本书？",
            text: "将一次发布 " + titles.length + " 本独立的书：共用这张合照作封面，交易地点「" + location + "」，价格描述「" + priceNote + "」。平台不参与交易，请与买家当面验书、当面付款。",
            okText: "确认发布"
        }, function (ok) {
            if (!ok) return
            Ui.loading(true, "发布中...")
            Api.upload("/api/books/batch", page.batchCover, 120000, {
                titles: JSON.stringify(titles),
                location: location,
                price_note: priceNote
            }).then(function (d) {
                Ui.loading(false)
                Ui.toast("已发布 " + d.count + " 本书！")
                page.batchTitles = []
                batchLocInput.text = ""
                batchPriceInput.text = ""
                page.batchCover = ""
                page.batchAiImg = ""
                loadMine()
            }).catch(function (e) {
                Ui.loading(false)
                Ui.toast(e.msg)
            })
        })
    }

    FileDialog {
        id: photoDlg
        fileMode: FileDialog.OpenFile
        nameFilters: ["图片 (*.jpg *.jpeg *.png)"]
        onAccepted: {
            // 批量合照：压两版——AI 识别要看得清书名（大而清晰），封面按常规压缩
            if (page.pendingKind === "batch") {
                var aiImg = ImageUtil.compress(photoDlg.selectedFile, 1600, 500)
                var coverImg = ImageUtil.compress(photoDlg.selectedFile, 800, 200)
                if (!aiImg) aiImg = coverImg
                if (!coverImg) coverImg = aiImg
                if (!aiImg || !coverImg) { Ui.toast("图片处理失败，请换一张"); return }
                page.batchAiImg = aiImg
                page.batchCover = coverImg
                Ui.toast("已选合照，点「AI 识别书名」开始识别")
                return
            }
            var outUrl = ImageUtil.compress(photoDlg.selectedFile, 600, 200)
            if (!outUrl) { Ui.toast("图片处理失败，请换一张"); return }
            if (page.pendingUploadBook) {
                page.uploadPhoto(page.pendingUploadBook, outUrl)
            } else {
                page.photoFile = outUrl
            }
        }
    }

    function uploadPhoto(bookId, fileUrl) {
        Ui.loading(true, "上传中...")
        Api.upload("/api/books/" + bookId + "/photo", fileUrl, 60000).then(function () {
            Ui.loading(false)
            Ui.toast("封面已上传")
            loadMine()
        }).catch(function (e) {
            Ui.loading(false)
            Ui.toast(e.msg)
        })
    }

    property bool publishing: false

    function publish() {
        if (page.publishing) return
        var title = titleInput.text.trim()
        if (!title) { Ui.toast("请填写书名"); return }
        var location = locationInput.text.trim()
        if (!location) { Ui.toast("请填写交易地点（线下交书用）"); return }
        var priceCents = Util.yuanToCents(priceInput.text)
        if (isNaN(priceCents) || priceCents < 1) { Ui.toast("价格需在 0.01-999.99 元之间"); return }
        if (priceCents > 99999) { Ui.toast("价格需在 0.01-999.99 元之间"); return }

        Ui.confirm({
            title: "确认发布到书市？",
            text: "《" + title + "》 定价 " + Util.yuan(priceCents) + "。平台仅提供信息展示与联系，不参与交易：请与买家当面验书、当面付款。",
            okText: "确认发布"
        }, function (ok) {
            if (!ok) return
            Ui.loading(true, "发布中...")
            Api.post("/api/books", {
                title: title,
                course: courseInput.text.trim(),
                cond: page.cond || undefined,
                price_cents: priceCents,
                note: noteInput.text.trim(),
                location: location
            }).then(function (d) {
                var bookId = d.id
                var after = function () {
                    page.publishing = false
                    Ui.loading(false)
                    Ui.toast("发布成功！")
                    titleInput.text = ""
                    courseInput.text = ""
                    noteInput.text = ""
                    locationInput.text = ""
                    priceInput.text = ""
                    page.cond = 0
                    page.photoFile = ""
                    loadMine()
                }
                if (page.photoFile) {
                    Api.upload("/api/books/" + bookId + "/photo", page.photoFile, 60000).then(function () {
                        after()
                    }).catch(function (e) {
                        after()
                        Ui.toast("发布成功，但封面上传失败：" + (e && e.msg ? e.msg : "网络异常") + "（可在列表点封面重试）")
                    })
                } else {
                    after()
                }
            }).catch(function (e) {
                Ui.loading(false)
                Ui.toast(e.msg)
            })
        })
    }

    function setStatus(b, st) {
        var sold = (st === "sold")
        Ui.confirm({
            title: sold ? "标记已售出？" : "暂时下架？",
            text: sold
                ? "标记后本书所有信息将从书市删除（已产生的会话仍可继续沟通）；建议确认图书已当面交接后再操作。是否确认标记已售出？"
                : "暂时下架后本书不再在书市展示，已联系的买家仍可继续沟通；建议图书交接完成后再操作。是否确认暂时下架？",
            okText: sold ? "确认已售出" : "确认下架",
            danger: sold
        }, function (ok) {
            if (!ok) return
            Api.post("/api/books/" + b.id + "/status", { status: st }).then(function () {
                if (sold) Ui.toast("已标记售出，本书信息已从平台删除")
                loadMine()
            }).catch(function (e) { Ui.toast(e.msg) })
        })
    }

    function loadMine() {
        Api.get("/api/books/mine").then(function (d) {
            page.myBooks = d.list
            pullRef.finish()
        }).catch(function () {
            pullRef.finish()
        })
    }

    function refresh() { loadMine() }

    Component.onCompleted: {
        loadMine()
        // 登出时 Loader 卸载会销毁本页，handler 必须解除，否则重登后重复触发
        page._unsubs = [
            Realtime.on("bchat", function () { page.loadMine() }),
            Realtime.on("notif", function () { page.loadMine() })
        ]
    }

    Component.onDestruction: {
        if (page._unsubs) for (var i = 0; i < page._unsubs.length; i++) page._unsubs[i]()
    }
}
