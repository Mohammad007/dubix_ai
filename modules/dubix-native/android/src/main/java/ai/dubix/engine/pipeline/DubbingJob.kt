package ai.dubix.engine.pipeline

import ai.dubix.engine.audio.AudioDecoder
import ai.dubix.engine.audio.PitchEstimator
import ai.dubix.engine.audio.SilenceTrimmer
import ai.dubix.engine.audio.TimeStretcher
import ai.dubix.engine.core.DeviceInfo
import ai.dubix.engine.core.DubixEvents
import ai.dubix.engine.core.Perf
import ai.dubix.engine.core.Wav
import ai.dubix.engine.ml.EngineHub
import ai.dubix.engine.ml.MODEL_SAMPLE_RATE
import ai.dubix.engine.ml.SpeakerClusterer
import ai.dubix.engine.ml.TranslationEngine
import ai.dubix.engine.ml.TtsEngine
import ai.dubix.engine.ml.VadEngine
import ai.dubix.engine.ml.VoiceSpec
import android.net.Uri
import android.os.PowerManager
import android.os.SystemClock
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/**
 * Offline dubbing of a local video's audio track:
 * decode (streamed) -> VAD -> ASR -> speaker clustering + pitch register -> MT -> TTS
 * -> silence trim -> WSOLA fit to the dialogue window -> per-segment WAV.
 * Segments are emitted as soon as they are ready so playback can start progressively.
 */
class DubbingJob(private val p: Params) : Runnable {
  data class Params(
    val jobId: String,
    val sessionId: String,
    val uri: String,
    val startMs: Long,
    val durationMs: Long,
    val sourceLang: String,       // "auto" or ISO code
    val translateTarget: String,  // ML Kit target (Hinglish => "hi"; the Roman layer is applied in JS)
    val vadModelId: String,
    val asrModelId: String,
    val speakerModelId: String?,
    val maxSpeakers: Int,
    val voices: Map<String, VoiceSpec>, // keys: "default", "speaker:<n>" (manual mappings)
    val voicePools: Map<String, List<VoiceSpec>> = emptyMap(), // "male" | "female" | "neutral"
    val userSpeed: Float,
    val maxSpeed: Float,
    val maxPauseSec: Float,
    val outDir: String,
    val speakerCentroids: List<FloatArray>,
    /** Live dubbing: stay at most this far ahead of the playhead (0 = prepare the whole file). */
    val maxLeadMs: Long = 0,
    /** Extra time a dubbed line may spill into the following silence before stretching. */
    val spillMs: Long = 300,
    val audioTrack: Int = 0,
    /**
     * Subtitle mode: dub these timed lines instead of running speech recognition. Exact timing,
     * much faster; the audio under each cue is still used for speaker and voice matching.
     */
    val cues: List<Cue> = emptyList()
  )

  @Volatile private var cancelled = false
  @Volatile private var paused = false
  private val pauseLock = Object()
  private val clusterer = SpeakerClusterer(maxSpeakers = p.maxSpeakers).apply { if (p.speakerCentroids.isNotEmpty()) seed(p.speakerCentroids) }
  private val voiceAssigner = SpeakerVoiceAssigner(
    pools = p.voicePools,
    overrides = p.voices.filterKeys { it.startsWith("speaker:") }.mapKeys { it.key.removePrefix("speaker:").toInt() },
    fallback = p.voices["default"]
  )
  private var segments = 0
  private var processedMs = p.startMs
  /** Absolute sample index (16 kHz) of the first sample fed to the VAD. */
  private var vadOriginSample = -1L

  @Volatile var playheadMs: Long = p.startMs

  fun cancel() { cancelled = true; resume() }
  fun pause() { paused = true; state("paused") }
  fun resume() { synchronized(pauseLock) { paused = false; pauseLock.notifyAll() } }

  override fun run() {
    val ctx = EngineHub.context()
    val wake = ctx.getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "dubix:dubbing").apply { setReferenceCounted(false); acquire(6 * 60 * 60 * 1000L) }
    val started = SystemClock.elapsedRealtime()
    var vad: VadEngine? = null
    try {
      state("loading")
      if (p.cues.isNotEmpty()) { runSubtitles(ctx, started); return }
      val src = if (p.sourceLang == "auto") "" else p.sourceLang
      val asr = EngineHub.asr(p.asrModelId, src)
      val embedder = p.speakerModelId?.let { id -> runCatching { EngineHub.embedder(id) }.getOrNull() }
      if (p.speakerModelId != null && embedder == null) {
        DubixEvents.warning("speaker_model_unavailable", "Speaker detection model could not be loaded; all dialogue uses a single voice. You can still assign voices manually.")
      }
      val tts = EngineHub.tts()
      vad = VadEngine(EngineHub.store, p.vadModelId, 1)
      File(p.outDir).mkdirs()
      state("running")

      var lastProgress = 0L
      AudioDecoder(ctx, Uri.parse(p.uri), audioTrackOrdinal = p.audioTrack).decode(p.startMs, { cancelled }) { chunk, absStart ->
        waitIfPaused()
        waitForPlayhead()
        if (cancelled) return@decode false
        DeviceInfo.shouldThrottle(ctx)?.let { reason ->
          DubixEvents.warning("throttled_$reason", if (reason == "thermal") "Device is hot; dubbing slowed down to cool off." else "Battery critically low; dubbing paused until charging.")
          Thread.sleep(if (reason == "thermal") 2_000 else 10_000)
        }
        val chunkStartMs = absStart * 1000 / MODEL_SAMPLE_RATE
        if (vadOriginSample < 0) vadOriginSample = absStart
        for ((start, samples) in vad.accept(chunk)) handleSegment(start, samples, asr, embedder, tts)
        processedMs = chunkStartMs + chunk.size * 1000L / MODEL_SAMPLE_RATE
        val now = SystemClock.elapsedRealtime()
        if (now - lastProgress > 1_000) { progress(started); lastProgress = now }
        !cancelled
      }
      if (!cancelled) for ((start, samples) in vad.flush()) handleSegment(start, samples, asr, embedder, tts)
      progress(started)
      state(if (cancelled) "cancelled" else "completed")
    } catch (e: AudioDecoder.NoAudioTrackException) {
      state("error", "no_audio", e.message)
    } catch (e: java.io.IOException) {
      state("error", "file_unreadable", "The video could not be read (moved, deleted or access revoked): ${e.message}")
    } catch (e: android.media.MediaCodec.CodecException) {
      state("error", "decode_failed", "This device cannot decode the movie's audio format: ${e.diagnosticInfo}")
    } catch (e: OutOfMemoryError) {
      EngineHub.releaseAll()
      state("error", "out_of_memory", "Not enough memory. Choose a smaller speech model or close other apps, then continue.")
    } catch (e: TranslationEngine.PackMissingException) {
      state("error", "translation_pack_missing", e.message)
    } catch (e: Throwable) {
      state("error", "pipeline_error", e.message ?: e.javaClass.simpleName)
    } finally {
      vad?.release()
      if (wake.isHeld) wake.release()
      Jobs.remove(p.jobId)
    }
  }

  /**
   * The VAD reports segment starts in samples since it was created; they are anchored to the
   * first decoded sample (which can be slightly after [Params.startMs] if the track starts late).
   */
  private fun handleSegment(
    vadStart: Long, samples: FloatArray,
    asr: ai.dubix.engine.ml.AsrEngine, embedder: ai.dubix.engine.ml.SpeakerEmbedder?, tts: TtsEngine
  ) {
    if (cancelled) return
    val startMs = (vadOriginSample.coerceAtLeast(0) + vadStart) * 1000 / MODEL_SAMPLE_RATE
    val durMs = samples.size * 1000L / MODEL_SAMPLE_RATE
    if (durMs < 300) return
    val endMs = startMs + durMs

    val result = asr.transcribe(samples)
    val text = TextNormalizer.cleanAsr(result.text) ?: return
    if (TextNormalizer.isLikelyHallucination(text, durMs)) return
    val srcLang = if (p.sourceLang == "auto") (result.language ?: "en") else p.sourceLang
    emitLine(startMs, endMs, text, srcLang, samples, embedder, tts)
  }

  /** Speaker + voice matching, translation, fitted synthesis and the segment event for one line. */
  private fun emitLine(
    startMs: Long, endMs: Long, text: String, srcLang: String, samples: FloatArray,
    embedder: ai.dubix.engine.ml.SpeakerEmbedder?, tts: TtsEngine
  ) {
    if (cancelled) return
    val durMs = endMs - startMs
    // Short lines give noisy embeddings: they may join a speaker but never create a new one.
    val speaker = (if (samples.isNotEmpty()) embedder?.embed(samples) else null)
      ?.let { clusterer.assign(it, allowNew = durMs >= 1500 || clusterer.speakerCount == 0) } ?: 0
    val f0 = if (samples.isNotEmpty()) PitchEstimator.medianF0(samples, MODEL_SAMPLE_RATE) else null
    val choice = voiceAssigner.voiceFor(speaker, f0)
    val register = choice.register

    val translated = TextNormalizer.punctuateForTarget(
      EngineHub.translation.translate(text, srcLang, p.translateTarget), p.translateTarget
    )

    val voice = choice.voice ?: p.voices["default"]
    var audioPath: String? = null
    var audioMs = 0L
    var speed = 1f
    var overflowMs = 0L
    var ttsError: String? = null
    if (voice != null) {
      try {
        val out = File(p.outDir, "seg_${startMs}.wav")
        val r = synthesizeFitted(tts, translated, voice, durMs, p.userSpeed, p.maxSpeed, p.maxPauseSec, out, p.spillMs)
        audioPath = out.absolutePath; audioMs = r.durationMs; speed = r.speed; overflowMs = r.overflowMs
      } catch (e: Throwable) {
        ttsError = e.message ?: "synthesis failed"
      }
    } else ttsError = "no voice available for ${p.translateTarget}"

    segments++
    DubixEvents.emit(DubixEvents.JOB_SEGMENT, mapOf(
      "jobId" to p.jobId, "sessionId" to p.sessionId, "id" to "seg_$startMs",
      "startMs" to startMs.toDouble(), "endMs" to endMs.toDouble(),
      "speaker" to speaker, "register" to register.key, "f0" to f0?.toDouble(),
      "sourceText" to text, "sourceLang" to srcLang, "translatedText" to translated,
      "audioPath" to audioPath, "audioDurationMs" to audioMs.toDouble(), "speed" to speed.toDouble(),
      "voiceEngine" to voice?.engine, "voiceId" to (voice?.modelId ?: voice?.systemVoice),
      "overflowMs" to overflowMs.toDouble(), "error" to ttsError
    ))
  }

  /**
   * Subtitle-driven dubbing: no VAD / ASR. Audio is still decoded (cheap) into a rolling buffer so
   * each cue's audio can be analysed for speaker identity and voice pitch.
   */
  private fun runSubtitles(ctx: android.content.Context, started: Long) {
    val embedder = p.speakerModelId?.let { id -> runCatching { EngineHub.embedder(id) }.getOrNull() }
    val tts = EngineHub.tts()
    File(p.outDir).mkdirs()
    val cues = p.cues.filter { it.endMs > p.startMs }.sortedBy { it.startMs }
    val srcLang = if (p.sourceLang != "auto") p.sourceLang
      else ai.dubix.engine.ml.LanguageDetector.detect(cues.take(40).joinToString(" ") { it.text }) ?: "en"
    state("running")

    val ring = AudioRing(MODEL_SAMPLE_RATE * 40)
    var next = 0
    var lastProgress = 0L
    fun drain(upToMs: Long) {
      while (next < cues.size && cues[next].endMs <= upToMs && !cancelled) {
        val c = cues[next++]
        val clipEnd = minOf(c.endMs, c.startMs + 12_000)
        val samples = ring.slice(c.startMs * MODEL_SAMPLE_RATE / 1000, clipEnd * MODEL_SAMPLE_RATE / 1000)
        emitLine(c.startMs, c.endMs, c.text, srcLang, samples, embedder, tts)
      }
    }
    try {
      AudioDecoder(ctx, Uri.parse(p.uri), audioTrackOrdinal = p.audioTrack).decode(p.startMs, { cancelled }) { chunk, absStart ->
        waitIfPaused()
        waitForPlayhead()
        if (cancelled) return@decode false
        ring.append(absStart, chunk)
        processedMs = (absStart + chunk.size) * 1000 / MODEL_SAMPLE_RATE
        drain(processedMs)
        val now = SystemClock.elapsedRealtime()
        if (now - lastProgress > 1_000) { progress(started); lastProgress = now }
        next < cues.size
      }
    } catch (e: AudioDecoder.NoAudioTrackException) {
      // Subtitles still work without analysable audio: single default voice.
    }
    if (!cancelled) {
      processedMs = maxOf(processedMs, cues.lastOrNull()?.endMs ?: processedMs)
      drain(Long.MAX_VALUE)
    }
    progress(started)
    state(if (cancelled) "cancelled" else "completed")
  }

  /** Bounded buffering for live dubbing: do not run further ahead of playback than needed. */
  private fun waitForPlayhead() {
    if (p.maxLeadMs <= 0) return
    var announced = false
    while (!cancelled && processedMs - playheadMs > p.maxLeadMs) {
      if (!announced) { state("waiting"); announced = true }
      Thread.sleep(250)
      waitIfPaused()
    }
    if (announced && !cancelled) state("running")
  }

  private fun waitIfPaused() {
    synchronized(pauseLock) { while (paused && !cancelled) pauseLock.wait(500) }
  }

  private fun progress(started: Long) {
    val wall = (SystemClock.elapsedRealtime() - started).coerceAtLeast(1)
    val media = (processedMs - p.startMs).coerceAtLeast(0)
    DubixEvents.emit(DubixEvents.JOB_PROGRESS, mapOf(
      "jobId" to p.jobId, "sessionId" to p.sessionId,
      "processedMs" to processedMs.toDouble(), "durationMs" to p.durationMs.toDouble(),
      "segments" to segments, "speakers" to clusterer.speakerCount,
      // < 1.0 means faster than real time
      "realtimeFactor" to if (media == 0L) 0.0 else wall.toDouble() / media,
      "perf" to Perf.snapshot()
    ))
  }

  private fun state(state: String, code: String? = null, message: String? = null) {
    DubixEvents.emit(DubixEvents.JOB_STATE, mapOf(
      "jobId" to p.jobId, "sessionId" to p.sessionId, "state" to state, "code" to code, "message" to message,
      "processedMs" to processedMs.toDouble(),
      "speakerCentroids" to if (state in setOf("paused", "completed", "cancelled", "error")) clusterer.centroids().map { c -> c.map { it.toDouble() } } else null
    ))
  }

  companion object {
    data class Fitted(val durationMs: Long, val speed: Float, val overflowMs: Long)

    /**
     * Synthesizes [text] with [voice], trims silence and time-stretches it to fit [windowMs] plus
     * [spillMs]. [Fitted.overflowMs] > 0 means the line still runs past its slot at the stretch limit.
     */
    fun synthesizeFitted(
      tts: TtsEngine, text: String, voice: VoiceSpec, windowMs: Long,
      userSpeed: Float, maxSpeed: Float, maxPauseSec: Float, out: File, spillMs: Long = 300
    ): Fitted {
      val rate = TtsEngine.OUTPUT_RATE
      var audio = tts.synthesize(text, voice)
      audio = SilenceTrimmer.trim(audio, rate, maxPauseSec)
      if (audio.isEmpty()) error("synthesizer produced silence")
      val synthMs = audio.size * 1000L / rate
      val speed = if (windowMs > 0) SegmentFit.fitSpeed(synthMs, windowMs, userSpeed, maxSpeed, spillMs) else userSpeed
      if (kotlin.math.abs(speed - 1f) >= 0.01f) audio = Perf.trace("stretch") { TimeStretcher.stretch(audio, rate, speed) }
      // short fades avoid clicks at segment boundaries
      val fade = minOf(audio.size / 4, rate / 200)
      for (i in 0 until fade) { val g = i.toFloat() / fade; audio[i] *= g; audio[audio.size - 1 - i] *= g }
      Wav.writeMono16(out, audio, rate)
      val finalMs = audio.size * 1000L / rate
      return Fitted(finalMs, speed, if (windowMs > 0) (finalMs - windowMs - spillMs).coerceAtLeast(0) else 0)
    }
  }

  /** Registry of running jobs (one active job per session). */
  object Jobs {
    private val jobs = ConcurrentHashMap<String, DubbingJob>()
    fun start(params: Params) {
      jobs.values.filter { it.p.sessionId == params.sessionId }.forEach { it.cancel() }
      val job = DubbingJob(params)
      jobs[params.jobId] = job
      Thread(job, "dubix-job-${params.jobId}").apply { priority = Thread.NORM_PRIORITY - 1 }.start()
    }
    fun get(id: String) = jobs[id]
    fun remove(id: String) = jobs.remove(id)
    fun cancelAll() = jobs.values.forEach { it.cancel() }
    fun isIdle() = jobs.isEmpty()
  }
}
