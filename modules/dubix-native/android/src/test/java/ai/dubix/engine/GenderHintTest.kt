package ai.dubix.engine

import ai.dubix.engine.ml.VoiceSpec
import ai.dubix.engine.pipeline.GenderHint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import kotlin.math.PI
import kotlin.math.sin

class GenderHintTest {
  private fun v(id: String) = VoiceSpec("sherpa", id, 0, null, "hi", 0f, 1f)
  private val pools = mapOf("male" to listOf(v("m1"), v("m2")), "female" to listOf(v("f1")), "neutral" to emptyList())

  @Test fun readsExplicitSubtitleCuesOnly() {
    assertEquals("female", GenderHint.fromText("[WOMAN] Where were you?"))
    assertEquals("male", GenderHint.fromText("OLD MAN: Sit down."))
    assertEquals("female", GenderHint.fromText("(mother sighs)\nCome home."))
    assertNull(GenderHint.fromText("JOHN: Sit down.")) // names are never used to guess gender
    assertNull(GenderHint.fromText("We have to go."))
  }

  @Test fun pitchPicksGenderAndVoiceWithinGender() {
    assertEquals("male", GenderHint.genderOf(110f))
    assertEquals("female", GenderHint.genderOf(220f))
    assertNull(GenderHint.genderOf(null))
    assertEquals("m1", GenderHint.voiceFor("male", 100f, pools)!!.modelId)
    assertEquals("m2", GenderHint.voiceFor("male", 140f, pools)!!.modelId)
    assertEquals("f1", GenderHint.voiceFor("female", 240f, pools)!!.modelId)
    // No female voice installed → a male voice shifted up.
    val shifted = GenderHint.voiceFor("female", 230f, mapOf("male" to listOf(v("m1"))))!!
    assertEquals(4f, shifted.pitchSemitones, 0f)
  }

  @Test fun quietAudioIsNormalisedForPitchTracking() {
    val rate = 16000
    val quiet = FloatArray(rate) { (0.004 * sin(2 * PI * 120.0 * it / rate)).toFloat() }
    val f0 = ai.dubix.engine.audio.PitchEstimator.medianF0(GenderHint.normalize(quiet), rate)
    assertEquals("male", GenderHint.genderOf(f0))
  }
}
