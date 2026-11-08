package ai.dubix.engine.ml

import ai.dubix.engine.core.DeviceInfo
import ai.dubix.engine.core.DubixEvents
import ai.dubix.engine.models.ModelDownloader
import ai.dubix.engine.models.ModelStore
import android.content.ComponentCallbacks2
import android.content.Context
import android.content.res.Configuration

/**
 * Process-wide owner of heavy engines so the local dubbing job, live session and previews
 * share loaded models. Releases models under memory pressure.
 */
object EngineHub {
  private lateinit var appContext: Context
  lateinit var store: ModelStore; private set
  lateinit var downloader: ModelDownloader; private set
  val translation by lazy { TranslationEngine(appContext) }

  private var asr: AsrEngine? = null
  private var embedder: Pair<String, SpeakerEmbedder>? = null
  private var tts: TtsEngine? = null

  @Synchronized
  fun init(context: Context) {
    if (::appContext.isInitialized) return
    appContext = context.applicationContext
    store = ModelStore(appContext)
    downloader = ModelDownloader(appContext, store)
    appContext.registerComponentCallbacks(object : ComponentCallbacks2 {
      override fun onTrimMemory(level: Int) {
        @Suppress("DEPRECATION")
        when (level) {
          // Real memory pressure while DubiX is running in the foreground: free models and tell the user.
          ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW, ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL -> {
            trimIdle()
            DubixEvents.warning("low_memory", "System memory is low. Unused voice models were unloaded; processing may slow down.")
          }
          // UI hidden / background levels just mean the app left the screen: trim quietly.
          ComponentCallbacks2.TRIM_MEMORY_BACKGROUND, ComponentCallbacks2.TRIM_MEMORY_MODERATE, ComponentCallbacks2.TRIM_MEMORY_COMPLETE -> trimIdle()
          else -> Unit
        }
      }
      override fun onConfigurationChanged(newConfig: Configuration) {}
      @Deprecated("Deprecated in Java")
      override fun onLowMemory() { trimIdle() }
    })
  }

  fun context(): Context = appContext

  fun threads(): Int = DeviceInfo.inferenceThreads(appContext)

  @Synchronized
  fun asr(modelId: String, language: String): AsrEngine {
    asr?.let { if (it.modelId == modelId && it.language == language) return it; it.release() }
    return AsrEngine(store, modelId, language, threads()).also { asr = it }
  }

  @Synchronized
  fun embedder(modelId: String): SpeakerEmbedder {
    embedder?.let { if (it.first == modelId) return it.second; it.second.release() }
    return SpeakerEmbedder(store, modelId, 1).also { embedder = modelId to it }
  }

  @Synchronized
  fun tts(): TtsEngine = tts ?: TtsEngine(appContext, store, threads()).also { tts = it }

  @Synchronized
  fun trimIdle() { tts?.trim() }

  /** Fully unloads models (called when no job or live session is active and on model deletion). */
  @Synchronized
  fun releaseAll() {
    asr?.release(); asr = null
    embedder?.second?.release(); embedder = null
    tts?.trim()
    translation.release()
  }
}
