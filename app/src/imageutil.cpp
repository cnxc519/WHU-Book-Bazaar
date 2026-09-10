#include "imageutil.h"
#include <QImage>
#include <QImageReader>
#include <QImageWriter>
#include <QFile>
#include <QFileInfo>
#include <QStandardPaths>
#include <QUrl>
#include <QRandomGenerator>

#ifdef Q_OS_ANDROID
#include <QJniEnvironment>
#include <QJniObject>
#include <QCoreApplication>

// Android 相册选择器返回 content:// URI。
// 此前 C++ 经 JNI 逐段读 openInputStream 字节流：x86_64 模拟器上 ContentResolver 内部
// 直接 SIGSEGV（崩在 java.lang.String.getChars），真机 HEIC/HEIF 照片 QImage 也解不了。
// 改为调应用自带的 ImageHelper（app/android/src/com/lele/book/ImageHelper.java）：
// Java 侧一次完成 读流→采样→缩放→压 JPEG，异常自兜底，失败返回 null。
static QByteArray readContentUriViaHelper(const QUrl &url, int maxDim, int quality)
{
    QJniEnvironment env;
    if (!env.findClass("com/lele/book/ImageHelper")) {
        qWarning() << "[ImageUtil] findClass ImageHelper FAILED";
        return {};
    }
    QJniObject context = QNativeInterface::QAndroidApplication::context();
    if (!context.isValid()) return {};
    // uri 以 String 传递（JNI 侧没有 android.net.Uri 包装，直接塞 jstring 给 Uri 形参
    // 会类型错乱：真机 ClassCastException / 模拟器 SEGV），Java 侧内部 Uri.parse
    QJniObject juri = QJniObject::fromString(url.toString());
    QJniObject bytes = QJniObject::callStaticObjectMethod(
                "com/lele/book/ImageHelper", "readScaledJpeg",
                "(Landroid/content/Context;Ljava/lang/String;II)[B",
                context.object(), juri.object(), (jint)maxDim, (jint)quality);
    if (env.checkAndClearExceptions() || !bytes.isValid()) return {};

    // jbyteArray 没有 .length() 方法（那是字段），必须走 JNI 数组接口；
    // 此前 callMethod<jint>("length") 直接 NoSuchMethodError，白白丢掉已解码好的图片
    const jsize len = env->GetArrayLength(static_cast<jbyteArray>(bytes.object()));
    if (len <= 0) return {};
    QByteArray out(len, Qt::Uninitialized);
    env->GetByteArrayRegion(static_cast<jbyteArray>(bytes.object()), 0, len,
                            reinterpret_cast<jbyte *>(out.data()));
    env.checkAndClearExceptions();
    return out;
}
#endif

ImageUtil::ImageUtil(QObject *parent) : QObject(parent) {}

bool ImageUtil::savePosterToGallery(const QUrl &url)
{
#ifdef Q_OS_ANDROID
    QJniEnvironment env;
    QJniObject context = QNativeInterface::QAndroidApplication::context();
    if (!context.isValid()) return false;
    QJniObject jurl = QJniObject::fromString(url.toString());
    jboolean ok = QJniObject::callStaticMethod<jboolean>(
                "com/lele/book/ImageHelper", "savePoster",
                "(Landroid/content/Context;Ljava/lang/String;)Z",
                context.object(), jurl.object());
    if (env->ExceptionCheck()) env->ExceptionClear();
    return ok;
#else
    return false;
#endif
}

QString ImageUtil::compress(const QUrl &src, int maxDim, int maxKb)
{
    QImage img;
#ifdef Q_OS_ANDROID
    // content://（相册选择器）交给 Java 侧读流+解码+缩放，直接拿 JPEG 字节
    if (src.scheme() == QLatin1String("content")) {
        const QByteArray bytes = readContentUriViaHelper(src, maxDim, 85);
        if (bytes.isEmpty()) return QString();
        img = QImage::fromData(bytes); // JPEG
    } else
#endif
    {
        const QString srcPath = src.toLocalFile();
        if (srcPath.isEmpty() || !QFile::exists(srcPath))
            return QString();

        QImageReader reader(srcPath);
        if (!reader.canRead())
            return QString();

        img = reader.read();
    }
    if (img.isNull())
        return QString();

    // 等比缩放到最长边 <= maxDim
    if (img.width() > maxDim || img.height() > maxDim) {
        if (img.width() >= img.height())
            img = img.scaledToWidth(maxDim, Qt::SmoothTransformation);
        else
            img = img.scaledToHeight(maxDim, Qt::SmoothTransformation);
    }

    // 从质量 80 起逐步降低，直到大小 <= maxKb（最低 25，保证可辨认）
    QString dir = QStandardPaths::writableLocation(QStandardPaths::TempLocation);
    QString out = dir + QLatin1String("/lele_img_")
            + QString::number(QRandomGenerator::global()->bounded(100000, 999999)) + QLatin1String(".jpg");

    int quality = 80;
    do {
        QImageWriter writer(out, "jpg");
        writer.setQuality(quality);
        if (!writer.write(img))
            return QString();
        quality -= 15;
    } while (quality >= 25 && QFileInfo(out).size() > maxKb * 1024);

    return QFileInfo(out).size() > 0 ? QUrl::fromLocalFile(out).toString() : QString();
}
