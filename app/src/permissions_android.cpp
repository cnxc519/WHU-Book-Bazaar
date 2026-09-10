// Android 平台的定位权限申请实现（桌面构建不参与编译）
// 注意：Qt 权限 API 在 <QPermission>（QLocationPermission 等）；
// 请求入口是 QCoreApplication::requestPermission()（Qt 6.8+，QtPermission::request 已移除）
#include "permissions.h"

#ifdef Q_OS_ANDROID

#include <QCoreApplication>
#include <QPermission>

void Permissions::requestAndroidLocation()
{
    QLocationPermission p;
    p.setAccuracy(QLocationPermission::Precise);

    auto *app = QCoreApplication::instance();
    const auto status = app->checkPermission(p);
    if (status == Qt::PermissionStatus::Granted) { // 已授权过：直接继续
        emit locationResult(true);
        return;
    }
    if (status == Qt::PermissionStatus::Denied) { // 曾被拒绝：引导去系统设置，不再重复弹
        emit locationResult(false);
        return;
    }
    // Undetermined：首次弹系统授权框
    app->requestPermission(p, this, [this](const QPermission &r) {
        emit locationResult(r.status() == Qt::PermissionStatus::Granted);
    });
}

#endif
