#ifndef UPDATER_H
#define UPDATER_H

#include <QObject>
#include <QNetworkAccessManager>
#include <QFile>

class QNetworkReply;

// 应用内更新：下载 APK -> 调用系统安装界面（Android FileProvider）
class Updater : public QObject
{
    Q_OBJECT
    Q_PROPERTY(qreal progress READ progress NOTIFY progressChanged)
    Q_PROPERTY(QString statusText READ statusText NOTIFY progressChanged)

public:
    explicit Updater(QObject *parent = nullptr);
    ~Updater() override;

    qreal progress() const { return m_progress; }
    QString statusText() const { return m_statusText; }
    bool running() const { return m_reply != nullptr; }

    // 开始下载 APK 到应用私有目录
    Q_INVOKABLE void start(const QString &url);
    // 触发系统安装界面（Android）
    Q_INVOKABLE void install();

signals:
    void progressChanged();
    void finished();          // 下载完成（可调用 install()）
    void failed(const QString &msg);

private:
    void setProgress(qreal p, const QString &text);

    QNetworkAccessManager m_nam;
    QNetworkReply *m_reply = nullptr;
    QFile m_file;             // 流式落盘：readyRead 即写，不整包占内存
    QString m_destPath;
    qreal m_progress = 0;
    QString m_statusText;
};

#endif // UPDATER_H
