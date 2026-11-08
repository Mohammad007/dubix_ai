package ai.dubix.engine

import ai.dubix.engine.audio.PitchEstimator
import ai.dubix.engine.audio.SilenceTrimmer
import ai.dubix.engine.audio.StreamingResampler
import ai.dubix.engine.audio.TimeStretcher
import ai.dubix.engine.core.Wav
import ai.dubix.engine.ml.SpeakerClusterer
import ai.dubix.engine.pipeline.SegmentFit
import ai.dubix.engine.pipeline.TextNormalizer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.sin

class DspTest {
  private fun sine(hz: Float, rate: Int, seconds: Float, amp: Float = 0.5f) =
    FloatArray((rate * seconds).toInt()) { amp * sin(2 * PI * hz * it / rate).toFloat() }

  @Test fun resamplerKeepsDurationAcrossChunks() {
    val input = sine(440f, 48_000, 1f)
    val r = StreamingResampler(48_000, 16_000)
    val out = ArrayList<Float>()
    var i = 0
    while (i < input.size) { val n = minOf(1_000, input.size - i); out.addAll(r.process(input.copyOfRange(i, i + n)).toList()); i += n }
    assertEquals(16_000.0, out.size.toDouble(), 20.0)
    // the resampled tone keeps its pitch
    val f0 = PitchEstimator.estimateF0(out.subList(4000, 8000).toFloatArray(), 16_000, minHz = 300f, maxHz = 600f)
    assertNotNull(f0); assertEquals(440.0, f0!!.toDouble(), 6.0)
  }

  @Test fun timeStretchChangesLengthNotPitch() {
    val rate = 24_000
    val input = sine(200f, rate, 2f)
    val faster = TimeStretcher.stretch(input, rate, 1.25f)
    assertEquals(input.size / 1.25, faster.size.toDouble(), rate * 0.08)
    val f0 = PitchEstimator.estimateF0(faster.copyOfRange(rate / 2, rate / 2 + 4800), rate)
    assertNotNull(f0); assertEquals(200.0, f0!!.toDouble(), 8.0)
    val slower = TimeStretcher.stretch(input, rate, 0.8f)
    assertEquals(input.size / 0.8, slower.size.toDouble(), rate * 0.08)
  }

  @Test fun pitchRegisterSuggestion() {
    assertEquals(PitchEstimator.Register.LOW, PitchEstimator.register(PitchEstimator.medianF0(sine(115f, 16_000, 1f), 16_000)))
    assertEquals(PitchEstimator.Register.HIGH, PitchEstimator.register(PitchEstimator.medianF0(sine(230f, 16_000, 1f), 16_000)))
    assertEquals(PitchEstimator.Register.NEUTRAL, PitchEstimator.register(null))
    assertNull(PitchEstimator.medianF0(FloatArray(16_000), 16_000))
  }

  @Test fun silenceTrimmerRemovesEdgesAndLongPauses() {
    val rate = 16_000
    val tone = sine(300f, rate, 0.5f)
    val gap = FloatArray(rate) // 1 s
    val x = FloatArray(rate / 2) + tone + gap + tone + FloatArray(rate / 2)
    val edges = SilenceTrimmer.trim(x, rate, 0f)
    assertEquals((tone.size * 2 + gap.size).toDouble(), edges.size.toDouble(), rate * 0.1)
    val compressed = SilenceTrimmer.trim(x, rate, 0.3f)
    assertEquals((tone.size * 2 + rate * 0.3).toDouble(), compressed.size.toDouble(), rate * 0.1)
    assertEquals(0, SilenceTrimmer.trim(FloatArray(rate), rate, 0.3f).size)
  }

  @Test fun wavRoundTrip() {
    val x = sine(440f, 24_000, 0.1f)
    val audio = Wav.decode(Wav.encodeMono16(x, 24_000))
    assertEquals(24_000, audio.sampleRate)
    assertEquals(x.size, audio.samples.size)
    assertTrue(x.indices.all { abs(x[it] - audio.samples[it]) < 1e-3 })
  }

  @Test fun clustererSeparatesDistinctSpeakers() {
    val c = SpeakerClusterer(threshold = 0.6f, maxSpeakers = 3)
    val a = floatArrayOf(1f, 0f, 0f, 0.1f)
    val b = floatArrayOf(0f, 1f, 0f, 0.1f)
    assertEquals(0, c.assign(a))
    assertEquals(1, c.assign(b))
    assertEquals(0, c.assign(floatArrayOf(0.95f, 0.05f, 0f, 0.1f)))
    assertEquals(2, c.assign(floatArrayOf(0f, 0f, 1f, 0f)))
    // cap reached: nearest existing cluster
    assertEquals(3, c.speakerCount)
    assertTrue(c.assign(floatArrayOf(-1f, -1f, -1f, 0f)) in 0..2)
    assertEquals(3, c.speakerCount)
  }

  @Test fun fitSpeedBounds() {
    assertEquals(1f, SegmentFit.fitSpeed(1_000, 2_000, 1f, 1.25f), 1e-4f)
    assertEquals(1.25f, SegmentFit.fitSpeed(5_000, 2_000, 1f, 1.25f), 1e-4f)
    assertEquals(1.1f, SegmentFit.fitSpeed(2_530, 2_000, 1f, 1.25f), 1e-3f)
    assertEquals(0.9f, SegmentFit.fitSpeed(500, 2_000, 0.9f, 1.25f), 1e-4f)
  }

  @Test fun schedulerDecisions() {
    assertEquals(SegmentFit.Decision.WAIT, SegmentFit.decide(900, 1_000, 2_000))
    assertEquals(SegmentFit.Decision.PLAY, SegmentFit.decide(1_050, 1_000, 2_000))
    assertEquals(SegmentFit.Decision.PLAY_FROM_OFFSET, SegmentFit.decide(1_800, 1_000, 2_000))
    assertEquals(SegmentFit.Decision.SKIP, SegmentFit.decide(2_500, 1_000, 2_000))
  }

  @Test fun textNormalization() {
    assertEquals("Hello there", TextNormalizer.cleanAsr(" [Music] Hello   there ♪ "))
    assertNull(TextNormalizer.cleanAsr("(applause) ..."))
    assertTrue(TextNormalizer.isLikelyHallucination("thank you thank you thank you thank you thank you thank you", 3_000))
    assertTrue(TextNormalizer.isLikelyHallucination("a".repeat(200), 1_000))
    assertFalse(TextNormalizer.isLikelyHallucination("We will reach the station in about five minutes", 3_000))
    assertEquals("हम पहुँचेंगे।", TextNormalizer.punctuateForTarget("हम पहुँचेंगे .", "hi"))
    assertEquals("کیا آپ ٹھیک ہیں؟", TextNormalizer.punctuateForTarget("کیا آپ ٹھیک ہیں?", "ur"))
    assertEquals("Hola, amigo.", TextNormalizer.punctuateForTarget("Hola , amigo", "es"))
  }
}
