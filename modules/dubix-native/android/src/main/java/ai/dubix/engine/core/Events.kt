package ai.dubix.engine.core

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Process-wide event bus used by background workers (jobs, downloads, the capture service)
 * to reach the JS bridge. Events emitted while no bridge is attached are dropped, except the
 * latest live state which stays queryable through [lastLiveState].
 */
object DubixEvents {
  const val DOWNLOAD_PROGRESS = "onDownloadProgress"
  const val JOB_PROGRESS = "onJobProgress"
  const val JOB_SEGMENT = "onJobSegment"
  const val JOB_STATE = "onJobState"
  const val PLAYER_STATE = "onPlayerState"
  const val DUB_STATE = "onDubState"
  const val LIVE_STATE = "onLiveState"
  const val LIVE_SEGMENT = "onLiveSegment"
  const val LIVE_LEVEL = "onLiveLevel"
  const val AUDIO_ROUTE = "onAudioRoute"
  const val SYSTEM_WARNING = "onSystemWarning"

  val ALL = arrayOf(
    DOWNLOAD_PROGRESS, JOB_PROGRESS, JOB_SEGMENT, JOB_STATE, PLAYER_STATE, DUB_STATE,
    LIVE_STATE, LIVE_SEGMENT, LIVE_LEVEL, AUDIO_ROUTE, SYSTEM_WARNING
  )

  fun interface Sink { fun emit(name: String, body: Map<String, Any?>) }

  private val sinks = CopyOnWriteArrayList<Sink>()
  private val main = Handler(Looper.getMainLooper())

  @Volatile var lastLiveState: Map<String, Any?> = mapOf("state" to "idle")
    private set

  fun attach(sink: Sink) { sinks.add(sink) }
  fun detach(sink: Sink) { sinks.remove(sink) }

  fun emit(name: String, body: Map<String, Any?>) {
    if (name == LIVE_STATE) lastLiveState = body
    if (sinks.isEmpty()) return
    main.post { sinks.forEach { runCatching { it.emit(name, body) } } }
  }

  fun warning(code: String, message: String, extra: Map<String, Any?> = emptyMap()) =
    emit(SYSTEM_WARNING, mapOf("code" to code, "message" to message) + extra)
}
