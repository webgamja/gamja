package com.gamja.app

import android.content.Context
import android.system.Os
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom

/**
 * 첫 실행 준비: 리눅스 도구 → Ubuntu → Node.js → 공식 Claude Code → 감자 서버.
 * 단계마다 완료 표시를 남겨서, 중간에 실패해도 "다시 시도"하면 끝난 단계는 건너뛴다.
 */
class Installer(
    private val ctx: Context,
    private val onStep: (index: Int, title: String) -> Unit,
    private val onLog: (String) -> Unit,
) {
    private val p = Paths(ctx)

    fun run() {
        p.markers.mkdirs()
        step(1, "리눅스 도구 준비", "bin", always = true) { extractBin() }
        step(2, "Ubuntu 내려받기 (약 30MB)", "rootfs") { installUbuntu() }
        step(3, "기본 설정", "config", always = true) { writeConfigs() }
        step(4, "Node.js 설치 (몇 분 걸려요)", "node") {
            sh("apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends " +
                "ca-certificates curl nodejs tar procps")
        }
        step(5, "Claude Code 설치 (공식 설치 스크립트)", "claude") {
            if (!p.claudeBin.exists()) sh("curl -fsSL https://claude.ai/install.sh | bash")
        }
        step(6, "감자 설치", "gamja", always = true) { installGamja() }
        p.marker("installed").createNewFile()
        onLog("✅ 준비 완료!")
    }

    private fun step(index: Int, title: String, marker: String, always: Boolean = false, block: () -> Unit) {
        onStep(index, title)
        val m = p.marker(marker)
        if (m.exists() && !always) {
            onLog("· $title — 이미 완료")
            return
        }
        onLog("▶ $title")
        block()
        m.createNewFile()
    }

    // 1. proot·loader·libtalloc을 APK에서 꺼내 실행 가능하게
    private fun extractBin() {
        p.bin.mkdirs()
        p.tmp.mkdirs()
        for (name in ctx.assets.list("bin").orEmpty()) {
            val out = File(p.bin, name)
            ctx.assets.open("bin/$name").use { input -> out.outputStream().use { input.copyTo(it) } }
            out.setExecutable(true, false)
        }
        if (!p.proot.exists()) throw IOException("APK 안에 proot가 없어요 (빌드 문제)")
        p.fakeProc.mkdirs()
        for ((name, text) in Proot.FAKE_PROC) File(p.fakeProc, name).writeText(text)
    }

    // 2. Ubuntu 공식 base 이미지 (arm64)
    private fun installUbuntu() {
        val base = "https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/"
        val name = Regex("ubuntu-base-24\\.04(\\.\\d+)?-base-arm64\\.tar\\.gz")
            .findAll(URL(base).readText()).map { it.value }.distinct()
            .maxByOrNull { it.substringAfter("24.04").substringBefore("-base").removePrefix(".").toIntOrNull() ?: 0 }
            ?: throw IOException("Ubuntu 이미지 목록을 읽지 못했어요")
        val file = File(p.files, "ubuntu-base.tar.gz")
        download(base + name, file)
        p.rootfs.deleteRecursively()
        p.rootfs.mkdirs()
        onLog("· 압축 푸는 중...")
        file.inputStream().use { untar(it, p.rootfs) }
        file.delete()
    }

    // 3. DNS, apt 설정 등 (매번 덮어씀)
    private fun writeConfigs() {
        val etc = File(p.rootfs, "etc")
        File(etc, "resolv.conf").apply { delete(); writeText("nameserver 8.8.8.8\nnameserver 1.1.1.1\n") }
        File(etc, "hosts").writeText("127.0.0.1 localhost\n::1 localhost ip6-localhost\n")
        // proot 안에서는 apt의 _apt 사용자 전환이 안 되므로 root로
        File(etc, "apt/apt.conf.d/99-gamja").apply { parentFile?.mkdirs(); writeText("APT::Sandbox::User \"root\";\n") }
        File(p.rootfs, "tmp").apply { mkdirs(); Os.chmod(path, "1777".toInt(8)) }
        File(p.rootfs, "root/projects").mkdirs()
    }

    // 6. 감자 서버 (APK에 들어 있는 묶음) + 비밀번호
    private fun installGamja() {
        p.appDir.mkdirs()
        // 이름이 .gz로 끝나면 안드로이드 빌드 도구가 압축을 풀고 이름을 바꿔 버려서 .pack을 쓴다 (내용은 tar.gz)
        ctx.assets.open("gamja-egg.pack").use { untar(it, p.appDir) }
        if (!p.envFile.exists()) {
            val pw = randomPassword()
            p.envFile.writeText("APP_PASSWORD=$pw\nPORT=3000\nHOST=0.0.0.0\nCLAUDE_BIN=/root/.local/bin/claude\n")
            onLog("· 로그인 비밀번호를 만들었어요 (앱 메뉴 → 다른 기기에서 접속)")
        }
    }

    /** Ubuntu 안에서 bash 스크립트 실행, 출력은 로그로 */
    private fun sh(script: String) {
        val proc = Proot(ctx).process("/bin/bash", "-c", script).start()
        proc.inputStream.bufferedReader().forEachLine { line -> line.split('\r').lastOrNull()?.let { if (it.isNotBlank()) onLog(it) } }
        val code = proc.waitFor()
        if (code != 0) throw IOException("명령이 실패했어요 (코드 $code)")
    }

    private fun download(url: String, dest: File) {
        onLog("· 내려받는 중: $url")
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 20000
        conn.readTimeout = 60000
        if (conn.responseCode != 200) throw IOException("내려받기 실패 (HTTP ${conn.responseCode})")
        val total = conn.contentLengthLong
        var done = 0L
        var lastPct = -1
        conn.inputStream.use { input ->
            dest.outputStream().use { out ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    done += n
                    if (total > 0) {
                        val pct = (done * 100 / total).toInt()
                        if (pct / 10 != lastPct / 10) { lastPct = pct; onLog("  $pct%") }
                    }
                }
            }
        }
    }

    companion object {
        const val TOTAL_STEPS = 6

        /** tar.gz 풀기: 심볼릭 링크·권한 유지, 하드 링크는 복사로 대신 */
        fun untar(input: InputStream, dest: File) {
            val hardLinks = mutableListOf<Pair<File, String>>()
            TarArchiveInputStream(GzipCompressorInputStream(BufferedInputStream(input))).use { tar ->
                while (true) {
                    val e = tar.nextEntry ?: break
                    val name = e.name.removePrefix("./").trimEnd('/')
                    if (name.isEmpty()) continue
                    if (name.split('/').any { it == ".." }) throw IOException("잘못된 경로: ${e.name}")
                    val out = File(dest, name)
                    out.parentFile?.mkdirs()
                    when {
                        e.isDirectory -> {
                            out.mkdirs()
                            Os.chmod(out.path, (e.mode and 0xFFF) or "700".toInt(8))
                        }
                        e.isSymbolicLink -> {
                            out.delete()
                            Os.symlink(e.linkName, out.path)
                        }
                        e.isLink -> hardLinks += out to e.linkName.removePrefix("./")
                        else -> {
                            out.delete()
                            out.outputStream().use { tar.copyTo(it) }
                            Os.chmod(out.path, e.mode and 0xFFF)
                        }
                    }
                }
            }
            for ((out, target) in hardLinks) {
                val src = File(dest, target)
                out.delete()
                src.copyTo(out, overwrite = true)
                if (src.canExecute()) out.setExecutable(true, false)
            }
        }

        fun randomPassword(): String {
            val chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
            val rnd = SecureRandom()
            return (1..12).map { chars[rnd.nextInt(chars.length)] }.joinToString("")
        }
    }
}
