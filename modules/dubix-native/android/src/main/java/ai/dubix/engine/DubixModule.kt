package ai.dubix.engine

import ai.dubix.engine.audio.AudioDecoder
import ai.dubix.engine.core.DeviceInfo
import ai.dubix.engine.core.DubixEvents
import ai.dubix.engine.core.Perf
import ai.dubix.engine.core.Wav
import ai.dubix.engine.live.LiveCaptureService
import ai.dubix.engine.ml.EngineHub
import ai.dubix.engine.ml.VoiceSpec
import ai.dubix.engine.models.ModelDownloader
import ai.dubix.engine.pipeline.DubbingJob
import ai.dubix.engine.player.DubPlaybackEngine
import ai.dubix.engine.player.DubixPlayerView
import ai.dubix.engine.player.PlayerManager
import android.app.Activity
import android.app.PictureInPictureParams
import android.util.Rational
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

class DubixModule : Module() {
  private val context: Context get() = requireNotNull(appContext.reactContext) { "React context unavailable" }
  private val sink = DubixEvents.Sink { name, body -> sendEvent(name, body) }
  private var pendingPick: Promise? = null
  private var pendingSubtitle: Promise? = null
  private var pendingLive: Pair<Promise, Pair<Map<String, Any?>, Boolean>>? = null
  private var preview: MediaPlayer? = null

  override fun definition() = ModuleDefinition {
    Name("DubixNative")
    Events(*DubixEvents.ALL)

    OnCreate {
      EngineHub.init(context)
      DubixEvents.attach(sink)
    }
    OnDestroy {
      DubixEvents.detach(sink)
      preview?.release(); preview = null
    }

    // ---------------- device & permissions ----------------

    Function("getDeviceInfo") { DeviceInfo.snapshot(context) }
    Function("canDrawOverlays") { Settings.canDrawOverlays(context) }
    Function("openOverlaySettings") {
      startSettings(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}")))
    }
    Function("openAppSettings") {
      startSettings(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
    }
    Function("getAudioRoute") { PlayerManager.currentRoute(context.getSystemService(AudioManager::class.java)) }
    Function("getPerfSnapshot") { Perf.snapshot() }
    Function("resetPerf") { Perf.reset() }

    // ---------------- media files ----------------

    AsyncFunction("pickVideo") { promise: Promise ->
      val activity = appContext.currentActivity ?: return@AsyncFunction promise.reject("no_activity", "No foreground activity", null)
      pendingPick?.resolve(null)
      pendingPick = promise
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("video/*")
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      activity.startActivityForResult(intent, REQ_PICK)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getMediaInfo") { uri: String -> mediaInfo(Uri.parse(uri)) }

    // ---------------- subtitles ----------------

    AsyncFunction("getSubtitleTracks") { uri: String ->
      ai.dubix.engine.pipeline.SubtitleExtractor.tracks(context, Uri.parse(uri)).map {
        mapOf("index" to it.index, "mime" to it.mime, "language" to it.language)
      }
    }
    /** Cues from an embedded track (`trackIndex`) or a subtitle file (`fileUri`: .srt / .vtt / .ass). */
    AsyncFunction("loadSubtitleCues") { videoUri: String?, trackIndex: Int?, fileUri: String? ->
      val cues = if (fileUri != null) {
        val text = context.contentResolver.openInputStream(Uri.parse(fileUri))?.use { input ->
          val bytes = input.readBytes()
          // Most subtitle files are UTF-8; fall back to Windows-1252 for older Latin files.
          runCatching { Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString() }
            .getOrElse { String(bytes, charset("windows-1252")) }
        } ?: error("Could not open the subtitle file")
        ai.dubix.engine.pipeline.SubtitleParser.parse(text)
      } else {
        ai.dubix.engine.pipeline.SubtitleExtractor.extract(context, Uri.parse(videoUri ?: error("No video")), trackIndex ?: error("No track"))
      }
      cues.map { mapOf("startMs" to it.startMs.toDouble(), "endMs" to it.endMs.toDouble(), "text" to it.text) }
    }
    AsyncFunction("pickSubtitleFile") { promise: Promise ->
      val activity = appContext.currentActivity ?: return@AsyncFunction promise.reject("no_activity", "No foreground activity", null)
      pendingSubtitle?.resolve(null)
      pendingSubtitle = promise
      // .srt/.vtt have no reliable MIME type on Android, so allow any file and validate on parse.
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
        .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/x-subrip", "text/vtt", "text/plain", "application/octet-stream", "*/*"))
      activity.startActivityForResult(intent, REQ_SUBTITLE)
    }.runOnQueue(Queues.MAIN)

    Function("releaseUri") { uri: String ->
      runCatching { context.contentResolver.releasePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION) }
      Unit
    }

    AsyncFunction("computeWaveform") { uri: String, startMs: Double, endMs: Double, buckets: Int ->
      AudioDecoder.envelope(context, Uri.parse(uri), startMs.toLong(), endMs.toLong(), buckets.coerceIn(8, 2000)).map { it.toDouble() }
    }

    AsyncFunction("dubWaveform") { segments: List<Map<String, Any?>>, startMs: Double, endMs: Double, buckets: Int ->
      val out = DoubleArray(buckets.coerceIn(8, 2000))
      val span = (endMs - startMs).coerceAtLeast(1.0)
      for (s in segments) {
        val path = s["path"] as? String ?: continue
        val segStart = (s["startMs"] as Number).toDouble()
        val audio = runCatching { Wav.read(File(path)) }.getOrNull() ?: continue
        val msPerSample = 1000.0 / audio.sampleRate
        for (i in audio.samples.indices step 8) {
          val t = segStart + i * msPerSample
          val b = ((t - startMs) / span * out.size).toInt()
          if (b in out.indices) out[b] = maxOf(out[b], kotlin.math.abs(audio.samples[i]).toDouble())
        }
      }
      out.toList()
    }

    // ---------------- model packs ----------------

    Function("getInstalledModels") { EngineHub.store.installed().map { jsonToMap(it) } }
    Function("getModelsSizeBytes") { EngineHub.store.totalSize().toDouble() }
    Function("downloadModel") { d: Map<String, Any?> ->
      EngineHub.downloader.enqueue(ModelDownloader.Descriptor(
        id = d["id"] as String, version = d["version"] as String, kind = d["kind"] as String,
        url = d["url"] as String, sha256 = d["sha256"] as? String, sizeBytes = (d["sizeBytes"] as Number).toLong(),
        archive = d["archive"] as? String ?: "none", fileName = d["fileName"] as? String,
        wifiOnly = d["wifiOnly"] as? Boolean ?: false
      ))
    }
    Function("cancelDownload") { id: String -> EngineHub.downloader.cancel(id) }
    AsyncFunction("deleteModel") { id: String ->
      EngineHub.releaseAll()
      EngineHub.store.delete(id)
    }

    AsyncFunction("getTranslationPacks") { EngineHub.translation.downloadedPacks() }
    AsyncFunction("downloadTranslationPack") { lang: String, wifiOnly: Boolean ->
      // "queued" until this pack's turn: ML Kit downloads run one at a time.
      DubixEvents.emit(DubixEvents.DOWNLOAD_PROGRESS, mapOf("id" to "mlkit-$lang", "state" to "queued", "bytes" to 0.0, "total" to 0.0))
      try {
        DubixEvents.emit(DubixEvents.DOWNLOAD_PROGRESS, mapOf("id" to "mlkit-$lang", "state" to "downloading", "bytes" to 0.0, "total" to 0.0))
        EngineHub.translation.downloadPack(lang, wifiOnly, isMetered())
        DubixEvents.emit(DubixEvents.DOWNLOAD_PROGRESS, mapOf("id" to "mlkit-$lang", "state" to "installed", "bytes" to 0.0, "total" to 0.0))
      } catch (e: Throwable) {
        android.util.Log.e("DubixMLKit", "downloadTranslationPack($lang) failed", e)
        // Engine errors are already user-friendly; anything unexpected gets its type and origin attached.
        val msg = if (e is IllegalStateException && e.cause != null) e.message
          else "${e.message ?: "Unknown error"} [${e.javaClass.simpleName} at ${e.stackTrace.firstOrNull()?.let { "${it.className.substringAfterLast('.')}.${it.methodName}" } ?: "?"}]"
        DubixEvents.emit(DubixEvents.DOWNLOAD_PROGRESS, mapOf("id" to "mlkit-$lang", "state" to "error", "bytes" to 0.0, "total" to 0.0, "error" to msg))
        throw IllegalStateException(msg, e)
      }
    }
    AsyncFunction("deleteTranslationPack") { lang: String -> EngineHub.translation.deletePack(lang) }
    AsyncFunction("getSystemVoices") { lang: String? -> EngineHub.tts().systemVoices(lang) }

    // ---------------- player + dub track (main thread) ----------------

    AsyncFunction("createPlayer") { uri: String -> PlayerManager.create(context, uri) }.runOnQueue(Queues.MAIN)
    AsyncFunction("releasePlayer") { id: String -> PlayerManager.release(id) }.runOnQueue(Queues.MAIN)
    AsyncFunction("play") { id: String -> PlayerManager.get(id).player.play() }.runOnQueue(Queues.MAIN)
    AsyncFunction("pause") { id: String -> PlayerManager.get(id).player.pause() }.runOnQueue(Queues.MAIN)
    AsyncFunction("seekTo") { id: String, ms: Double -> PlayerManager.get(id).player.seekTo(ms.toLong()) }.runOnQueue(Queues.MAIN)
    AsyncFunction("setDubSegments") { id: String, segs: List<Map<String, Any?>> ->
      PlayerManager.get(id).dub.setSegments(segs.mapNotNull(::toSeg))
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("addDubSegments") { id: String, segs: List<Map<String, Any?>> ->
      PlayerManager.get(id).dub.addSegments(segs.mapNotNull(::toSeg))
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("setDubConfig") { id: String, c: Map<String, Any?> ->
      PlayerManager.get(id).dub.setConfig(DubPlaybackEngine.Config(
        enabled = c["enabled"] as? Boolean ?: true,
        offsetMs = (c["offsetMs"] as? Number)?.toLong() ?: 0,
        dubVolume = (c["dubVolume"] as? Number)?.toFloat() ?: 1f,
        originalVolume = (c["originalVolume"] as? Number)?.toFloat() ?: 1f,
        duckWhileDubbing = c["duckWhileDubbing"] as? Boolean ?: true,
        duckLevel = (c["duckLevel"] as? Number)?.toFloat() ?: 0.6f
      ))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setPlaybackSpeed") { id: String, speed: Double ->
      PlayerManager.get(id).player.setPlaybackSpeed(speed.toFloat().coerceIn(0.5f, 2f))
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("getAudioTracks") { id: String -> PlayerManager.audioTracks(id) }.runOnQueue(Queues.MAIN)
    AsyncFunction("selectAudioTrack") { id: String, ordinal: Int -> PlayerManager.selectAudioTrack(id, ordinal) }.runOnQueue(Queues.MAIN)

    AsyncFunction("enterPictureInPicture") { width: Int, height: Int ->
      val activity = appContext.currentActivity ?: return@AsyncFunction false
      if (!context.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)) return@AsyncFunction false
      val ratio = Rational(width.coerceIn(100, 239 * 100), height.coerceIn(100, 239 * 100))
      runCatching { activity.enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(ratio).build()) }.getOrDefault(false)
    }.runOnQueue(Queues.MAIN)
    Function("isInPictureInPicture") { appContext.currentActivity?.isInPictureInPictureMode ?: false }

    View(DubixPlayerView::class) {
      Prop("playerId") { view: DubixPlayerView, id: String? -> view.setPlayerId(id) }
      Prop("resizeMode") { view: DubixPlayerView, mode: String? -> view.setResizeMode(mode) }
      OnViewDestroys { view: DubixPlayerView -> view.detach() }
    }

    // ---------------- offline dubbing job ----------------

    Function("getSessionsDir") { File(context.filesDir, "sessions").apply { mkdirs() }.absolutePath }

    Function("startDubbingJob") { p: Map<String, Any?> ->
      @Suppress("UNCHECKED_CAST")
      val voices = (p["voices"] as? Map<String, Map<String, Any?>> ?: emptyMap()).mapValues { VoiceSpec.from(it.value) }
      @Suppress("UNCHECKED_CAST")
      val voicePools = (p["voicePools"] as? Map<String, List<Map<String, Any?>>> ?: emptyMap()).mapValues { e -> e.value.map { VoiceSpec.from(it) } }
      @Suppress("UNCHECKED_CAST")
      val centroids = (p["speakerCentroids"] as? List<List<Number>>)?.map { c -> FloatArray(c.size) { c[it].toFloat() } } ?: emptyList()
      DubbingJob.Jobs.start(DubbingJob.Params(
        jobId = p["jobId"] as String, sessionId = p["sessionId"] as String, uri = p["uri"] as String,
        startMs = (p["startMs"] as? Number)?.toLong() ?: 0, durationMs = (p["durationMs"] as? Number)?.toLong() ?: 0,
        sourceLang = p["sourceLang"] as? String ?: "auto", translateTarget = p["translateTarget"] as String,
        vadModelId = p["vadModelId"] as String, asrModelId = p["asrModelId"] as String,
        speakerModelId = p["speakerModelId"] as? String, maxSpeakers = (p["maxSpeakers"] as? Number)?.toInt() ?: 6,
        voices = voices, voicePools = voicePools, userSpeed = (p["userSpeed"] as? Number)?.toFloat() ?: 1f,
        maxSpeed = (p["maxSpeed"] as? Number)?.toFloat() ?: 1.25f, maxPauseSec = (p["maxPauseSec"] as? Number)?.toFloat() ?: 0.3f,
        outDir = sessionDir(p["sessionId"] as String).absolutePath, speakerCentroids = centroids,
        maxLeadMs = (p["maxLeadMs"] as? Number)?.toLong() ?: 0, spillMs = (p["spillMs"] as? Number)?.toLong() ?: 300,
        audioTrack = (p["audioTrack"] as? Number)?.toInt() ?: 0,
        cues = (p["cues"] as? List<*>)?.mapNotNull { c ->
          (c as? Map<*, *>)?.let { m ->
            ai.dubix.engine.pipeline.Cue((m["startMs"] as Number).toLong(), (m["endMs"] as Number).toLong(), m["text"] as String)
          }
        } ?: emptyList()
      ))
    }
    Function("setJobPlayhead") { id: String, ms: Double -> DubbingJob.Jobs.get(id)?.playheadMs = ms.toLong() }
    Function("pauseJob") { id: String -> DubbingJob.Jobs.get(id)?.pause() }
    Function("resumeJob") { id: String -> DubbingJob.Jobs.get(id)?.resume() }
    Function("cancelJob") { id: String -> DubbingJob.Jobs.get(id)?.cancel() }

    AsyncFunction("synthesize") { p: Map<String, Any?> ->
      @Suppress("UNCHECKED_CAST")
      val voice = VoiceSpec.from(p["voice"] as Map<String, Any?>)
      val out = p["outPath"] as? String
      val file = if (out != null) File(out).also { requireInside(it) } else File(context.cacheDir, "preview.wav")
      val r = DubbingJob.synthesizeFitted(
        EngineHub.tts(), p["text"] as String, voice, (p["windowMs"] as? Number)?.toLong() ?: 0,
        (p["userSpeed"] as? Number)?.toFloat() ?: voice.speed, (p["maxSpeed"] as? Number)?.toFloat() ?: 1.25f,
        (p["maxPauseSec"] as? Number)?.toFloat() ?: 0.3f, file, (p["spillMs"] as? Number)?.toLong() ?: 300
      )
      mapOf("path" to file.absolutePath, "durationMs" to r.durationMs.toDouble(), "speed" to r.speed.toDouble(), "overflowMs" to r.overflowMs.toDouble())
    }

    AsyncFunction("playPreview") { path: String ->
      preview?.release()
      preview = MediaPlayer().apply {
        setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .apply { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_SYSTEM) }.build())
        setDataSource(path); prepare(); start()
      }
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("stopPreview") { preview?.release(); preview = null }.runOnQueue(Queues.MAIN)

    Function("deleteSessionFiles") { sessionId: String -> sessionDir(sessionId).deleteRecursively() }
    Function("getSessionStorage") {
      File(context.filesDir, "sessions").listFiles()?.filter { it.isDirectory }?.associate { d ->
        d.name to d.walkBottomUp().filter { it.isFile }.sumOf { it.length() }.toDouble()
      } ?: emptyMap<String, Double>()
    }
    Function("purgeSessionFiles") { keep: List<String> ->
      val keepSet = keep.toSet()
      File(context.filesDir, "sessions").listFiles()?.filter { it.isDirectory && it.name !in keepSet }?.forEach { it.deleteRecursively() }
      File(context.cacheDir, "thumbs").listFiles()?.filter { f -> keepSet.none { f.name.startsWith(it) } && f.lastModified() < System.currentTimeMillis() - 7 * 86_400_000L }?.forEach { it.delete() }
    }
    Function("releaseEngines") { if (DubbingJob.Jobs.isIdle() && LiveCaptureService.instance == null) EngineHub.releaseAll() }

    // ---------------- live translator / external capture ----------------

    AsyncFunction("startLiveSession") { config: Map<String, Any?>, overlay: Boolean, promise: Promise ->
      if (config["source"] == "playback" || config["source"] == "screen") {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return@AsyncFunction promise.reject("unsupported", "Audio playback capture requires Android 10+", null)
        val activity = appContext.currentActivity ?: return@AsyncFunction promise.reject("no_activity", "No foreground activity", null)
        pendingLive?.first?.resolve("cancelled")
        pendingLive = promise to (config to overlay)
        val mpm = activity.getSystemService(MediaProjectionManager::class.java)
        activity.startActivityForResult(mpm.createScreenCaptureIntent(), REQ_PROJECTION)
      } else {
        LiveCaptureService.command(context, LiveCaptureService.ACTION_START) {
          putExtra(LiveCaptureService.EXTRA_CONFIG, JSONObject(config).toString())
          putExtra(LiveCaptureService.EXTRA_OVERLAY, overlay)
        }
        promise.resolve("started")
      }
    }.runOnQueue(Queues.MAIN)

    Function("stopLiveSession") { liveCommand(LiveCaptureService.ACTION_STOP) }
    Function("pauseLiveSession") { liveCommand(LiveCaptureService.ACTION_PAUSE) }
    Function("resumeLiveSession") { liveCommand(LiveCaptureService.ACTION_RESUME) }
    Function("setLiveOptions") { speak: Boolean?, captions: Boolean? -> LiveCaptureService.instance?.setOptions(speak, captions); Unit }
    AsyncFunction("setFloatingControllerVisible") { visible: Boolean ->
      LiveCaptureService.instance?.setOverlayVisible(visible) ?: DubixEvents.warning("live_inactive", "Start live translation first to show the floating controller.")
      Unit
    }.runOnQueue(Queues.MAIN)
    Function("getLiveState") { DubixEvents.lastLiveState }

    OnActivityResult { _, payload ->
      when (payload.requestCode) {
        REQ_PICK -> {
          val promise = pendingPick ?: return@OnActivityResult
          pendingPick = null
          val uri = payload.data?.data
          if (payload.resultCode != Activity.RESULT_OK || uri == null) { promise.resolve(null); return@OnActivityResult }
          runCatching { context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
          promise.resolve(describe(uri))
        }
        REQ_SUBTITLE -> {
          val promise = pendingSubtitle ?: return@OnActivityResult
          pendingSubtitle = null
          val uri = payload.data?.data
          if (payload.resultCode != Activity.RESULT_OK || uri == null) { promise.resolve(null); return@OnActivityResult }
          runCatching { context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
          promise.resolve(describe(uri))
        }
        REQ_PROJECTION -> {
          val (promise, args) = pendingLive ?: return@OnActivityResult
          pendingLive = null
          val data = payload.data
          if (payload.resultCode != Activity.RESULT_OK || data == null) { promise.resolve("consent_denied"); return@OnActivityResult }
          LiveCaptureService.command(context, LiveCaptureService.ACTION_START) {
            putExtra(LiveCaptureService.EXTRA_CONFIG, JSONObject(args.first).toString())
            putExtra(LiveCaptureService.EXTRA_OVERLAY, args.second)
            putExtra(LiveCaptureService.EXTRA_PROJECTION_CODE, payload.resultCode)
            putExtra(LiveCaptureService.EXTRA_PROJECTION_DATA, data)
          }
          promise.resolve("started")
        }
      }
    }
  }

  // ---------------- helpers ----------------

  private fun liveCommand(action: String) {
    if (LiveCaptureService.instance == null) return
    runCatching { LiveCaptureService.command(context, action) }
  }

  /** True on mobile data / metered networks (or no network). */
  private fun isMetered(): Boolean {
    val cm = context.getSystemService(android.net.ConnectivityManager::class.java) ?: return true
    val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return true
    return !caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
  }

  private fun startSettings(intent: Intent) {
    val activity = appContext.currentActivity
    if (activity != null) activity.startActivity(intent) else context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  private fun sessionDir(id: String): File {
    require(id.matches(Regex("[a-zA-Z0-9_-]+"))) { "Invalid session id" }
    return File(File(context.filesDir, "sessions"), id)
  }

  private fun requireInside(f: File) {
    val roots = listOf(File(context.filesDir, "sessions").canonicalPath, context.cacheDir.canonicalPath)
    require(roots.any { f.canonicalPath.startsWith(it + File.separator) }) { "Output path outside app storage" }
  }

  private fun toSeg(m: Map<String, Any?>): DubPlaybackEngine.Seg? {
    val path = m["path"] as? String ?: return null
    return DubPlaybackEngine.Seg(m["id"] as String, (m["startMs"] as Number).toLong(), (m["endMs"] as Number).toLong(), path)
  }

  private fun describe(uri: Uri): Map<String, Any?> {
    var name: String? = null
    var size = 0L
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
      if (c.moveToFirst()) { name = c.getString(0); size = if (c.isNull(1)) 0 else c.getLong(1) }
    }
    return mapOf("uri" to uri.toString(), "name" to (name ?: uri.lastPathSegment ?: "Video"), "size" to size.toDouble(),
      "mimeType" to context.contentResolver.getType(uri))
  }

  private fun mediaInfo(uri: Uri): Map<String, Any?> {
    val r = MediaMetadataRetriever()
    try {
      r.setDataSource(context, uri)
      val duration = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      val thumbs = File(context.cacheDir, "thumbs").apply { mkdirs() }
      val thumb = File(thumbs, "${uri.toString().hashCode().toUInt()}.jpg")
      if (!thumb.exists()) {
        r.getFrameAtTime(minOf(duration / 10, 60_000L) * 1000, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)?.let { bmp ->
          val w = 480; val h = (bmp.height * w / bmp.width.coerceAtLeast(1)).coerceAtLeast(1)
          FileOutputStream(thumb).use { Bitmap.createScaledBitmap(bmp, w, h, true).compress(Bitmap.CompressFormat.JPEG, 82, it) }
        }
      }
      var audioMime: String? = null; var sampleRate = 0; var channels = 0; var audioTracks = 0
      runCatching {
        val ex = MediaExtractor(); ex.setDataSource(context, uri, null)
        for (i in 0 until ex.trackCount) {
          val f = ex.getTrackFormat(i)
          val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
          if (mime.startsWith("audio/")) {
            audioTracks++
            if (audioMime == null) {
              audioMime = mime; sampleRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE); channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            }
          }
        }
        ex.release()
      }
      return describe(uri) + mapOf(
        "durationMs" to duration.toDouble(),
        "title" to r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE),
        "width" to (r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0),
        "height" to (r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0),
        "hasAudio" to (audioTracks > 0), "audioTracks" to audioTracks,
        "audioMime" to audioMime, "sampleRate" to sampleRate, "channels" to channels,
        "thumbnail" to if (thumb.exists()) "file://${thumb.absolutePath}" else null
      )
    } finally {
      r.release()
    }
  }

  private fun jsonToMap(o: JSONObject): Map<String, Any?> = o.keys().asSequence().associateWith { k ->
    when (val v = o.get(k)) { JSONObject.NULL -> null; is Number -> v.toDouble(); else -> v }
  }

  companion object {
    private const val REQ_PICK = 41071
    private const val REQ_PROJECTION = 41072
    private const val REQ_SUBTITLE = 41073
  }
}
