package ai.dubix.engine.core

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.os.StatFs
import android.provider.Settings

/** Real device capabilities used by the compatibility checker and the setup checklist. */
object DeviceInfo {
  fun snapshot(context: Context): Map<String, Any?> {
    val am = context.getSystemService(ActivityManager::class.java)
    val mem = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
    val data = StatFs(Environment.getDataDirectory().path)
    val pm = context.getSystemService(PowerManager::class.java)
    return mapOf(
      "apiLevel" to Build.VERSION.SDK_INT,
      "release" to Build.VERSION.RELEASE,
      "manufacturer" to Build.MANUFACTURER,
      "model" to Build.MODEL,
      "abis" to Build.SUPPORTED_ABIS.toList(),
      "cpuCores" to Runtime.getRuntime().availableProcessors(),
      "totalRamMb" to (mem.totalMem / 1_048_576).toInt(),
      "availRamMb" to (mem.availMem / 1_048_576).toInt(),
      "lowRamDevice" to am.isLowRamDevice,
      "storageTotalBytes" to data.totalBytes.toDouble(),
      "storageFreeBytes" to data.availableBytes.toDouble(),
      "playbackCaptureSupported" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q),
      "canDrawOverlays" to Settings.canDrawOverlays(context),
      "powerSaveMode" to pm.isPowerSaveMode,
      "thermalStatus" to if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) pm.currentThermalStatus else 0
    ) + battery(context)
  }

  fun battery(context: Context): Map<String, Any?> {
    val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, 100) ?: 100
    val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
    val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
    return mapOf("batteryPct" to if (level >= 0) level * 100 / scale else -1, "charging" to charging)
  }

  /**
   * Inference thread budget: fewer threads in power-save, low battery, or thermal throttling,
   * trading speed for battery/heat.
   */
  fun inferenceThreads(context: Context): Int {
    val cores = Runtime.getRuntime().availableProcessors()
    val pm = context.getSystemService(PowerManager::class.java)
    val b = battery(context)
    val pct = b["batteryPct"] as Int
    val charging = b["charging"] as Boolean
    val hot = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && pm.currentThermalStatus >= PowerManager.THERMAL_STATUS_MODERATE
    return when {
      pm.isPowerSaveMode || hot || (!charging && pct in 0..15) -> 1
      cores >= 8 -> 4
      cores >= 4 -> 2
      else -> 1
    }
  }

  fun shouldThrottle(context: Context): String? {
    val pm = context.getSystemService(PowerManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && pm.currentThermalStatus >= PowerManager.THERMAL_STATUS_SEVERE) return "thermal"
    val b = battery(context)
    if (!(b["charging"] as Boolean) && (b["batteryPct"] as Int) in 0..5) return "battery_critical"
    return null
  }
}
