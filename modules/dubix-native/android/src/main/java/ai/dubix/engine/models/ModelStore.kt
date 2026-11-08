package ai.dubix.engine.models

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * On-disk layout of installed model packs: `<filesDir>/models/<id>/` containing the extracted
 * pack plus `dubix-manifest.json` written after a verified install. Only directories with a
 * manifest are considered installed, so interrupted installs never load.
 */
class ModelStore(context: Context) {
  val root: File = File(context.filesDir, "models").apply { mkdirs() }

  fun dir(id: String): File {
    require(id.matches(Regex("[a-zA-Z0-9._-]+"))) { "Invalid model id: $id" }
    return File(root, id)
  }

  private fun manifestFile(id: String) = File(dir(id), MANIFEST)

  fun isInstalled(id: String) = manifestFile(id).isFile

  fun manifest(id: String): JSONObject? =
    manifestFile(id).takeIf { it.isFile }?.let { runCatching { JSONObject(it.readText()) }.getOrNull() }

  fun writeManifest(id: String, json: JSONObject) {
    val f = manifestFile(id)
    val tmp = File(f.path + ".tmp")
    tmp.writeText(json.toString())
    tmp.renameTo(f)
  }

  fun installed(): List<JSONObject> =
    root.listFiles()?.filter { it.isDirectory }?.mapNotNull { manifest(it.name) } ?: emptyList()

  fun delete(id: String): Boolean = dir(id).deleteRecursively()

  fun sizeOnDisk(id: String): Long = dir(id).walkBottomUp().filter { it.isFile }.sumOf { it.length() }

  fun totalSize(): Long = root.walkBottomUp().filter { it.isFile }.sumOf { it.length() }

  // ---- file resolution for each engine type ----

  private fun files(id: String): List<File> {
    check(isInstalled(id)) { "Model '$id' is not installed" }
    return dir(id).walkTopDown().filter { it.isFile }.toList()
  }

  private fun pick(candidates: List<File>, what: String, id: String): File =
    candidates.firstOrNull() ?: error("Model '$id' is missing its $what file")

  fun singleOnnx(id: String): String =
    pick(files(id).filter { it.name.endsWith(".onnx") }, ".onnx", id).absolutePath

  data class WhisperFiles(val encoder: String, val decoder: String, val tokens: String)

  fun whisper(id: String): WhisperFiles {
    val f = files(id)
    fun best(key: String) = f.filter { it.name.contains(key) && it.name.endsWith(".onnx") }
      .sortedBy { if (it.name.contains("int8")) 0 else 1 }
    return WhisperFiles(
      encoder = pick(best("encoder"), "encoder", id).absolutePath,
      decoder = pick(best("decoder"), "decoder", id).absolutePath,
      tokens = pick(f.filter { it.name.endsWith("tokens.txt") }, "tokens", id).absolutePath
    )
  }

  data class VitsFiles(val model: String, val tokens: String, val dataDir: String, val lexicon: String)

  fun vits(id: String): VitsFiles {
    val f = files(id)
    val model = pick(f.filter { it.name.endsWith(".onnx") }.sortedBy { if (it.name.contains("int8")) 1 else 0 }, ".onnx", id)
    val tokens = pick(f.filter { it.name == "tokens.txt" }, "tokens.txt", id)
    val espeak = dir(id).walkTopDown().firstOrNull { it.isDirectory && it.name == "espeak-ng-data" }
    val lexicon = f.firstOrNull { it.name == "lexicon.txt" }
    return VitsFiles(model.absolutePath, tokens.absolutePath, espeak?.absolutePath ?: "", lexicon?.absolutePath ?: "")
  }

  companion object {
    const val MANIFEST = "dubix-manifest.json"
  }
}
