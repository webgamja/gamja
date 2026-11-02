package com.gamja.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** 폰을 켜거나 감자 앱이 업데이트되면 감자알을 자동으로 다시 시작 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val wanted = intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED
        if (wanted && Paths(ctx).isInstalled()) runCatching { GamjaService.start(ctx) }
    }
}
