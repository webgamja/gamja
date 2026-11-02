package com.gamja.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.widget.Toast

/** 설치 도구가 알려 주는 결과를 받는다: 확인 화면 띄우기 / 실패 알리기 (성공하면 앱이 새 버전으로 바뀐다) */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
                if (confirm != null) ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> {}
            else -> Toast.makeText(
                ctx, "업데이트를 설치하지 못했어요: ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: ""}",
                Toast.LENGTH_LONG,
            ).show()
        }
    }

    companion object {
        const val ACTION = "com.gamja.app.UPDATE_STATUS"
    }
}
