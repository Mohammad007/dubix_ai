package ai.dubix.engine.pipeline

import ai.dubix.engine.audio.PitchEstimator
import ai.dubix.engine.ml.VoiceSpec

/**
 * Small, explainable voice-gender estimator for subtitle dubbing.
 *
 * 1. Voice pitch (median F0 of the dialogue heard while the line is shown) is the main signal.
 * 2. When no usable audio is available, explicit cues written in the subtitle are used, e.g.
 *    "[WOMAN]", "(man on radio)", "MOTHER:". Names are never used to guess gender.
 * 3. Otherwise the previous speaker's voice is kept for a few seconds (dialogue usually continues),
 *    then the default voice is used.
 *
 * The result only picks which installed voice speaks; it is an estimate, shown as such.
 */
object GenderHint {
  private val FEMALE = setOf(
    "woman", "women", "girl", "girls", "female", "lady", "ladies", "mother", "mom", "mum", "mommy", "grandma", "grandmother",
    "sister", "daughter", "wife", "queen", "princess", "aunt", "madam", "ma'am", "actress", "waitress", "nurse", "she", "her"
  )
  private val MALE = setOf(
    "man", "men", "boy", "boys", "male", "gentleman", "father", "dad", "daddy", "grandpa", "grandfather", "brother", "son",
    "husband", "king", "prince", "uncle", "sir", "actor", "waiter", "he", "him", "his"
  )
  // Bracketed descriptions ([WOMAN], (man laughing)) and leading speaker labels (MOTHER:, Old man:).
  private val bracket = Regex("[\\[(]([^\\])]{1,40})[\\])]")
  private val label = Regex("(?m)^\\s*-?\\s*([A-Za-z' ]{2,30}):")

  /** "male" | "female" | null from explicit cues in the raw (uncleaned) subtitle text. */
  fun fromText(raw: String): String? {
    val cues = bracket.findAll(raw).map { it.groupValues[1] } + label.findAll(raw).map { it.groupValues[1] }
    var f = 0; var m = 0
    for (c in cues) for (w in c.lowercase().split(Regex("[^a-z']+"))) {
      if (w in FEMALE) f++ else if (w in MALE) m++
    }
    return when {
      f > m -> "female"
      m > f -> "male"
      else -> null
    }
  }

  /** Scale quiet audio (app volume turned down) so the pitch tracker's voicing gate still works. */
  fun normalize(x: FloatArray): FloatArray {
    var peak = 0f
    for (v in x) peak = maxOf(peak, kotlin.math.abs(v))
    if (peak < 1e-4f || peak >= 0.5f) return x
    val g = 0.5f / peak
    return FloatArray(x.size) { x[it] * g }
  }

  fun genderOf(f0: Float?): String? = when (PitchEstimator.register(f0)) {
    PitchEstimator.Register.LOW -> "male"
    PitchEstimator.Register.HIGH -> "female"
    PitchEstimator.Register.NEUTRAL -> null
  }

  /**
   * Voice for a gender; with two voices of that gender installed, deeper and higher voices within
   * the gender get different ones, so two people of the same gender sound different.
   */
  fun voiceFor(gender: String, f0: Float?, pools: Map<String, List<VoiceSpec>>): VoiceSpec? {
    val pool = pools[gender].orEmpty()
    if (pool.isEmpty()) {
      // No voice of that gender installed: shift one of the other gender (approximation).
      val other = pools[if (gender == "male") "female" else "male"].orEmpty().firstOrNull() ?: pools["neutral"].orEmpty().firstOrNull()
      return other?.copy(pitchSemitones = if (gender == "male") -4f else 4f)
    }
    val split = if (gender == "male") 125f else 215f
    val idx = if (f0 != null && f0 > split && pool.size > 1) 1 else 0
    return pool[idx]
  }
}
