package ai.dubix.engine.ml

import ai.dubix.engine.audio.StreamingResampler
import ai.dubix.engine.audio.TimeStretcher
import ai.dubix.engine.core.DubixEvents
import ai.dubix.engine.core.Perf
import ai.dubix.engine.core.Wav
import ai.dubix.engine.models.ModelStore
import android.content.Context
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import com.k2fsa.sherpa.onnx.OfflineTts
import com.k2fsa.sherpa.onnx.OfflineTtsConfig
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig
import java.io.File
import java.util.Locale
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.pow

/** Voice selection for one speaker. */
data class VoiceSpec(
  val engine: String,          // "sherpa" | "system"
  val modelId: String?,        // sherpa voice pack id
  val speakerId: Int,          // sherpa multi-speaker sid
  val systemVoice: String?,    // android.speech.tts.Voice name
  val language: String,
  val pitchSemitones: Float,   // -6..+6
  val speed: Float             // 0.5..2.0 base speaking rate
) {
  companion object {
    fun from(map: Map<String, Any?>): VoiceSpec = VoiceSpec(
      engine = map["engine"] as? String ?: "system",
      modelId = map["modelId"] as? String,
      speakerId = (map["speakerId"] as? Number)?.toInt() ?: 0,
      systemVoice = map["systemVoice"] as? String,
      language = map["language"] as? String ?: "en",
      pitchSemitones = (map["pitch"] as? Number)?.toFloat() ?: 0f,
      speed = (map["speed"] as? Number)?.toFloat() ?: 1f
    )
  }
}

/**
 * Offline speech synthesis. Primary engine: sherpa-onnx VITS/Piper voice packs. Fallback:
 * Android's TextToSpeech restricted to voices installed on the device (no network voices).
 * All output is normalised to [OUTPUT_RATE] mono float.
 */
class TtsEngine(private val context: Context, private val store: ModelStore, private val numThreads: Int) : SpeechSynthesizer {
  private val sherpa = LinkedHashMap<String, OfflineTts>(4, 0.75f, true)
  private var system: TextToSpeech? = null
  private val lock = Any()

  /** Voice packs that produced no audio (e.g. the runtime lacks a phonemizer); skipped afterwards. */
  private val unusableSherpa = java.util.Collections.synchronizedSet(HashSet<String>())

  override fun synthesize(text: String, voice: VoiceSpec): FloatArray = Perf.trace("tts") {
    if (voice.engine == "sherpa" && voice.modelId !in unusableSherpa) {
      val raw = try { synthSherpa(text, voice) } catch (e: Exception) { FloatArray(0) }
      if (hasSignal(raw)) {
        return@trace if (voice.pitchSemitones != 0f) shiftPitch(raw, OUTPUT_RATE, voice.pitchSemitones) else raw
      }
      voice.modelId?.let { unusableSherpa.add(it) }
      DubixEvents.warning(
        "voice_pack_fallback",
        "The downloaded neural voice could not speak on this engine build, so an installed offline Android voice is used instead."
      )
    }
    // Android system voice (offline only). Pitch is applied by the engine itself.
    val out = synthSystem(text, voice)
    if (!hasSignal(out)) error("The voice produced no audio for this text")
    out
  }

  private fun hasSignal(x: FloatArray): Boolean {
    if (x.size < OUTPUT_RATE / 20) return false
    var peak = 0f
    for (v in x) { val a = kotlin.math.abs(v); if (a > peak) peak = a }
    return peak > 0.005f
  }

  private fun synthSherpa(text: String, voice: VoiceSpec): FloatArray {
    val id = voice.modelId ?: error("Voice has no model id")
    val tts = synchronized(lock) {
      sherpa[id] ?: run {
        val f = store.vits(id)
        val t = OfflineTts(
          null,
          OfflineTtsConfig(
            model = OfflineTtsModelConfig(
              vits = OfflineTtsVitsModelConfig(model = f.model, lexicon = f.lexicon, tokens = f.tokens, dataDir = f.dataDir),
              numThreads = numThreads, debug = false, provider = "cpu"
            ),
            maxNumSentences = 1
          )
        )
        sherpa[id] = t
        // keep at most two voice models resident
        while (sherpa.size > 2) {
          val eldest = sherpa.entries.first()
          eldest.value.release(); sherpa.remove(eldest.key)
        }
        t
      }
    }
    val sid = voice.speakerId.coerceIn(0, maxOf(0, tts.numSpeakers() - 1))
    val audio = synchronized(tts) { tts.generate(text, sid, voice.speed.coerceIn(0.5f, 2f)) }
    return StreamingResampler.resample(audio.samples, audio.sampleRate, OUTPUT_RATE)
  }

  // ---------------- Android system TTS (on-device voices only) ----------------

  private fun ensureSystem(): TextToSpeech {
    system?.let { return it }
    val latch = CountDownLatch(1)
    var status = TextToSpeech.ERROR
    val tts = TextToSpeech(context.applicationContext) { s -> status = s; latch.countDown() }
    latch.await(10, TimeUnit.SECONDS)
    if (status != TextToSpeech.SUCCESS) { tts.shutdown(); error("Android text-to-speech engine is unavailable") }
    system = tts
    return tts
  }

  fun systemVoices(language: String?): List<Map<String, Any?>> = synchronized(lock) {
    val tts = ensureSystem()
    (tts.voices ?: emptySet()).filter { v ->
      !v.isNetworkConnectionRequired &&
        !v.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) &&
        (language == null || v.locale.language == Locale.forLanguageTag(language).language)
    }.sortedBy { it.name }.map { v ->
      mapOf(
        "name" to v.name, "language" to v.locale.toLanguageTag(), "quality" to v.quality,
        "latency" to v.latency, "offline" to true
      )
    }
  }

  private fun synthSystem(text: String, voice: VoiceSpec): FloatArray = synchronized(lock) {
    val tts = ensureSystem()
    val locale = Locale.forLanguageTag(voice.language)
    val chosen: Voice? = tts.voices?.firstOrNull { it.name == voice.systemVoice }
      ?: tts.voices?.filter {
        it.locale.language == locale.language && !it.isNetworkConnectionRequired &&
          !it.features.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)
      }?.maxByOrNull { it.quality }
    if (chosen == null) {
      error("No offline Android voice for '${locale.displayLanguage}' is installed. Install its voice data in Android Settings › Text-to-speech (Speech services by Google), or pick another voice.")
    }
    tts.voice = chosen
    tts.setPitch(2f.pow(voice.pitchSemitones / 12f))
    tts.setSpeechRate(voice.speed.coerceIn(0.5f, 2f))

    val out = File(context.cacheDir, "tts-${UUID.randomUUID()}.wav")
    val id = UUID.randomUUID().toString()
    val latch = CountDownLatch(1)
    var failed: String? = null
    tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String?) {}
      override fun onDone(utteranceId: String?) { if (utteranceId == id) latch.countDown() }
      @Deprecated("Deprecated in Java")
      override fun onError(utteranceId: String?) { failed = "synthesis error"; latch.countDown() }
      override fun onError(utteranceId: String?, errorCode: Int) { failed = "synthesis error $errorCode"; latch.countDown() }
    })
    val params = Bundle().apply { putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, id) }
    if (tts.synthesizeToFile(text, params, out, id) != TextToSpeech.SUCCESS) error("System TTS rejected the request")
    if (!latch.await(60, TimeUnit.SECONDS)) error("System TTS timed out")
    failed?.let { out.delete(); error(it) }
    try {
      val wav = Wav.read(out)
      StreamingResampler.resample(wav.samples, wav.sampleRate, OUTPUT_RATE)
    } finally {
      out.delete()
    }
  }

  /** Releases loaded voice models (e.g. on memory pressure). */
  fun trim() = synchronized(lock) {
    sherpa.values.forEach { it.release() }
    sherpa.clear()
  }

  override fun release() = synchronized(lock) {
    trim()
    system?.shutdown(); system = null
  }

  companion object {
    const val OUTPUT_RATE = 24_000

    /** Pitch shift without duration change: resample (pitch+tempo) then WSOLA back to length. */
    fun shiftPitch(x: FloatArray, rate: Int, semitones: Float): FloatArray {
      val factor = 2f.pow(semitones / 12f)
      val resampled = StreamingResampler.resample(x, (rate * factor).toInt(), rate)
      return TimeStretcher.stretch(resampled, rate, 1f / factor)
    }
  }
}
