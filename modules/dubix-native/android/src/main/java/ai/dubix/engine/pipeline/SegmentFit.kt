package ai.dubix.engine.pipeline

/** Timing math shared by the offline job and the playback scheduler. */
object SegmentFit {
  /**
   * Speed factor to apply to synthesized speech so it fits the dialogue window.
   * Never slows below [userSpeed]; never speeds beyond [maxSpeed] (overflow is then handled by
   * the scheduler, which may delay or skip). [allowanceMs] lets speech spill into following silence.
   */
  fun fitSpeed(synthMs: Long, windowMs: Long, userSpeed: Float, maxSpeed: Float, allowanceMs: Long = 300): Float {
    if (synthMs <= 0 || windowMs <= 0) return userSpeed
    val needed = synthMs.toFloat() / (windowMs + allowanceMs)
    return needed.coerceAtLeast(userSpeed).coerceAtMost(maxOf(maxSpeed, userSpeed))
  }

  enum class Decision { PLAY, PLAY_FROM_OFFSET, SKIP, WAIT }

  /**
   * Decides what to do with a segment given the player position.
   * @param positionMs current media position (already compensated for output latency)
   * @param startMs scheduled start (segment start + user offset)
   */
  fun decide(positionMs: Long, startMs: Long, durationMs: Long, lookaheadMs: Long = 30): Decision {
    val late = positionMs - startMs
    return when {
      late < -lookaheadMs -> Decision.WAIT
      late <= 120 -> Decision.PLAY
      late < durationMs * 0.6 -> Decision.PLAY_FROM_OFFSET
      else -> Decision.SKIP
    }
  }
}
