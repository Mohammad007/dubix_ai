package ai.dubix.engine.audio

import kotlin.math.sqrt

/**
 * YIN fundamental-frequency estimator. It only *suggests* a voice register (lower / higher /
 * neutral) for a speaker that has no manual mapping. The UI presents this as an estimate the
 * user can override; it is not a gender classifier.
 */
object PitchEstimator {
  enum class Register(val key: String) { LOW("low"), HIGH("high"), NEUTRAL("neutral") }

  fun estimateF0(frame: FloatArray, sampleRate: Int, minHz: Float = 65f, maxHz: Float = 400f, threshold: Float = 0.12f): Float? {
    val maxLag = (sampleRate / minHz).toInt()
    val minLag = (sampleRate / maxHz).toInt()
    if (frame.size < maxLag * 2) return null
    val w = frame.size - maxLag
    val d = FloatArray(maxLag + 1)
    for (tau in 1..maxLag) {
      var s = 0f
      for (j in 0 until w) { val diff = frame[j] - frame[j + tau]; s += diff * diff }
      d[tau] = s
    }
    val cmnd = FloatArray(maxLag + 1); cmnd[0] = 1f
    var running = 0f
    for (tau in 1..maxLag) { running += d[tau]; cmnd[tau] = if (running == 0f) 1f else d[tau] * tau / running }
    var tau = minLag
    while (tau <= maxLag) {
      if (cmnd[tau] < threshold) {
        while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) tau++
        val refined = if (tau in 1 until maxLag) {
          val a = cmnd[tau - 1]; val b = cmnd[tau]; val c = cmnd[tau + 1]
          val den = a + c - 2 * b
          if (den != 0f) tau + (a - c) / (2 * den) else tau.toFloat()
        } else tau.toFloat()
        return sampleRate / refined
      }
      tau++
    }
    return null
  }

  /** Median F0 over voiced frames of a speech segment, or null if mostly unvoiced. */
  fun medianF0(samples: FloatArray, sampleRate: Int): Float? {
    val frameLen = (sampleRate * 0.05).toInt() // 50 ms gives >= 2 periods at 70 Hz
    val values = ArrayList<Float>()
    var i = 0
    while (i + frameLen <= samples.size && values.size < 120) {
      val frame = samples.copyOfRange(i, i + frameLen)
      if (rms(frame) > 0.01f) estimateF0(frame, sampleRate)?.let { values.add(it) }
      i += frameLen
    }
    if (values.size < 3) return null
    values.sort()
    return values[values.size / 2]
  }

  /**
   * Typical adult speaking F0: ~85–155 Hz for lower voices, ~165–255 Hz for higher ones. 165 Hz
   * splits them; null (unvoiced / unknown) stays NEUTRAL.
   */
  fun register(f0: Float?): Register = when {
    f0 == null -> Register.NEUTRAL
    f0 < 165f -> Register.LOW
    else -> Register.HIGH
  }

  fun rms(x: FloatArray): Float {
    if (x.isEmpty()) return 0f
    var s = 0.0
    for (v in x) s += v * v
    return sqrt(s / x.size).toFloat()
  }
}
