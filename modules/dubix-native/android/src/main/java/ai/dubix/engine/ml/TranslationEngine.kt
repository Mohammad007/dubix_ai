package ai.dubix.engine.ml

import ai.dubix.engine.core.Perf
import android.content.Context
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.TranslateRemoteModel
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions
import java.util.concurrent.TimeUnit

/**
 * Offline text translation through ML Kit on-device models. Language packs are downloaded once
 * (explicit user action); translation never triggers a download implicitly.
 *
 * Resilience: ML Kit's `RemoteModelManager` is created lazily and every call into it is guarded.
 * If it fails on a device (seen in the field as a NullPointerException inside Play services),
 * packs are downloaded through a Translator client instead, and the set of packs DubiX installed
 * is remembered locally so translation keeps working. Every failure is logged with its full
 * stack trace under the `DubixMLKit` tag.
 */
class TranslationEngine(context: Context) : TextTranslator {
  private val translators = HashMap<String, Translator>()
  private val prefs = context.applicationContext.getSharedPreferences("dubix-mlkit", Context.MODE_PRIVATE)

  class PackMissingException(lang: String) : IllegalStateException("Offline translation pack for '$lang' is not installed")

  /** Lazily created so a broken model manager cannot take down the whole engine. */
  private fun manager(): RemoteModelManager = RemoteModelManager.getInstance()

  fun supported(): List<String> = TranslateLanguage.getAllLanguages()

  fun isSupported(lang: String) = TranslateLanguage.fromLanguageTag(lang) != null

  @Volatile private var packsCache: Pair<Long, List<String>>? = null

  private fun remembered(): Set<String> = prefs.getStringSet(KEY_PACKS, emptySet()) ?: emptySet()
  private fun remember(lang: String, installed: Boolean) {
    val next = remembered().toMutableSet().apply { if (installed) add(lang) else remove(lang) }
    prefs.edit().putStringSet(KEY_PACKS, next).apply()
  }

  /**
   * Installed packs (cached 15 s). Uses the model manager; if it fails, falls back to the packs
   * DubiX installed itself, so a Play services glitch does not block translation.
   */
  fun downloadedPacks(): List<String> {
    packsCache?.let { (at, list) -> if (System.currentTimeMillis() - at < 15_000) return list }
    val list = try {
      Tasks.await(manager().getDownloadedModels(TranslateRemoteModel::class.java), 20, TimeUnit.SECONDS)
        .map { it.language }
        .also { live -> prefs.edit().putStringSet(KEY_PACKS, live.toSet()).apply() }
    } catch (e: Exception) {
      Log.e(TAG, "getDownloadedModels failed; using remembered packs", e)
      remembered().toList()
    }
    packsCache = System.currentTimeMillis() to list
    return list
  }

  fun isDownloaded(lang: String): Boolean = downloadedPacks().contains(lang)

  private val downloadLock = Any()

  /**
   * Downloads one ML Kit pack over Wi-Fi or mobile data (or Wi-Fi only when [wifiOnly]).
   * Serialized, because concurrent model-manager downloads can fail inside Play services.
   * Any model-manager failure (including creating it) falls back to a Translator client's
   * `downloadModelIfNeeded`, ML Kit's other supported download path.
   */
  fun downloadPack(lang: String, wifiOnly: Boolean, metered: Boolean) = synchronized(downloadLock) {
    val code = TranslateLanguage.fromLanguageTag(lang) ?: error("Language '$lang' is not supported by on-device translation")
    if (wifiOnly && metered) {
      error("“Download on Wi-Fi only” is on and this device is on mobile data. Connect to Wi-Fi or turn that setting off in Offline AI Models.")
    }
    val conditions = DownloadConditions.Builder().apply { if (wifiOnly) requireWifi() }.build()
    try {
      try {
        Tasks.await(manager().download(TranslateRemoteModel.Builder(code).build(), conditions), 30, TimeUnit.MINUTES)
      } catch (first: Throwable) {
        Log.e(TAG, "RemoteModelManager.download($code) failed; trying Translator.downloadModelIfNeeded", first)
        downloadViaTranslator(code, conditions)
      }
      remember(code, true)
    } finally {
      packsCache = null
    }
    Unit
  }

  /** English is the pivot of every ML Kit pair, so an English↔X translator downloads X (and English). */
  private fun downloadViaTranslator(code: String, conditions: DownloadConditions) {
    val other = if (code == TranslateLanguage.ENGLISH) {
      remembered().firstOrNull { it != TranslateLanguage.ENGLISH } ?: TranslateLanguage.HINDI
    } else TranslateLanguage.ENGLISH
    val client = try {
      Translation.getClient(TranslatorOptions.Builder().setSourceLanguage(other).setTargetLanguage(code).build())
    } catch (e: Throwable) {
      Log.e(TAG, "Translation.getClient failed", e)
      throw IllegalStateException(friendly(e), e)
    }
    try {
      Tasks.await(client.downloadModelIfNeeded(conditions), 30, TimeUnit.MINUTES)
      remember(other, true)
    } catch (e: Throwable) {
      Log.e(TAG, "Translator.downloadModelIfNeeded($other>$code) failed", e)
      throw IllegalStateException(friendly(e), e)
    } finally {
      client.close()
    }
  }

  /** Plain-language message plus where it failed (exception type and first ML Kit / GMS frame). */
  private fun friendly(e: Throwable): String {
    val root = generateSequence(e) { it.cause }.last()
    val msg = root.message.orEmpty()
    val where = root.stackTrace.firstOrNull { it.className.startsWith("com.google") }?.let { " at ${it.className.substringAfterLast('.')}.${it.methodName}" } ?: ""
    return when {
      root is java.net.UnknownHostException || msg.contains("resolve host", true) || msg.contains("network", true) ->
        "No internet connection. Connect to Wi-Fi or mobile data and retry."
      root is java.util.concurrent.TimeoutException -> "The download timed out. Check the connection and retry."
      else -> "Google Play services could not download the translation pack. Update Google Play services (Play Store › Google Play services) and retry. [${root.javaClass.simpleName}$where]"
    }
  }

  fun deletePack(lang: String) {
    val code = TranslateLanguage.fromLanguageTag(lang) ?: return
    try {
      Tasks.await(manager().deleteDownloadedModel(TranslateRemoteModel.Builder(code).build()), 60, TimeUnit.SECONDS)
    } catch (e: Exception) {
      Log.e(TAG, "deleteDownloadedModel($code) failed", e)
      throw IllegalStateException(friendly(e), e)
    } finally {
      remember(code, false)
      packsCache = null
    }
  }

  /** Small LRU so repeated lines (common in films and live captions) are not re-translated. */
  private val cache = object : LinkedHashMap<String, String>(256, 0.75f, true) {
    override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, String>?) = size > 512
  }

  /** Blocking; call off the main thread. */
  override fun translate(text: String, source: String, target: String): String {
    if (source == target || text.isBlank()) return text
    val key = "$source>$target|$text"
    synchronized(cache) { cache[key] }?.let { return it }
    val src = TranslateLanguage.fromLanguageTag(source) ?: error("Unsupported source language '$source'")
    val tgt = TranslateLanguage.fromLanguageTag(target) ?: error("Unsupported target language '$target'")
    val packs = downloadedPacks()
    if (!packs.contains(src)) throw PackMissingException(src)
    if (!packs.contains(tgt)) throw PackMissingException(tgt)
    val translator = synchronized(translators) {
      translators.getOrPut("$src>$tgt") {
        Translation.getClient(TranslatorOptions.Builder().setSourceLanguage(src).setTargetLanguage(tgt).build())
      }
    }
    val out = Perf.trace("translate") { Tasks.await(translator.translate(text), 30, TimeUnit.SECONDS) }
    synchronized(cache) { cache[key] = out }
    return out
  }

  override fun release() = synchronized(translators) {
    translators.values.forEach { it.close() }
    translators.clear()
  }

  companion object {
    private const val TAG = "DubixMLKit"
    private const val KEY_PACKS = "installedPacks"
  }
}
