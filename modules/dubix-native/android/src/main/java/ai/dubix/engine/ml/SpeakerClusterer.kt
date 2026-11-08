package ai.dubix.engine.ml

import kotlin.math.sqrt

/**
 * Online (streaming) speaker clustering over embedding vectors. Memory-bounded alternative to
 * whole-file diarization so multi-hour films never need to be held in RAM.
 * New clusters are created when similarity to every centroid is below [threshold] until
 * [maxSpeakers] is reached; afterwards segments go to the nearest existing cluster.
 */
class SpeakerClusterer(private val threshold: Float = 0.5f, private val maxSpeakers: Int = 8) {
  private class Cluster(val id: Int, var centroid: FloatArray, var count: Int)

  private val clusters = ArrayList<Cluster>()

  val speakerCount: Int get() = clusters.size

  /**
   * Returns a 0-based speaker index. With [allowNew] false (short, noisy segments) the segment
   * joins the nearest existing speaker instead of creating a new one, which prevents one person
   * being split into many speakers.
   */
  @Synchronized
  fun assign(embedding: FloatArray, allowNew: Boolean = true): Int {
    val e = normalize(embedding)
    var bestIdx = -1
    var best = -2f
    for ((i, c) in clusters.withIndex()) {
      val s = dot(e, c.centroid)
      if (s > best) { best = s; bestIdx = i }
    }
    if (bestIdx >= 0 && (best >= threshold || clusters.size >= maxSpeakers || !allowNew)) {
      val c = clusters[bestIdx]
      val n = c.count
      val updated = FloatArray(e.size) { (c.centroid[it] * n + e[it]) / (n + 1) }
      c.centroid = normalize(updated); c.count = n + 1
      return c.id
    }
    val id = clusters.size
    clusters.add(Cluster(id, e, 1))
    return id
  }

  /** Restores centroids from a previous run so resumed jobs keep consistent speaker ids. */
  @Synchronized
  fun seed(centroids: List<FloatArray>) {
    clusters.clear()
    centroids.forEachIndexed { i, c -> clusters.add(Cluster(i, normalize(c), 5)) }
  }

  @Synchronized
  fun centroids(): List<FloatArray> = clusters.map { it.centroid.copyOf() }

  companion object {
    fun normalize(v: FloatArray): FloatArray {
      var s = 0f
      for (x in v) s += x * x
      val n = sqrt(s)
      return if (n == 0f) v.copyOf() else FloatArray(v.size) { v[it] / n }
    }

    fun dot(a: FloatArray, b: FloatArray): Float {
      var s = 0f
      for (i in 0 until minOf(a.size, b.size)) s += a[i] * b[i]
      return s
    }
  }
}
