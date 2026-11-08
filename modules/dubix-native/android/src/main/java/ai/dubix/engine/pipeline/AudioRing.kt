package ai.dubix.engine.pipeline

/** Fixed-size rolling buffer of the most recent mono samples, addressed by absolute sample index. */
class AudioRing(private val capacity: Int) {
  private val buf = FloatArray(capacity)
  private var end = 0L // absolute index one past the newest sample

  fun append(absStart: Long, chunk: FloatArray) {
    for (i in chunk.indices) buf[((absStart + i) % capacity).toInt()] = chunk[i]
    end = absStart + chunk.size
  }

  /** Samples in [from, to), clipped to what is still buffered; empty if none. */
  fun slice(from: Long, to: Long): FloatArray {
    val lo = maxOf(from, end - capacity, 0)
    val hi = minOf(to, end)
    if (hi <= lo) return FloatArray(0)
    return FloatArray((hi - lo).toInt()) { buf[((lo + it) % capacity).toInt()] }
  }
}
