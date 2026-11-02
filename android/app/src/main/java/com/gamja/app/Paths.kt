package com.gamja.app

import android.content.Context
import java.io.File

/** 앱 안의 파일 위치와 상태 확인 */
class Paths(ctx: Context) {
    val files: File = ctx.filesDir
    val bin = File(files, "bin")               // proot, loader, libtalloc (APK assets에서 꺼냄)
    val proot = File(bin, "proot")
    val loader = File(bin, "loader")
    val tmp = File(files, "tmp")
    val fakeProc = File(files, "proc")         // 안드로이드가 막은 /proc 파일 대용
    val rootfs = File(files, "ubuntu")         // Ubuntu 루트 파일 시스템
    val markers = File(files, "markers")       // 설치 단계별 완료 표시
    val serverLog = File(files, "server.log")
    val appDir = File(rootfs, "root/gamja-egg") // 감자알 (Ubuntu 안의 /root/gamja-egg)
    val envFile = File(appDir, ".env")
    val claudeBin = File(rootfs, "root/.local/bin/claude")

    fun marker(name: String) = File(markers, name)

    fun isInstalled() = marker("installed").exists()

    /** 공식 Claude Code에 로그인했는지 (Claude Code가 남기는 파일로 추정) */
    fun isLoggedIn(): Boolean {
        if (File(rootfs, "root/.claude/.credentials.json").exists()) return true
        val cfg = File(rootfs, "root/.claude.json")
        return cfg.exists() && runCatching { cfg.readText().contains("oauthAccount") }.getOrDefault(false)
    }

    fun password(): String? = envFile.takeIf { it.exists() }?.readLines()
        ?.firstOrNull { it.startsWith("APP_PASSWORD=") }?.substringAfter("=")
}
