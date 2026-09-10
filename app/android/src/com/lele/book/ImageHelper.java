package com.lele.book;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.net.Uri;

/**
 * 相册图片读取/解码助手（纯 Java，异常自兜底）。
 *
 * 之所以放 Java 里做：此前 C++ 经 JNI 逐段读 ContentResolver.openInputStream 字节流，
 * 在 x86_64 模拟器上 ContentResolver.openInputStream 内部直接 SIGSEGV（java.lang.String.getChars
 * 里崩掉整个进程）；真机 HEIC/HEIF 照片 Qt 的 QImage 也解不了。
 * 这里一次调用完成「读流→按尺寸采样→缩放→压成 JPEG 字节」，任何一步失败返回 null，
 * C++ 侧只拿结果，不再碰 ContentResolver 的流。
 */
public class ImageHelper {

    /**
     * 读取 content:// 或 file:// 图片并输出为 JPEG 字节。
     * 注意 uriStr 必须是 String：C++ 侧手里只有 jstring，
     * 此前直接把 jstring 当 android.net.Uri 传给 openInputStream，
     * JNI 不做类型检查 —— 真机上 ClassCastException（表现为"图片处理失败"），
     * x86_64 模拟器上更是直接 SEGV。这里在 Java 内 Uri.parse 转成真 Uri。
     * @param maxDim 输出最长边上限（像素）
     * @param quality JPEG 质量 1-100
     * @return JPEG 字节；失败返回 null
     */
    public static byte[] readScaledJpeg(Context ctx, String uriStr, int maxDim, int quality) {
        if (uriStr == null || uriStr.isEmpty()) return null;
        Uri uri = Uri.parse(uriStr);
        try {
            byte[] r = readScaledJpegInner(ctx, uri, maxDim, quality);
            if (r == null) android.util.Log.e("ImageHelper", "readScaledJpeg failed for " + uriStr);
            return r;
        } catch (Throwable t) {
            android.util.Log.e("ImageHelper", "readScaledJpeg exception for " + uriStr, t);
            return null;
        }
    }

    private static byte[] readScaledJpegInner(Context ctx, Uri uri, int maxDim, int quality) {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            decode(ctx, uri, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;

            // inSampleSize 采样：先粗降到目标的一半以内，避免大图整张进内存
            int sample = 1;
            while (bounds.outWidth / (sample * 2) >= maxDim && bounds.outHeight / (sample * 2) >= maxDim) {
                sample *= 2;
            }
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            Bitmap bmp = decode(ctx, uri, opts);
            if (bmp == null) return null;

            // 采样后仍超过 maxDim 再精确缩放一次
            int w = bmp.getWidth(), h = bmp.getHeight();
            if (w > maxDim || h > maxDim) {
                float scale = w >= h ? (float) maxDim / w : (float) maxDim / h;
                Matrix m = new Matrix();
                m.postScale(scale, scale);
                Bitmap scaled = Bitmap.createBitmap(bmp, 0, 0, w, h, m, true);
                if (scaled != bmp) bmp.recycle();
                bmp = scaled;
            }

            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.JPEG, quality, out);
            bmp.recycle();
            return out.toByteArray();
    }

    private static Bitmap decode(Context ctx, Uri uri, BitmapFactory.Options opts) {
        java.io.InputStream is = null;
        try {
            is = ctx.getContentResolver().openInputStream(uri);
            if (is == null) return null;
            return BitmapFactory.decodeStream(is, null, opts);
        } catch (Throwable t) {
            return null;
        } finally {
            if (is != null) { try { is.close(); } catch (Throwable ignored) {} }
        }
    }

    /**
     * 调起系统安装器安装 APK（应用内更新）。
     * C++ 侧经 JNI 拼 Intent 调 startActivity 在模拟器上会 SEGV（void 方法误用
     * callObjectMethod 等隐患），整个动作收进 Java，异常自兜底。
     * @return true = 已成功发出安装意图
     */
    public static boolean installApk(Context ctx, String uriStr) {
        try {
            Uri uri = Uri.parse(uriStr);
            android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_VIEW);
            i.setDataAndType(uri, "application/vnd.android.package-archive");
            i.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            return true;
        } catch (Throwable t) {
            android.util.Log.e("ImageHelper", "installApk failed for " + uriStr, t);
            return false;
        }
    }

    /**
     * 从服务器下载宣传海报并保存到系统相册（Pictures/乐乐书市/）。
     * 走 MediaStore 插入，API 29+ 无需存储权限。
     * @return true = 保存成功
     */
    public static boolean savePoster(Context ctx, String urlStr) {
        try {
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection)
                    new java.net.URL(urlStr).openConnection();
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);
            java.io.InputStream in = conn.getInputStream();
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            in.close();
            byte[] data = out.toByteArray();
            if (data.length == 0) return false;

            android.content.ContentValues v = new android.content.ContentValues();
            v.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME,
                    "乐乐书市海报_" + System.currentTimeMillis() + ".png");
            v.put(android.provider.MediaStore.Images.Media.MIME_TYPE, "image/png");
            v.put(android.provider.MediaStore.Images.Media.RELATIVE_PATH,
                    android.os.Environment.DIRECTORY_PICTURES + "/乐乐书市");
            android.net.Uri uri = ctx.getContentResolver()
                    .insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
            if (uri == null) return false;
            java.io.OutputStream os = ctx.getContentResolver().openOutputStream(uri);
            os.write(data);
            os.close();
            return true;
        } catch (Throwable t) {
            android.util.Log.e("ImageHelper", "savePoster failed", t);
            return false;
        }
    }
}
