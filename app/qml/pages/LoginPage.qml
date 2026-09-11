import QtQuick
import QtQuick.Controls
import ".." as Root
import "../js/util.js" as Util
import "../js/api.js" as Api
import "../js/ui.js" as Ui
import "../components"

// 登录 / 注册（无密码，仅邮箱验证码）
Item {
    id: page
    property var app: null
    property int mode: 0 // 0 登录 / 1 注册
    property int schoolId: 0
    property string gender: ""
    property var schools: []
    property bool busy: false
    property bool mailHintVisible: false // 发送成功后显示"未收到邮件？"
    property bool mailHintOpen: false    // 展开排查建议
    property bool _inFlight: false // 学校请求进行中标记
    // 学校列表加载失败/为空时：切到注册页或重进页面时自动重试
    onModeChanged: { if (page.mode === 1 && page.schools.length === 0) loadSchools() }

    Flickable {
        anchors.fill: parent
        contentHeight: col.implicitHeight + 36
        clip: true
        boundsBehavior: Flickable.StopAtBounds

        Column {
            id: col
            width: parent.width
            spacing: 14
            anchors.horizontalCenter: parent.horizontalCenter

            // ---------- Hero 品牌卡 ----------
            Rectangle {
                id: hero
                width: parent.width - 28
                anchors.horizontalCenter: parent.horizontalCenter
                height: 188
                radius: 26
                gradient: Root.Theme.brandGradient

                // 装饰圆（右上大圆 / 左下小圆）
                Rectangle {
                    width: 170; height: 170; radius: 85
                    color: "#14FFFFFF"; anchors.right: parent.right; anchors.top: parent.top; anchors.topMargin: -60; anchors.rightMargin: -40
                }
                Rectangle {
                    width: 64; height: 64; radius: 32
                    color: "#0DFFFFFF"; anchors.left: parent.left; anchors.bottom: parent.bottom; anchors.bottomMargin: -18; anchors.leftMargin: -14
                }
                Rectangle {
                    width: 10; height: 10; radius: 5
                    color: "#22FFFFFF"; anchors.left: parent.left; anchors.top: parent.top; anchors.leftMargin: 40; anchors.topMargin: 24
                }

                Column {
                    anchors.fill: parent
                    anchors.topMargin: 22
                    anchors.leftMargin: 22
                    anchors.rightMargin: 22
                    spacing: 10

                    Row {
                        spacing: 12
                        // Logo 白圆
                        Rectangle {
                            width: 52; height: 52; radius: 16
                            color: "#E6FFFFFF"
                            Text {
                                anchors.centerIn: parent
                                text: "乐"
                                color: "#00875F"
                                font.pixelSize: 26
                                font.weight: Font.Black
                            }
                        }
                        Column {
                            anchors.verticalCenter: parent.verticalCenter
                            spacing: 3
                            Text {
                                text: "WHU二手书市"
                                color: "#FFFFFF"
                                font.pixelSize: 24
                                font.weight: Font.Black
                            }
                            Text {
                                text: "教材课本 · 让好书继续流转"
                                color: "#E0FFFFFF"
                                font.pixelSize: 12
                            }
                        }
                    }

                    Row {
                        spacing: 8
                        Repeater {
                            model: ["📚 二手书市", "🤝 同学互助", "🏫 校园同校"]
                            delegate: Rectangle {
                                height: 26
                                width: txtW.implicitWidth + 20
                                radius: 13
                                color: "#26FFFFFF"
                                border.color: "#33FFFFFF"
                                Text {
                                    id: txtW
                                    anchors.centerIn: parent
                                    text: modelData
                                    color: "#FFFFFF"
                                    font.pixelSize: 11
                                }
                            }
                        }
                    }

                    Item { height: 4; width: 1 }

                    Text {
                        text: "不碰钱 · 当面验书 · 当面交易"
                        color: "#CCFFFFFF"
                        font.pixelSize: 11
                    }
                }
            }

            // ---------- 登录 / 注册 分段切换 ----------
            Rectangle {
                id: seg
                width: hero.width
                anchors.horizontalCenter: parent.horizontalCenter
                height: 50
                radius: 25
                color: "#FFFFFF"
                anchors.topMargin: -4
                Row {
                    anchors.fill: parent
                    anchors.margins: 4
                    spacing: 4
                    Repeater {
                        model: ["登 录", "注 册"]
                        delegate: Rectangle {
                            width: (seg.width - 12) / 2
                            height: 42
                            radius: 21
                            gradient: page.mode === index ? Root.Theme.brandGradient : undefined
                            color: page.mode === index ? "transparent" : "transparent"
                            Text {
                                anchors.centerIn: parent
                                text: modelData
                                color: page.mode === index ? "#FFFFFF" : Root.Theme.textSub
                                font.pixelSize: 15
                                font.weight: page.mode === index ? Font.DemiBold : Font.Normal
                            }
                            MouseArea {
                                anchors.fill: parent
                                onClicked: page.mode = index
                            }
                        }
                    }
                }
            }

            // ---------- 表单白卡 ----------
            Rectangle {
                width: hero.width
                anchors.horizontalCenter: parent.horizontalCenter
                radius: 22
                color: "#FFFFFF"
                height: form.implicitHeight + 36
                Column {
                    id: form
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.top: parent.top
                    anchors.margins: 18
                    spacing: 14

                    // 邮箱
                    Column {
                        width: parent.width
                        spacing: 6
                        Text {
                            text: page.mode === 0 ? "邮箱登录" : "1 · 邮箱验证码"
                            color: Root.Theme.textSub
                            font.pixelSize: 12
                            font.weight: Font.Medium
                        }
                        AppInput {
                            id: emailInput
                            hint: "邮箱（学号邮箱或其他邮箱均可）"
                            inputMethodHints: Qt.ImhEmailCharactersOnly | Qt.ImhNoPredictiveText
                        }
                    }

                    // 验证码
                    Row {
                        width: parent.width
                        spacing: 10
                        AppInput {
                            id: codeInput
                            width: parent.width - 128
                            hint: "6 位验证码"
                            inputMethodHints: Qt.ImhDigitsOnly
                        }
                        Rectangle {
                            width: 118; height: 48
                            radius: 14
                            color: codeBtn.enabled ? Root.Theme.primarySoft : "#F1F2F4"
                            border.color: codeBtn.enabled ? Root.Theme.primaryLight : "transparent"
                            border.width: 1
                            Text {
                                anchors.centerIn: parent
                                text: codeBtn.countdown > 0 ? codeBtn.countdown + "s 后重发" : "获取验证码"
                                color: codeBtn.enabled ? Root.Theme.primaryDark : Root.Theme.textLight
                                font.pixelSize: 13
                                font.weight: Font.Medium
                            }
                            MouseArea {
                                id: codeBtn
                                anchors.fill: parent
                                property int countdown: 0
                                property bool enabled: countdown === 0
                                Timer { id: cdTimer; interval: 1000; repeat: true; onTriggered: { codeBtn.countdown--; if (codeBtn.countdown <= 0) stop() } }
                                onClicked: {
                                    if (countdown > 0) return
                                    var email = emailInput.text.trim()
                                    if (!Util.isEmail(email)) { Ui.toast("请先填写正确的邮箱"); return }
                                    var purpose = page.mode === 0 ? "login" : "register"
                                    Ui.loading(true, "发送中...")
                                    Api.post("/api/auth/send-code", { email: email, purpose: purpose }).then(function (d) {
                                        Ui.loading(false)
                                        codeBtn.countdown = 60
                                        cdTimer.start()
                                        var msg = d.msg || "验证码已发送"
                                        if (d.dev_code) msg += "（开发模式验证码：" + d.dev_code + "）"
                                        page.mailHintVisible = true // "未收到邮件？"可点击展开
                                        Ui.toast("验证码已发送")
                                    }).catch(function (e) {
                                        Ui.loading(false)
                                        Ui.toast(e.msg)
                                    })
                                }
                            }
                        }
                    }

                    // 未收到邮件：可点击的蓝字，点开看排查建议（默认收起）
                    Column {
                        width: parent.width
                        spacing: 3
                        visible: page.mailHintVisible
                        Text {
                            text: page.mailHintOpen ? "收起" : "未收到邮件？"
                            color: Root.Theme.blue
                            font.pixelSize: 11
                            font.underline: true
                            MouseArea {
                                anchors.fill: parent
                                onClicked: page.mailHintOpen = !page.mailHintOpen
                            }
                        }
                        Text {
                            width: parent.width
                            visible: page.mailHintOpen
                            text: "少数邮件可能被运营商或邮箱拦截：请检查垃圾邮件/订阅邮件文件夹；若使用企业或校园邮箱，可能被网关过滤；也可返回修改其他邮箱重新获取，或稍等 1-2 分钟再试。"
                            color: Root.Theme.textSub
                            font.pixelSize: 11
                            wrapMode: Text.Wrap
                            lineHeight: 1.4
                        }
                    }

                    // ---------- 注册附加信息 ----------
                    Column {
                        width: parent.width
                        spacing: 14
                        visible: page.mode === 1

                        Column {
                            width: parent.width
                            spacing: 8
                            Text {
                                text: "2 · 昵称"
                                color: Root.Theme.textSub
                                font.pixelSize: 12
                                font.weight: Font.Medium
                            }
                            AppInput {
                                id: nickInput
                                hint: "昵称（展示给同学，默认取首字符）"
                            }
                        }

                        // 学校（必选）
                        Column {
                            width: parent.width
                            spacing: 8
                            Text {
                                text: "3 · 学校"
                                color: Root.Theme.textSub
                                font.pixelSize: 12
                                font.weight: Font.Medium
                            }
                            Flow {
                                width: parent.width
                                spacing: 10
                                Repeater {
                                    model: page.schools
                                    delegate: Rectangle {
                                        height: 42
                                        width: schTxt.implicitWidth + 34
                                        radius: 21
                                        color: page.schoolId === modelData.id ? "transparent" : "#F2F4F3"
                                        border.color: page.schoolId === modelData.id ? Root.Theme.primary : "transparent"
                                        border.width: 1.2
                                        gradient: page.schoolId === modelData.id ? Root.Theme.brandGradient : undefined
                                        Text {
                                            id: schTxt
                                            anchors.centerIn: parent
                                            text: modelData.name
                                            color: page.schoolId === modelData.id ? "#FFFFFF" : Root.Theme.text
                                            font.pixelSize: 13
                                            font.weight: page.schoolId === modelData.id ? Font.DemiBold : Font.Normal
                                        }
                                        MouseArea {
                                            anchors.fill: parent
                                            onClicked: page.schoolId = modelData.id
                                        }
                                    }
                                }
                            }
                            // 加载中提示
                            Text {
                                width: parent.width
                                visible: page.schoolsLoading && page.schools.length === 0
                                text: "正在加载学校…"
                                color: Root.Theme.textLight
                                font.pixelSize: 12
                                horizontalAlignment: Text.AlignHCenter
                            }
                            // 学校列表加载失败提示（不静默：显示原因 + 服务器地址，可点重试）
                            Column {
                                width: parent.width
                                visible: !page.schoolsLoading && page.schools.length === 0
                                spacing: 4
                                Text {
                                    width: parent.width
                                    text: "学校列表加载失败：" + page.schoolErr
                                    color: Root.Theme.warning
                                    font.pixelSize: 12
                                    wrapMode: Text.Wrap
                                    horizontalAlignment: Text.AlignHCenter
                                }
                                Text {
                                    width: parent.width
                                    text: "当前服务器：" + Api.baseUrl()
                                    color: Root.Theme.textLight
                                    font.pixelSize: 10
                                    wrapMode: Text.Wrap
                                    horizontalAlignment: Text.AlignHCenter
                                }
                                Text {
                                    width: parent.width
                                    text: "点此重试"
                                    color: Root.Theme.primary
                                    font.pixelSize: 12
                                    font.weight: Font.Medium
                                    horizontalAlignment: Text.AlignHCenter
                                    MouseArea {
                                        anchors.fill: parent
                                        anchors.margins: -8
                                        onClicked: page.loadSchools()
                                    }
                                }
                            }
                        }

                        // 性别（必选）
                        Column {
                            width: parent.width
                            spacing: 8
                            Text {
                                text: "4 · 性别"
                                color: Root.Theme.textSub
                                font.pixelSize: 12
                                font.weight: Font.Medium
                            }
                            Row {
                                width: parent.width
                                spacing: 10
                                Repeater {
                                    model: [{ v: "female", l: "女生", s: "♀" }, { v: "male", l: "男生", s: "♂" }]
                                    delegate: Rectangle {
                                        width: (parent.width - 10) / 2
                                        height: 52
                                        radius: 16
                                        color: page.gender === modelData.v ? "transparent" : "#F2F4F3"
                                        border.color: page.gender === modelData.v ? Root.Theme.primary : "transparent"
                                        border.width: 1.2
                                        gradient: page.gender === modelData.v ? Root.Theme.brandGradient : undefined
                                        Row {
                                            anchors.centerIn: parent
                                            spacing: 8
                                            Text {
                                                text: modelData.s
                                                color: page.gender === modelData.v ? "#FFFFFF" : Root.Theme.primaryDark
                                                font.pixelSize: 24
                                                anchors.verticalCenter: parent.verticalCenter
                                            }
                                            Text {
                                                text: modelData.l
                                                color: page.gender === modelData.v ? "#FFFFFF" : Root.Theme.text
                                                font.pixelSize: 15
                                                font.weight: page.gender === modelData.v ? Font.DemiBold : Font.Medium
                                                anchors.verticalCenter: parent.verticalCenter
                                            }
                                        }
                                        MouseArea {
                                            anchors.fill: parent
                                            onClicked: page.gender = modelData.v
                                        }
                                    }
                                }
                            }
                            Text {
                                width: parent.width
                                text: "性别仅用于展示，请如实选择"
                                color: Root.Theme.warning
                                font.pixelSize: 11
                                wrapMode: Text.Wrap
                            }
                        }

                        // 邀请码（选填）
                        Column {
                            width: parent.width
                            spacing: 8
                            Text {
                                text: "5 · 邀请码（选填）"
                                color: Root.Theme.textSub
                                font.pixelSize: 12
                                font.weight: Font.Medium
                            }
                            AppInput {
                                id: inviteInput
                                hint: "有同学邀请你时填写 TA 的邀请码"
                                property bool cap: true
                                onTextEdited: { text = text.toUpperCase() }
                            }
                        }
                    }

                    // 注册协议勾选 + 入口（未勾选不可提交，见 doSubmit）
                    Row {
                        width: parent.width
                        visible: page.mode === 1
                        spacing: 6
                        Rectangle {
                            id: agreeBox
                            width: 16; height: 16; radius: 4
                            anchors.verticalCenter: parent.verticalCenter
                            color: page.agreeChecked ? Root.Theme.primary : "#FFFFFF"
                            border.color: page.agreeChecked ? Root.Theme.primary : Root.Theme.line
                            border.width: 1
                            Text { anchors.centerIn: parent; text: "✓"; color: "#FFFFFF"; font.pixelSize: 12; font.weight: Font.Bold; visible: page.agreeChecked }
                            MouseArea { anchors.fill: parent; anchors.margins: -6; onClicked: page.agreeChecked = !page.agreeChecked }
                        }
                        Text {
                            text: "我已阅读并同意"
                            color: Root.Theme.textLight
                            font.pixelSize: 11
                            anchors.verticalCenter: parent.verticalCenter
                        }
                        Text {
                            text: "《注册协议》"
                            color: Root.Theme.blue
                            font.pixelSize: 11
                            font.underline: true
                            anchors.verticalCenter: parent.verticalCenter
                            MouseArea { anchors.fill: parent; anchors.margins: -8; onClicked: page.agreementVisible = true }
                        }
                    }

                    // 规则提示
                    Text {
                        width: parent.width
                        visible: page.mode === 1
                        text: "见面当面验书、当面付款，平台不参与交易"
                        color: Root.Theme.textLight
                        font.pixelSize: 11
                        wrapMode: Text.Wrap
                        horizontalAlignment: Text.AlignHCenter
                    }
                }
            }

            // ---------- 主按钮 ----------
            AppButton {
                width: hero.width
                anchors.horizontalCenter: parent.horizontalCenter
                text: page.mode === 0 ? "登 录" : "注册并登录"
                busy: page.busy
                heightPx: 52
                onClicked: page.doSubmit()
            }

            Text {
                width: hero.width
                anchors.horizontalCenter: parent.horizontalCenter
                horizontalAlignment: Text.AlignHCenter
                text: "没有账号？点击上方「注册」两步搞定"
                color: Root.Theme.textLight
                font.pixelSize: 11
            }
        }
    }

    property bool schoolsLoading: false
    property string schoolErr: ""
    property int _retry: 0
    property Timer _retryTimer: Timer {
        interval: 2000
        repeat: false
        onTriggered: page.loadSchools()
    }

    function loadSchools() {
        if (page.schools.length > 0 || page._inFlight) return
        page._inFlight = true
        // 首次/手动触发才显示「正在加载」；自动重试在后台静默进行（错误提示保持可见）
        if (!page.schoolErr) page.schoolsLoading = true
        Api.get("/api/schools").then(function (d) {
            page._inFlight = false
            page.schoolsLoading = false
            page.schools = d.list
            page._retry = 0
            if (d.list.length > 0) {
                page.schoolErr = ""
                page.schoolId = d.list[0].id
            } else {
                page.schoolErr = "服务器暂无学校，请管理员在后台添加"
            }
            console.log("[schools] loaded " + d.list.length + " to " + Api.baseUrl())
        }).catch(function (e) {
            page._inFlight = false
            page.schoolsLoading = false
            page.schoolErr = (e && e.msg) ? e.msg : "网络异常"
            console.log("[schools] FAIL " + page.schoolErr + " @ " + Api.baseUrl())
            // 失败自动重试（最多 5 次，每 2 秒后台静默），网络恢复后自动出现学校
            if (page._retry < 5) {
                page._retry = page._retry + 1
                page._retryTimer.restart()
            }
        })
    }

    Component.onCompleted: { page.loadSchools() }

    function doSubmit() {
        if (page.busy) { console.log("[auth] busy, submit ignored"); return }
        var email = emailInput.text.trim()
        var code = codeInput.text.trim()
        if (!Util.isEmail(email)) { Ui.toast("请填写正确的邮箱"); return }
        if (code.length !== 6) { Ui.toast("请填写 6 位验证码"); return }
        console.log("[auth] submit mode=" + page.mode + " email=" + email + " code=" + code)
        if (page.mode === 0) {
            page.busy = true
            Ui.loading(true, "登录中...")
            Api.post("/api/auth/login", { email: email, code: code }).then(function (d) {
                console.log("[auth] login OK uid=" + d.user.id)
                try {
                    page.busy = false
                    console.log("[auth] s1 busy=false ok")
                    Ui.loading(false)
                    console.log("[auth] s2 loading(false) ok")
                    page.enter(d)
                    console.log("[auth] s3 enter returned")
                } catch (err2) {
                    console.log("[auth] SUCCESS-BLOCK CRASH: " + err2 + " | " + (err2 && err2.stack ? err2.stack : "no stack"))
                }
            }).catch(function (e) {
                console.log("[auth] login FAIL " + e.msg + " code=" + e.code + " status=" + e.status + " raw=" + e)
                page.busy = false
                Ui.loading(false)
                if (e.code === "NOT_REGISTERED") {
                    // 未注册自动切到注册页
                    Ui.confirm({ title: "该邮箱尚未注册", text: "是否前往注册？", okText: "去注册" }, function (ok) {
                        if (ok) { page.mode = 1 }
                    })
                } else {
                    Ui.toast(e.msg)
                }
            })
        } else {
            var nick = nickInput.text.trim()
            if (!nick || nick.length > 20) { Ui.toast("请填写昵称（20 字以内）"); return }
            if (!page.schoolId) { Ui.toast("请选择学校"); return }
            if (!page.gender) { Ui.toast("请选择性别"); return }
            if (!page.agreeChecked) { Ui.toast("请先阅读并同意《注册协议》"); return }
            page.busy = true
            Ui.loading(true, "注册中...")
            Api.post("/api/auth/register", {
                email: email, code: code, nickname: nick,
                school_id: page.schoolId, gender: page.gender,
                invite_code: inviteInput.text.trim()
            }).then(function (d) {
                console.log("[auth] register OK uid=" + d.user.id)
                page.busy = false
                Ui.loading(false)
                page.enter(d)
            }).catch(function (e) {
                console.log("[auth] register FAIL " + e.msg + " code=" + e.code + " status=" + e.status)
                page.busy = false
                Ui.loading(false)
                Ui.toast(e.msg)
            })
        }
    }

    function enter(d) {
        // 全部收尾动作移到 Main(永不销毁) 的 loginSuccess 里执行，
        // 这里只转发 —— 避免 loggedIn 置位导致本页被销毁后继续在本页上下文跑代码
        console.log("[auth] enter forwarding to main")
        app.loginSuccess(d)
    }

    // ---------- 注册协议 ----------
    property bool agreeChecked: false
    property bool agreementVisible: false

readonly property var _agreementParas: [
        '更新日期：2026 年 9 月 9 日　　生效日期：2026 年 9 月 9 日',
        '欢迎使用WHU二手书市（以下简称“本平台”）。本平台为面向在校学生的校园二手书市信息平台，提供闲置教材等二手书信息展示与买卖沟通渠道。你（以下简称“用户”）在注册前请务必仔细阅读本协议，提交注册即视为已阅读、理解并同意本协议全部内容。',
        '一、平台性质与服务范围',
        '1. 本平台仅提供信息撮合与技术支持：展示用户发布的二手书信息，提供买卖双方沟通渠道。平台不是交易的任何一方，不参与线下交付，不收取任何中介费用，不代收、不托管、不担保任何款项。',
        '2. 平台上的书价等信息仅为双方协商参考，实际交易由双方线下自行当面完成。',
        '二、账号注册与安全',
        '1. 用户应使用本人邮箱注册，并保证注册信息（昵称、学校、性别等）真实、准确；平台有权对违规账号采取提醒、限制或封禁措施。',
        '2. 账号仅限本人使用，不得出借、转让；因保管不善造成的损失由用户自行承担。',
        '三、用户行为规范',
        '1. 严禁利用本平台进行违反校规校纪的行为。用户线下交易产生的一切违规后果由用户自行承担，平台概不负责。',
        '2. 用户不得发布虚假、违法、侵权或与平台服务无关的信息；不得利用平台从事代课、代考、代写等学术不诚信活动及其他违法违规行为。',
        '3. 卖家应如实描述书籍成色与瑕疵；买家应在当面验书后再付款。虚假发布等行为将被记录并处理。',
        '四、线下交易与安全提示',
        '1. 双方线下见面时请注意人身与财物安全，建议选择校园内公共场合；妥善保管个人证件与贵重物品。',
        '2. 线下交易产生的纠纷由交易双方自行协商解决，平台可基于双方提交的信息提供必要的记录协助，但不承担裁决或赔付义务。',
        '五、隐私保护',
        '1. 平台仅收集提供服务所必需的信息（邮箱、昵称、学校、性别及你主动发布的内容），用于账号识别与交易沟通。',
        '2. 除法律法规要求或用户本人同意外，平台不会向第三方提供用户个人信息。',
        '六、服务的变更与中断',
        '1. 平台有权基于运营需要调整、暂停或终止部分或全部服务；对于因系统维护、网络故障、不可抗力等原因导致的服务中断，平台不承担由此产生的损失。'
    ]
    readonly property string agreementText: _agreementParas.join("\n\n")

    // 协议全文浮层（注册页无页面栈，直接做页内遮罩）
    Rectangle {
        id: agreementOverlay
        anchors.fill: parent
        visible: page.agreementVisible
        z: 100
        color: Root.Theme.bg

        Column {
            anchors.fill: parent
            anchors.margins: 16
            anchors.topMargin: 24
            spacing: 10

            Row {
                width: parent.width
                Text {
                    text: "注册协议"
                    font.pixelSize: 18
                    font.weight: Font.Bold
                    color: Root.Theme.text
                }
                Item { width: 8; height: 1 }
                Text {
                    anchors.bottom: parent.bottom
                    text: "WHU二手书市 · 校园二手书市"
                    color: Root.Theme.textLight
                    font.pixelSize: 11
                }
            }

            Flickable {
                id: agFlick
                width: parent.width
                height: parent.height - 120
                contentHeight: agText.implicitHeight
                clip: true
                boundsBehavior: Flickable.StopAtBounds
                ScrollBar.vertical: ScrollBar { }

                Text {
                    id: agText
                    width: agFlick.width
                    text: page.agreementText
                    color: Root.Theme.text
                    font.pixelSize: 13
                    wrapMode: Text.Wrap
                    lineHeight: 1.45
                }
            }

            AppButton {
                width: parent.width
                text: "我已阅读并同意"
                onClicked: {
                    page.agreeChecked = true
                    page.agreementVisible = false
                }
            }
        }
    }
}
