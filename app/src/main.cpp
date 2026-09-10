#include <QClipboard>
#include <QGuiApplication>
#include <QKeyEvent>
#include <QQmlApplicationEngine>
#include <QQuickStyle>
#include <QScreen>
#include <QTimer>
#include <QtQml>
#include <QWindow>

#include "session.h"
#include "imageutil.h"
#include "updater.h"
#include "permissions.h"

// 应用当前版本号：由 CMakeLists.txt 的 APP_VERSION_CODE 注入（发布时只改 CMake 一处），
// 与 AndroidManifest 的 versionCode 同源；与服务端 /api/version 的 version_code 对应
#ifndef APP_VERSION_CODE
#define APP_VERSION_CODE 100
#endif

#ifdef Q_OS_ANDROID
// Android 系统返回键拦截：默认行为是退出 Activity，焦点在输入框等控件上时
// QML 的 Keys.onReleased 收不到事件，导致"按返回直接退出应用而非回到上一页"。
// 这里在应用层统一吃掉 Key_Back，转发给 QML 根的 androidBack() 处理（弹层→页面栈→忽略）
class BackKeyFilter : public QObject
{
public:
    explicit BackKeyFilter(QWindow *win, QObject *parent = nullptr)
        : QObject(parent), m_win(win) {}

    bool eventFilter(QObject *obj, QEvent *ev) override
    {
        if (m_win && (ev->type() == QEvent::KeyPress || ev->type() == QEvent::KeyRelease)) {
            QKeyEvent *ke = static_cast<QKeyEvent *>(ev);
            if (ke->key() == Qt::Key_Back) {
                if (ev->type() == QEvent::KeyPress)
                    QMetaObject::invokeMethod(m_win, "androidBack", Qt::DirectConnection);
                return true; // 吃掉，阻止 Qt 默认的退出行为
            }
        }
        return QObject::eventFilter(obj, ev);
    }

private:
    QWindow *m_win = nullptr;
};
#endif

int main(int argc, char *argv[])
{
    QGuiApplication app(argc, argv);
    QGuiApplication::setApplicationName(QStringLiteral("WHU二手书市"));
    QGuiApplication::setOrganizationName(QStringLiteral("LeLeBook"));

    // 全平台统一用 Basic 控件样式：Windows 原生样式不支持自定义 background，
    // 会导致输入框圆角底、弹窗等渲染异常；Basic 在桌面与 Android 渲染一致
    QQuickStyle::setStyle(QStringLiteral("Basic"));

    Session *session = new Session(&app);
    session->setAppVersionCode(APP_VERSION_CODE);

    qmlRegisterSingletonInstance("LeLeBook", 1, 0, "Session", session);
    qmlRegisterSingletonInstance("LeLeBook", 1, 0, "ImageUtil", new ImageUtil(&app));
    qmlRegisterSingletonInstance("LeLeBook", 1, 0, "Updater", new Updater(&app));
    qmlRegisterSingletonInstance("LeLeBook", 1, 0, "Permissions", new Permissions(&app));

    QQmlApplicationEngine engine;
    // 剪贴板：QML 里 Clipboard.text = "..." 直接读写（邀请码复制等此前引用了不存在的
    // Clipboard 对象，点击复制会 ReferenceError 静默失败）
    engine.rootContext()->setContextProperty(QStringLiteral("Clipboard"), QGuiApplication::clipboard());
    engine.loadFromModule("LeLeBook", "Main");
    if (engine.rootObjects().isEmpty())
        return -1;

    QObject *root = engine.rootObjects().value(0);
    QWindow *rootWin = qobject_cast<QWindow *>(root);

    // 桌面端：把窗口收进屏幕可用区域（任务栏除外）。上次会话可能把窗口拉得比可用区还高，
    // 底部输入栏/按钮会被任务栏盖住——看得见（窗口自身渲染）却点不到。
    // QML 层的 Screen 属性与实际几何对不齐，这里用 QScreen 精确处理；延迟一次执行即可，
    // 不干扰用户之后手动调整大小；Android 无此问题（全屏）。
#if !defined(Q_OS_ANDROID)
    QTimer::singleShot(300, &app, [&engine]() {
        QObject *w = engine.rootObjects().value(0);
        if (!w) { qWarning("[clamp] no root object"); return; }
        QScreen *scr = qobject_cast<QScreen *>(w->property("screen").value<QObject *>());
        if (!scr) scr = QGuiApplication::primaryScreen();
        if (!scr) { qWarning("[clamp] no screen"); return; }
        QWindow *win = qobject_cast<QWindow *>(w);
        if (!win) { qWarning("[clamp] root not a window"); return; }
        const QRect av = scr->availableGeometry();
        const QRect g = win->geometry();
        const int nw = qMin(g.width(), av.width());
        const int nh = qMin(g.height(), av.height());
        const int nx = qBound(av.left(), g.x(), av.right() - nw + 1);
        const int ny = qBound(av.top(), g.y(), av.bottom() - nh + 1);
        win->setGeometry(QRect(nx, ny, nw, nh));
        qWarning("[clamp] av=%dx%d+%d+%d geom=%dx%d+%d+%d -> %dx%d+%d+%d dpr=%f",
                 av.width(), av.height(), av.x(), av.y(), g.width(), g.height(), g.x(), g.y(),
                 nw, nh, nx, ny, win->devicePixelRatio());
    });
#endif

#ifdef Q_OS_ANDROID
    // 状态栏安全区：只有窗口真的延伸到状态栏下面（部分机型的 edge-to-edge 行为）才需要顶部内缩；
    // 鸿蒙等系统窗口默认从状态栏下方开始，统一内缩反而会在顶部多出一段空白。
    // 判断方法：系统"可用显示高度"不含状态栏，若 Qt 窗口物理高 >= 可用高度，说明窗口占到了状态栏区
    QTimer::singleShot(300, &app, [&engine, session]() {
        QObject *w = engine.rootObjects().value(0);
        QWindow *win = w ? qobject_cast<QWindow *>(w) : nullptr;
        if (!win) return;
        QJniObject activity = QNativeInterface::QAndroidApplication::context();
        if (!activity.isValid()) return;
        QJniObject resources = activity.callObjectMethod("getResources", "()Landroid/content/res/Resources;");
        if (!resources.isValid()) return;
        QJniObject metrics = resources.callObjectMethod("getDisplayMetrics", "()Landroid/util/DisplayMetrics;");
        if (!metrics.isValid()) return;
        const float density = metrics.getField<jfloat>("density");
        const jint screenH = metrics.getField<jint>("heightPixels"); // 可用显示高度（不含系统栏）
        const int winPhysH = qRound(win->height() * density);
        const bool covered = winPhysH >= screenH - qRound(density * 2.0f); // 占满可用区以上 = 内容在状态栏下

        if (covered) {
            const jint dimId = resources.callMethod<jint>("getIdentifier",
                "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)I",
                QJniObject::fromString("status_bar_height").object(),
                QJniObject::fromString("dimen").object(),
                QJniObject::fromString("android").object());
            if (dimId > 0) {
                const jint px = resources.callMethod<jint>("getDimensionPixelSize", "(I)I", dimId);
                const int logical = qRound(px / density);
                if (logical > 0) {
                    session->setSafeTop(logical);
                    qWarning("[safeTop] window covers status bar: win=%d screen=%d -> inset %d", winPhysH, screenH, logical);
                    return;
                }
            }
        }
        session->setSafeTop(0);
        qWarning("[safeTop] no inset needed: win=%d screen=%d", winPhysH, screenH);
    });

    // 返回键统一拦截（见 BackKeyFilter 注释）
    if (rootWin) {
        BackKeyFilter *filter = new BackKeyFilter(rootWin, rootWin);
        app.installEventFilter(filter);
    }
#endif

    return app.exec();
}
