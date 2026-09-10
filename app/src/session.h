#ifndef SESSION_H
#define SESSION_H

#include <QObject>
#include <QSettings>
#include <QNetworkAccessManager>

// 本地会话：登录态与偏好设置的持久化（QSettings）+ 文件上传
class Session : public QObject
{
    Q_OBJECT
    Q_PROPERTY(QString token READ token WRITE setToken NOTIFY tokenChanged)
    Q_PROPERTY(QString baseUrl READ baseUrl WRITE setBaseUrl NOTIFY baseUrlChanged)
    Q_PROPERTY(QString nickname READ nickname WRITE setNickname NOTIFY nicknameChanged)
    Q_PROPERTY(QString email READ email WRITE setEmail NOTIFY emailChanged)
    Q_PROPERTY(int gender READ gender WRITE setGender NOTIFY genderChanged)
    Q_PROPERTY(bool onboardingDone READ onboardingDone WRITE setOnboardingDone NOTIFY onboardingDoneChanged)
    Q_PROPERTY(int appVersionCode READ appVersionCode CONSTANT)
    Q_PROPERTY(QString filterJson READ filterJson WRITE setFilterJson NOTIFY filterJsonChanged)
    Q_PROPERTY(QString mode READ mode WRITE setMode NOTIFY modeChanged) // errand 代跑 | market 书市
    Q_PROPERTY(int safeTop READ safeTop WRITE setSafeTop NOTIFY safeTopChanged FINAL)
    Q_PROPERTY(int myId READ myId WRITE setMyId NOTIFY myIdChanged)
    Q_PROPERTY(int dismissNoticeId READ dismissNoticeId WRITE setDismissNoticeId NOTIFY dismissNoticeIdChanged)

public:
    explicit Session(QObject *parent = nullptr);

    // 所有 setter 必须 Q_INVOKABLE：QML 以 Session.setXxx() 方法式调用，
    // 只有 Q_PROPERTY WRITE 的话 QML 端会报 "is not a function"
    QString token() const { return m_token; }
    Q_INVOKABLE void setToken(const QString &t);

    QString baseUrl() const { return m_baseUrl; }
    Q_INVOKABLE void setBaseUrl(const QString &u);

    QString nickname() const { return m_nickname; }
    Q_INVOKABLE void setNickname(const QString &n);

    QString email() const { return m_email; }
    Q_INVOKABLE void setEmail(const QString &e);

    int gender() const { return m_gender; } // 0=女 1=男（与服务端一致用字符串，此处存显示用）
    Q_INVOKABLE void setGender(int g);

    bool onboardingDone() const { return m_onboardingDone; }
    Q_INVOKABLE void setOnboardingDone(bool d);

    int appVersionCode() const { return m_appVersionCode; }
    Q_INVOKABLE void setAppVersionCode(int v);

    QString filterJson() const { return m_filterJson; }
    Q_INVOKABLE void setFilterJson(const QString &f);

    QString mode() const { return m_mode; }
    Q_INVOKABLE void setMode(const QString &m);

    int myId() const { return m_myId; }
    Q_INVOKABLE void setMyId(int id);

    int safeTop() const { return m_safeTop; }
    Q_INVOKABLE void setSafeTop(int px);

    Q_INVOKABLE void clear(); // 退出登录时清空

    // 文件上传（multipart）：QML 的 XMLHttpRequest 没有 FormData，带文件的接口
    // （书籍封面/头像/批量发书）只能在 C++ 用 QNetworkAccessManager 发送。
    // path=API 路径（如 /api/books/5/photo），fileUrl=file:/// 本地文件，timeoutMs 毫秒，
    // extra=随文件一起提交的文本表单字段（可省）。返回本次上传的 key，
    // 结果统一经 uploadFinished(key, ok, status, responseText) 异步回报。
    Q_INVOKABLE QString uploadFile(const QString &path, const QUrl &fileUrl, int timeoutMs = 60000, const QVariantMap &extra = QVariantMap());

    int dismissNoticeId() const { return m_dismissNoticeId; }
    Q_INVOKABLE void setDismissNoticeId(int id);

signals:
    void tokenChanged();
    void baseUrlChanged();
    void nicknameChanged();
    void emailChanged();
    void genderChanged();
    void onboardingDoneChanged();
    void filterJsonChanged();
    void modeChanged();
    void myIdChanged();
    void safeTopChanged();
    void dismissNoticeIdChanged();
    void uploadFinished(const QString &key, bool ok, int status, const QString &response);

private:
    QNetworkAccessManager m_nam;
    int m_uploadSeq = 0;
    QSettings m_s;
    QString m_token;
    QString m_baseUrl;
    QString m_nickname;
    QString m_email;
    int m_gender = 0;
    bool m_onboardingDone = false;
    int m_appVersionCode = 0;
    QString m_filterJson;
    QString m_mode = QStringLiteral("errand");
    int m_myId = 0;
    int m_safeTop = 0;
    int m_dismissNoticeId = 0;
};

#endif // SESSION_H
