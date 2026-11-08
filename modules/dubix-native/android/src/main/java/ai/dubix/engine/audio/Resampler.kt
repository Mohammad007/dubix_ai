package ai.dubix.engine.audio

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin

/**
 * Streaming mono resampler: windowed-sinc low-pass (when downsampling) followed by linear
 * interpolation. State is kept across [process] calls so chunk boundaries are seamless.
 * Quality is sufficient for speech models (VAD/ASR at 16 kHz) and TTS output normalisation.
 */
class StreamingResampler(private val inRate: Int, private val outRate: Int) {
  private val step = inRate.toDouble() / outRate
  private val taps: FloatArray? = if (outRate < inRate) designLowPass(0.45 * outRate / inRate, 31) else null
  private val history = FloatArray(taps?.size ?: 0)
  private var pos = 0.0
  private var prev = 0f
  private var hasPrev = false

  fun process(input: FloatArray): FloatArray {
    if (inRate == outRate) return input.copyOf()
    if (input.isEmpty()) return FloatArray(0)
    val filtered = taps?.let { fir(input, it) } ?: input
    // Virtual buffer = [prev] + filtered (prev only after the first chunk).
    val base = if (hasPrev) 1 else 0
    val total = filtered.size + base
    val out = FloatArray(((total - pos) / step).toInt() + 2)
    var n = 0
    while (pos + 1 < total) {
      val i = floor(pos).toInt()
      val frac = (pos - i).toFloat()
      val a = if (base == 1 && i == 0) prev else filtered[i - base]
      val b = filtered[i + 1 - base]
      out[n++] = a + (b - a) * frac
      pos += step
    }
    pos -= (total - 1)
    prev = filtered[filtered.size - 1]; hasPrev = true
    return out.copyOf(n)
  }

  private fun fir(x: FloatArray, h: FloatArray): FloatArray {
    val n = h.size
    val y = FloatArray(x.size)
    for (i in x.indices) {
      var acc = 0f
      for (k in 0 until n) {
        val idx = i - k
        acc += h[k] * (if (idx >= 0) x[idx] else history[n + idx])
      }
      y[i] = acc
    }
    if (x.size >= n) {
      System.arraycopy(x, x.size - n, history, 0, n)
    } else {
      System.arraycopy(history, x.size, history, 0, n - x.size)
      System.arraycopy(x, 0, history, n - x.size, x.size)
    }
    return y
  }

  companion object {
    /** Hann-windowed sinc low-pass; [cutoff] is normalised to the input rate (0..0.5). */
    fun designLowPass(cutoff: Double, numTaps: Int): FloatArray {
      val m = numTaps - 1
      val h = FloatArray(numTaps)
      var sum = 0.0
      for (i in 0 until numTaps) {
        val n = i - m / 2.0
        val sinc = if (n == 0.0) 2 * cutoff else sin(2 * PI * cutoff * n) / (PI * n)
        val w = 0.5 - 0.5 * cos(2 * PI * i / m)
        h[i] = (sinc * w).toFloat(); sum += h[i]
      }
      for (i in h.indices) h[i] = (h[i] / sum).toFloat()
      return h
    }

    fun resample(input: FloatArray, inRate: Int, outRate: Int): FloatArray =
      if (inRate == outRate) input else StreamingResampler(inRate, outRate).process(input)
  }
}
