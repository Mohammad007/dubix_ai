package ai.dubix.engine.ml

import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.nl.languageid.LanguageIdentification
import com.google.mlkit.nl.languageid.LanguageIdentificationOptions
import java.util.concurrent.TimeUnit

/** On-device text language identification (ML Kit, bundled model) for subtitle text. */
object LanguageDetector {
  private val client by lazy {
    LanguageIdentification.getClient(LanguageIdentificationOptions.Builder().setConfidenceThreshold(0.4f).build())
  }

  /** BCP-47 code such as "en" or "hi", or null when undetermined. */
  fun detect(text: String): String? = try {
    val tag = Tasks.await(client.identifyLanguage(text.take(500)), 5, TimeUnit.SECONDS)
    tag.takeIf { it != "und" }?.substringBefore('-')
  } catch (e: Exception) {
    Log.w("DubixLangId", "language identification failed", e)
    null
  }
}
