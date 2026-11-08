package ai.dubix.engine.audio

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.roundToInt

/**
 * WSOLA (waveform-similarity overlap-add) time-stretch. Changes duration without changing
 * pitch, which keeps synthesized voices natural while fitting them into dialogue windows.
 * speed > 1 shortens the audio, speed < 1 lengthens it.
 */
object TimeStretcher {
  fun stretch(input: FloatArray, sampleRate: Int, speed: Float): FloatArray {
    if (input.isEmpty() || abs(speed - 1f) < 0.01f) return input.copyOf()
    val frame = (sampleRate * 0.030).roundToInt().coerceAtLeast(64) // 30 ms
    val overlap = frame / 2
    val hop = frame - overlap
    val hopIn = hop * speed
    val search = (sampleRate * 0.010).roundToInt() // ±10 ms tolerance
    val window = FloatArray(overlap) { (0.5 - 0.5 * cos(PI * it / overlap)).toFloat() }
    if (input.size <= frame * 2) return input.copyOf()

    val out = FloatArray((input.size / speed).roundToInt() + frame * 2)
    System.arraycopy(input, 0, out, 0, frame)
    var outPos = hop
    var inPos = 0.0
    var natural = hop // input index that naturally continues the last written frame

    while (true) {
      inPos += hopIn
      val nominal = inPos.roundToInt()
      if (nominal + frame + search >= input.size || outPos + frame >= out.size) break
      val lo = maxOf(-search, -nominal)
      var bestOff = 0
      var best = Float.NEGATIVE_INFINITY
      var off = lo
      while (off <= search) {
        val a = nominal + off
        var c = 0f
        var k = 0
        while (k < overlap) {
          val ref = if (natural + k < input.size) input[natural + k] else 0f
          c += input[a + k] * ref
          k += 2
        }
        if (c > best) { best = c; bestOff = off }
        off += 2
      }
      val start = nominal + bestOff
      for (k in 0 until overlap) {
        val w = window[k]
        out[outPos + k] = out[outPos + k] * (1 - w) + input[start + k] * w
      }
      for (k in overlap until frame) out[outPos + k] = input[start + k]
      natural = start + hop
      outPos += hop
    }
    return out.copyOf(minOf(out.size, outPos + overlap))
  }
}
