package ai.dubix.engine.models

import ai.dubix.engine.core.DubixEvents
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.StatFs
import android.os.SystemClock
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Downloads model packs once, with HTTP range resume, SHA-256 verification (when the catalog
 * provides a digest), free-space checks, safe tar.bz2 extraction and atomic install.
 * Downloads are serialized on one worker thread.
 */
class ModelDownloader(private val context: Context, private val store: ModelStore) {
  data class Descriptor(
    val id: String,
    val version: String,
    val kind: String,
    val url: String,
    val sha256: String?,
    val sizeBytes: Long,
    val archive: String, // "tar.bz2" | "none"
    val fileName: String?,
    val wifiOnly: Boolean
  )

  private val executor = Executors.newSingleThreadExecutor { r -> Thread(r, "dubix-download").apply { priority = Thread.MIN_PRIORITY } }
  private val cancelled = ConcurrentHashMap<String, AtomicBoolean>()
  private val tmpRoot = File(context.cacheDir, "model-downloads").apply { mkdirs() }

  fun enqueue(d: Descriptor) {
    if (cancelled.containsKey(d.id)) return // already queued
    val flag = AtomicBoolean(false)
    cancelled[d.id] = flag
    emit(d.id, "queued", 0, d.sizeBytes)
    executor.execute {
      try {
        run(d, flag)
      } catch (e: CancelledException) {
        emit(d.id, "cancelled", 0, d.sizeBytes)
      } catch (e: Throwable) {
        emit(d.id, "error", 0, d.sizeBytes, e.message ?: e.javaClass.simpleName)
      } finally {
        cancelled.remove(d.id)
      }
    }
  }

  fun cancel(id: String) { cancelled[id]?.set(true) }

  private class CancelledException : IOException("cancelled")

  private fun run(d: Descriptor, cancel: AtomicBoolean) {
    if (d.wifiOnly && isMetered()) {
      throw IOException("“Download on Wi-Fi only” is on and this device is on mobile data. Connect to Wi-Fi or turn that setting off in Offline AI Models.")
    }
    val needed = if (d.archive == "none") d.sizeBytes else (d.sizeBytes * 3.2).toLong()
    val free = StatFs(context.filesDir.path).availableBytes
    if (free < needed + 200L * 1024 * 1024) {
      throw IOException("Not enough free storage: needs ~${needed / 1_048_576} MB, ${free / 1_048_576} MB free")
    }

    val part = File(tmpRoot, "${d.id}.part")
    val digest = MessageDigest.getInstance("SHA-256")
    var have = 0L
    if (part.isFile) {
      FileInputStream(part).use { input ->
        val buf = ByteArray(1 shl 16)
        while (true) { val n = input.read(buf); if (n < 0) break; digest.update(buf, 0, n); have += n }
      }
    }

    val conn = (URL(d.url).openConnection() as HttpURLConnection).apply {
      connectTimeout = 20_000; readTimeout = 30_000; instanceFollowRedirects = true
      if (have > 0) setRequestProperty("Range", "bytes=$have-")
    }
    val code = conn.responseCode
    if (code == 200 && have > 0) { // server ignored the range: restart
      part.delete(); digest.reset(); have = 0
    } else if (code != 200 && code != 206) {
      conn.disconnect()
      throw IOException("Download failed: HTTP $code")
    }
    val total = if (code == 206) have + conn.contentLengthLong else conn.contentLengthLong.takeIf { it > 0 } ?: d.sizeBytes

    var lastEmit = 0L
    conn.inputStream.use { input ->
      FileOutputStream(part, have > 0).use { out ->
        val buf = ByteArray(1 shl 16)
        while (true) {
          if (cancel.get()) throw CancelledException()
          val n = input.read(buf)
          if (n < 0) break
          out.write(buf, 0, n); digest.update(buf, 0, n); have += n
          val now = SystemClock.elapsedRealtime()
          if (now - lastEmit > 300) { emit(d.id, "downloading", have, total); lastEmit = now }
        }
      }
    }
    conn.disconnect()

    val actual = digest.digest().joinToString("") { "%02x".format(it) }
    val expected = d.sha256?.removePrefix("sha256:")?.lowercase()
    if (expected != null && expected.isNotEmpty() && expected != actual) {
      part.delete()
      throw IOException("Checksum mismatch: the downloaded file is corrupted or was modified")
    }

    emit(d.id, "installing", have, total)
    val staging = File(store.root, ".${d.id}.staging").apply { deleteRecursively(); mkdirs() }
    try {
      if (d.archive == "tar.bz2") extractTarBz2(part, staging, cancel)
      else part.copyTo(File(staging, d.fileName ?: "${d.id}.onnx"), overwrite = true)

      val target = store.dir(d.id)
      target.deleteRecursively()
      if (!staging.renameTo(target)) throw IOException("Could not move model into place")
      store.writeManifest(d.id, JSONObject().apply {
        put("id", d.id); put("version", d.version); put("kind", d.kind)
        put("installedAt", System.currentTimeMillis())
        put("sha256", actual); put("verified", expected != null && expected.isNotEmpty())
        put("sizeOnDisk", store.sizeOnDisk(d.id)); put("sourceUrl", d.url)
      })
    } finally {
      staging.deleteRecursively()
      part.delete()
    }
    emit(d.id, "installed", have, total)
  }

  private fun extractTarBz2(archive: File, dest: File, cancel: AtomicBoolean) {
    val destPath = dest.canonicalPath + File.separator
    TarArchiveInputStream(BZip2CompressorInputStream(FileInputStream(archive).buffered(1 shl 16))).use { tar ->
      while (true) {
        if (cancel.get()) throw CancelledException()
        val entry = tar.nextEntry ?: break
        val out = File(dest, entry.name)
        if (!out.canonicalPath.startsWith(destPath)) throw IOException("Unsafe path in archive: ${entry.name}")
        if (entry.isDirectory) { out.mkdirs(); continue }
        if (entry.isSymbolicLink || entry.isLink) continue
        out.parentFile?.mkdirs()
        FileOutputStream(out).use { tar.copyTo(it, 1 shl 16) }
      }
    }
  }

  private fun isMetered(): Boolean {
    val cm = context.getSystemService(ConnectivityManager::class.java) ?: return true
    val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return true
    return !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
  }

  private fun emit(id: String, state: String, bytes: Long, total: Long, error: String? = null) {
    DubixEvents.emit(DubixEvents.DOWNLOAD_PROGRESS, mapOf(
      "id" to id, "state" to state, "bytes" to bytes.toDouble(), "total" to total.toDouble(), "error" to error
    ))
  }
}
