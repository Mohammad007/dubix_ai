package ai.dubix.engine.player

import ai.dubix.engine.core.DubixEvents
import ai.dubix.engine.core.Wav
import ai.dubix.engine.ml.TtsEngine
import ai.dubix.engine.pipeline.SegmentFit
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTimestamp
import android.media.AudioTrack
import android.media.PlaybackParams
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.media3.exoplayer.ExoPlayer
import java.io.File
import java.util.concurrent.LinkedBlockingQueue

/**
 * Plays generated dub segments in sync with an ExoPlayer instance. Scheduling uses the player's
 * audio-clock position plus a *measured* output latency of the dub AudioTrack (which grows with
 * Bluetooth), the user offset, and catch-up rules from [SegmentFit.decide].
 * The original track keeps playing through ExoPlayer; optional ducking lowers it (music and
 * effects included) while a dub segment plays.
 */
class DubPlaybackEngine(private val playerId: String, private val player: ExoPlayer) {
  data class Seg(val id: String, val startMs: Long, val endMs: Long, val path: String)

  data class Config(
    val enabled: Boolean = true,
    val offsetMs: Long = 0,
    val dubVolume: Float = 1f,
    val originalVolume: Float = 1f,
    val duckWhileDubbing: Boolean = true,
    val duckLevel: Float = 0.6f // fraction removed from the original while a segment plays
  )

  private val main = Handler(Looper.getMainLooper())
  private var segs: List<Seg> = emptyList()
  private val played = HashSet<String>()
  @Volatile var config = Config(); private set
  @Volatile private var latencyMs = 0.0
  @Volatile private var latencyMeasured = false
  /** Scheduling error (actual start - intended start) of recent segments, for drift monitoring. */
  @Volatile private var driftAvgMs = 0.0
  @Volatile private var lastStartErrorMs = 0L
  private val writer = Writer()

  /** Follows the movie's playback speed; AudioTrack time-stretches with pitch preserved. */
  fun setRate(rate: Float) { writer.setRate(rate) }

  init { writer.start() }

  fun setSegments(list: List<Seg>) {
    segs = list.sortedBy { it.startMs }
    resyncPlayed(player.currentPosition)
  }

  fun addSegments(list: List<Seg>) {
    val ids = list.map { it.id }.toSet()
    segs = (segs.filter { it.id !in ids } + list).sortedBy { it.startMs }
    val pos = player.currentPosition
    list.forEach { if (it.endMs + config.offsetMs < pos) played.add(it.id) else played.remove(it.id) }
  }

  fun setConfig(c: Config) {
    config = c
    writer.volume = c.dubVolume
    applyOriginalVolume(writer.isBusy())
    if (!c.enabled) writer.stopNow()
  }

  /** Called every ~20 ms on the main thread. */
  fun tick() {
    if (!config.enabled || !player.isPlaying || writer.isBusy()) return
    val pos = player.currentPosition + latencyMs.toLong()
    for (s in segs) {
      if (s.id in played) continue
      val start = s.startMs + config.offsetMs
      when (SegmentFit.decide(pos, start, s.endMs - s.startMs)) {
        SegmentFit.Decision.WAIT -> return
        SegmentFit.Decision.PLAY -> { recordStart(pos - start); played.add(s.id); writer.play(s, 0); return }
        SegmentFit.Decision.PLAY_FROM_OFFSET -> { recordStart(pos - start); played.add(s.id); writer.play(s, pos - start); return }
        SegmentFit.Decision.SKIP -> played.add(s.id)
      }
    }
  }

  private fun recordStart(errorMs: Long) {
    lastStartErrorMs = errorMs
    driftAvgMs = if (driftAvgMs == 0.0) errorMs.toDouble() else driftAvgMs * 0.8 + errorMs * 0.2
  }

  fun onSeek(positionMs: Long) { writer.stopNow(); resyncPlayed(positionMs) }
  fun onPlayingChanged(playing: Boolean) { if (playing) writer.resumeOutput() else writer.pauseOutput() }
  fun onRouteChanged() { latencyMeasured = false }

  private fun resyncPlayed(positionMs: Long) {
    played.clear()
    segs.forEach { if (it.startMs + config.offsetMs + (it.endMs - it.startMs) * 6 / 10 < positionMs) played.add(it.id) }
  }

  private fun applyOriginalVolume(dubbing: Boolean) {
    val c = config
    player.volume = if (dubbing && c.enabled && c.duckWhileDubbing) c.originalVolume * (1f - c.duckLevel) else c.originalVolume
  }

  fun release() {
    writer.shutdown()
    main.removeCallbacksAndMessages(null)
  }

  private fun emitState(state: String, segId: String? = null) {
    DubixEvents.emit(DubixEvents.DUB_STATE, mapOf(
      "playerId" to playerId, "state" to state, "segmentId" to segId,
      "outputLatencyMs" to latencyMs, "latencyMeasured" to latencyMeasured,
      "startErrorMs" to lastStartErrorMs.toDouble(), "driftAvgMs" to driftAvgMs
    ))
  }

  /** Dedicated thread writing PCM to one streaming AudioTrack. */
  private inner class Writer : Thread("dubix-dub-writer") {
    private val rate = TtsEngine.OUTPUT_RATE
    private val queue = LinkedBlockingQueue<Pair<Seg, Long>>()
    @Volatile private var stop = false
    @Volatile private var paused = false
    @Volatile private var shutdown = false
    @Volatile private var busy = false
    @Volatile var volume = 1f
    private val track: AudioTrack = run {
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .apply {
          // Our synthesized speech must never be re-captured (by our own capture or other apps).
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_SYSTEM)
        }.build()
      val fmt = AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build()
      val min = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT)
      AudioTrack.Builder().setAudioAttributes(attrs).setAudioFormat(fmt)
        .setBufferSizeInBytes(maxOf(min, rate / 10 * 4)) // ~100 ms
        .setTransferMode(AudioTrack.MODE_STREAM).build()
    }
    private var framesWritten = 0L

    fun isBusy() = busy || queue.isNotEmpty()
    fun setRate(rate: Float) {
      runCatching { track.playbackParams = PlaybackParams().setSpeed(rate.coerceIn(0.5f, 2f)).setPitch(1f) }
    }
    fun play(s: Seg, fromMs: Long) { busy = true; queue.offer(s to fromMs.coerceAtLeast(0)) }
    fun stopNow() { queue.clear(); stop = true }
    fun pauseOutput() { paused = true; runCatching { track.pause() } }
    fun resumeOutput() { paused = false; if (busy) runCatching { track.play() } }
    fun shutdown() { shutdown = true; stopNow(); interrupt() }

    override fun run() {
      try {
        while (!shutdown) {
          val (seg, fromMs) = try { queue.take() } catch (_: InterruptedException) { break }
          stop = false
          playSegment(seg, fromMs)
          busy = queue.isNotEmpty()
          if (!busy) main.post { applyOriginalVolume(false) }
        }
      } finally {
        runCatching { track.stop() }
        track.release()
      }
    }

    private fun playSegment(seg: Seg, fromMs: Long) {
      val audio = runCatching { Wav.read(File(seg.path)) }.getOrNull() ?: return
      val samples = audio.samples
      var i = (fromMs * rate / 1000).toInt().coerceIn(0, samples.size)
      if (i >= samples.size) return
      main.post { applyOriginalVolume(true) }
      emitState("playing", seg.id)
      track.setVolume(volume)
      if (!paused) track.play()
      val startFrame = framesWritten
      val writeStartNs = System.nanoTime()
      val ts = AudioTimestamp()
      val chunk = rate / 50 // 20 ms
      while (i < samples.size && !stop && !shutdown) {
        if (paused) { SystemClock.sleep(20); continue }
        val n = minOf(chunk, samples.size - i)
        val w = track.write(samples, i, n, AudioTrack.WRITE_BLOCKING)
        if (w <= 0) break
        i += w; framesWritten += w
        if (!latencyMeasured && track.getTimestamp(ts) && ts.framePosition >= startFrame) {
          val presentedNs = ts.nanoTime - (ts.framePosition - startFrame) * 1_000_000_000L / rate
          val measured = (presentedNs - writeStartNs) / 1e6
          if (measured in 0.0..1500.0) {
            latencyMs = if (latencyMs == 0.0) measured else latencyMs * 0.7 + measured * 0.3
            latencyMeasured = true
          }
        }
      }
      if (stop) { runCatching { track.pause(); track.flush() } }
      else {
        // let the tail drain before reporting idle
        SystemClock.sleep(minOf(300L, latencyMs.toLong() + 40))
        runCatching { track.pause() }
      }
      emitState(if (stop) "interrupted" else "idle", seg.id)
    }
  }
}
