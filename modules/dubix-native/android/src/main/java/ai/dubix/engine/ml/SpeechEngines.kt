package ai.dubix.engine.ml

import ai.dubix.engine.core.Perf
import ai.dubix.engine.models.ModelStore
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineWhisperModelConfig
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractor
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import com.k2fsa.sherpa.onnx.SpeechSegment
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig

const val MODEL_SAMPLE_RATE = 16_000

/** Silero VAD (sherpa-onnx). Not thread-safe: one instance per pipeline. */
class VadEngine(store: ModelStore, modelId: String, numThreads: Int, maxSpeechSec: Float = 12f, minSilenceSec: Float = 0.35f) : SpeechSegmenter {
  private val vad = Vad(
    null,
    VadModelConfig(
      sileroVadModelConfig = SileroVadModelConfig(
        model = store.singleOnnx(modelId),
        threshold = 0.5f,
        minSilenceDuration = minSilenceSec,
        minSpeechDuration = 0.25f,
        windowSize = WINDOW,
        maxSpeechDuration = maxSpeechSec
      ),
      sampleRate = MODEL_SAMPLE_RATE,
      numThreads = numThreads,
      provider = "cpu"
    )
  )
  private val pending = FloatArray(WINDOW)
  private var pendingLen = 0

  /** Feeds 16 kHz mono audio; returns completed speech segments as (startSample, samples). */
  override fun accept(samples: FloatArray): List<Pair<Long, FloatArray>> {
    var i = 0
    val out = ArrayList<SpeechSegment>()
    while (i < samples.size) {
      val n = minOf(WINDOW - pendingLen, samples.size - i)
      System.arraycopy(samples, i, pending, pendingLen, n)
      pendingLen += n; i += n
      if (pendingLen == WINDOW) {
        Perf.trace("vad") { vad.acceptWaveform(pending.copyOf()) }
        pendingLen = 0
        drain(out)
      }
    }
    return out.map { it.start.toLong() to it.samples }
  }

  override fun isSpeech(): Boolean = vad.isSpeechDetected()

  override fun flush(): List<Pair<Long, FloatArray>> {
    vad.flush()
    return ArrayList<SpeechSegment>().also { drain(it) }.map { it.start.toLong() to it.samples }
  }

  override fun reset() { vad.reset(); pendingLen = 0 }

  private fun drain(out: MutableList<SpeechSegment>) {
    while (!vad.empty()) { out.add(vad.front()); vad.pop() }
  }

  override fun release() = vad.release()

  companion object { const val WINDOW = 512 }
}

/** Whisper ASR (sherpa-onnx). [language] empty = auto-detect (multilingual models only). */
class AsrEngine(store: ModelStore, val modelId: String, val language: String, numThreads: Int) : SpeechRecognizerEngine {

  private val recognizer: OfflineRecognizer = run {
    val w = store.whisper(modelId)
    OfflineRecognizer(
      null,
      OfflineRecognizerConfig(
        modelConfig = OfflineModelConfig(
          whisper = OfflineWhisperModelConfig(
            encoder = w.encoder, decoder = w.decoder, language = language, task = "transcribe", tailPaddings = -1
          ),
          tokens = w.tokens,
          numThreads = numThreads,
          provider = "cpu",
          modelType = "whisper"
        ),
        decodingMethod = "greedy_search"
      )
    )
  }

  @Synchronized
  override fun transcribe(samples: FloatArray): SpeechRecognizerEngine.Result = Perf.trace("asr") {
    val stream = recognizer.createStream()
    try {
      stream.acceptWaveform(samples, MODEL_SAMPLE_RATE)
      recognizer.decode(stream)
      val r = recognizer.getResult(stream)
      val lang = r.lang.replace(Regex("[^a-zA-Z-]"), "").lowercase().ifEmpty { null }
      SpeechRecognizerEngine.Result(r.text.trim(), lang)
    } finally {
      stream.release()
    }
  }

  override fun release() = recognizer.release()
}

/** Speaker embedding extractor (3D-Speaker / WeSpeaker ONNX via sherpa-onnx). */
class SpeakerEmbedder(store: ModelStore, modelId: String, numThreads: Int) {
  private val extractor = SpeakerEmbeddingExtractor(
    null,
    SpeakerEmbeddingExtractorConfig(model = store.singleOnnx(modelId), numThreads = numThreads, debug = false, provider = "cpu")
  )

  /** Returns null when the segment is too short for a reliable embedding. */
  @Synchronized
  fun embed(samples: FloatArray): FloatArray? = Perf.trace("speaker") {
    if (samples.size < MODEL_SAMPLE_RATE / 2) return@trace null
    val stream = extractor.createStream()
    try {
      stream.acceptWaveform(samples, MODEL_SAMPLE_RATE)
      stream.inputFinished()
      if (!extractor.isReady(stream)) null else extractor.compute(stream)
    } finally {
      stream.release()
    }
  }

  fun release() = extractor.release()
}
