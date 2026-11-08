package ai.dubix.engine.live

/** A running live translation source (audio capture or on-screen subtitles). */
interface LiveEngine {
  val paused: Boolean
  fun start()
  fun stop()
  fun setPaused(p: Boolean)
  fun setSpeak(on: Boolean)
  fun setCaptions(on: Boolean)
  fun config(): LiveSession.Config
}
