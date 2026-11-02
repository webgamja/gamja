package com.gamja.app

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * 감자 앱(APK) 업데이트. 스토어를 거치지 않고 gamja-release의 최신 APK를 받아 설치한다.
 * 같은 서명 키로 만든 APK라서 로그인·대화·Ubuntu는 그대로 남는다. 설치 확인 버튼은 안드로이드 정책상 사용자가 직접 누른다.
 */
object Updater {
    private const val BASE = "https://github.com/webgamja/gamja-release/releases/latest/download"

    /** code: 앱 내부 번호(커질수록 새 버전), name: 사람에게 보이는 번호 */
    class Info(val code: Int, val name: String, val apkSha256: String)

    @Suppress("DEPRECATION")
    fun currentCode(ctx: Context): Int = ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionCode

    fun currentName(ctx: Context): String = ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: ""

    /** 최신 버전 정보. 네트워크 문제 등이면 null */
    fun fetchLatest(): Info? = runCatching {
        val conn = URL("$BASE/latest.json").openConnection() as HttpURLConnection
        conn.connectTimeout = 8000
        conn.readTimeout = 8000
        val j = JSONObject(conn.inputStream.bufferedReader().readText())
        // appCode·appName은 앱 코드가 바뀐 날짜로 매긴 앱 번호 (감자알의 build·version과 따로 간다)
        Info(j.getInt("appCode"), j.getString("appName"), j.getString("apkSha256"))
    }.getOrNull()

    /** 지금 설치된 것보다 새 버전이 있으면 그 정보, 없으면 null */
    fun newer(ctx: Context): Info? = fetchLatest()?.takeIf { it.code > currentCode(ctx) }

    /** APK를 내려받아 체크섬을 확인한 뒤 설치 화면을 띄운다. 성공이면 null, 실패면 이유를 돌려준다 */
    fun downloadAndInstall(ctx: Context, info: Info, onStep: (String) -> Unit): String? {
        val file = File(ctx.cacheDir, "gamja-update.apk")
        return try {
            onStep("내려받는 중...")
            val conn = URL("$BASE/gamja.apk").openConnection() as HttpURLConnection
            conn.connectTimeout = 15000
            conn.readTimeout = 30000
            val md = MessageDigest.getInstance("SHA-256")
            conn.inputStream.use { input ->
                file.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        md.update(buf, 0, n)
                    }
                }
            }
            val sha = md.digest().joinToString("") { "%02x".format(it) }
            if (sha != info.apkSha256) {
                file.delete()
                return "내려받은 파일이 손상됐어요. 잠시 뒤 다시 시도해 주세요."
            }
            onStep("설치 화면을 여는 중...")
            install(ctx, file)
            null
        } catch (e: Exception) {
            "내려받지 못했어요: ${e.message}"
        }
    }

    /** 안드로이드 설치 도구(PackageInstaller)에 APK를 넘긴다. 확인 화면은 UpdateReceiver가 띄운다 */
    private fun install(ctx: Context, file: File) {
        val installer = ctx.packageManager.packageInstaller
        val id = installer.createSession(PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL))
        installer.openSession(id).use { session ->
            file.inputStream().use { input ->
                session.openWrite("gamja.apk", 0, file.length()).use { out ->
                    input.copyTo(out)
                    session.fsync(out)
                }
            }
            val intent = Intent(ctx, UpdateReceiver::class.java).setAction(UpdateReceiver.ACTION)
            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            if (Build.VERSION.SDK_INT >= 31) flags = flags or PendingIntent.FLAG_MUTABLE // 설치 결과를 채워 보내려면 필요
            session.commit(PendingIntent.getBroadcast(ctx, id, intent, flags).intentSender)
        }
    }
}
