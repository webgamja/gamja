package com.gamja.app

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import com.termux.terminal.TerminalSession
import com.termux.terminal.TerminalSessionClient
import com.termux.view.TerminalView
import com.termux.view.TerminalViewClient

/**
 * 공식 Claude Code 화면을 터미널로 그대로 보여 주고, 감자는 화면 글자를 읽어 "지금 할 일"만 안내한다.
 * 로그인 자체(계정 선택, 브라우저 로그인, 코드 확인)는 공식 Claude Code와 Anthropic 페이지에서 이뤄진다.
 */
class LoginActivity : Activity() {
    private lateinit var p: Paths
    private lateinit var terminal: TerminalView
    private lateinit var session: TerminalSession
    private lateinit var guideStep: TextView
    private lateinit var guideTitle: TextView
    private lateinit var guideText: TextView
    private lateinit var guideButton: Button
    private val ui = Handler(Looper.getMainLooper())
    private var stage = Stage.STARTING
    private var loginUrl: String? = null
    private var finishing = false

    /** 터미널 화면으로 판단한 로그인 진행 단계 */
    private enum class Stage { STARTING, THEME, METHOD, BROWSER, CODE, SUCCESS, READY }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        p = Paths(this)
        val proot = Proot(this)
        val dp = resources.displayMetrics.density

        // 키보드는 처음부터 띄우지 않는다 (안내 카드의 버튼과 아래 키 줄로 모두 할 수 있다). 화면을 눌렀을 때만 키보드가 올라온다
        window.setSoftInputMode(
            android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN or
                android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE,
        )
        window.statusBarColor = 0xFFFBF5E6.toInt()
        window.decorView.systemUiVisibility = window.decorView.systemUiVisibility or android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        fun rounded(color: Int, r: Int) = android.graphics.drawable.GradientDrawable().apply { setColor(color); cornerRadius = r * dp }

        // 안내 카드 (감자 콘솔 더보기와 같은 느낌: 흰 카드, 노란 버튼)
        guideStep = TextView(this).apply { textSize = 12f; setTypeface(typeface, Typeface.BOLD); setTextColor(0xFF7A6F5A.toInt()) }
        guideTitle = TextView(this).apply { textSize = 20f; setTypeface(typeface, Typeface.BOLD); setTextColor(0xFF2B2418.toInt()); setPadding(0, (4 * dp).toInt(), 0, 0) }
        guideText = TextView(this).apply { textSize = 14f; setTextColor(0xFF4E5968.toInt()); setPadding(0, (6 * dp).toInt(), 0, (12 * dp).toInt()); setLineSpacing(0f, 1.15f) }
        guideButton = Button(this).apply {
            isAllCaps = false; textSize = 16f
            setTypeface(typeface, Typeface.BOLD)
            setTextColor(0xFF3B2F14.toInt())
            stateListAnimator = null
            background = rounded(0xFFF2D98A.toInt(), 16)
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(0xFFFFFDF7.toInt(), 20)
            val pad = (18 * dp).toInt()
            setPadding(pad, (16 * dp).toInt(), pad, pad)
            // 맨 위 줄: 단계 표시(왼쪽)와 나가기(오른쪽)
            addView(LinearLayout(this@LoginActivity).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = android.view.Gravity.CENTER_VERTICAL
                addView(guideStep, LinearLayout.LayoutParams(0, -2, 1f))
                addView(TextView(this@LoginActivity).apply {
                    text = "나가기"
                    textSize = 14f
                    setTypeface(typeface, Typeface.BOLD)
                    setTextColor(0xFF7A6F5A.toInt())
                    setPadding((12 * dp).toInt(), (8 * dp).toInt(), (4 * dp).toInt(), (8 * dp).toInt())
                    setOnClickListener { finish() } // 뒤로 가기와 같다: 앱 첫 화면으로 돌아간다
                })
            })
            addView(guideTitle)
            addView(guideText)
            addView(guideButton, LinearLayout.LayoutParams(-1, (52 * dp).toInt()))
        }
        val cardWrap = LinearLayout(this).apply {
            setPadding((12 * dp).toInt(), (12 * dp).toInt(), (12 * dp).toInt(), (8 * dp).toInt())
            addView(card, LinearLayout.LayoutParams(-1, -2))
        }

        // 공식 Claude Code 터미널 (어두운 바탕)
        terminal = TerminalView(this, null).apply {
            setTextSize((14 * resources.displayMetrics.scaledDensity).toInt())
            setTypeface(Typeface.MONOSPACE)
            setBackgroundColor(0xFF1C1C1E.toInt())
            isFocusableInTouchMode = true
            setTerminalViewClient(viewClient)
        }
        val terminalWrap = LinearLayout(this).apply {
            background = rounded(0xFF1C1C1E.toInt(), 16)
            clipToOutline = true
            val m = (8 * dp).toInt()
            setPadding(m, m, m, m)
            addView(terminal, LinearLayout.LayoutParams(-1, -1))
        }
        val cmd = proot.command("/bin/bash", "-lc", "claude")
        session = TerminalSession(
            cmd[0], p.files.path,
            arrayOf("proot") + cmd.drop(1).toTypedArray(),   // args[0]은 프로그램 이름
            proot.hostEnv.map { "${it.key}=${it.value}" }.toTypedArray(),
            2000, sessionClient,
        )
        terminal.attachSession(session)

        // 휴대폰 키보드에 없는 키
        val keys = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding((8 * dp).toInt(), (4 * dp).toInt(), (8 * dp).toInt(), (8 * dp).toInt())
            addView(key("↑") { session.write("\u001b[A") })
            addView(key("↓") { session.write("\u001b[B") })
            addView(key("Enter") { session.write("\r") })
            addView(key("Esc") { session.write("\u001b") })
            addView(key("붙여넣기") { paste(submit = false) })
            addView(key("키보드") { showKeyboard() })
        }

        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFFFBF5E6.toInt())
            fitsSystemWindows = true
            addView(cardWrap)
            addView(terminalWrap, LinearLayout.LayoutParams(-1, 0, 1f).apply {
                setMargins((12 * dp).toInt(), 0, (12 * dp).toInt(), 0)
            })
            addView(keys)
        })
        showStage(Stage.STARTING)
    }

    private fun key(label: String, onClick: () -> Unit) = Button(this).apply {
        val d = resources.displayMetrics.density
        text = label
        isAllCaps = false
        textSize = 12f
        setSingleLine(true) // 글자가 두 줄로 나뉘어 잘리지 않게 한 줄로
        includeFontPadding = false
        minWidth = 0
        minHeight = 0
        setPadding(0, 0, 0, 0)
        gravity = android.view.Gravity.CENTER
        setTextColor(0xFF2B2418.toInt())
        stateListAnimator = null
        background = android.graphics.drawable.GradientDrawable().apply { setColor(0xFFEDE3CB.toInt()); cornerRadius = 12 * d }
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(0, (44 * d).toInt(), 1f).apply { setMargins((3 * d).toInt(), 0, (3 * d).toInt(), 0) }
    }

    // ---------- 단계 판단 (화면 글자를 읽어서) ----------
    private val detect = Runnable { detectStage() }

    private fun screenText(): String = session.emulator?.screen?.transcriptText ?: ""

    private fun detectStage() {
        val all = screenText()
        val text = all.takeLast(4000) // 최근 화면 기준
        val next = when {
            text.contains("Login successful", ignoreCase = true) -> Stage.SUCCESS
            text.contains("Paste code here", ignoreCase = true) -> Stage.CODE
            text.contains("oauth/authorize") -> Stage.BROWSER
            text.contains("login method", ignoreCase = true) -> Stage.METHOD
            text.contains("text style", ignoreCase = true) || text.contains("Dark mode", ignoreCase = true) -> Stage.THEME
            p.isLoggedIn() && stage == Stage.STARTING && text.isNotBlank() -> Stage.READY
            else -> stage
        }
        if (next == Stage.BROWSER || next == Stage.CODE) extractUrl(all)?.let { loginUrl = it }
        if (next != stage) showStage(next)
    }

    /** 여러 줄로 쪼개져 나온 로그인 주소를 이어 붙인다 */
    private fun extractUrl(text: String): String? {
        val start = text.lastIndexOf("https://claude.")
        if (start < 0) return null
        var end = text.indexOf("Paste code", start)
        if (end < 0) end = text.indexOf("\n\n", start)
        if (end < 0) end = text.length
        val joined = text.substring(start, end).replace(Regex("\\s"), "")
        return Regex("^https://[\\w\\-._~:/?#\\[\\]@!$&'()*+,;=%]+").find(joined)?.value
    }

    private fun showStage(s: Stage) {
        stage = s
        when (s) {
            Stage.STARTING -> guide("준비 중", "Claude Code를 여는 중...", "잠시만 기다려 주세요. 아래 검은 화면이 Claude 공식 화면이에요.", null, null)
            Stage.THEME -> guide("로그인 1/4", "화면 스타일 고르기",
                "아래 검은 화면에 글자 스타일(테마)을 고르는 목록이 보여요. 어느 것이든 괜찮아요. 그대로 두고 아래 버튼을 눌러 넘어가세요.", "다음") {
                session.write("\r")
            }
            Stage.METHOD -> guide("로그인 2/4", "로그인 방법 고르기",
                "아래 검은 화면의 목록에서 'Claude account with subscription'(Claude 구독 계정) 줄 앞에 ❯ 표시가 있는지 보세요. 다른 줄에 있으면 키 줄의 ↑ ↓ 로 옮긴 뒤 버튼을 누르세요.", "구독 계정으로 로그인") {
                session.write("\r")
            }
            Stage.BROWSER, Stage.CODE -> guide("로그인 3/4", "브라우저에서 로그인",
                "버튼을 눌러 Claude 공식 페이지에서 로그인하세요. 끝나면 코드가 나와요. 그 코드를 복사하고 이 앱으로 돌아오세요.",
                "브라우저에서 로그인") { openLoginUrl() }
            Stage.SUCCESS -> {
                guide("완료", "로그인 완료!", "감자 홈 화면으로 이동해요...", null, null)
                finishWhenSaved()
            }
            Stage.READY -> guide("완료", "이미 로그인돼 있어요", "다른 계정으로 바꾸려면 아래 검은 화면에 /login 을 입력하세요.", "완료") { done() }
        }
    }

    private fun guide(step: String, title: String, text: String, button: String?, onClick: (() -> Unit)?) {
        guideStep.text = step
        guideTitle.text = title
        guideText.text = text
        guideButton.visibility = if (button == null) android.view.View.GONE else android.view.View.VISIBLE
        guideButton.text = button ?: ""
        guideButton.setOnClickListener { onClick?.invoke() }
    }

    /** 브라우저에서 복사해 온 코드를 알아채면 "붙여넣고 완료" 버튼으로 바꾼다 */
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || (stage != Stage.CODE && stage != Stage.BROWSER)) return
        val code = clipboardText()?.trim() ?: return
        if (code.length in 20..400 && !code.contains(Regex("\\s")) && !code.startsWith("http")) {
            guide("로그인 4/4", "코드 붙여넣기", "복사한 로그인 코드를 찾았어요. 버튼을 누르면 Claude Code에 붙여 넣고 Enter까지 눌러 완료해요.", "코드 붙여넣고 완료하기") {
                paste(submit = true)
            }
        }
    }

    private fun openLoginUrl() {
        val url = loginUrl ?: extractUrl(screenText())
        if (url == null) {
            Toast.makeText(this, "아직 화면에 로그인 주소가 없어요", Toast.LENGTH_SHORT).show()
            return
        }
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }

    private fun clipboardText(): String? =
        getSystemService(ClipboardManager::class.java).primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()

    private fun paste(submit: Boolean) {
        val text = clipboardText()?.let { if (submit) it.trim() else it } ?: return
        session.write(text)
        // 붙여 넣은 글과 Enter를 한꺼번에 보내면 Claude Code가 Enter를 붙여 넣은 글의 일부로 받아서 완료가 안 될 수 있다 → 잠깐 뒤에 따로 보낸다
        if (submit) ui.postDelayed({ if (session.isRunning) session.write("\r") }, 500)
    }

    /** 로그인 정보가 저장될 때까지 잠깐 기다렸다가 닫는다 (/exit 를 칠 필요 없음) */
    private fun finishWhenSaved(tries: Int = 0) {
        if (p.isLoggedIn() || tries >= 20) done() else ui.postDelayed({ finishWhenSaved(tries + 1) }, 500)
    }

    private fun done() {
        if (finishing) return
        finishing = true
        setResult(RESULT_OK)
        finish()
    }

    private fun showKeyboard() {
        terminal.requestFocus()
        getSystemService(InputMethodManager::class.java).showSoftInput(terminal, 0)
    }

    override fun onDestroy() {
        ui.removeCallbacksAndMessages(null)
        if (session.isRunning) session.finishIfRunning()
        super.onDestroy()
    }

    private val sessionClient = object : TerminalSessionClient {
        override fun onTextChanged(changedSession: TerminalSession) {
            terminal.onScreenUpdated()
            ui.removeCallbacks(detect)
            ui.postDelayed(detect, 300) // 화면이 바뀔 때마다 (잠시 모아서) 단계 판단
        }
        override fun onTitleChanged(changedSession: TerminalSession) {}
        override fun onSessionFinished(finishedSession: TerminalSession) = done()
        override fun onCopyTextToClipboard(session: TerminalSession, text: String?) {
            getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("감자", text ?: ""))
        }
        override fun onPasteTextFromClipboard(session: TerminalSession?) = paste(submit = false)
        override fun onBell(session: TerminalSession) {}
        override fun onColorsChanged(session: TerminalSession) {}
        override fun onTerminalCursorStateChange(state: Boolean) {}
        override fun getTerminalCursorStyle(): Int? = null
        override fun logError(tag: String?, message: String?) {}
        override fun logWarn(tag: String?, message: String?) {}
        override fun logInfo(tag: String?, message: String?) {}
        override fun logDebug(tag: String?, message: String?) {}
        override fun logVerbose(tag: String?, message: String?) {}
        override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) {}
        override fun logStackTrace(tag: String?, e: Exception?) {}
    }

    private val viewClient = object : TerminalViewClient {
        override fun onScale(scale: Float): Float = 1f
        override fun onSingleTapUp(e: MotionEvent?) = showKeyboard()
        override fun shouldBackButtonBeMappedToEscape() = false
        override fun shouldEnforceCharBasedInput() = true
        override fun shouldUseCtrlSpaceWorkaround() = false
        override fun isTerminalViewSelected() = true
        override fun copyModeChanged(copyMode: Boolean) {}
        override fun onKeyDown(keyCode: Int, e: KeyEvent?, session: TerminalSession?) = false
        override fun onKeyUp(keyCode: Int, e: KeyEvent?) = false
        override fun onLongPress(event: MotionEvent?) = false
        override fun readControlKey() = false
        override fun readAltKey() = false
        override fun readShiftKey() = false
        override fun readFnKey() = false
        override fun onCodePoint(codePoint: Int, ctrlDown: Boolean, session: TerminalSession?) = false
        override fun onEmulatorSet() {}
        override fun logError(tag: String?, message: String?) {}
        override fun logWarn(tag: String?, message: String?) {}
        override fun logInfo(tag: String?, message: String?) {}
        override fun logDebug(tag: String?, message: String?) {}
        override fun logVerbose(tag: String?, message: String?) {}
        override fun logStackTraceWithMessage(tag: String?, message: String?, e: Exception?) {}
        override fun logStackTrace(tag: String?, e: Exception?) {}
    }
}
