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

    init { Ports.envFile = envFile } // 앱의 다른 곳(MainActivity.BASE 등)이 감자알의 포트를 알 수 있게 .env 위치를 알려 둔다

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

/**
 * 감자알이 듣는 포트. 감자알의 .env에 적힌 PORT를 읽는다. 예전에 설치한 폰은 PORT=3000이 적혀 있어서 그대로 3000을 쓰고,
 * 새로 설치한 폰은 26514다. .env에 PORT가 없으면 감자알의 기본값(26514)과 같게 맞춘다.
 */
object Ports {
    const val DEFAULT = 26514
    @Volatile var envFile: File? = null

    fun current(): Int {
        val fromEnv = runCatching {
            envFile?.takeIf { it.exists() }?.readLines()
                ?.firstOrNull { it.startsWith("PORT=") }?.substringAfter("=")?.trim()?.toInt()
        }.getOrNull()
        return fromEnv?.takeIf { it in 1..65535 } ?: DEFAULT
    }
}
