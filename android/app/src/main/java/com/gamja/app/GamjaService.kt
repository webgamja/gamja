package com.gamja.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONObject
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * 감자 서버를 상시 실행하는 서비스. 상단 알림을 띄워 안드로이드가 끄지 못하게 하고,
 * Ubuntu 안에서 start.sh의 감시 루프를 돌린다 (채팅에서 요청한 재시작·자동 복구는 그 루프가 처리).
 */
class GamjaService : Service() {
    private var runner: Thread? = null
    @Volatile private var proc: Process? = null
    @Volatile private var stopping = false
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(1, notification())
        if (wakeLock == null) {
            wakeLock = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "gamja-egg:run").apply { acquire() }
            @Suppress("DEPRECATION")
            wifiLock = applicationContext.getSystemService(WifiManager::class.java)
                .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "gamja:wifi").apply { acquire() }
        }
        inst = this
        if (runner == null) runner = thread(name = "gamja-egg") { loop() }
        if (watcher == null) watcher = thread(name = "gamja-notify") { watch() }
        if (updateWatcher == null) updateWatcher = thread(name = "gamja-update") { watchUpdate() }
        return START_STICKY
    }

    // ---------- 🆕 감자 앱 업데이트 알림: 켠 지 1분 뒤 한 번, 이후 3시간마다 확인 ----------
    private var updateWatcher: Thread? = null

    private fun watchUpdate() {
        runCatching { Thread.sleep(60_000) }
        while (!stopping) {
            // 결과를 감자알 로그(⋮ → 감자알 로그)에 한 줄 남겨서, 알림이 안 올 때 이유를 볼 수 있게 한다
            val result = try {
                val latest = Updater.fetchLatest()
                val mine = Updater.currentCode(this)
                val prefs = getSharedPreferences("update", MODE_PRIVATE)
                when {
                    latest == null -> "새 버전 확인에 실패했어요 (인터넷 연결 확인)"
                    latest.code <= mine -> "최신이에요 (내 버전 ${Updater.currentName(this)})"
                    // 같은 버전은 한 번만 알린다 (알림을 지웠는데 계속 뜨지 않도록)
                    prefs.getInt("notified", 0) >= latest.code -> "새 버전 ${latest.name}이 있어요 (이미 알림을 보냈어요)"
                    else -> {
                        notifyUpdate(latest)
                        prefs.edit().putInt("notified", latest.code).apply()
                        "새 버전 ${latest.name} 알림을 보냈어요"
                    }
                }
            } catch (e: Exception) {
                "알림을 보내지 못했어요: ${e.message}"
            }
            val time = java.text.SimpleDateFormat("MM-dd HH:mm", java.util.Locale.KOREA).format(java.util.Date())
            runCatching { Paths(this).serverLog.appendText("[앱 업데이트 확인] $time $result\n") }
            runCatching { Thread.sleep(3 * 3600 * 1000L) }
        }
    }

    private fun notifyUpdate(info: Updater.Info) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(UPDATE_CHANNEL, "감자 업데이트", NotificationManager.IMPORTANCE_DEFAULT))
        val open = Intent(this, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_UPDATE, true)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pi = PendingIntent.getActivity(this, 2, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        nm.notify(2, Notification.Builder(this, UPDATE_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("🥔 새 감자가 나왔어요 (${info.name})")
            .setContentText("눌러서 업데이트하세요. 로그인과 대화는 그대로 남아요.")
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build())
    }

    // ---------- 🔔 완료 알림: 서버의 /api/events를 몇 초마다 확인 ----------
    private var watcher: Thread? = null
    private var cookie: String? = null

    private fun watch() {
        var since = 0L // 0 = 아직 서버 시각을 모름 → 첫 응답의 now부터 (예전 답변은 알리지 않음)
        var nextId = 100
        while (!stopping) {
            runCatching { Thread.sleep(5000) }
            try {
                val json = JSONObject(getEvents(since) ?: continue)
                if (since == 0L) { since = json.getLong("now"); continue }
                val events = json.getJSONArray("events")
                for (i in 0 until events.length()) {
                    val e = events.getJSONObject(i)
                    since = maxOf(since, e.getLong("ts"))
                    // 감자 화면을 보고 있으면 이미 답이 보이므로 알리지 않는다
                    if (!MainActivity.visible) notifyDone(e, nextId++)
                }
            } catch (_: Exception) {
                // 서버 재시작 중 등 → 다음 차례에 다시
            }
        }
    }

    private fun getEvents(since: Long): String? {
        repeat(2) {
            val c = cookie ?: login() ?: return null
            val conn = URL("${MainActivity.BASE}/api/events?since=$since").openConnection() as HttpURLConnection
            conn.connectTimeout = 2000; conn.readTimeout = 3000
            conn.setRequestProperty("Cookie", c)
            when (conn.responseCode) {
                200 -> return conn.inputStream.bufferedReader().readText()
                401 -> cookie = null // 비밀번호가 바뀌었거나 만료 → 다시 로그인
                else -> return null
            }
        }
        return null
    }

    private fun login(): String? {
        val pw = Paths(this).password() ?: return null
        val conn = URL("${MainActivity.BASE}/api/login").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.connectTimeout = 2000; conn.readTimeout = 3000
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(JSONObject().put("password", pw).toString().toByteArray()) }
        if (conn.responseCode != 200) return null
        cookie = conn.getHeaderField("Set-Cookie")?.substringBefore(";")
        return cookie
    }

    private fun notifyDone(e: JSONObject, id: Int) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(DONE_CHANNEL, "답변 완료 알림", NotificationManager.IMPORTANCE_HIGH))
        val project = e.optString("project")
        val sec = e.optInt("seconds")
        val took = if (sec >= 60) "${sec / 60}분 ${sec % 60}초" else "${sec}초"
        val title = (if (e.optBoolean("error")) "⚠️ " else "✅ ") +
            (if (project.isEmpty()) "답변 완료" else "$project · 답변 완료") + " ($took)"
        val open = Intent(this, MainActivity::class.java)
            .putExtra(MainActivity.EXTRA_PROJECT, project)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pi = PendingIntent.getActivity(this, id, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val preview = e.optString("preview")
        nm.notify(id, Notification.Builder(this, DONE_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title)
            .setContentText(preview)
            .setStyle(Notification.BigTextStyle().bigText(preview))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build())
    }

    private fun loop() {
        val p = Paths(this)
        while (!stopping) {
            try {
                if (p.serverLog.length() > 1_000_000) p.serverLog.delete()
                val pr = Proot(this).process("/bin/bash", "-lc", "cd /root/gamja-egg && exec bash ./start.sh run").start()
                proc = pr
                FileOutputStream(p.serverLog, true).bufferedWriter().use { log ->
                    pr.inputStream.bufferedReader().forEachLine { log.write(it); log.newLine(); log.flush() }
                }
                pr.waitFor()
            } catch (e: Exception) {
                runCatching { p.serverLog.appendText("서비스 오류: ${e.message}\n") }
            }
            if (!stopping) Thread.sleep(3000)
        }
    }

    override fun onDestroy() {
        stopping = true
        proc?.destroy()
        runCatching { wakeLock?.release() }
        runCatching { wifiLock?.release() }
        if (inst === this) inst = null
        super.onDestroy()
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "감자 실행 상태", NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("감자 실행 중")
            .setContentText("감자알이 정상적으로 동작되고 있어요.")
            .setContentIntent(open)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL = "gamja"
        private const val DONE_CHANNEL = "gamja-done"
        private const val UPDATE_CHANNEL = "gamja-update"
        @Volatile private var inst: GamjaService? = null
        /** C: CPU를 깨워 두는 잠금(WakeLock)을 실제로 쥐고 있는지 */
        fun cpuHeld(): Boolean = runCatching { inst?.wakeLock?.isHeld == true }.getOrDefault(false)
        /** N: 와이파이를 켜 두는 잠금(WifiLock)을 실제로 쥐고 있는지 */
        fun netHeld(): Boolean = runCatching { inst?.wifiLock?.isHeld == true }.getOrDefault(false)
        fun start(ctx: Context) {
            ctx.startForegroundService(Intent(ctx, GamjaService::class.java))
        }
    }
}
