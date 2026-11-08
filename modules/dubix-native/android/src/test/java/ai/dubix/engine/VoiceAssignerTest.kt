package ai.dubix.engine

import ai.dubix.engine.audio.PitchEstimator
import ai.dubix.engine.ml.SpeakerClusterer
import ai.dubix.engine.ml.VoiceSpec
import ai.dubix.engine.pipeline.SpeakerVoiceAssigner
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class VoiceAssignerTest {
  private fun v(id: String) = VoiceSpec("sherpa", id, 0, null, "hi", 0f, 1f)
  private val pools = mapOf("male" to listOf(v("rohan"), v("pratham")), "female" to listOf(v("priyamvada")))

  @Test fun eachSpeakerKeepsOneGenderMatchedVoice() {
    val a = SpeakerVoiceAssigner(pools, emptyMap(), null)
    a.voiceFor(0, 120f); val man = a.voiceFor(0, 125f)
    a.voiceFor(1, 220f); val woman = a.voiceFor(1, 210f)
    assertEquals("rohan", man.voice?.modelId)
    assertEquals(PitchEstimator.Register.LOW, man.register)
    assertEquals("priyamvada", woman.voice?.modelId)
    // A single octave-error line later must not flip the decided voice.
    assertEquals("rohan", a.voiceFor(0, 240f).voice?.modelId)
  }

  @Test fun twoMenGetDifferentVoicesAndExtraSpeakersArePitchShifted() {
    val a = SpeakerVoiceAssigner(pools, emptyMap(), null)
    repeat(2) { a.voiceFor(0, 110f) }
    repeat(2) { a.voiceFor(1, 130f) }
    repeat(2) { a.voiceFor(2, 120f) }
    val m0 = a.voiceFor(0, 110f).voice!!; val m1 = a.voiceFor(1, 130f).voice!!; val m2 = a.voiceFor(2, 120f).voice!!
    assertNotEquals(m0.modelId, m1.modelId)
    assertEquals("rohan", m2.modelId)
    assertNotEquals(0f, m2.pitchSemitones)
  }

  @Test fun manualMappingWinsAndMissingGenderUsesShiftedOtherVoice() {
    val a = SpeakerVoiceAssigner(mapOf("male" to listOf(v("rohan"))), mapOf(3 to v("custom")), null)
    assertEquals("custom", a.voiceFor(3, 120f).voice?.modelId)
    repeat(2) { a.voiceFor(4, 230f) }
    val woman = a.voiceFor(4, 230f).voice!!
    assertEquals("rohan", woman.modelId)
    assertEquals(4f, woman.pitchSemitones, 0.01f)
  }

  @Test fun shortSegmentsCannotCreateSpeakers() {
    val c = SpeakerClusterer(threshold = 0.5f)
    assertEquals(0, c.assign(floatArrayOf(1f, 0f, 0f)))
    // A short, different-sounding segment joins the nearest speaker instead of creating one…
    assertEquals(0, c.assign(floatArrayOf(0f, 1f, 0f), allowNew = false))
    assertEquals(1, c.speakerCount)
    // …while a long segment from a genuinely new voice creates a new speaker.
    assertEquals(1, c.assign(floatArrayOf(0f, 0f, 1f), allowNew = true))
  }
}
