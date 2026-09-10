#ifndef IMAGEUTIL_H
#define IMAGEUTIL_H

#include <QObject>
#include <QUrl>

// 头像压缩：把用户选择的图片等比缩放到限制尺寸内并输出为 JPEG 临时文件（服务端带不动大图，必须压缩）
class ImageUtil : public QObject
{
    Q_OBJECT
public:
    explicit ImageUtil(QObject *parent = nullptr);

    // 压缩 src 到临时目录并返回输出文件的 URL；失败返回空字符串。
    // maxDim 最长边像素，maxKb 大小上限（KB），质量从 80 起逐步降低直到满足
    Q_INVOKABLE QString compress(const QUrl &src, int maxDim, int maxKb);

    // 下载 url 指向的宣传海报并保存到系统相册（走 Java ImageHelper，MediaStore 免存储权限）
    Q_INVOKABLE bool savePosterToGallery(const QUrl &url);
};

#endif // IMAGEUTIL_H
