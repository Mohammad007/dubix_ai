package ai.dubix.engine.audio

import kotlin.math.abs

/** Removes leading/trailing silence and shortens long internal pauses in synthesized speech. */
object SilenceTrimmer {
  /**
   * @param maxPauseSec internal pauses longer than this are shortened to it; <= 0 keeps
   * internal pauses untouched (edges are still trimmed).
   */
  fun trim(x: FloatArray, sampleRate: Int, maxPauseSec: Float, threshold: Float = 0.01f): FloatArray {
    if (x.isEmpty()) return x
    val win = (sampleRate / 100).coerceAtLeast(1) // 10 ms
    val n = (x.size + win - 1) / win
    val loud = BooleanArray(n) { i ->
      var peak = 0f
      for (k in i * win until minOf(x.size, (i + 1) * win)) { val a = abs(x[k]); if (a > peak) peak = a }
      peak > threshold
    }
    val first = loud.indexOfFirst { it }
    if (first < 0) return FloatArray(0)
    val last = loud.indexOfLast { it }
    val pad = 3 // keep 30 ms around speech
    val s = maxOf(0, first - pad)
    val e = minOf(n, last + 1 + pad)
    if (maxPauseSec <= 0f) return x.copyOfRange(s * win, minOf(x.size, e * win))
    val maxPauseWins = (maxPauseSec * 100).toInt().coerceAtLeast(1)
    val out = FloatArray(x.size)
    var len = 0
    var silentRun = 0
    for (i in s until e) {
      silentRun = if (loud[i]) 0 else silentRun + 1
      if (silentRun > maxPauseWins) continue
      val from = i * win
      val to = minOf(x.size, (i + 1) * win)
      System.arraycopy(x, from, out, len, to - from)
      len += to - from
    }
    return out.copyOf(len)
  }
}
