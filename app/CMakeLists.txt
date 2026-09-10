cmake_minimum_required(VERSION 3.21)

project(LeLeBook VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Qt6 6.5 REQUIRED COMPONENTS Quick QuickControls2 Network WebSockets Positioning)

qt_standard_project_setup()

# Qt 6.9 标准行为：QML 模块资源默认前缀 /qt/qml/（Android 打包流程依赖此布局，勿改回 OLD）
qt_policy(SET QTP0001 NEW)
# 无 qmldir 的目录结构沿用旧式扫描，静音 QTP0004 dev 警告
qt_policy(SET QTP0004 OLD)

# pragma Singleton：声明为模块单例（生成 qmldir 的 singleton 行，Android AOT 必需）
set_source_files_properties(qml/Theme.qml PROPERTIES QT_QML_SINGLETON_TYPE TRUE)
set_source_files_properties(qml/Realtime.qml PROPERTIES QT_QML_SINGLETON_TYPE TRUE)

qt_add_executable(LeLeBook
    src/main.cpp
    src/session.cpp
    src/imageutil.cpp
    src/updater.cpp
)

qt_add_qml_module(LeLeBook
    URI LeLeBook
    VERSION 1.0
    QML_FILES
        qml/Main.qml
        qml/Theme.qml
        qml/Realtime.qml
        qml/js/api.js
        qml/js/ui.js
        qml/js/util.js
        qml/components/Avatar.qml
        qml/components/AppButton.qml
        qml/components/AppHeader.qml
        qml/components/AppInput.qml
        qml/components/AppTextArea.qml
        qml/components/AppCard.qml
        qml/components/TagBadge.qml
        qml/components/EmptyState.qml
        qml/components/NoticeBar.qml
        qml/components/Sheet.qml
        qml/components/Overlays.qml
        qml/components/PullToRefresh.qml
        qml/pages/LoginPage.qml
        qml/pages/ProfilePage.qml
        qml/pages/NotificationsPage.qml
        qml/pages/TabInvite.qml
        qml/pages/TabMe.qml
        qml/pages/VersionDialog.qml
        qml/pages/SettingsPage.qml
        qml/pages/NoticesPage.qml
        qml/pages/TabBookBrowse.qml
        qml/pages/TabBookSell.qml
        qml/pages/BookDetailPage.qml
        qml/pages/BookChatPage.qml
        qml/pages/BookChatsPage.qml
    RESOURCES
        # 邀请页「面对面邀请」宣传海报（朋友扫二维码下载）；资源路径 = /qt/qml/LeLeBook/posters/...
        posters/invite_poster.png
    SOURCES
        src/session.h src/session.cpp
        src/imageutil.h src/imageutil.cpp
        src/updater.h src/updater.cpp
        src/permissions.h
        src/permissions_android.cpp
)

# ============================================================
# 版本号（发布流程唯一入口）：
#   1. 发布新 APK 前，把 APP_VERSION_CODE 改成新版本号（须大于服务器上已发布的值）
#   2. 构建签名 APK（AndroidManifest 的 versionCode 由 Qt 打包时自动取这里）
#   3. 管理后台「版本更新」上传该 APK，并填写相同的版本号
# 客户端更新判断用的是这个值：改了它构建出的 APK 才算"新版本"
# ============================================================
set(APP_VERSION_CODE 100)
# 显示版本名按位拆分：110 -> 1.1.0、105 -> 1.0.5（百位恒为 1，十位=minor，个位=patch）
math(EXPR APP_MINOR_VER "${APP_VERSION_CODE} / 10 % 10")
math(EXPR APP_PATCH_VER "${APP_VERSION_CODE} % 10")

set_target_properties(LeLeBook PROPERTIES
    MACOSX_BUNDLE_GUI_IDENTIFIER com.lele.book
    MACOSX_BUNDLE_BUNDLE_VERSION ${PROJECT_VERSION}
    MACOSX_BUNDLE_SHORT_VERSION_STRING ${PROJECT_VERSION_MAJOR}.${PROJECT_VERSION_MINOR}
    ANDROID_MIN_SDK_VERSION 24
    ANDROID_TARGET_SDK_VERSION 35
    # 包名必须与 AndroidManifest / FileProvider authority(com.lele.book.fileprovider) 一致；
    # 不设置时 Qt 会默认重写成 org.qtproject.example.xxx，导致安装环节 authority 对不上
    QT_ANDROID_PACKAGE_NAME "com.lele.book"
    # 自定义 Android 清单 + 附加 Java 代码（ImageHelper）所在目录。
    # 不设置时 Qt 用自带模板生成清单：REQUEST_INSTALL_PACKAGES、usesCleartextTraffic、
    # 自定义 FileProvider 全部丢失 —— 应用内更新下载后装不了（invalid uri）就是这么来的
    QT_ANDROID_PACKAGE_SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/android"
    QT_ANDROID_COMPILE_SDK_VERSION 35
    QT_ANDROID_VERSION_CODE ${APP_VERSION_CODE}
    QT_ANDROID_VERSION_NAME "1.${APP_MINOR_VER}.${APP_PATCH_VER}"
)

# main.cpp 的 APP_VERSION_CODE 由这里注入，与 manifest versionCode 同源
target_compile_definitions(LeLeBook PRIVATE APP_VERSION_CODE=${APP_VERSION_CODE})

target_link_libraries(LeLeBook PRIVATE
    Qt6::Quick
    Qt6::QuickControls2
    Qt6::Network
    Qt6::WebSockets
    Qt6::Positioning
)
