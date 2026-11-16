package com.gamja.app

import android.content.Context
import android.system.Os
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Node 24를 Ubuntu 안의 /usr/local/bin/node에 넣는다. 설치 때 apt로 받는 nodejs는 18이라서,
 * 감자알을 켜기 전에(= bash가 node 위치를 처음 찾기 전에) 넣어 둬야 감자알이 Node 24로 뜬다.
 * PATH에서 /usr/local/bin이 /usr/bin보다 앞이라 apt의 node 18은 그대로 두어도 된다.
 * 실패하면 아무것도 바꾸지 않고 Node 18로 계속 쓰고, 다음에 감자알을 켤 때 다시 시도한다.
 */
object NodeInstaller {
    private const val DIST = "https://nodejs.org/dist/latest-v24.x/"

    /** 이미 들어 있는지 (감자알이 스스로 받아 둔 것도 Node 24다) */
    fun installed(p: Paths): Boolean = target(p).let { it.exists() && it.length() > 10_000_000 }

    private fun target(p: Paths) = File(p.rootfs, "usr/local/bin/node")

    fun ensure(ctx: Context, log: (String) -> Unit): Boolean {
        val p = Paths(ctx)
        if (installed(p)) return true
        return try {
            log("[Node 24] 받는 중...")
            val sums = URL(DIST + "SHASUMS256.txt").readText()
            val line = sums.lines().firstOrNull { it.trim().endsWith("-linux-arm64.tar.gz") }
                ?: throw IOException("SHASUMS256.txt에 linux-arm64 파일이 없어요")
            val (hash, name) = line.trim().split(Regex("\\s+")).let { it[0].lowercase() to it[1] }
            val dir = File(p.files, "node-dl").apply { deleteRecursively(); mkdirs() }
            val tgz = File(dir, name)
            download(DIST + name, tgz)
            val got = sha256(tgz)
            if (got != hash) throw IOException("파일 확인 실패 (sha256 불일치)")
            val out = target(p)
            out.parentFile?.mkdirs()
            val part = File(out.parentFile, "node.part")
            var found = false
            TarArchiveInputStream(GzipCompressorInputStream(BufferedInputStream(tgz.inputStream()))).use { tar ->
                while (true) {
                    val e = tar.nextEntry ?: break
                    if (!e.isFile || !e.name.endsWith("/bin/node")) continue
                    part.outputStream().use { tar.copyTo(it) }
                    found = true
                    break
                }
            }
            if (!found) throw IOException("압축 안에 bin/node가 없어요")
            Os.chmod(part.path, "755".toInt(8))
            if (!part.renameTo(out)) throw IOException("파일을 옮기지 못했어요")
            dir.deleteRecursively()
            log("[Node 24] 설치 완료: ${name.removeSuffix("-linux-arm64.tar.gz")}")
            true
        } catch (e: Exception) {
            runCatching { File(p.files, "node-dl").deleteRecursively() }
            log("[Node 24] 설치 실패, Node 18로 계속해요 (다음에 다시 시도): ${e.message}")
            false
        }
    }

    private fun download(url: String, dest: File) {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 20000
        conn.readTimeout = 60000
        if (conn.responseCode != 200) throw IOException("내려받기 실패 (HTTP ${conn.responseCode})")
        conn.inputStream.use { input -> dest.outputStream().use { input.copyTo(it, 64 * 1024) } }
    }

    private fun sha256(f: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        f.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) { val n = input.read(buf); if (n < 0) break; md.update(buf, 0, n) }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
