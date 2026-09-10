import QtQuick
import "../js/util.js" as Util
import ".." as Root

// 头像：上传了照片显示照片（用于双方相认），否则显示昵称首字符
Item {
    id: root
    property int size: 40
    property string nickname: ""
    property bool photo: false
    property string photoUrl: ""
    property int myId: 0
    property color textColor: "#FFFFFF"
    property color bgColor: Root.Theme.primary

    width: size
    height: size

    Rectangle {
        anchors.fill: parent
        radius: size / 2
        color: root.bgColor
        clip: true
        Image {
            anchors.fill: parent
            fillMode: Image.PreserveAspectCrop
            visible: root.photo && root.photoUrl.length > 0
            source: root.photo && root.photoUrl.length > 0 ? root.photoUrl : ""
        }
        Text {
            anchors.centerIn: parent
            visible: !(root.photo && root.photoUrl.length > 0)
            text: Util.avatarText(root.nickname)
            color: root.textColor
            font.pixelSize: root.size * 0.42
            font.bold: true
        }
    }
}
