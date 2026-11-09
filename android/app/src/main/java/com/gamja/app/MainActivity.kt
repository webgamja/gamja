package com.gamja.app

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * 화면 흐름: 준비(첫 실행) → 배터리 설정 → Claude 로그인(공식 화면) → 홈.
 * 감자 콘솔(채팅 화면)은 앱 안이 아니라 폰의 브라우저로 연다.
 */
class MainActivity : Activity() {
    private lateinit var p: Paths
    private val ui = Handler(Looper.getMainLooper())
    private var installing = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        p = Paths(this)
        route()
        handleUpdateIntent(intent)
    }

    private fun route() {
        val prefs = getPreferences(MODE_PRIVATE)
        when {
            !p.isInstalled() -> showSetup()
            prefs.getBoolean("needBattery", false) && !batteryAllowed() -> showBattery()
            !p.isLoggedIn() && !prefs.getBoolean("skipLogin", false) -> showLogin()
            else -> showHome()
        }
    }

    // ---------- 3. 홈 화면: 감자는 폰의 브라우저(크롬 등)로 연다 ----------
    // 앱 안의 화면(WebView)은 폰마다 버전이 달라 화면이 안 뜨는 일이 있어서, 브라우저로 열고 앱은 감자알을 켜 두는 일과 설정을 맡는다.
    /**
     * 예전에 설치한 폰의 .env가 PORT=3000이면 26514로 바꾼다. 감자알 0.1.127부터 3000과 26514를 함께 열 수 있어서,
     * 그보다 새 감자알일 때만 바꾼다 (옛 감자알은 3000만 열어서 앱이 못 붙는다). 감자알은 다음에 다시 켜질 때 26514로 뜬다.
     */
    private fun migratePort() {
        runCatching {
            val build = java.io.File(p.appDir, "BUILD").takeIf { it.exists() }?.readText()?.trim()?.toIntOrNull() ?: 0
            if (build < 127 || !p.envFile.exists()) return
            val text = p.envFile.readText()
            val fixed = text.replace(Regex("(?m)^PORT=3000[ \\t\\r]*\$"), "PORT=26514")
            if (fixed != text) p.envFile.writeText(fixed)
        }
    }

    private fun showHome() {
        migratePort()
        syncChatCode()
        GamjaService.start(this)
        // 감자 콘솔 더보기와 같은 느낌: 옅은 회색 바탕, 흰 카드, 노란 큰 버튼
        window.statusBarColor = HOME_BG
        window.decorView.systemUiVisibility = window.decorView.systemUiVisibility or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(20), dp(16), dp(28))
        }
        // 제목 오른쪽: C(CPU 깨움 잠금)·N(와이파이 잠금) 동그라미. 실제로 쥐고 있으면 녹색, 아니면 빨강
        fun sysDot(ch: String) = TextView(this).apply {
            text = ch
            textSize = 12f
            gravity = Gravity.CENTER
            setTextColor(0xFFFFFFFF.toInt())
            setTypeface(typeface, Typeface.BOLD)
            background = rounded(0xFF9AA1AB.toInt(), 13)
        }
        val dotC = sysDot("C")
        val dotN = sysDot("N")
        fun refreshSys() {
            dotC.background = rounded(if (GamjaService.cpuHeld()) 0xFF2F9E44.toInt() else 0xFFE5484D.toInt(), 13)
            dotN.background = rounded(if (GamjaService.netHeld()) 0xFF2F9E44.toInt() else 0xFFE5484D.toInt(), 13)
        }
        refreshSys()
        val sysTick = object : Runnable {
            override fun run() {
                if (isFinishing || isDestroyed) return
                refreshSys()
                ui.postDelayed(this, 2000)
            }
        }
        ui.postDelayed(sysTick, 2000)
        root.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(8), 0, 0)
            addView(label("감자", 34f, HOME_INK, bold = true))
            addView(dotC, LinearLayout.LayoutParams(dp(26), dp(26)).apply { leftMargin = dp(12) })
            addView(dotN, LinearLayout.LayoutParams(dp(26), dp(26)).apply { leftMargin = dp(6) })
        })
        root.addView(label("감자알이 돌아가는 곳이에요", 14f, HOME_SUB).apply { setPadding(dp(4), dp(4), 0, dp(14)) })

        // 감자알 상태 카드
        val dot = View(this).apply { background = rounded(0xFF9AA1AB.toInt(), 8) }
        val statusTitle = label("감자알을 깨우는 중...", 17f, HOME_INK, bold = true)
        val statusSub = label(BASE.removePrefix("http://"), 13f, HOME_SUB)
        val statusCard = card().apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(20), dp(18), dp(20), dp(18))
            addView(dot, LinearLayout.LayoutParams(dp(12), dp(12)).apply { rightMargin = dp(14) })
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                addView(statusTitle)
                addView(statusSub)
            })
        }
        root.addView(statusCard)

        // 노란 큰 버튼
        val open = Button(this).apply {
            text = "감자 콘솔 접속하기"
            textSize = 18f
            isAllCaps = false
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(0xFF191919.toInt())
            stateListAnimator = null
            background = rounded(HOME_YELLOW, 20)
            isEnabled = false
            alpha = 0.5f
            setOnClickListener { openInBrowser(null) }
        }
        root.addView(open, LinearLayout.LayoutParams(-1, dp(60)).apply { topMargin = dp(4); bottomMargin = dp(4) })

        // 정보
        root.addView(sectionLabel("정보"))
        val eggBuild = runCatching { java.io.File(p.appDir, "BUILD").readText().trim() }.getOrNull()
        root.addView(card().apply {
            addView(versionRow("감자 버전", Updater.currentName(this@MainActivity)) { checkUpdate(silentIfLatest = false) })
            addView(divider())
            addView(versionRow("감자알 버전", if (eggBuild.isNullOrBlank()) "-" else "0.1.$eggBuild") { checkEggUpdate() })
        })
        root.addView(label("↻를 누르면 새 버전을 확인해요", 12f, HOME_SUB).apply { setPadding(dp(4), dp(2), 0, 0) })

        // 설정
        root.addView(sectionLabel("설정"))
        val batteryValue = TextView(this)
        batteryValueView = batteryValue
        val notifValue = TextView(this)
        notifValueView = notifValue
        root.addView(card().apply {
            addView(infoRow("배터리 설정", "", batteryValue) { openBatterySettings() })
            addView(divider())
            addView(infoRow("알림 허용", "", notifValue) { askNotifOrSettings() })
        })
        refreshBatteryValue()
        refreshNotifValue()
        // 처음 열 때 한 번 알림 허용을 물어본다 (안드로이드 13 이상은 허용해야 답변 완료 알림이 와요)
        val prefsHome = getPreferences(MODE_PRIVATE)
        if (!notifAllowed() && !prefsHome.getBoolean("notifAsked", false)) {
            prefsHome.edit().putBoolean("notifAsked", true).apply()
            askNotif()
        }

        // 문제 해결 (접어 둔다)
        root.addView(sectionLabel("문제 해결"))
        val trouble = card().apply { visibility = View.GONE }
        trouble.addView(infoRow("감자알 다시 시작", "›") {
            confirmSheet("감자알을 다시 시작할까요?", "진행 중인 답변이 있으면 끊겨요. 보통 10초쯤 걸려요.", "다시 시작", "취소") { restartEgg() }
        })
        trouble.addView(divider())
        trouble.addView(infoRow("Claude 다시 로그인", "›") { startActivityForResult(Intent(this@MainActivity, LoginActivity::class.java), REQ_LOGIN) })
        trouble.addView(divider())
        trouble.addView(infoRow("감자알 로그 보기", "›") { showLog() })
        trouble.addView(divider())
        trouble.addView(infoRow("오픈소스 라이선스", "›") { showLicenses() })
        root.addView(card().apply {
            addView(infoRow("문제 해결 도구", "›") {
                trouble.visibility = if (trouble.visibility == View.GONE) View.VISIBLE else View.GONE
            })
        })
        root.addView(trouble)
        root.addView(label("평소에는 안 봐도 돼요", 12f, HOME_SUB).apply { setPadding(dp(4), dp(2), 0, 0) })

        setContentView(ScrollView(this).apply {
            setBackgroundColor(HOME_BG)
            fitsSystemWindows = true
            addView(root)
        })

        thread {
            val ready = waitForServer()
            ui.post {
                if (isFinishing || isDestroyed) return@post
                if (ready) {
                    dot.background = rounded(0xFF2F9E44.toInt(), 8)
                    statusTitle.text = "감자알이 켜져 있어요"
                    open.isEnabled = true
                    open.alpha = 1f
                    handleProjectIntent(intent)
                } else {
                    dot.background = rounded(0xFFE5484D.toInt(), 8)
                    statusTitle.text = "감자알이 아직 안 떠요"
                    val log = runCatching { p.serverLog.readText().takeLast(600) }.getOrDefault("")
                    statusSub.text = "잠시 후 앱을 다시 열어 보세요.\n$log"
                }
            }
        }
    }

    // ---- 홈 화면 도우미 ----
    private var batteryValueView: TextView? = null
    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun rounded(color: Int, radiusDp: Int) = android.graphics.drawable.GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radiusDp).toFloat()
    }
    private fun label(s: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
        text = s
        textSize = size
        setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
    }
    private fun card() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = rounded(Color.WHITE, 20)
        setPadding(dp(20), dp(4), dp(20), dp(4))
        layoutParams = LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) }
    }
    private fun sectionLabel(s: String) = label(s, 13f, HOME_SUB, bold = true).apply { setPadding(dp(4), dp(14), 0, dp(6)) }
    private fun divider() = View(this).apply {
        setBackgroundColor(HOME_LINE)
        layoutParams = LinearLayout.LayoutParams(-1, dp(1))
    }
    /** 왼쪽 이름(아래에 작은 설명), 오른쪽 값. onClick이 있으면 눌러서 쓰는 줄 */
    private fun infoRow(name: String, value: String, valueView: TextView? = null, caption: String? = null, onClick: (() -> Unit)? = null): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(15), 0, dp(15))
            addView(LinearLayout(this@MainActivity).apply {
                orientation = LinearLayout.VERTICAL
                addView(label(name, 16f, HOME_INK))
                if (caption != null) addView(label(caption, 12f, HOME_SUB).apply { setPadding(0, dp(3), dp(8), 0) })
            }, LinearLayout.LayoutParams(0, -2, 1f))
            addView((valueView ?: TextView(this@MainActivity)).apply {
                text = value
                textSize = 16f
                setTextColor(HOME_SUB)
                gravity = Gravity.END
            })
            if (onClick != null) {
                isClickable = true
                setOnClickListener { onClick() }
            }
        }

    /** 버전 줄: 오른쪽에 버전과 ↻ 아이콘. 누르면 새 버전을 확인하고, 1초 동안은 다시 눌러도 반응하지 않는다 */
    private fun versionRow(name: String, version: String, onCheck: () -> Unit): View {
        val icon = TextView(this).apply {
            text = "↻"
            textSize = 22f
            setTextColor(HOME_INK)
            setPadding(dp(14), 0, 0, 0)
        }
        var locked = false
        val row = infoRow(name, version) {
            if (locked) return@infoRow
            locked = true
            icon.alpha = 0.3f
            ui.postDelayed({ locked = false; icon.alpha = 1f }, 1000)
            onCheck()
        }
        (row as LinearLayout).addView(icon)
        return row
    }

    private var notifValueView: TextView? = null
    private fun notifAllowed() = Build.VERSION.SDK_INT < 33 ||
        checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    private fun askNotif() {
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF)
    }
    /** 허용돼 있으면 폰의 알림 설정 화면을, 아니면 허용 창을 연다 (한 번 거절하면 안드로이드가 창을 다시 안 띄워서 설정 화면으로 보낸다) */
    private fun askNotifOrSettings() {
        val prefs = getPreferences(MODE_PRIVATE)
        if (!notifAllowed() && !prefs.getBoolean("notifDenied", false)) { askNotif(); return }
        runCatching {
            startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        }.onFailure { openAppDetails(packageName) }
    }
    private fun refreshNotifValue() {
        notifValueView?.text = if (notifAllowed()) "허용됨  ›" else "허용 필요  ›"
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQ_NOTIF) {
            if (grantResults.firstOrNull() != PackageManager.PERMISSION_GRANTED) getPreferences(MODE_PRIVATE).edit().putBoolean("notifDenied", true).apply()
            refreshNotifValue()
        }
    }

    /** 감자알을 스스로 다시 시작하게 하고(start.sh 루프가 다시 띄운다), 다시 켜질 때까지 기다린 뒤 홈 화면을 새로 그린다 */
    private fun restartEgg() {
        Toast.makeText(this, "감자알을 다시 시작하는 중...", Toast.LENGTH_SHORT).show()
        thread {
            val ok = runCatching {
                val pw = p.password() ?: return@runCatching false
                val conn = URL("$BASE/api/self-restart").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.connectTimeout = 3000; conn.readTimeout = 3000
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(JSONObject().put("password", pw).toString().toByteArray()) }
                conn.responseCode == 200
            }.getOrDefault(false)
            if (ok) { Thread.sleep(2500); waitForServer() }
            ui.post {
                if (isFinishing || isDestroyed) return@post
                Toast.makeText(this, if (ok) "다시 시작했어요" else "다시 시작하지 못했어요. 잠시 뒤에 다시 눌러 주세요", Toast.LENGTH_LONG).show()
                showHome()
            }
        }
    }

    /**
     * 감자알 업데이트를 지금 확인한다 (감자알은 3시간마다 스스로도 확인한다).
     * 새 감자알이 있으면 받아서 스스로 다시 시작하므로, 다시 켜질 때까지 기다린 뒤 홈 화면을 새로 그린다.
     */
    private fun checkEggUpdate() {
        Toast.makeText(this, "감자알 업데이트를 확인하는 중...", Toast.LENGTH_SHORT).show()
        thread {
            val status = runCatching {
                val cookie = loginCookie()?.substringBefore(';') ?: return@runCatching "error"
                val conn = URL("$BASE/api/update-check").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.doOutput = true
                conn.connectTimeout = 3000; conn.readTimeout = 120_000 // 새 감자알을 내려받는 시간을 기다린다
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Cookie", cookie)
                conn.outputStream.use { it.write("{}".toByteArray()) }
                if (conn.responseCode != 200) return@runCatching "error"
                JSONObject(conn.inputStream.bufferedReader().use { it.readText() }).optString("status", "error")
            }.getOrDefault("error")
            if (status == "restart") { Thread.sleep(2500); waitForServer() }
            ui.post {
                if (isFinishing || isDestroyed) return@post
                val build = runCatching { java.io.File(p.appDir, "BUILD").readText().trim() }.getOrNull()
                val msg = when (status) {
                    "latest" -> "지금 최신 감자알이에요 (0.1.$build)"
                    "restart" -> "새 감자알로 바뀌었어요"
                    "busy" -> "답변이 진행 중이라 끝난 뒤에 받아요"
                    "checking" -> "이미 확인하는 중이에요"
                    "off" -> "개발용 감자알은 자동 업데이트가 꺼져 있어요"
                    else -> "확인하지 못했어요. 잠시 뒤에 다시 눌러 주세요"
                }
                Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
                if (status == "restart") showHome()
            }
        }
    }

    private fun refreshBatteryValue() {
        val ok = getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)
        batteryValueView?.text = if (ok) "허용됨  ›" else "설정 필요  ›"
    }

    /** 폰의 브라우저로 감자를 연다. 앱이 한 번만 쓰는 로그인 표를 받아 함께 넘기므로 비밀번호를 다시 치지 않아도 된다 */
    private fun openInBrowser(project: String?) {
        thread {
            val ticket = runCatching { loginTicket() }.getOrNull()
            ui.post {
                val to = if (project != null) "/?project=" + Uri.encode(project) else "/"
                val url = if (ticket != null) "$BASE/api/app-login?t=${Uri.encode(ticket)}&to=${Uri.encode(to)}" else "$BASE$to"
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
                    .onFailure { Toast.makeText(this, "브라우저를 찾지 못했어요. 폰에 크롬 같은 브라우저를 설치해 주세요.", Toast.LENGTH_LONG).show() }
            }
        }
    }

    /** 🔔 완료 알림을 눌러 열렸으면 그 크루 방을 브라우저로 연다 */
    private fun handleProjectIntent(i: Intent?) {
        val project = i?.getStringExtra(EXTRA_PROJECT) ?: return
        i.removeExtra(EXTRA_PROJECT)
        openInBrowser(project)
    }

    // ---------- 1. 준비 화면 ----------
    private fun showSetup() {
        val root = pageRoot("처음 설정 1/3", "감자 준비하기",
            "이 폰을 나만의 Claude Code로 만들어요. 처음 한 번만 필요하고 10~20분쯤 걸려요. 와이파이에 연결하고 충전기를 꽂아 주세요.")
        val stepText = label("시작하기를 누르면 준비를 시작해요", 15f, HOME_INK, bold = true)
        val bar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = Installer.TOTAL_STEPS
            progressTintList = android.content.res.ColorStateList.valueOf(HOME_YELLOW)
            progressBackgroundTintList = android.content.res.ColorStateList.valueOf(HOME_LINE)
        }
        val logView = label("", 11f, HOME_SUB).apply { typeface = Typeface.MONOSPACE }
        val logScroll = ScrollView(this).apply { addView(logView) }
        root.addView(card().apply {
            setPadding(dp(20), dp(18), dp(20), dp(18))
            addView(stepText)
            addView(bar, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(10) })
        })
        root.addView(sectionLabel("진행 기록"))
        root.addView(card().apply {
            setPadding(dp(16), dp(12), dp(16), dp(12))
            addView(logScroll, LinearLayout.LayoutParams(-1, dp(220)))
        })
        val start = primaryButton("시작하기")
        showPage(root, listOf(start)) // 시작하기는 화면 아래에 고정

        val lines = ArrayDeque<String>()
        start.setOnClickListener {
            if (installing) return@setOnClickListener
            installing = true
            start.isEnabled = false
            start.text = "진행 중..."
            start.alpha = 0.5f
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) // 준비 중 화면 꺼짐 방지
            thread {
                try {
                    Installer(this,
                        onStep = { i, title -> ui.post { bar.progress = i; stepText.text = "($i/${Installer.TOTAL_STEPS}) $title" } },
                        onLog = { line -> ui.post {
                            lines.addLast(line)
                            while (lines.size > 300) lines.removeFirst()
                            logView.text = lines.joinToString("\n")
                            logScroll.post { logScroll.fullScroll(View.FOCUS_DOWN) }
                        } },
                    ).run()
                    ui.post {
                        installing = false
                        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        getPreferences(MODE_PRIVATE).edit().putBoolean("needBattery", true).apply() // 다음 단계: 배터리 설정
                        route()
                    }
                } catch (e: Exception) {
                    ui.post {
                        installing = false
                        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        stepText.text = "⚠️ 문제가 생겼어요: ${e.message}\n'다시 시도'를 누르면 끝난 단계는 건너뛰고 이어서 해요."
                        start.text = "다시 시도"
                        start.isEnabled = true
                        start.alpha = 1f
                    }
                }
            }
        }
    }

    // ---------- 2. 로그인 안내 ----------
    private fun showLogin() {
        val root = pageRoot("처음 설정 3/3", "Claude 로그인",
            "이제 공식 Claude Code 화면을 열어요. 감자는 화면을 띄워 주기만 하고, 로그인 정보는 감자를 거치지 않고 Anthropic과 직접 주고받아요.")
        root.addView(sectionLabel("이렇게 하세요"))
        root.addView(card().apply {
            val steps = listOf(
                "처음 설정 화면이 나오면 Enter로 넘어가세요.",
                "로그인 방법에서 Claude 계정(구독)을 고르세요.",
                "'로그인 주소 열기'를 눌러 브라우저에서 로그인하세요.",
                "받은 코드를 복사한 뒤 '붙여넣기'를 누르세요.",
                "로그인이 끝나면 /exit 를 입력해 나오세요.",
            )
            steps.forEachIndexed { i, s ->
                if (i > 0) addView(divider())
                addView(infoRow("${i + 1}. $s", ""))
            }
        })
        val go = primaryButton("Claude 로그인 화면 열기").apply {
            setOnClickListener { startActivityForResult(Intent(this@MainActivity, LoginActivity::class.java), REQ_LOGIN) }
        }
        // 로그인을 마쳐야 감자를 쓸 수 있다. 미루려면 앱을 종료하고, 다시 열면 이 화면에서 시작한다
        val later = ghostButton("나중에 할게요").apply {
            setOnClickListener {
                confirmSheet("앱을 종료할까요?", "Claude 로그인을 마쳐야 감자를 쓸 수 있어요.\n앱을 종료하고, 다시 열면 이 화면에서 시작해요.", "종료하기", "취소") { finishAndRemoveTask() }
            }
        }
        showPage(root, listOf(go, later))
    }

    /** 아래에서 올라오는 확인 창 */
    private fun confirmSheet(title: String, message: String, ok: String, cancel: String, onOk: () -> Unit) {
        val dlg = android.app.Dialog(this)
        dlg.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE)
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(Color.WHITE, 24)
            setPadding(dp(22), dp(24), dp(22), dp(18))
            addView(label(title, 19f, HOME_INK, bold = true))
            addView(label(message, 14f, HOME_SUB).apply { setPadding(0, dp(8), 0, dp(18)) })
            addView(primaryButton(ok).apply { setOnClickListener { dlg.dismiss(); onOk() } }, LinearLayout.LayoutParams(-1, dp(54)))
            addView(ghostButton(cancel).apply { setOnClickListener { dlg.dismiss() } }, LinearLayout.LayoutParams(-1, dp(50)).apply { topMargin = dp(8) })
        }
        dlg.setContentView(android.widget.FrameLayout(this).apply {
            setPadding(dp(12), 0, dp(12), dp(12))
            addView(box)
        })
        dlg.window?.apply {
            setBackgroundDrawableResource(android.R.color.transparent)
            setGravity(Gravity.BOTTOM)
            setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT)
        }
        dlg.show()
    }

    // ---------- 1.5 배터리 설정 (준비 다음 단계) ----------
    private var onBatteryPage = false
    private fun batteryAllowed() = getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)

    private fun showBattery() {
        onBatteryPage = true
        val root = pageRoot("처음 설정 2/3", "배터리 설정",
            "화면이 꺼져 있어도 감자알이 계속 돌아가게 해 주세요. 허용하지 않으면 폰이 감자알을 멈춰서 답변을 받지 못할 수 있어요.")
        root.addView(card().apply {
            addView(infoRow("지금 상태", if (batteryAllowed()) "허용됨" else "허용 안 됨"))
        })
        val go = primaryButton("허용하러 가기").apply { setOnClickListener { askBatteryOptimization() } }
        val later = ghostButton("나중에 할게요").apply { setOnClickListener { finishBatteryPage() } }
        showPage(root, listOf(go, later))
    }

    private fun finishBatteryPage() {
        onBatteryPage = false
        getPreferences(MODE_PRIVATE).edit().remove("needBattery").apply()
        route()
    }

    // ---------- 설정 화면 공통 모양 (감자 콘솔 더보기와 같은 팔레트) ----------
    private fun pageRoot(step: String, title: String, sub: String): LinearLayout {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(20), dp(16), dp(28))
        }
        root.addView(label(step, 13f, HOME_SUB, bold = true).apply { setPadding(dp(4), dp(8), 0, 0) })
        root.addView(label(title, 30f, HOME_INK, bold = true).apply { setPadding(dp(4), dp(4), 0, 0) })
        root.addView(label(sub, 14f, HOME_SUB).apply { setPadding(dp(4), dp(6), dp(4), dp(14)) })
        return root
    }

    /** 내용은 스크롤되고, actions(버튼)는 화면 아래에 고정된다 */
    private fun showPage(root: LinearLayout, actions: List<View> = emptyList()) {
        window.statusBarColor = HOME_BG
        window.decorView.systemUiVisibility = window.decorView.systemUiVisibility or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(HOME_BG)
            setPadding(dp(16), dp(6), dp(16), dp(16))
            for (a in actions) {
                val h = if (a.tag == "ghost") dp(52) else dp(60)
                addView(a, LinearLayout.LayoutParams(-1, h).apply { topMargin = dp(8) })
            }
        }
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(HOME_BG)
            fitsSystemWindows = true
            addView(ScrollView(this@MainActivity).apply { addView(root) }, LinearLayout.LayoutParams(-1, 0, 1f))
            if (actions.isNotEmpty()) addView(bar, LinearLayout.LayoutParams(-1, -2))
        })
    }

    private fun primaryButton(s: String) = Button(this).apply {
        text = s
        textSize = 18f
        isAllCaps = false
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(0xFF191919.toInt())
        stateListAnimator = null
        background = rounded(HOME_YELLOW, 20)
    }

    private fun ghostButton(s: String) = Button(this).apply {
        tag = "ghost"
        text = s
        textSize = 16f
        isAllCaps = false
        setTextColor(HOME_INK)
        stateListAnimator = null
        background = rounded(HOME_LINE, 20)
    }

    @Deprecated("Activity 결과 API (minSdk 26, AndroidX 없이 사용)")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_LOGIN) {
            if (p.isLoggedIn()) getPreferences(MODE_PRIVATE).edit().remove("skipLogin").apply()
            route()
        }
    }

    /**
     * 감자 앱을 새 버전으로 덮어 설치했을 때, 폰 안에 이미 설치된 감자알 코드를 APK에 든 새 코드로 바꾼다.
     * (설치 단계는 한 번만 하므로, 이걸 안 하면 새 APK를 깔아도 감자알은 옛 코드 그대로다)
     * 감자알이 스스로 업데이트해서 APK보다 새 코드가 이미 있으면(BUILD 번호 비교) 건드리지 않는다.
     * 비밀번호(.env)와 대화 기록(data)은 묶음에 없으므로 그대로 남는다.
     */
    private fun syncChatCode() {
        runCatching {
            // 앱 번호와 감자알 번호는 따로 간다 → APK 안 묶음의 빌드 번호(chat-build.txt)와 폰 안 감자알의 번호를 비교한다
            val packBuild = assets.open("egg-build.txt").bufferedReader().use { it.readText() }.trim().toIntOrNull() ?: 0
            val installed = java.io.File(p.appDir, "BUILD").takeIf { it.exists() }
                ?.readText()?.trim()?.toIntOrNull() ?: 0
            if (installed < packBuild) assets.open("gamja-egg.pack").use { Installer.untar(it, p.appDir) }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleProjectIntent(intent)
        handleUpdateIntent(intent)
    }

    // ---------- 🆕 감자 앱 업데이트 ----------
    /** 업데이트 알림을 눌러서 열렸으면 바로 업데이트 안내를 띄운다 */
    private fun handleUpdateIntent(i: Intent?) {
        if (i?.getBooleanExtra(EXTRA_UPDATE, false) != true) return
        i.removeExtra(EXTRA_UPDATE)
        checkUpdate(silentIfLatest = false)
    }

    private fun checkUpdate(silentIfLatest: Boolean) {
        thread {
            val info = Updater.newer(this)
            ui.post {
                when {
                    info == null && !silentIfLatest ->
                        Toast.makeText(this, "지금 최신 감자예요 (${Updater.currentName(this)})", Toast.LENGTH_LONG).show()
                    info != null -> showUpdateDialog(info)
                }
            }
        }
    }

    private fun showUpdateDialog(info: Updater.Info) {
        AlertDialog.Builder(this)
            .setTitle("🥔 새 감자가 나왔어요")
            .setMessage("${info.name} 버전이에요. 지금 업데이트할까요?\n\n로그인과 대화, 설치한 Ubuntu는 그대로 남아요. 내려받은 뒤 나오는 안드로이드 설치 화면에서 '설치'를 눌러 주세요.")
            .setPositiveButton("업데이트") { _, _ -> startUpdate(info) }
            .setNegativeButton("나중에", null)
            .show()
    }

    /**
     * 감자를 열 때(화면으로 돌아올 때) 새 버전이 있으면 한 번 물어본다.
     * 너무 자주 묻지 않도록: 확인은 15분에 한 번, 같은 버전은 하루에 한 번만 안내한다.
     * (알림을 놓친 사람도 열면 바로 알 수 있게 하는 용도. 알림은 그대로 따로 간다)
     */
    private fun askUpdateOnOpen() {
        if (!p.isInstalled() || installing) return
        val prefs = getSharedPreferences("update", MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (now - prefs.getLong("lastCheck", 0) < 15 * 60_000L) return
        prefs.edit().putLong("lastCheck", now).apply()
        thread {
            val info = Updater.newer(this) ?: return@thread
            if (prefs.getInt("askedBuild", 0) == info.code && now - prefs.getLong("askedAt", 0) < 24 * 3600_000L) return@thread
            ui.post {
                if (isFinishing || isDestroyed) return@post
                prefs.edit().putInt("askedBuild", info.code).putLong("askedAt", now).apply()
                showUpdateDialog(info)
            }
        }
    }

    private fun startUpdate(info: Updater.Info) {
        // 스토어 밖에서 받은 앱은 "이 앱의 설치 허용"을 한 번 켜 줘야 안드로이드가 설치해 준다
        if (!packageManager.canRequestPackageInstalls()) {
            AlertDialog.Builder(this)
                .setTitle("설치 허용이 필요해요")
                .setMessage("다음 화면에서 'GAMJA'의 '이 출처 허용'을 켜고, 뒤로 가기로 돌아온 뒤 홈 화면의 감자 버전 옆 ↻를 다시 눌러 주세요. 처음 한 번만 하면 돼요.")
                .setPositiveButton("설정 열기") { _, _ ->
                    startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
                }
                .setNegativeButton("취소", null)
                .show()
            return
        }
        val dialog = AlertDialog.Builder(this).setTitle("업데이트").setMessage("준비 중...").setCancelable(false).show()
        thread {
            val error = Updater.downloadAndInstall(this, info) { step -> ui.post { dialog.setMessage(step) } }
            ui.post {
                dialog.dismiss()
                if (error != null) AlertDialog.Builder(this).setTitle("업데이트 실패").setMessage(error).setPositiveButton("확인", null).show()
            }
        }
    }

    override fun onResume() {
        super.onResume(); visible = true; askUpdateOnOpen(); refreshBatteryValue(); refreshNotifValue()
        if (onBatteryPage && batteryAllowed()) finishBatteryPage() // 배터리 허용 화면에서 돌아왔고 허용됐으면 다음 단계로
    }
    override fun onPause() {
        visible = false
        super.onPause()
    }

    private fun waitForServer(): Boolean {
        repeat(120) {
            val ok = runCatching {
                (URL("$BASE/api/me").openConnection() as HttpURLConnection).run {
                    connectTimeout = 1000; readTimeout = 1000; responseCode == 200
                }
            }.getOrDefault(false)
            if (ok) return true
            Thread.sleep(500)
        }
        return false
    }

    /** 브라우저가 로그인된 채로 열리도록, 비밀번호로 한 번만 쓰는 로그인 표를 감자알에서 받는다 */
    private fun loginTicket(): String? {
        val pw = p.password() ?: return null
        val conn = URL("$BASE/api/login-ticket").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.connectTimeout = 3000; conn.readTimeout = 3000
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(JSONObject().put("password", pw).toString().toByteArray()) }
        if (conn.responseCode != 200) return null
        return JSONObject(conn.inputStream.bufferedReader().use { it.readText() }).optString("ticket").ifBlank { null }
    }

    /** 앱이 감자알에 직접 요청할 때 쓰는 로그인 쿠키 (감자알 업데이트 확인) */
    private fun loginCookie(): String? {
        val pw = p.password() ?: return null
        val conn = URL("$BASE/api/login").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.connectTimeout = 3000; conn.readTimeout = 3000
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(JSONObject().put("password", pw).toString().toByteArray()) }
        return if (conn.responseCode == 200) conn.getHeaderField("Set-Cookie") else null
    }

    @Deprecated("뒤로 가기: 앱을 끄지 않고 뒤로 보낸다")
    override fun onBackPressed() {
        moveTaskToBack(true)
    }

    private fun openAppDetails(pkg: String) {
        runCatching { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))) }
    }

    private fun showLog() {
        AlertDialog.Builder(this).setTitle("감자알 로그")
            .setMessage(runCatching { p.serverLog.readText().takeLast(4000) }.getOrDefault("(없음)"))
            .setPositiveButton("닫기", null).show()
    }

    /** 감자에 들어 있는 오픈소스와 라이선스 (GPL 프로그램은 소스를 받을 수 있는 주소를 함께 알려야 한다) */
    private fun showLicenses() {
        val body = """
            감자는 아래 오픈소스를 사용해요. 각 프로그램은 자기 라이선스를 따릅니다.

            ■ proot — GPL-2.0 이상
            폰 안에서 Ubuntu를 실행해 줘요. 감자는 Termux 저장소의 빌드를 그대로 가져와 수정 없이 넣었어요.
            소스: https://github.com/proot-me/proot
            Termux 빌드: https://github.com/termux/termux-packages (packages/proot)

            ■ libtalloc — LGPL-3.0 이상
            proot가 쓰는 라이브러리예요. 소스: https://talloc.samba.org

            ■ libandroid-shmem — BSD 계열
            Termux 저장소의 빌드를 그대로 넣었어요.

            ■ Termux terminal-view — Apache-2.0
            Claude 로그인 화면에 쓰는 터미널 화면이에요. https://github.com/termux/termux-app

            ■ Apache Commons Compress — Apache-2.0
            압축 풀기에 써요. https://commons.apache.org/proper/commons-compress/

            ■ Ubuntu · Node.js
            첫 실행 때 공식 저장소에서 내려받아 설치해요. Ubuntu의 각 패키지는 자기 라이선스를 따르고, Node.js는 MIT 라이선스예요.

            ■ Claude Code
            Anthropic의 프로그램이에요. 감자에 들어 있지 않고, 첫 실행 때 공식 설치 방법으로 내려받아요. 사용 약관은 Anthropic을 따릅니다.

            GPL·LGPL 프로그램의 소스는 위 주소에서 받을 수 있어요.
        """.trimIndent()
        AlertDialog.Builder(this).setTitle("오픈소스 라이선스").setMessage(body)
            .setPositiveButton("닫기", null).show()
    }

    private fun askBatteryOptimization() {
        val pm = getSystemService(PowerManager::class.java)
        if (pm.isIgnoringBatteryOptimizations(packageName)) return
        runCatching {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        }.onFailure {
            runCatching { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        }
    }

    /**
     * 설정의 "배터리 설정" 버튼. 이미 허용돼 있으면 안드로이드의 허용 창이 바로 닫혀서 아무 일도 안 일어난 것처럼 보였다
     * → 지금 상태를 알려 주고, 원하면 폰의 배터리 설정 화면을 열어 준다
     */
    private fun openBatterySettings() {
        val pm = getSystemService(PowerManager::class.java)
        if (!pm.isIgnoringBatteryOptimizations(packageName)) { askBatteryOptimization(); return }
        AlertDialog.Builder(this)
            .setTitle("배터리 설정")
            .setMessage("✅ 이미 허용돼 있어요.\n화면이 꺼져 있어도 감자알이 계속 돌아가요.\n\n폰의 배터리 설정에서 바꾸고 싶으면 아래 버튼을 눌러 주세요.")
            .setPositiveButton("폰 배터리 설정 열기") { _, _ ->
                runCatching { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }.onFailure {
                    runCatching { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }
                }
            }
            .setNegativeButton("닫기", null)
            .show()
    }

    companion object {
        /** 감자알 주소. 포트는 감자알의 .env에서 읽는다 (예전에 설치한 폰 3000, 새로 설치한 폰 26514) */
        val BASE: String get() = "http://127.0.0.1:${Ports.current()}"
        // 홈 화면 색 (감자 콘솔 더보기와 같은 팔레트)
        private val HOME_BG = 0xFFF2F4F6.toInt()
        private val HOME_INK = 0xFF191F28.toInt()
        private val HOME_SUB = 0xFF6B7684.toInt()
        private val HOME_LINE = 0xFFE5E8EB.toInt()
        private val HOME_YELLOW = 0xFFFEE500.toInt()
        const val EXTRA_PROJECT = "project"
        const val EXTRA_UPDATE = "update"
        /** 감자 화면이 지금 보이는지 (보이면 완료 알림을 띄우지 않음) */
        @Volatile var visible = false
        private const val REQ_LOGIN = 1
        private const val REQ_NOTIF = 5
    }
}
