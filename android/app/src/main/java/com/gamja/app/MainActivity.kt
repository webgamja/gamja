package com.gamja.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Typeface
import android.media.ExifInterface
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import java.io.ByteArrayOutputStream
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
import android.webkit.CookieManager
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL
import java.util.Locale
import kotlin.concurrent.thread

/**
 * 화면 흐름: 준비(첫 실행) → Claude 로그인(공식 화면) → 채팅(감자 웹 화면).
 */
class MainActivity : Activity() {
    private lateinit var p: Paths
    private val ui = Handler(Looper.getMainLooper())
    private var web: WebView? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
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
            !p.isLoggedIn() && !prefs.getBoolean("skipLogin", false) -> showLogin()
            else -> showHome()
        }
    }

    // ---------- 3. 홈 화면: 감자는 폰의 브라우저(크롬 등)로 연다 ----------
    // 앱 안의 화면(WebView)은 폰마다 버전이 달라 화면이 안 뜨는 일이 있어서, 기본은 브라우저로 열고 앱은 감자알을 켜 두는 일과 설정을 맡는다.
    private fun showHome() {
        syncChatCode()
        GamjaService.start(this)
        // 감자 콘솔 더보기와 같은 느낌: 옅은 회색 바탕, 흰 카드, 노란 큰 버튼
        window.statusBarColor = HOME_BG
        window.decorView.systemUiVisibility = window.decorView.systemUiVisibility or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(20), dp(16), dp(28))
        }
        root.addView(label("감자", 34f, HOME_INK, bold = true).apply { setPadding(dp(4), dp(8), 0, 0) })
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
            addView(infoRow("감자 버전", Updater.currentName(this@MainActivity)) { checkUpdate(silentIfLatest = false) })
            addView(divider())
            addView(infoRow("감자알 버전", if (eggBuild.isNullOrBlank()) "-" else "0.1.$eggBuild"))
        })
        root.addView(label("감자 버전을 누르면 새 버전을 확인해요", 12f, HOME_SUB).apply { setPadding(dp(4), dp(2), 0, 0) })

        // 설정
        root.addView(sectionLabel("설정"))
        val batteryValue = TextView(this)
        batteryValueView = batteryValue
        root.addView(card().apply {
            addView(infoRow("배터리 설정", "", batteryValue) { openBatterySettings() })
        })
        refreshBatteryValue()

        // 문제 해결 (접어 둔다)
        root.addView(sectionLabel("문제 해결"))
        val trouble = card().apply { visibility = View.GONE }
        trouble.addView(infoRow("감자알 로그 보기", "›") { showLog() })
        trouble.addView(divider())
        trouble.addView(infoRow("Claude 다시 로그인", "›") { startActivityForResult(Intent(this@MainActivity, LoginActivity::class.java), REQ_LOGIN) })
        trouble.addView(divider())
        trouble.addView(infoRow("다른 기기에서 접속하는 주소", "›") { showAddress() })
        trouble.addView(divider())
        trouble.addView(infoRow("앱 안에서 열기 (문제 해결용)", "›") { showChat() })
        trouble.addView(divider())
        trouble.addView(infoRow("오픈소스 라이선스", "›") { showLicenses() })
        root.addView(card().apply {
            addView(infoRow("로그 · Claude 로그인 · 그 밖의 도구", "›") {
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
    /** 왼쪽 이름, 오른쪽 값. onClick이 있으면 눌러서 쓰는 줄 */
    private fun infoRow(name: String, value: String, valueView: TextView? = null, onClick: (() -> Unit)? = null): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(15), 0, dp(15))
            addView(label(name, 16f, HOME_INK), LinearLayout.LayoutParams(0, -2, 1f))
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
        val col = column()
        col.addView(text("🥔 감자", 30f, bold = true))
        col.addView(text("이 폰을 나만의 Claude Code 서버로 만들어요.\n처음 한 번만 준비가 필요해요. 약 10~20분 걸리니 와이파이에 연결하고 충전기를 꽂아 주세요.", 15f))
        val stepText = text("", 15f, bold = true)
        val bar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { max = Installer.TOTAL_STEPS }
        val logView = text("", 11f).apply { typeface = Typeface.MONOSPACE }
        val logScroll = ScrollView(this).apply { addView(logView) }
        val start = Button(this).apply { text = "시작하기" }
        col.addView(start)
        col.addView(stepText)
        col.addView(bar)
        col.addView(logScroll, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(col)

        val lines = ArrayDeque<String>()
        start.setOnClickListener {
            if (installing) return@setOnClickListener
            installing = true
            start.isEnabled = false
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
                        askBatteryOptimization()
                        route()
                    }
                } catch (e: Exception) {
                    ui.post {
                        installing = false
                        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                        stepText.text = "⚠️ 문제가 생겼어요: ${e.message}\n'다시 시도'를 누르면 끝난 단계는 건너뛰고 이어서 해요."
                        start.text = "다시 시도"
                        start.isEnabled = true
                    }
                }
            }
        }
    }

    // ---------- 2. 로그인 안내 ----------
    private fun showLogin() {
        val col = column()
        col.addView(text("Claude 로그인", 24f, bold = true))
        col.addView(text(
            "이제 공식 Claude Code 화면을 열어요. 감자는 화면을 띄워 주기만 하고, " +
                "로그인 정보는 감자를 거치지 않고 Anthropic과 직접 주고받아요.\n\n" +
                "1) 처음 설정 화면이 나오면 Enter로 넘어가세요.\n" +
                "2) 로그인 방법에서 Claude 계정(구독)을 고르세요.\n" +
                "3) '로그인 주소 열기'를 눌러 브라우저에서 로그인하세요.\n" +
                "4) 받은 코드를 복사한 뒤 '붙여넣기'를 누르세요.\n" +
                "5) 로그인이 끝나면 /exit 를 입력해 나오세요.", 15f))
        col.addView(Button(this).apply {
            text = "Claude 로그인 화면 열기"
            setOnClickListener { startActivityForResult(Intent(this@MainActivity, LoginActivity::class.java), REQ_LOGIN) }
        })
        col.addView(Button(this).apply {
            text = "나중에 할게요"
            setOnClickListener {
                getPreferences(MODE_PRIVATE).edit().putBoolean("skipLogin", true).apply()
                route()
            }
        })
        setContentView(col)
    }

    @Deprecated("Activity 결과 API (minSdk 26, AndroidX 없이 사용)")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_PICK) { // ＋ 사진 첨부: 고른 사진을 줄여서 웹 화면에 보낸다
            if (resultCode == RESULT_OK) handlePicked(data)
            return
        }
        if (requestCode == REQ_FILE) { // 사진 선택 결과를 웹 화면에 돌려준다 (고르지 않고 닫으면 null)
            fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            fileCallback = null
            return
        }
        if (requestCode == REQ_LOGIN) {
            if (p.isLoggedIn()) getPreferences(MODE_PRIVATE).edit().remove("skipLogin").apply()
            route()
        }
    }

    // ---------- 3. 채팅 화면 ----------
    @SuppressLint("SetJavaScriptEnabled")
    private fun showChat() {
        syncChatCode()
        GamjaService.start(this)
        val loading = text("🥔 감자를 깨우는 중...", 16f).apply { gravity = Gravity.CENTER }
        setContentView(loading)

        val wv = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = WebViewClient()
            // alert/confirm/prompt 표시 + 입력창의 ＋(사진 첨부)가 폰의 사진 선택 화면을 열 수 있게 한다
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    webView: WebView?, callback: ValueCallback<Array<Uri>>?, params: FileChooserParams?,
                ): Boolean {
                    fileCallback?.onReceiveValue(null) // 이전 선택이 끝나지 않았으면 취소로 처리
                    fileCallback = callback
                    val intent = runCatching { params?.createIntent() }.getOrNull()
                        ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "image/*"
                            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                        }
                    return try {
                        startActivityForResult(intent, REQ_FILE)
                        true
                    } catch (e: Exception) {
                        fileCallback = null
                        callback?.onReceiveValue(null)
                        false
                    }
                }
            }
            addJavascriptInterface(Bridge(), "GamjaApp") // 설정 → 고급·정보 → 감자 앱 에서 앱 기능을 부른다
        }
        web = wv
        thread {
            val ready = waitForServer()
            val cookie = if (ready) runCatching { loginCookie() }.getOrNull() else null
            ui.post {
                if (!ready) {
                    // 화면을 못 열었으니 설정 화면의 로그를 볼 수 없다 → 여기서 바로 보여 준다
                    val log = runCatching { p.serverLog.readText().takeLast(1500) }.getOrDefault("")
                    loading.text = "감자알이 아직 안 떠요.\n잠시 후 앱을 다시 열어 보세요.\n\n[감자알 로그]\n$log"
                    return@post
                }
                cookie?.let { CookieManager.getInstance().setCookie(BASE, it) }
                setContentView(wv)
                wv.loadUrl(chatUrl(intent))
            }
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

    /** 🔔 완료 알림에서 열었으면 그 프로젝트 화면으로 */
    private fun chatUrl(i: Intent?): String {
        val project = i?.getStringExtra(EXTRA_PROJECT) ?: return BASE
        return "$BASE/?project=${Uri.encode(project)}"
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.hasExtra(EXTRA_PROJECT)) {
            if (web != null) web?.loadUrl(chatUrl(intent)) else handleProjectIntent(intent)
        }
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
                .setMessage("다음 화면에서 'GAMJA'의 '이 출처 허용'을 켜고, 뒤로 가기로 돌아온 뒤 ⚙️ 설정 아래쪽 ℹ️ 정보에서 감자 버전 옆의 🔄을 다시 눌러 주세요. 처음 한 번만 하면 돼요.")
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

    override fun onResume() { super.onResume(); visible = true; askUpdateOnOpen(); refreshBatteryValue() }
    override fun onPause() {
        visible = false
        // 앱을 떠나면 듣기를 멈춘다. 단, 마이크 권한 창이 떠서 잠깐 멈추는 경우(아직 인식기를 안 만든 상태)는 그대로 기다린다
        if (recognizer != null) voiceStopNow(abort = true)
        super.onPause()
    }
    override fun onDestroy() {
        recognizer?.destroy(); recognizer = null
        tts?.shutdown(); tts = null
        super.onDestroy()
    }

    // ---------- 📷 사진 첨부 (입력창 ＋) ----------
    // WebView의 파일 선택 기능에 기대지 않고, 앱이 사진을 직접 골라 읽어서 웹 화면에 넘긴다.
    // 사진은 긴 변 1800px 이하 JPEG로 줄이고, 휴대폰 사진의 회전 정보도 바로잡는다 (HEIC도 열 수 있다).
    private var pickMax = 4

    private fun pickImages(max: Int) {
        pickMax = max.coerceAtLeast(1)
        // 안드로이드 13 이상: 폰의 "사진 선택" 화면에 최대 장수를 알려 주면, 그 화면이 스스로 한도를 지켜 주고
        // 한도를 넘게 고르려 할 때 그 자리에서 안내해 준다. 그보다 옛 폰은 일반 선택 화면을 쓰고 고른 뒤에 안내한다
        val system = if (Build.VERSION.SDK_INT >= 33) {
            Intent(MediaStore.ACTION_PICK_IMAGES).apply {
                if (pickMax > 1) putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, pickMax.coerceAtMost(MediaStore.getPickImagesMaxLimit()))
            }
        } else null
        val ok = system != null && runCatching { startActivityForResult(system, REQ_PICK) }.isSuccess
        if (ok) return
        val general = Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "image/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, pickMax > 1)
        }
        runCatching { startActivityForResult(general, REQ_PICK) }
            .onFailure { Toast.makeText(this, "사진 선택 화면을 열 수 없어요", Toast.LENGTH_LONG).show() }
    }

    private fun handlePicked(data: Intent?) {
        val uris = mutableListOf<Uri>()
        data?.clipData?.let { c -> for (i in 0 until c.itemCount) uris.add(c.getItemAt(i).uri) }
        if (uris.isEmpty()) data?.data?.let { uris.add(it) }
        if (uris.isEmpty()) return
        if (uris.size > pickMax) {
            Toast.makeText(this, "사진은 12장까지 첨부할 수 있어요", Toast.LENGTH_LONG).show()
        }
        thread {
            for (uri in uris.take(pickMax)) {
                val img = runCatching { readImage(uri) }.getOrNull()
                ui.post {
                    val call = if (img == null) "window.__gamjaPicked&&window.__gamjaPicked('','','')"
                    else "window.__gamjaPicked&&window.__gamjaPicked(${JSONObject.quote(img.first)},${JSONObject.quote(img.second)},${JSONObject.quote(img.third)})"
                    web?.evaluateJavascript(call, null)
                }
            }
        }
    }

    /** 사진 하나를 읽어 (이름, 종류, base64)로. 움직이는 GIF와 작은 PNG는 그대로 두고 나머지는 줄인 JPEG로 만든다 */
    private fun readImage(uri: Uri): Triple<String, String, String> {
        val mime = contentResolver.getType(uri) ?: "image/jpeg"
        val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: "photo.jpg"
        if (mime == "image/gif" || mime == "image/png") {
            val raw = contentResolver.openInputStream(uri)!!.use { it.readBytes() }
            if (mime == "image/gif" && raw.size <= 8_000_000 || mime == "image/png" && raw.size <= 800_000) {
                return Triple(name, mime, Base64.encodeToString(raw, Base64.NO_WRAP))
            }
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 3600) sample *= 2 // 먼저 크게 줄여 메모리를 아낀다
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        var bmp = contentResolver.openInputStream(uri)!!.use { BitmapFactory.decodeStream(it, null, opts) }
            ?: throw IllegalStateException("사진을 열 수 없어요")
        val degrees = runCatching {
            contentResolver.openInputStream(uri)!!.use { s ->
                when (ExifInterface(s).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270
                    else -> 0
                }
            }
        }.getOrDefault(0)
        val scale = minOf(1f, 1800f / maxOf(bmp.width, bmp.height))
        if (degrees != 0 || scale < 1f) {
            val m = Matrix().apply {
                if (degrees != 0) postRotate(degrees.toFloat())
                if (scale < 1f) postScale(scale, scale)
            }
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, 88, out)
        return Triple(name.substringBeforeLast('.') + ".jpg", "image/jpeg", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP))
    }

    // ---------- 🔊 답변 읽어주기 ----------
    // WebView의 speechSynthesis는 소리가 안 나거나 없는 폰이 있어서, 폰의 TextToSpeech로 읽고 끝났는지를 웹 화면(voice-app.js)에 알려 준다.
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private val ttsWaiting = mutableListOf<Pair<String, () -> Unit>>() // 엔진이 준비되길 기다리는 읽기 (id, 실행)

    private fun ttsJs(id: String?, type: String) {
        web?.evaluateJavascript(
            "window.__gamjaTTS&&window.__gamjaTTS.event(${JSONObject.quote(id ?: "")},${JSONObject.quote(type)})", null)
    }

    private fun ttsEnsure(id: String, run: () -> Unit) {
        if (ttsReady) { run(); return }
        ttsWaiting.add(id to run)
        if (tts != null) return
        tts = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) {
                tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) { ui.post { ttsJs(utteranceId, "start") } }
                    override fun onDone(utteranceId: String?) { ui.post { ttsJs(utteranceId, "end") } }
                    @Deprecated("이전 버전용 (새 버전은 오류 번호가 있는 쪽)")
                    override fun onError(utteranceId: String?) { ui.post { ttsJs(utteranceId, "error") } }
                    override fun onStop(utteranceId: String?, interrupted: Boolean) { ui.post { ttsJs(utteranceId, "end") } }
                })
                ttsReady = true
                val queued = ttsWaiting.toList()
                ttsWaiting.clear()
                queued.forEach { it.second() }
            } else {
                // 엔진을 못 켰으면 기다리던 읽기를 오류로 끝내서 화면이 영원히 기다리지 않게 한다
                tts = null
                val queued = ttsWaiting.toList()
                ttsWaiting.clear()
                queued.forEach { ttsJs(it.first, "error") }
            }
        }
    }

    private fun ttsSpeakNow(id: String, text: String, lang: String, rate: Double) = ttsEnsure(id) {
        val t = tts ?: return@ttsEnsure
        runCatching { t.language = Locale.forLanguageTag(lang) }
        t.setSpeechRate(rate.toFloat().coerceIn(0.5f, 2f))
        t.speak(text, TextToSpeech.QUEUE_ADD, null, id)
    }

    // ---------- 🎤 음성 입력 ----------
    // 안드로이드 WebView에는 음성 인식이 없어서, 폰의 SpeechRecognizer를 대신 쓰고 결과를 웹 화면(voice-app.js)에 알려 준다.
    // 웹 화면은 크롬의 SpeechRecognition처럼 쓰므로 🎤·음성 대화 코드는 그대로다.
    private var recognizer: SpeechRecognizer? = null
    private var voiceLang = "ko-KR"
    private var voiceOpen = false // 웹이 시작을 불렀고 아직 "끝났다"고 알려 주지 않은 상태

    private fun voiceJs(type: String, text: String = "", isFinal: Boolean = false) {
        web?.evaluateJavascript(
            "window.__gamjaSR&&window.__gamjaSR.event(${JSONObject.quote(type)},${JSONObject.quote(text)},$isFinal)", null)
    }

    private fun voiceEnd() {
        if (!voiceOpen) return
        voiceOpen = false
        voiceJs("end")
    }

    private fun voiceBegin(lang: String) {
        voiceLang = lang
        voiceOpen = true
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), REQ_MIC) // 처음 한 번 "마이크를 써도 될까요?"
            return
        }
        startRecognizer()
    }

    /**
     * 말을 글자로 바꿔 줄 수 있는 폰의 음성 인식 서비스 목록 (앞쪽부터 시도).
     * 폰의 기본 서비스가 Google 텍스트 변환 앱(com.google.android.tts)으로 잡혀 있으면 "연결이 끊어졌어요(오류 11)"가 나는 폰이 있어서,
     * 널리 쓰는 Google 앱의 인식기를 먼저 쓰고, 안 되면 다른 것, 마지막으로 폰의 기본값을 쓴다. 전에 잘 됐던 것은 맨 앞으로 올린다.
     */
    private fun voiceCandidates(): List<ComponentName?> {
        val found = runCatching {
            packageManager.queryIntentServices(Intent("android.speech.RecognitionService"), 0)
                .map { ComponentName(it.serviceInfo.packageName, it.serviceInfo.name) }
        }.getOrDefault(emptyList())
        val google = found.filter { it.packageName == "com.google.android.googlequicksearchbox" }
        val rest = found.filter { it.packageName != "com.google.android.googlequicksearchbox" }
        val liked = getSharedPreferences("voice", MODE_PRIVATE).getString("service", null)
        val ordered = (google + rest).sortedBy { if (it.flattenToString() == liked) 0 else 1 }
        return ordered + listOf<ComponentName?>(null) // null = 폰의 기본 서비스
    }

    private var voiceCands: List<ComponentName?> = listOf(null)
    private var voiceUsing = "기본"

    private fun startRecognizer(index: Int = 0) {
        if (index == 0) voiceCands = voiceCandidates()
        val cand = voiceCands.getOrNull(index)
        voiceUsing = cand?.packageName ?: "기본"
        recognizer?.destroy()
        val r = runCatching {
            if (cand != null) SpeechRecognizer.createSpeechRecognizer(this, cand) else SpeechRecognizer.createSpeechRecognizer(this)
        }.getOrNull() ?: SpeechRecognizer.createSpeechRecognizer(this)
        recognizer = r
        var heard = false // 이 인식기가 말소리를 한 번이라도 들었는지 (들었으면 서비스 문제가 아니다)
        fun worked() {
            heard = true
            if (cand != null) getSharedPreferences("voice", MODE_PRIVATE).edit().putString("service", cand.flattenToString()).apply()
        }
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { if (recognizer === r) voiceJs("start") }
            override fun onBeginningOfSpeech() { if (recognizer === r) { worked(); voiceJs("speechstart") } }
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
            override fun onPartialResults(partialResults: Bundle?) {
                if (recognizer !== r) return
                worked()
                partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                    ?.let { voiceJs("result", it, false) }
            }
            override fun onResults(results: Bundle?) {
                if (recognizer !== r) return
                worked()
                results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                    ?.let { voiceJs("result", it, true) }
                voiceEnd()
            }
            override fun onError(error: Int) {
                if (recognizer !== r) return
                // 서비스가 연결되지 않았거나(11) 시작도 못 한(5, 3) 경우에는 화면에 알리지 않고 다음 서비스로 조용히 다시 시도한다
                val broken = error == 11 || error == SpeechRecognizer.ERROR_CLIENT || error == SpeechRecognizer.ERROR_AUDIO || error == SpeechRecognizer.ERROR_SERVER
                if (broken && !heard && index + 1 < voiceCands.size) {
                    ui.post { if (voiceOpen && recognizer === r) startRecognizer(index + 1) }
                    return
                }
                val name = when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
                    // 감자의 마이크 권한은 있는데 이 오류가 나면, 말을 글자로 바꿔 주는 폰의 음성 인식 서비스(보통 Google 앱)에 마이크 권한이 없는 것이다
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
                        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) "service-permission" else "not-allowed"
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "network"
                    SpeechRecognizer.ERROR_CLIENT -> "aborted"
                    else -> "error-$error" // 번호를 같이 알려 줘서 원인을 찾기 쉽게 한다
                }
                voiceJs("error", "$name|${voiceDiag(error)}")
                voiceEnd()
            }
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, voiceLang)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
        }
        r.startListening(intent)
    }

    /** abort: 지금까지 들은 것을 버리고 바로 멈춤 / 아니면 말을 마친 것으로 보고 결과를 받는다 */
    private fun voiceStopNow(abort: Boolean) {
        val r = recognizer
        if (abort || r == null) {
            recognizer = null
            r?.cancel()
            r?.destroy()
            voiceEnd()
        } else r.stopListening()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_MIC) return
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) {
            if (voiceOpen) startRecognizer()
        } else {
            voiceJs("error", "not-allowed|${voiceDiag(-1)}")
            voiceEnd()
        }
    }

    /** 오류가 났을 때 화면에 같이 보여 줄 진단 글: 오류 번호, 감자의 마이크 권한, 폰의 기본 음성 인식 서비스 */
    private fun voiceDiag(code: Int): String {
        val granted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val svc = runCatching { Settings.Secure.getString(contentResolver, "voice_recognition_service") }.getOrNull()
            ?.substringBefore('/')?.ifBlank { null } ?: "없음"
        return "오류 $code · 감자 마이크 ${if (granted) "허용" else "거부"} · 기본 서비스 $svc · 사용한 서비스 $voiceUsing"
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

    /** 이 폰에서 여는 화면은 비밀번호 없이 바로 들어가도록 앱이 대신 로그인 */
    private fun loginCookie(): String? {
        val pw = p.password() ?: return null
        val conn = URL("$BASE/api/login").openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(JSONObject().put("password", pw).toString().toByteArray()) }
        return if (conn.responseCode == 200) conn.getHeaderField("Set-Cookie") else null
    }

    @Deprecated("뒤로 가기: 웹 화면에 열려 있는 창(설정 등)부터 닫는다")
    override fun onBackPressed() {
        val wv = web
        if (wv == null) { moveTaskToBack(true); return }
        wv.evaluateJavascript("(window.gamjaBack ? window.gamjaBack() : false)") { handled ->
            if (handled == "true") return@evaluateJavascript // 웹 화면이 열려 있던 창을 닫았다
            if (wv.canGoBack()) wv.goBack() else moveTaskToBack(true)
        }
    }

    // ---------- 웹 화면과 이어 주는 통로 (설정 → 고급·정보 → 감자 앱) ----------
    // 감자 화면에서만 동작하고, 크루가 만든 페이지 미리보기(/preview/)에서 부른 것은 무시한다
    inner class Bridge {
        private fun guarded(block: () -> Unit) = runOnUiThread {
            val url = web?.url ?: return@runOnUiThread
            if (url.startsWith("$BASE/") && !url.startsWith("$BASE/preview/")) block()
        }
        @JavascriptInterface fun appVersion(): String = Updater.currentName(this@MainActivity)
        @JavascriptInterface fun showAddress() = guarded { this@MainActivity.showAddress() }
        @JavascriptInterface fun openLogin() = guarded { startActivityForResult(Intent(this@MainActivity, LoginActivity::class.java), REQ_LOGIN) }
        @JavascriptInterface fun batterySettings() = guarded { this@MainActivity.openBatterySettings() }
        @JavascriptInterface fun showLog() = guarded { this@MainActivity.showLog() }
        @JavascriptInterface fun checkUpdate() = guarded { this@MainActivity.checkUpdate(silentIfLatest = false) }
        @JavascriptInterface fun showLicenses() = guarded { this@MainActivity.showLicenses() }
        @JavascriptInterface fun setBarColor(hex: String) = guarded { applyBarColor(hex) }
        // 🎤 음성 입력 (웹 화면의 voice-app.js가 부른다)
        @JavascriptInterface fun voiceAvailable(): Boolean = SpeechRecognizer.isRecognitionAvailable(this@MainActivity)
        @JavascriptInterface fun voiceStart(lang: String) = guarded { voiceBegin(lang) }
        @JavascriptInterface fun voiceStop() = guarded { voiceStopNow(abort = false) }
        @JavascriptInterface fun voiceAbort() = guarded { voiceStopNow(abort = true) }
        /**
         * 결과물(웹페이지·이미지·음악·영상)을 앱 기능 통로가 없는 따로 떨어진 화면(PreviewActivity)에서 연다.
         * url은 감자 안의 결과물 주소(/preview/)만 받고, html은 감자 화면이 직접 만든 이미지·음악·영상 재생용 작은 페이지다.
         */
        @JavascriptInterface fun openPreview(url: String, html: String, title: String) = guarded {
            if (url.isNotEmpty() && !url.startsWith("$BASE/preview/")) return@guarded
            if (url.isEmpty() && html.isEmpty()) return@guarded
            startActivity(Intent(this@MainActivity, PreviewActivity::class.java)
                .putExtra(PreviewActivity.EXTRA_URL, url)
                .putExtra(PreviewActivity.EXTRA_HTML, html)
                .putExtra(PreviewActivity.EXTRA_TITLE, title.take(80)))
        }
        /** 결과물(PDF·워드·엑셀 등)을 폰의 브라우저로 연다. 감자 안의 결과물 주소(/preview/)만 열 수 있다 */
        @JavascriptInterface fun openExternal(url: String) = guarded {
            if (url.startsWith("$BASE/preview/")) runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        }
        // 📷 입력창 ＋ : 폰의 사진 선택 화면을 열고, 고른 사진을 줄여서 웹 화면(__gamjaPicked)에 보낸다
        @JavascriptInterface fun pickImages(max: Int) = guarded { this@MainActivity.pickImages(max) }
        // 🔊 답변 읽어주기 (웹 화면의 voice-app.js가 부른다)
        @JavascriptInterface fun ttsAvailable(): Boolean = true
        @JavascriptInterface fun ttsSpeak(id: String, text: String, lang: String, rate: Double) = guarded { ttsSpeakNow(id, text, lang, rate) }
        @JavascriptInterface fun ttsStop() = guarded { tts?.stop() }
        /** 마이크를 거부해 둔 사람을 폰의 GAMJA 앱 정보 화면(권한 → 마이크)으로 데려간다 */
        @JavascriptInterface fun appSettings() = guarded { openAppDetails(packageName) }
        /** 말을 글자로 바꿔 주는 폰의 음성 인식 서비스(보통 Google 앱)의 앱 정보 화면으로 데려간다 */
        @JavascriptInterface fun recognizerSettings() = guarded {
            val fromSetting = runCatching {
                Settings.Secure.getString(contentResolver, "voice_recognition_service")?.substringBefore('/')
            }.getOrNull()?.takeIf { it.isNotBlank() }
            val fromQuery = runCatching {
                packageManager.queryIntentServices(Intent("android.speech.RecognitionService"), 0).firstOrNull()?.serviceInfo?.packageName
            }.getOrNull()
            openAppDetails(fromSetting ?: fromQuery ?: packageName)
        }
    }

    private fun openAppDetails(pkg: String) {
        runCatching { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg"))) }
    }

    private fun showLog() {
        AlertDialog.Builder(this).setTitle("감자알 로그")
            .setMessage(runCatching { p.serverLog.readText().takeLast(4000) }.getOrDefault("(없음)"))
            .setPositiveButton("닫기", null).show()
    }

    /** 위쪽 상태 표시줄 색을 웹 화면의 위쪽 줄 색에 맞춘다 (밝은 색이면 아이콘은 어둡게) */
    private fun applyBarColor(hex: String) {
        val c = runCatching { Color.parseColor(hex.trim()) }.getOrNull() ?: return
        window.statusBarColor = c
        val lum = (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) / 255
        val dv = window.decorView
        dv.systemUiVisibility =
            if (lum > 0.6) dv.systemUiVisibility or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
            else dv.systemUiVisibility and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
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

    private fun showAddress() {
        val ips = NetworkInterface.getNetworkInterfaces().toList()
            .flatMap { it.inetAddresses.toList() }
            .filter { it is Inet4Address && !it.isLoopbackAddress }
            .map { "http://${it.hostAddress}:${Ports.current()}" }
        val pw = p.password() ?: "(없음)"
        AlertDialog.Builder(this)
            .setTitle("다른 기기에서 접속")
            .setMessage("같은 와이파이에 연결된 기기의 브라우저에서 아래 주소로 접속하세요.\n\n" +
                (ips.joinToString("\n").ifEmpty { "(와이파이 주소를 찾지 못했어요)" }) + "\n\n비밀번호: $pw")
            .setPositiveButton("비밀번호 복사") { _, _ ->
                getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("감자 비밀번호", pw))
            }
            .setNegativeButton("닫기", null)
            .show()
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
            .setMessage("✅ 이미 허용돼 있어요.\n화면이 꺼져 있어도 감자알이 계속 돌아요.\n\n폰의 배터리 설정에서 바꾸고 싶으면 아래 버튼을 눌러 주세요.")
            .setPositiveButton("폰 배터리 설정 열기") { _, _ ->
                runCatching { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }.onFailure {
                    runCatching { startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$packageName"))) }
                }
            }
            .setNegativeButton("닫기", null)
            .show()
    }

    // ---------- 작은 화면 도우미 ----------
    private fun column() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        val pad = (20 * resources.displayMetrics.density).toInt()
        setPadding(pad, pad, pad, pad)
    }

    private fun text(s: String, size: Float, bold: Boolean = false) = TextView(this).apply {
        text = s
        textSize = size
        if (bold) setTypeface(typeface, Typeface.BOLD)
        setPadding(0, 8, 0, 8)
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
        private const val REQ_MIC = 2
        private const val REQ_FILE = 3
        private const val REQ_PICK = 4
    }
}
