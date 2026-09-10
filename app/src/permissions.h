#pragma once

#include <QObject>

// 定位权限运行时申请：Android 6+ 需要动态请求 ACCESS_FINE_LOCATION，
// 此前只声明在 manifest 里从未请求 → PositionSource 永远拿不到位置 → 打卡/发位置一律"定位超时"
class Permissions : public QObject
{
    Q_OBJECT
public:
    using QObject::QObject;

    // 异步请求精确定位；结果通过 locationResult 信号返回（已授权/桌面环境立即返回 granted）
    Q_INVOKABLE void requestLocation()
    {
#ifdef Q_OS_ANDROID
        requestAndroidLocation();
#else
        emit locationResult(true);
#endif
    }

signals:
    void locationResult(bool granted);

private:
#ifdef Q_OS_ANDROID
    void requestAndroidLocation();
#endif
};
