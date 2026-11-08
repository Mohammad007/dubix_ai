package ai.dubix.engine.core

import android.os.SystemClock
import android.os.Trace
import java.util.concurrent.ConcurrentHashMap

/**
 * Performance instrumentation. Each stage is recorded as a systrace section (visible in
 * Perfetto / Android Studio profiler as `dubix:<stage>`) and as an aggregated metric that JS
 * reads via `getPerfSnapshot()` and persists per session.
 */
object Perf {
  class Stat {
    var count = 0L; private set
    var totalMs = 0.0; private set
    var maxMs = 0.0; private set
    var lastMs = 0.0; private set

    @Synchronized fun add(ms: Double) {
      count++; totalMs += ms; lastMs = ms; if (ms > maxMs) maxMs = ms
    }

    @Synchronized fun toMap(): Map<String, Any?> = mapOf(
      "count" to count,
      "avgMs" to if (count == 0L) 0.0 else totalMs / count,
      "maxMs" to maxMs,
      "lastMs" to lastMs,
      "totalMs" to totalMs
    )
  }

  private val stats = ConcurrentHashMap<String, Stat>()

  inline fun <T> trace(stage: String, block: () -> T): T {
    val t0 = SystemClock.elapsedRealtimeNanos()
    Trace.beginSection("dubix:$stage")
    try {
      return block()
    } finally {
      Trace.endSection()
      record(stage, (SystemClock.elapsedRealtimeNanos() - t0) / 1_000_000.0)
    }
  }

  fun record(stage: String, ms: Double) { stats.getOrPut(stage) { Stat() }.add(ms) }

  fun snapshot(): Map<String, Any?> = stats.mapValues { it.value.toMap() }

  fun reset() = stats.clear()
}
