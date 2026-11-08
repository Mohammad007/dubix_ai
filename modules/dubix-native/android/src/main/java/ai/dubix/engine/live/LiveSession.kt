package ai.dubix.engine.live

import ai.dubix.engine.audio.PitchEstimator
import ai.dubix.engine.core.DubixEvents
import ai.dubix.engine.ml.EngineHub
import ai.dubix.engine.ml.MODEL_SAMPLE_RATE
import ai.dubix.engine.ml.TranslationEngine
import ai.dubix.engine.ml.TtsEngine
import ai.dubix.engine.ml.VadEngine
import ai.dubix.engine.ml.VoiceSpec
import ai.dubix.engine.pipeline.TextNormalizer
import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.os.Build
import android.os.SystemClock
import org.json.JSONObject
import java.util.concurrent.LinkedBlockingDeque
import java.util.concurrent.atomic.AtomicInteger

/**
 * Streaming translation over an [AudioRecord] source (microphone, or AudioPlaybackCapture of
 * other apps that allow it). Reader thread: capture -> level -> VAD. Worker thread:
 * ASR -> MT -> caption event -> optional TTS. Synthesized speech is played with a capture
 * policy that excludes it from playback capture, and the microphone path is half-duplex gated
 * while we speak, so our own voice is never re-translated.
 */
class LiveSession(private val record: AudioRecord, private val cfg: Config, private val listener: Listener) : LiveEngine {
  data class Config(
    val source: String,          // "mic" | "playback" | "screen"
    val sourceLang: String,      // "auto" | code
    val targetLang: String,      // display language code (e.g. "hinglish" handled in JS)
    val translateTarget: String, // ML Kit target
    val vadModelId: String,
    val asrModelId: String,
    val voice: VoiceSpec?,
    /** "male" | "female" | "neutral" voices; when present, each utterance uses a voice matching its pitch. */
    val voicePools: Map<String, List<VoiceSpec>>,
    var speak: Boolean,
    var captions: Boolean,
    /** Digital boost for the translated voice (0..12 dB), so it stays audible over low-volume apps. */
    val voiceGainDb: Float = 0f
  ) {
    companion object {
      fun from(json: JSONObject): Config = Config(
        source = json.getString("source"),
        sourceLang = json.optString("sourceLang", "auto"),
        targetLang = json.getString("targetLang"),
        translateTarget = json.getString("translateTarget"),
        vadModelId = json.getString("vadModelId"),
        asrModelId = json.getString("asrModelId"),
        voice = json.optJSONObject("voice")?.let { v -> VoiceSpec.from(v.keys().asSequence().associateWith { v.get(it) }) },
        voicePools = json.optJSONObject("voicePools")?.let { pools ->
          pools.keys().asSequence().associateWith { k ->
            val arr = pools.getJSONArray(k)
            (0 until arr.length()).map { i -> arr.getJSONObject(i).let { v -> VoiceSpec.from(v.keys().asSequence().associateWith { v.get(it) }) } }
          }
        } ?: emptyMap(),
        speak = json.optBoolean("speak", true),
        captions = json.optBoolean("captions", true),
        voiceGainDb = json.optDouble("voiceGainDb", 0.0).toFloat().coerceIn(0f, 12f)
      )
    }
  }

  interface Listener {
    fun onState(state: String, message: String? = null)
    fun onCaption(original: String, translated: String)
  }

  private class Utterance(val samples: FloatArray, val endedAt: Long, val mediaMs: Long)

  @Volatile private var running = false
  @Volatile override var paused = false; private set
  @Volatile private var speakingUntil = 0L
  private val queue = LinkedBlockingDeque<Utterance>()
  private val droppedAudio = AtomicInteger(0)
  private var reader: Thread? = null
  private var worker: Thread? = null
  private var aec: AcousticEchoCanceler? = null
  private val startedAt = SystemClock.elapsedRealtime()
  private var latencyEma = 0.0

  private val out: AudioTrack = AudioTrack.Builder()
    .setAudioAttributes(AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .apply { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_SYSTEM) }
      .build())
    .setAudioFormat(AudioFormat.Builder().setSampleRate(TtsEngine.OUTPUT_RATE).setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
      .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
    .setBufferSizeInBytes(AudioTrack.getMinBufferSize(TtsEngine.OUTPUT_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT) * 2)
    .setTransferMode(AudioTrack.MODE_STREAM)
    .build()

  override fun start() {
    running = true
    if (cfg.source == "mic" && AcousticEchoCanceler.isAvailable()) {
      aec = runCatching { AcousticEchoCanceler.create(record.audioSessionId)?.apply { enabled = true } }.getOrNull()
    }
    record.startRecording()
    if (record.recordingState != AudioRecord.RECORDSTATE_RECORDING) {
      running = false
      listener.onState("error", "Audio capture could not start. Another app may be using the microphone.")
      return
    }
    reader = Thread(::readLoop, "dubix-live-reader").apply { priority = Thread.MAX_PRIORITY; start() }
    worker = Thread(::workLoop, "dubix-live-worker").apply { start() }
    listener.onState("listening")
  }

  override fun setPaused(p: Boolean) {
    paused = p
    if (p) { queue.clear(); runCatching { out.pause(); out.flush() } }
    listener.onState(if (p) "paused" else "listening")
  }

  override fun setSpeak(on: Boolean) { cfg.speak = on; if (!on) runCatching { out.pause(); out.flush() } }
  override fun setCaptions(on: Boolean) { cfg.captions = on }
  override fun config() = cfg

  override fun stop() {
    running = false
    reader?.interrupt(); worker?.interrupt()
    runCatching { reader?.join(1_000) }
    runCatching { worker?.join(2_000) }
    runCatching { record.stop() }
    record.release()
    aec?.release()
    runCatching { out.stop() }
    out.release()
  }

  private fun readLoop() {
    val vad = try { VadEngine(EngineHub.store, cfg.vadModelId, 1, maxSpeechSec = 6f, minSilenceSec = 0.25f) } catch (e: Throwable) {
      listener.onState("error", "Voice activity model missing: ${e.message}"); return
    }
    val frame = ShortArray(MODEL_SAMPLE_RATE / 50) // 20 ms
    val floats = FloatArray(frame.size)
    var silentMs = 0L
    var silentReported = false
    var lastLevel = 0L
    var totalSamples = 0L
    try {
      while (running) {
        val n = record.read(frame, 0, frame.size)
        if (n == AudioRecord.ERROR_DEAD_OBJECT || n == AudioRecord.ERROR_INVALID_OPERATION) {
          listener.onState("error", "Audio capture stopped by the system (permission revoked or device changed).")
          break
        }
        if (n <= 0) continue
        for (i in 0 until n) floats[i] = frame[i] / 32768f
        val chunk = if (n == floats.size) floats.copyOf() else floats.copyOf(n)
        totalSamples += n
        val level = PitchEstimator.rms(chunk)
        val now = SystemClock.elapsedRealtime()
        if (now - lastLevel > 100) {
          DubixEvents.emit(DubixEvents.LIVE_LEVEL, mapOf("level" to level.toDouble(), "speaking" to (now < speakingUntil), "speech" to vad.isSpeech()))
          lastLevel = now
        }
        if (paused) continue

        // Capture-silence detection: AudioPlaybackCapture yields silence for apps that opt out.
        if (level < 1e-4f) silentMs += n * 1000L / MODEL_SAMPLE_RATE else {
          silentMs = 0
          if (silentReported) { silentReported = false; listener.onState("listening") }
        }
        if (!silentReported && silentMs > SILENCE_REPORT_MS) {
          silentReported = true
          listener.onState(if (cfg.source == "playback") "capture_silent" else "mic_silent")
        }

        // Half-duplex gate for the microphone while our own speech is audible.
        if (cfg.source == "mic" && now < speakingUntil + 250) { vad.reset(); continue }

        for ((_, samples) in vad.accept(chunk)) {
          if (queue.size >= MAX_BACKLOG) { queue.pollFirst(); droppedAudio.incrementAndGet() }
          queue.offer(Utterance(samples, now, totalSamples * 1000 / MODEL_SAMPLE_RATE))
        }
      }
    } finally {
      vad.release()
    }
  }

  private fun workLoop() {
    val asr = try { EngineHub.asr(cfg.asrModelId, if (cfg.sourceLang == "auto") "" else cfg.sourceLang) } catch (e: Throwable) {
      listener.onState("error", "Speech recognition model missing: ${e.message}"); return
    }
    while (running) {
      val u = try { queue.take() } catch (_: InterruptedException) { break }
      if (paused) continue
      try {
        val durMs = u.samples.size * 1000L / MODEL_SAMPLE_RATE
        val r = asr.transcribe(u.samples)
        val text = TextNormalizer.cleanAsr(r.text) ?: continue
        if (TextNormalizer.isLikelyHallucination(text, durMs)) continue
        val src = if (cfg.sourceLang == "auto") (r.language ?: "en") else cfg.sourceLang
        val translated = TextNormalizer.punctuateForTarget(EngineHub.translation.translate(text, src, cfg.translateTarget), cfg.translateTarget)
        val latency = (SystemClock.elapsedRealtime() - u.endedAt).toDouble()
        latencyEma = if (latencyEma == 0.0) latency else latencyEma * 0.8 + latency * 0.2
        DubixEvents.emit(DubixEvents.LIVE_SEGMENT, mapOf(
          "id" to "live_${u.mediaMs}", "atMs" to (SystemClock.elapsedRealtime() - startedAt).toDouble(),
          "sourceText" to text, "sourceLang" to src, "translatedText" to translated,
          "latencyMs" to latency, "avgLatencyMs" to latencyEma, "droppedAudio" to droppedAudio.get()
        ))
        if (cfg.captions) listener.onCaption(text, translated)
        // Skip speaking stale lines when we are behind; captions still show them.
        val voice = voiceFor(u.samples)
        if (cfg.speak && voice != null && queue.size < 2) speak(translated, voice)
        else if (cfg.speak) droppedAudio.incrementAndGet()
      } catch (e: TranslationEngine.PackMissingException) {
        listener.onState("error", e.message); break
      } catch (e: Throwable) {
        DubixEvents.warning("live_segment_failed", e.message ?: "segment failed")
      }
    }
  }

  /** Pitch-matched voice for this utterance (lower → male pool, higher → female pool); manual default otherwise. */
  private fun voiceFor(samples: FloatArray): VoiceSpec? {
    if (cfg.voicePools.isEmpty()) return cfg.voice
    val key = when (PitchEstimator.register(PitchEstimator.medianF0(samples, MODEL_SAMPLE_RATE))) {
      PitchEstimator.Register.LOW -> "male"
      PitchEstimator.Register.HIGH -> "female"
      PitchEstimator.Register.NEUTRAL -> null
    }
    return key?.let { cfg.voicePools[it]?.firstOrNull() } ?: cfg.voice
  }

  private fun speak(text: String, voice: VoiceSpec) {
    val audio = EngineHub.tts().synthesize(text, voice)
    if (audio.isEmpty() || !running || paused) return
    SubtitleOcrSession.applyGain(audio, cfg.voiceGainDb)
    speakingUntil = SystemClock.elapsedRealtime() + audio.size * 1000L / TtsEngine.OUTPUT_RATE
    out.play()
    var i = 0
    val chunk = TtsEngine.OUTPUT_RATE / 50
    while (i < audio.size && running && !paused && cfg.speak) {
      val w = out.write(audio, i, minOf(chunk, audio.size - i), AudioTrack.WRITE_BLOCKING)
      if (w <= 0) break
      i += w
    }
    speakingUntil = SystemClock.elapsedRealtime() + 150
  }

  companion object {
    const val SILENCE_REPORT_MS = 6_000L
    const val MAX_BACKLOG = 4

    @SuppressLint("MissingPermission") // RECORD_AUDIO is checked by the caller before starting.
    fun micRecord(): AudioRecord {
      val min = AudioRecord.getMinBufferSize(MODEL_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      return AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, MODEL_SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT, maxOf(min, MODEL_SAMPLE_RATE))
    }
  }
}
