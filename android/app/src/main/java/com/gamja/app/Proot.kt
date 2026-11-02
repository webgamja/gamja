package com.gamja.app

import android.content.Context
import java.io.File

/** proot로 Ubuntu 안에서 명령을 실행하는 도우미 (proot-distro와 같은 방식) */
class Proot(ctx: Context) {
    private val p = Paths(ctx)

    /** proot 자체가 쓰는 환경 변수 (안드로이드 쪽) */
    val hostEnv: Map<String, String>
        get() = System.getenv() + mapOf(
            "PROOT_LOADER" to p.loader.path,
            "PROOT_TMP_DIR" to p.tmp.path,
            "LD_LIBRARY_PATH" to p.bin.path,
        )

    /** Ubuntu 안의 프로그램이 보는 환경 변수 */
    private val guestEnv = listOf(
        "HOME=/root",
        "USER=root",
        "PATH=/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        "TERM=xterm-256color",
        "COLORTERM=truecolor",
        "LANG=C.UTF-8",
        "TMPDIR=/tmp",
    )

    /** Ubuntu 안에서 cmd를 실행하는 전체 명령줄 */
    fun command(vararg cmd: String): List<String> {
        val args = mutableListOf(
            p.proot.path, "--kill-on-exit", "--link2symlink", "-L", "--sysvipc", "-0",
            "-r", p.rootfs.path,
            "-b", "/dev", "-b", "/proc", "-b", "/sys",
            "-b", "${p.tmp.path}:/dev/shm",
            "-w", "/root",
        )
        // 안드로이드가 읽기를 막은 /proc 파일은 가짜 파일로 대신한다
        for (name in FAKE_PROC.keys) {
            if (!readable("/proc/$name")) {
                args += "-b"
                args += "${File(p.fakeProc, name).path}:/proc/$name"
            }
        }
        args += listOf("/usr/bin/env", "-i") + guestEnv + cmd
        return args
    }

    fun process(vararg cmd: String): ProcessBuilder = ProcessBuilder(command(*cmd)).apply {
        environment().putAll(hostEnv)
        redirectErrorStream(true)
    }

    private fun readable(path: String) = runCatching { File(path).inputStream().use { it.read() }; true }.getOrDefault(false)

    companion object {
        val FAKE_PROC = mapOf(
            "loadavg" to "0.12 0.07 0.02 2/165 765\n",
            "stat" to buildString {
                append("cpu  1957 0 2877 93280 262 342 254 87 0 0\n")
                for (i in 0 until 8) append("cpu$i 245 0 360 11660 33 43 32 11 0 0\n")
                append("intr 63361 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n")
                append("ctxt 38014093\nbtime 1694292441\nprocesses 26442\nprocs_running 1\nprocs_blocked 0\n")
                append("softirq 75663 0 5903 6 25375 10774 0 243 11685 0 21677\n")
            },
            "uptime" to "124.08 932.80\n",
            "version" to "Linux version 6.2.1-gamja (gamja@localhost) (gcc version 12) #1 SMP PREEMPT_DYNAMIC\n",
            "vmstat" to "nr_free_pages 1743136\nnr_zone_inactive_anon 179281\nnr_zone_active_anon 7183\n" +
                "nr_zone_inactive_file 22858\nnr_zone_active_file 51328\nnr_mlock 0\npgpgin 198\npgpgout 0\n",
        )
    }
}
