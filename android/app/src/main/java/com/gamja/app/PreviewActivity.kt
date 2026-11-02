package com.gamja.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.TextView

/**
 * 결과물(크루가 만든 웹페이지·이미지·음악·영상)을 보여 주는 따로 떨어진 화면.
 *
 * 왜 따로 만드나: 감자 화면(MainActivity의 WebView)에는 앱 기능을 부르는 통로(GamjaApp)가 붙어 있고, 이 통로는 그 안의 모든 창(iframe 포함)에 생긴다.
 * 크루가 만든 페이지를 같은 WebView 안에서 열면 그 페이지의 코드가 통로를 부를 수 있게 된다.
 * 그래서 결과물은 통로가 없는 이 WebView에서만 연다. 여기에는 addJavascriptInterface를 절대 붙이지 않는다.
 */
class PreviewActivity : Activity() {
    private var web: WebView? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val title = intent.getStringExtra(EXTRA_TITLE) ?: ""
        val url = intent.getStringExtra(EXTRA_URL) ?: ""
        val html = intent.getStringExtra(EXTRA_HTML) ?: ""
        // 감자 안의 결과물 주소가 아니면 열지 않는다 (직접 만든 작은 페이지는 html로 온다)
        if (url.isNotEmpty() && !url.startsWith("${MainActivity.BASE}/preview/")) { finish(); return }

        val density = resources.displayMetrics.density
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.parseColor("#111111")) }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(Color.parseColor("#1c1d22"))
            setPadding((8 * density).toInt(), (28 * density).toInt(), (16 * density).toInt(), (8 * density).toInt())
        }
        val back = TextView(this).apply {
            text = "←"
            textSize = 24f
            setTextColor(Color.WHITE)
            setPadding((12 * density).toInt(), 0, (12 * density).toInt(), 0)
            setOnClickListener { finish() }
        }
        val label = TextView(this).apply {
            text = title
            textSize = 17f
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            maxLines = 1
        }
        bar.addView(back)
        bar.addView(label)
        root.addView(bar)

        val wv = WebView(this).apply {
            settings.javaScriptEnabled = true // 만든 페이지가 움직이려면 필요하다 (페이지는 CSP sandbox로 격리돼서 감자의 로그인·저장소에 닿지 못한다)
            settings.domStorageEnabled = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.mediaPlaybackRequiresUserGesture = false
            setBackgroundColor(Color.parseColor("#111111"))
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val target = request?.url ?: return true
                    val s = target.toString()
                    if (s.startsWith("${MainActivity.BASE}/preview/") || s.startsWith("about:") || s.startsWith("data:")) return false
                    // 다른 사이트로 가는 링크는 폰의 브라우저가 연다. http(s)가 아닌 주소(intent:, javascript: 등)는 막는다
                    if (target.scheme == "http" || target.scheme == "https") runCatching { startActivity(Intent(Intent.ACTION_VIEW, target)) }
                    return true
                }
            }
            // 이 WebView에는 앱 기능 통로(addJavascriptInterface)를 붙이지 않는다. 일부러다.
        }
        web = wv
        root.addView(wv, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        window.statusBarColor = Color.parseColor("#1c1d22")
        window.decorView.systemUiVisibility = window.decorView.systemUiVisibility and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()

        if (url.isNotEmpty()) wv.loadUrl(url)
        else wv.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    @Deprecated("뒤로 가기: 페이지 안에서 이동했으면 한 단계 뒤로, 아니면 닫는다")
    override fun onBackPressed() {
        val wv = web
        if (wv != null && wv.canGoBack()) wv.goBack() else finish()
    }

    override fun onDestroy() {
        web?.destroy()
        web = null
        super.onDestroy()
    }

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_HTML = "html"
        const val EXTRA_TITLE = "title"
    }
}
