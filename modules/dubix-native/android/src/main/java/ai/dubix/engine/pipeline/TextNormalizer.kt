package ai.dubix.engine.pipeline

/**
 * Text clean-up around the ASR -> MT -> TTS chain: removes non-speech annotations, rejects
 * likely ASR hallucinations, and applies script-appropriate punctuation for the target language.
 */
object TextNormalizer {
  private val annotation = Regex("""\[[^\]]*]|\([^)]*\)|[♪♫]+|<\|[^|]*\|>""")
  private val spaces = Regex("""\s+""")
  private val onlyPunct = Regex("""^[\p{P}\p{S}\s]*$""")

  /** Returns cleaned ASR text, or null when nothing speakable remains. */
  fun cleanAsr(raw: String): String? {
    val t = raw.replace(annotation, " ").replace(spaces, " ").trim()
    if (t.isEmpty() || onlyPunct.matches(t)) return null
    return t
  }

  /**
   * Heuristic hallucination guard for Whisper-style decoders: rejects runaway repetition and
   * physically implausible speaking rates for the segment duration.
   */
  fun isLikelyHallucination(text: String, durationMs: Long): Boolean {
    val words = text.lowercase().split(' ').filter { it.isNotBlank() }
    if (words.size >= 6) {
      val distinct = words.toSet().size
      if (distinct.toFloat() / words.size < 0.3f) return true
    }
    // > 30 characters per second of audio is not natural speech in any supported language.
    if (durationMs > 0 && text.length * 1000f / durationMs > 30f) return true
    return false
  }

  /** Language-aware punctuation for display and TTS prosody. */
  fun punctuateForTarget(text: String, lang: String): String {
    var t = text.replace(spaces, " ").trim()
    if (t.isEmpty()) return t
    when (lang) {
      "hi", "mr", "ne" -> {
        t = t.replace(Regex("""\s*\.(\s|$)"""), "।$1").replace(Regex("""\s+([।?!,])"""), "$1")
        if (!t.last().isTerminal()) t += "।"
      }
      "ur", "ar", "fa" -> {
        t = t.replace('?', '؟').replace(',', '،').replace(';', '؛').replace(Regex("""\s+([؟،؛.!])"""), "$1")
        if (!t.last().isTerminal()) t += "."
      }
      "zh", "ja" -> {
        if (!t.last().isTerminal()) t += "。"
      }
      else -> {
        t = t.replace(Regex("""\s+([.?!,;:])"""), "$1")
        if (!t.last().isTerminal()) t += "."
      }
    }
    return t
  }

  private fun Char.isTerminal() = this in ".?!।॥؟。！？…"
}
