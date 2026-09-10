#include "updater.h"
#include <QFile>
#include <QFileInfo>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QStandardPaths>
#include <QStringList>
#include <QTimer>
#include <QUrl>

#ifdef Q_OS_ANDROID
#include <QJniEnvironment>
#include <QJniObject>
#include <QCoreApplication> // Qt 6.9：QNativeInterface::QAndroidApplication 随平台头随 QCoreApplication 暴露（<QNativeInterface> 头已移除）
#endif

Updater::Updater(QObject *parent) : QObject(parent) {}

Updater::~Updater()
{
    if (m_reply) { m_reply->abort(); m_reply->deleteLater(); }
}

void Updater::setProgress(qreal p, const QString &text)
{
    m_progress = p;
    m_statusText = text;
    emit progressChanged();
}

void Updater::start(const QString &url)
{
    if (m_reply) {
        emit failed(QStringLiteral("已有更新任务进行中"));
        return;
    }
    // APK 直接流式写入磁盘：此前是 finished 后 readAll 整包进内存，
    // 一两百 MB 的包在手机上会内存暴涨甚至被系统杀掉
    m_destPath = QStandardPaths::writableLocation(QStandardPaths::AppDataLocation)
            + QStringLiteral("/lele-book.apk");
    QFile::remove(m_destPath);
    m_file.setFileName(m_destPath);
    if (!m_file.open(QIODevice::WriteOnly)) {
        emit failed(QStringLiteral("无法创建下载文件（存储不可用）"));
        return;
    }

    QNetworkRequest req;
    req.setUrl(QUrl(url));
    // APK 地址若经 302 跳转（对象存储/CDN）必须允许重定向，否则下载到的是一段 HTML
    req.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::NoLessSafeRedirectPolicy);
    req.setAttribute(QNetworkRequest::HttpPipeliningAllowedAttribute, false);
    req.setTransferTimeout(0); // 整体不限时；无数据卡死由下面的 stall 定时器兜底

    m_reply = m_nam.get(req);
    connect(m_reply, &QNetworkReply::downloadProgress, this, [this](qint64 got, qint64 total) {
        if (total > 0) {
            qreal p = qreal(got) / qreal(total);
            setProgress(p, QStringLiteral("下载中 %1%").arg(int(p * 100)));
        } else {
            setProgress(m_progress, QStringLiteral("已下载 %1 MB").arg(int(m_file.pos() / 1048576.0)));
        }
    });
    // 收到数据即落盘
    connect(m_reply, &QNetworkReply::readyRead, this, [this]() {
        m_file.write(m_reply->readAll());
    });
    // 90 秒没有任何字节视为卡死（网络切换/代理挂起）
    QTimer *stall = new QTimer(m_reply);
    stall->setInterval(90 * 1000);
    connect(stall, &QTimer::timeout, m_reply, &QNetworkReply::abort);
    connect(m_reply, &QNetworkReply::downloadProgress, stall, [stall]() { stall->start(); });
    stall->start();

    connect(m_reply, &QNetworkReply::finished, this, [this, stall]() {
        auto *reply = m_reply;
        m_reply = nullptr;
        stall->stop();
        const QByteArray tail = reply->readAll(); // 收尾残留字节
        if (tail.size()) m_file.write(tail);
        m_file.close();
        const QUrl redir = reply->attribute(QNetworkRequest::RedirectionTargetAttribute).toUrl();
        const int httpStatus = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const QString errStr = reply->errorString();
        const QNetworkReply::NetworkError err = reply->error();
        reply->deleteLater();

        if (err != QNetworkReply::NoError) {
            QFile::remove(m_destPath);
            setProgress(0, QString());
            // 带上 HTTP 状态便于定位：404=服务器上没有 APK 文件（管理后台未上传），其他=网络/服务器异常
            emit failed(QStringLiteral("下载失败（HTTP %1）：%2").arg(httpStatus).arg(errStr));
            return;
        }
        if (redir.isValid()) { // 理论上 RedirectPolicy 已处理，保险再防一次
            QFile::remove(m_destPath);
            setProgress(0, QString());
            emit failed(QStringLiteral("下载地址跳转过多"));
            return;
        }
        setProgress(1, QStringLiteral("下载完成"));
        emit finished();
    });
    setProgress(0, QStringLiteral("准备下载..."));
}

void Updater::install()
{
#ifdef Q_OS_ANDROID
    QJniEnvironment env;
    // 先确认 androidx FileProvider 确实打进了 APK（缺依赖时给出可行动的提示）
    if (!env.findClass("androidx/core/content/FileProvider")) {
        emit failed(QStringLiteral("安装组件缺失（androidx 未打包），请改用浏览器下载"));
        return;
    }

    QJniObject context = QNativeInterface::QAndroidApplication::context();
    if (!context.isValid()) { emit failed(QStringLiteral("无法获取应用上下文")); return; }

    // 候选文件两份：应用内部私有目录（下载位置）+ 外部私有目录
    //（个别 ROM/场景下内部路径的 FileProvider root 匹配会失败，外部路径通常可用）
    const QString pkg = context.callObjectMethod("getPackageName", "()Ljava/lang/String;").toString();
    QStringList paths { m_destPath };
    QJniObject extDir = context.callObjectMethod("getExternalFilesDir", "(Ljava/lang/String;)Ljava/io/File;", nullptr);
    if (extDir.isValid()) {
        const QString extPath = extDir.callObjectMethod("getAbsolutePath", "()Ljava/lang/String;").toString();
        if (!extPath.isEmpty()) {
            const QString extApk = extPath + QStringLiteral("/lele-book.apk");
            QFile::remove(extApk);
            if (QFile::copy(m_destPath, extApk)) paths << extApk;
        }
    }

    // authority 候选：我们 manifest 里声明的 fileprovider（包名运行时值 + 字面量），
    // 以及 Qt 模板可能自带的 qtprovider（自定义 manifest 未生效时兜底）
    QStringList authorities;
    const QString literal = QStringLiteral("com.lele.book");
    for (const QString &base : { pkg, literal }) {
        authorities.removeAll(base + QStringLiteral(".fileprovider"));
        authorities << base + QStringLiteral(".fileprovider");
        authorities.removeAll(base + QStringLiteral(".qtprovider"));
        authorities << base + QStringLiteral(".qtprovider");
    }

    QString lastErr = QStringLiteral("FileProvider 均不可用");
    QJniObject uri;
    for (const QString &auth : authorities) {
        for (const QString &path : paths) {
            QJniObject jauth = QJniObject::fromString(auth);
            QJniObject jpath = QJniObject::fromString(path);
            QJniObject jfile("java/io/File", "(Ljava/lang/String;)V", jpath.object());
            QJniObject u = QJniObject::callStaticObjectMethod(
                        "androidx/core/content/FileProvider", "getUriForFile",
                        "(Landroid/content/Context;Ljava/lang/String;Ljava/io/File;)Landroid/net/Uri;",
                        context.object(), jauth.object(), jfile.object());
            if (env->ExceptionCheck()) { // Java 侧抛异常：抓异常原文，换下一组合
                QJniObject thr(env->ExceptionOccurred());
                env->ExceptionClear();
                QJniObject m = thr.callObjectMethod("getMessage", "()Ljava/lang/String;");
                lastErr = (m.isValid() ? m.toString() : QStringLiteral("Java 异常"));
                continue;
            }
            if (!u.isValid()) { lastErr = auth + QStringLiteral(" / invalid uri"); continue; }
            uri = u;
            break;
        }
        if (uri.isValid()) break;
    }
    if (!uri.isValid()) {
        emit failed(QStringLiteral("无法生成安装地址（%1），请改用浏览器下载").arg(lastErr));
        return;
    }

    // 调起安装器整个动作收进 Java（ImageHelper.installApk）：
    // C++ 侧经 JNI 拼 Intent 时 void 方法（setDataAndType/addFlags/startActivity）
    // 误用 callObjectMethod，在模拟器上 startActivity 一返回就 SEGV
    const jboolean ok = QJniObject::callStaticMethod<jboolean>(
                "com/lele/book/ImageHelper", "installApk",
                "(Landroid/content/Context;Ljava/lang/String;)Z",
                context.object(), QJniObject::fromString(uri.toString()).object());
    if (env->ExceptionCheck()) env->ExceptionClear();
    if (!ok) emit failed(QStringLiteral("无法调起安装器，请改用浏览器下载"));
#else
    emit failed(QStringLiteral("当前平台不支持应用内安装，请用浏览器下载"));
#endif
}
