#include "session.h"

#include <QFile>
#include <QHttpMultiPart>
#include <QNetworkReply>
#include <QNetworkRequest>
#include <QUrl>

Session::Session(QObject *parent) : QObject(parent)
{
    m_token = m_s.value("auth/token", "").toString();
    m_baseUrl = m_s.value("auth/baseUrl", "http://47.91.25.15:8901").toString();
    m_nickname = m_s.value("profile/nickname", "").toString();
    m_email = m_s.value("profile/email", "").toString();
    m_gender = m_s.value("profile/gender", 0).toInt();
    m_onboardingDone = m_s.value("ui/onboardingDone", false).toBool();
    m_filterJson = m_s.value("ui/filterJson", "").toString();
    m_mode = m_s.value("ui/mode", "errand").toString();
    m_myId = m_s.value("profile/myId", 0).toInt();
    m_dismissNoticeId = m_s.value("ui/dismissNoticeId", 0).toInt();
    m_safeTop = m_s.value("ui/safeTop", 0).toInt();
}

void Session::setToken(const QString &t)
{
    if (m_token == t) return;
    m_token = t;
    m_s.setValue("auth/token", t);
    emit tokenChanged();
}

void Session::setBaseUrl(const QString &u)
{
    if (m_baseUrl == u) return;
    m_baseUrl = u;
    m_s.setValue("auth/baseUrl", u);
    emit baseUrlChanged();
}

void Session::setNickname(const QString &n)
{
    if (m_nickname == n) return;
    m_nickname = n;
    m_s.setValue("profile/nickname", n);
    emit nicknameChanged();
}

void Session::setEmail(const QString &e)
{
    if (m_email == e) return;
    m_email = e;
    m_s.setValue("profile/email", e);
    emit emailChanged();
}

void Session::setGender(int g)
{
    if (m_gender == g) return;
    m_gender = g;
    m_s.setValue("profile/gender", g);
    emit genderChanged();
}

void Session::setOnboardingDone(bool d)
{
    if (m_onboardingDone == d) return;
    m_onboardingDone = d;
    m_s.setValue("ui/onboardingDone", d);
    emit onboardingDoneChanged();
}

void Session::setAppVersionCode(int v)
{
    m_appVersionCode = v;
}

void Session::setFilterJson(const QString &f)
{
    if (m_filterJson == f) return;
    m_filterJson = f;
    m_s.setValue("ui/filterJson", f);
    emit filterJsonChanged();
}

void Session::setMode(const QString &m)
{
    if (m_mode == m) return;
    m_mode = m;
    m_s.setValue("ui/mode", m);
    emit modeChanged();
}

void Session::setMyId(int id)
{
    if (m_myId == id) return;
    m_myId = id;
    m_s.setValue("profile/myId", id);
    emit myIdChanged();
}

void Session::setSafeTop(int px)
{
    if (m_safeTop == px) return;
    m_safeTop = px;
    m_s.setValue("ui/safeTop", px);
    emit safeTopChanged();
}

void Session::setDismissNoticeId(int id)
{
    if (m_dismissNoticeId == id) return;
    m_dismissNoticeId = id;
    m_s.setValue("ui/dismissNoticeId", id);
    emit dismissNoticeIdChanged();
}

void Session::clear()
{
    setToken("");
    setNickname("");
    setEmail("");
    setMyId(0);
}

QString Session::uploadFile(const QString &path, const QUrl &fileUrl, int timeoutMs, const QVariantMap &extra)
{
    const QString key = QStringLiteral("u%1").arg(++m_uploadSeq);
    const QString local = fileUrl.toLocalFile();
    QFile *file = new QFile(local);
    if (local.isEmpty() || !file->open(QIODevice::ReadOnly)) {
        file->deleteLater();
        // 统一走信号回报，调用方（api.js）无需区分同步/异步失败
        QMetaObject::invokeMethod(this, [this, key]() {
            emit uploadFinished(key, false, 0,
                                QStringLiteral("{\"error\":{\"code\":\"FILE\",\"msg\":\"无法读取所选图片\"}}"));
        }, Qt::QueuedConnection);
        return key;
    }

    auto *multi = new QHttpMultiPart(QHttpMultiPart::FormDataType);
    // 随文件一起提交的文本字段（批量发书的 titles/location/price_note 等）
    for (auto it = extra.constBegin(); it != extra.constEnd(); ++it) {
        QHttpPart textPart;
        textPart.setHeader(QNetworkRequest::ContentDispositionHeader,
                           QStringLiteral("form-data; name=\"%1\"").arg(it.key()));
        textPart.setBody(it.value().toString().toUtf8());
        multi->append(textPart);
    }
    QHttpPart part;
    part.setHeader(QNetworkRequest::ContentTypeHeader, QStringLiteral("image/jpeg"));
    // 服务端 multer 按字段名 file 取文件；类型恒为 JPEG（ImageUtil.compress 统一压成 jpg）
    part.setHeader(QNetworkRequest::ContentDispositionHeader,
                   QStringLiteral("form-data; name=\"file\"; filename=\"photo.jpg\""));
    part.setBodyDevice(file);
    file->setParent(multi); // multi 析构时连带关闭并释放文件
    multi->append(part);

    QNetworkRequest req(QUrl(m_baseUrl + path));
    req.setTransferTimeout(timeoutMs > 0 ? timeoutMs : 60000);
    if (!m_token.isEmpty())
        req.setRawHeader("Authorization", "Bearer " + m_token.toUtf8());

    QNetworkReply *reply = m_nam.post(req, multi);
    multi->setParent(reply);
    connect(reply, &QNetworkReply::finished, this, [this, reply, key]() {
        reply->deleteLater();
        const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
        const bool ok = reply->error() == QNetworkReply::NoError;
        emit uploadFinished(key, ok, status, QString::fromUtf8(reply->readAll()));
    });
    return key;
}
