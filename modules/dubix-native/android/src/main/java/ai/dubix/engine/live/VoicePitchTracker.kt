package ai.dubix.engine.live

import ai.dubix.engine.audio.PitchEstimator
import ai.dubix.engine.pipeline.AudioRing
import ai.dubix.engine.pipeline.GenderHint
import android.media.AudioRecord
import android.os.SystemClock
import android.util.Log

/**
 * Keeps the last few seconds of the playing app's audio (Android playback capture, same consent)
 * so subtitle mode can tell whether a line is spoken by a lower (male) or higher (female) voice.
 * Audio stays in memory only. If the app blocks capture, everything is silent and the caller falls
 * back to subtitle cues.
 */
class VoicePitchTracker(private val record: AudioRecord, private val rate: Int) {
  private val ring = AudioRing(rate * 8)
  @Volatile private var running = false
  private var thread: Thread? = null
  @Volatile private var endIndex = 0L
  @Volatile private var endAt = 0L

  fun start() {
    running = true
    runCatching { record.startRecording() }.onFailure { Log.w(TAG, "capture failed", it); running = false; return }
    thread = Thread({
      val buf = ShortArray(rate / 20)
      while (running) {
        val n = record.read(buf, 0, buf.size)
        if (n <= 0) { if (n == AudioRecord.ERROR_DEAD_OBJECT) break else continue }
        val f = FloatArray(n) { buf[it] / 32768f }
        synchronized(ring) {
          ring.append(endIndex, f)
          endIndex += n
          endAt = SystemClock.elapsedRealtime()
        }
      }
    }, "dubix-pitch").apply { isDaemon = true; start() }
  }

  /** Median F0 of the audio between two elapsedRealtime instants, or null if silent/unvoiced. */
  fun f0Between(fromMs: Long, toMs: Long): Float? {
    val samples = synchronized(ring) {
      if (endAt == 0L) return null
      val to = endIndex - (endAt - toMs).coerceAtLeast(0) * rate / 1000
      val from = endIndex - (endAt - fromMs).coerceAtLeast(0) * rate / 1000
      ring.slice(from, to)
    }
    if (samples.size < rate / 5) return null
    return PitchEstimator.medianF0(GenderHint.normalize(samples), rate)
  }

  fun stop() {
    running = false
    runCatching { record.stop() }
    thread?.join(300)
    record.release()
  }

  private companion object { const val TAG = "DubixPitch" }
}
