package ai.dubix.engine.ml

/**
 * Replaceable engine contracts. The pipeline depends only on these interfaces, so a different
 * ASR (e.g. whisper.cpp), translator or TTS backend can be plugged in by adding an adapter.
 */
interface SpeechRecognizerEngine {
  data class Result(val text: String, val language: String?)

  /** Recognizes one complete utterance of 16 kHz mono float PCM. */
  fun transcribe(samples: FloatArray): Result
  fun release()
}

interface TextTranslator {
  fun translate(text: String, source: String, target: String): String
  fun release()
}

interface SpeechSynthesizer {
  /** Returns mono float PCM at [TtsEngine.OUTPUT_RATE]. */
  fun synthesize(text: String, voice: VoiceSpec): FloatArray
  fun release()
}

interface SpeechSegmenter {
  /** Feeds PCM; returns finished utterances as (startSample, samples). */
  fun accept(samples: FloatArray): List<Pair<Long, FloatArray>>
  fun flush(): List<Pair<Long, FloatArray>>
  fun isSpeech(): Boolean
  fun reset()
  fun release()
}

/**
 * Streaming recognition facade (initialize → start → feed → partial/final → stop → release)
 * composed from a segmenter and an utterance recognizer. Whisper is not a streaming model, so the
 * partial result is the "speech in progress" state rather than partial words. It never fakes text.
 */
class StreamingRecognition(
  private val segmenter: SpeechSegmenter,
  private val recognizer: SpeechRecognizerEngine,
  private val sampleRate: Int = MODEL_SAMPLE_RATE
) {
  data class Final(val startMs: Long, val endMs: Long, val text: String, val language: String?)

  private var started = false
  private var fed = 0L
  private val finals = ArrayDeque<Final>()

  fun startRecognition() { segmenter.reset(); fed = 0; finals.clear(); started = true }

  fun feedAudio(samples: FloatArray) {
    check(started) { "startRecognition() first" }
    fed += samples.size
    segmenter.accept(samples).forEach { decode(it) }
  }

  /** True while the VAD hears ongoing speech that has not been finalized yet. */
  fun getPartialResult(): Boolean = started && segmenter.isSpeech()

  fun getFinalResult(): Final? = finals.removeFirstOrNull()

  fun stopRecognition(): List<Final> {
    segmenter.flush().forEach { decode(it) }
    started = false
    return finals.toList().also { finals.clear() }
  }

  fun releaseModel() { segmenter.release(); recognizer.release() }

  private fun decode(seg: Pair<Long, FloatArray>) {
    val r = recognizer.transcribe(seg.second)
    if (r.text.isBlank()) return
    val start = seg.first * 1000 / sampleRate
    finals.addLast(Final(start, start + seg.second.size * 1000L / sampleRate, r.text, r.language))
  }
}
