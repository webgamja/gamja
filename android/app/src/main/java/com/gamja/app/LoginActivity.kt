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

        // 안내 카드
        guideTitle = TextView(this).apply { textSize = 18f; setTypeface(typeface, Typeface.BOLD); setTextColor(Color.BLACK) }
        guideText = TextView(this).apply { textSize = 14f; setTextColor(0xFF444444.toInt()); setPadding(0, (4 * dp).toInt(), 0, (8 * dp).toInt()) }
        guideButton = Button(this).apply { isAllCaps = false; textSize = 16f }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFFFFF6C2.toInt())
            val pad = (14 * dp).toInt()
            setPadding(pad, pad, pad, pad)
            addView(guideTitle)
            addView(guideText)
            addView(guideButton)
        }

        // 공식 Claude Code 터미널 (어두운 바탕)
        terminal = TerminalView(this, null).apply {
            setTextSize((14 * resources.displayMetrics.scaledDensity).toInt())
            setTypeface(Typeface.MONOSPACE)
            setBackgroundColor(0xFF1C1C1E.toInt())
            isFocusableInTouchMode = true
            setTerminalViewClient(viewClient)
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
            setBackgroundColor(0xFF2C2C2E.toInt())
            addView(key("↑") { session.write("\u001b[A") })
            addView(key("↓") { session.write("\u001b[B") })
            addView(key("Enter") { session.write("\r") })
            addView(key("Esc") { session.write("\u001b") })
            addView(key("붙여넣기") { paste(submit = false) })
        }

        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF1C1C1E.toInt())
            addView(card)
            addView(terminal, LinearLayout.LayoutParams(-1, 0, 1f))
            addView(keys)
        })
        showStage(Stage.STARTING)
        terminal.requestFocus()
    }

    private fun key(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        setOnClickListener { onClick() }
        layoutParams = LinearLayout.LayoutParams(0, -2, 1f)
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
            Stage.STARTING -> guide("Claude Code를 여는 중...", "잠시만 기다려 주세요.", null, null)
            Stage.THEME -> guide("1. 화면 스타일 고르기", "아래 화면에서 원하는 스타일을 고르는 단계예요. 기본값 그대로 넘어가도 돼요.", "다음 (Enter)") {
                session.write("\r")
            }
            Stage.METHOD -> guide("2. 로그인 방법 고르기", "'Claude account with subscription'(Claude 구독 계정)이 선택된 상태에서 넘어가요.", "구독 계정으로 로그인 (Enter)") {
                session.write("\r")
            }
            Stage.BROWSER, Stage.CODE -> guide(
                "3. 브라우저에서 로그인",
                "버튼을 눌러 Claude 공식 페이지에서 로그인하세요. 로그인이 끝나면 나오는 코드를 복사한 뒤 이 앱으로 돌아오세요.",
                "🌐 브라우저에서 로그인",
            ) { openLoginUrl() }
            Stage.SUCCESS -> {
                guide("✅ 로그인 완료!", "채팅 화면으로 이동해요...", null, null)
                finishWhenSaved()
            }
            Stage.READY -> guide("이미 로그인돼 있어요", "다른 계정으로 바꾸려면 아래 화면에 /login 을 입력하세요.", "완료") { done() }
        }
    }

    private fun guide(title: String, text: String, button: String?, onClick: (() -> Unit)?) {
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
            guide("4. 코드 붙여넣기", "복사한 로그인 코드를 찾았어요. 버튼을 누르면 Claude Code에 붙여 넣고 완료해요.", "📋 코드 붙여넣고 완료") {
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
        if (submit) session.write("\r")
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
