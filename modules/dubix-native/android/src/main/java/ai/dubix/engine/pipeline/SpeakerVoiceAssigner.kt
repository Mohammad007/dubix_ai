package ai.dubix.engine.pipeline

import ai.dubix.engine.audio.PitchEstimator
import ai.dubix.engine.ml.VoiceSpec

/**
 * Chooses one consistent voice per detected speaker.
 *
 * - The voice gender is suggested from the speaker's median pitch over its first lines (not per
 *   line), then fixed for that speaker, so a person's voice never flips mid-movie.
 * - Speakers of the same suggested gender get different voices from that gender's pool (round
 *   robin); when speakers outnumber voices, the pitch is offset to keep them distinguishable.
 * - Manual mappings (`overrides`) always win. The suggestion is an estimate the user can change.
 */
class SpeakerVoiceAssigner(
  private val pools: Map<String, List<VoiceSpec>>, // "male" | "female" | "neutral"
  private val overrides: Map<Int, VoiceSpec>,
  private val fallback: VoiceSpec?,
  private val linesToDecide: Int = 2
) {
  private val f0s = HashMap<Int, MutableList<Float>>()
  private val decided = HashMap<Int, Pair<PitchEstimator.Register, VoiceSpec>>()
  private val used = HashMap<String, Int>()
  private val lines = HashMap<Int, Int>()

  data class Choice(val register: PitchEstimator.Register, val voice: VoiceSpec?)

  @Synchronized
  fun voiceFor(speaker: Int, f0: Float?): Choice {
    if (f0 != null) f0s.getOrPut(speaker) { ArrayList() }.add(f0)
    lines[speaker] = (lines[speaker] ?: 0) + 1
    val register = decided[speaker]?.first ?: PitchEstimator.register(median(f0s[speaker]))
    overrides[speaker]?.let { return Choice(register, it) }
    decided[speaker]?.let { return Choice(it.first, it.second) }

    val samples = f0s[speaker]?.size ?: 0
    // Decide once enough voiced lines were heard (or after several lines without usable pitch).
    if (samples >= linesToDecide || (lines[speaker] ?: 0) >= linesToDecide + 2) {
      val r = PitchEstimator.register(median(f0s[speaker]))
      val spec = pick(r)
      if (spec != null) decided[speaker] = r to spec
      return Choice(r, spec)
    }
    // Provisional (not stored): use the current estimate without consuming a pool slot.
    return Choice(register, provisional(register))
  }

  private fun genderKey(r: PitchEstimator.Register) = when (r) {
    PitchEstimator.Register.LOW -> "male"
    PitchEstimator.Register.HIGH -> "female"
    PitchEstimator.Register.NEUTRAL -> "neutral"
  }

  private fun provisional(r: PitchEstimator.Register): VoiceSpec? {
    val key = genderKey(r)
    return pools[key]?.firstOrNull() ?: crossGender(r, 0) ?: fallback
  }

  private fun pick(r: PitchEstimator.Register): VoiceSpec? {
    val key = genderKey(r)
    val n = used[key] ?: 0
    used[key] = n + 1
    val pool = pools[key].orEmpty()
    if (pool.isNotEmpty()) {
      val base = pool[n % pool.size]
      val cycle = n / pool.size
      // 2nd round: +1.5 st, 3rd: -1.5 st, 4th: +3 st … keeps extra speakers distinguishable.
      val offset = if (cycle == 0) 0f else (if (cycle % 2 == 1) 1f else -1f) * 1.5f * ((cycle + 1) / 2)
      return base.copy(pitchSemitones = base.pitchSemitones + offset)
    }
    return crossGender(r, n) ?: fallback
  }

  /** No voice of the wanted gender installed: shift a voice of the other gender (approximation). */
  private fun crossGender(r: PitchEstimator.Register, n: Int): VoiceSpec? = when (r) {
    PitchEstimator.Register.LOW -> pools["female"]?.takeIf { it.isNotEmpty() }?.let { it[n % it.size].copy(pitchSemitones = -4f) }
      ?: pools["neutral"]?.firstOrNull()?.copy(pitchSemitones = -3f)
    PitchEstimator.Register.HIGH -> pools["male"]?.takeIf { it.isNotEmpty() }?.let { it[n % it.size].copy(pitchSemitones = 4f) }
      ?: pools["neutral"]?.firstOrNull()?.copy(pitchSemitones = 3f)
    PitchEstimator.Register.NEUTRAL -> (pools["male"].orEmpty() + pools["female"].orEmpty()).getOrNull(n % maxOf(1, (pools["male"].orEmpty() + pools["female"].orEmpty()).size))
  }

  private fun median(x: List<Float>?): Float? = x?.takeIf { it.isNotEmpty() }?.sorted()?.let { it[it.size / 2] }
}
