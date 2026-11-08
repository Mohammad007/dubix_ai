package ai.dubix.engine.live

import ai.dubix.engine.core.DubixEvents
import ai.dubix.engine.core.Perf
import ai.dubix.engine.ml.EngineHub
import ai.dubix.engine.ml.LanguageDetector
import ai.dubix.engine.ml.TranslationEngine
import ai.dubix.engine.ml.TtsEngine
import ai.dubix.engine.pipeline.GenderHint
import ai.dubix.engine.pipeline.SubtitleParser
import ai.dubix.engine.pipeline.TextNormalizer
import android.content.Context
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.pow

/**
 * Reads subtitles that another app shows on screen (with the user's screen-capture consent),
 * translates them and speaks them. No audio capture is needed, so it works even when the
 * other app's volume is low, and timing follows the subtitles as they appear.
 *
 * Only works for apps that allow screen capture: protected (DRM / FLAG_SECURE) content is
 * captured as black by Android. That is detected and reported, never bypassed.
 */
class SubtitleOcrSession(
  private val context: Context,
  private val projection: MediaProjection,
  private val cfg: LiveSession.Config,
  private val listener: LiveSession.Listener,
  /** Optional: the app's audio, used only to estimate each speaker's voice gender. */
  private val pitch: VoicePitchTracker? = null
) : LiveEngine {
  @Volatile private var running = false
  @Volatile override var paused = false; private set
  private val thread = HandlerThread("dubix-ocr").apply { start() }
  private val handler = Handler(thread.looper)
  private val speakThread = HandlerThread("dubix-ocr-speak").apply { start() }
  private val speakHandler = Handler(speakThread.looper)
  private var display: VirtualDisplay? = null
  private var reader: ImageReader? = null
  private var width = 0
  private var height = 0

  private val latin: TextRecognizer by lazy { TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS) }
  private val devanagari: TextRecognizer by lazy { TextRecognition.getClient(DevanagariTextRecognizerOptions.Builder().build()) }

  private var candidate = ""
  private var candidateSeen = 0
  private var candidateSince = 0L
  private var candidateRaw = ""
  private var lastGender: String? = null
  private var lastGenderAt = 0L
  private var lastSpoken = ""
  private var blackSinceMs = 0L
  private var noTextSinceMs = SystemClock.elapsedRealtime()
  private var reportedState = ""
  private val speakGeneration = AtomicLong(0)
  private var latencyEma = 0.0

  private val out: AudioTrack = AudioTrack.Builder()
    .setAudioAttributes(AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .apply { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_SYSTEM) }
      .build())
    .setAudioFormat(AudioFormat.Builder().setSampleRate(TtsEngine.OUTPUT_RATE).setEncoding(AudioFormat.ENCODING_PCM_FLOAT)
      .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
    .setBufferSizeInBytes(AudioTrack.getMinBufferSize(TtsEngine.OUTPUT_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_FLOAT) * 2)
    .setTransferMode(AudioTrack.MODE_STREAM)
    .build()

  override fun config() = cfg

  override fun start() {
    running = true
    val metrics = context.resources.displayMetrics
    // Movies are watched in landscape: capture a landscape-shaped, downscaled mirror (~720p).
    val longSide = maxOf(metrics.widthPixels, metrics.heightPixels)
    val shortSide = minOf(metrics.widthPixels, metrics.heightPixels)
    val scale = minOf(1f, 1280f / longSide)
    createDisplay((longSide * scale).toInt(), (shortSide * scale).toInt(), metrics.densityDpi)
    if (Build.VERSION.SDK_INT >= 34) {
      projection.registerCallback(object : MediaProjection.Callback() {
        override fun onCapturedContentResize(w: Int, h: Int) {
          handler.post {
            val s = minOf(1f, 1280f / maxOf(w, h))
            createDisplay((w * s).toInt().coerceAtLeast(2), (h * s).toInt().coerceAtLeast(2), metrics.densityDpi)
          }
        }
      }, handler)
    }
    pitch?.start()
    listener.onState("listening", "Reading on-screen subtitles")
    handler.postDelayed(tick, FRAME_MS)
  }

  private fun createDisplay(w: Int, h: Int, dpi: Int) {
    width = w; height = h
    val r = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 2)
    reader?.close()
    reader = r
    val d = display
    if (d == null) {
      display = projection.createVirtualDisplay("dubix-subtitles", w, h, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, handler)
    } else {
      d.resize(w, h, dpi)
      d.surface = r.surface
    }
  }

  private val tick = object : Runnable {
    override fun run() {
      if (!running) return
      if (!paused) runCatching { process() }.onFailure { Log.w(TAG, "frame failed", it) }
      handler.postDelayed(this, FRAME_MS)
    }
  }

  private fun process() {
    val image = reader?.acquireLatestImage() ?: return
    val bitmap = try {
      val plane = image.planes[0]
      val rowPadding = plane.rowStride - plane.pixelStride * image.width
      val full = Bitmap.createBitmap(image.width + rowPadding / plane.pixelStride, image.height, Bitmap.Config.ARGB_8888)
      full.copyPixelsFromBuffer(plane.buffer)
      // Subtitles live in the lower part of the frame.
      val top = (image.height * (1f - REGION)).toInt()
      Bitmap.createBitmap(full, 0, top, image.width, image.height - top).also { if (it !== full) full.recycle() }
    } finally {
      image.close()
    }
    val now = SystemClock.elapsedRealtime()

    if (isBlack(bitmap)) {
      if (blackSinceMs == 0L) blackSinceMs = now
      if (now - blackSinceMs > 3_000) report("screen_blocked")
      bitmap.recycle()
      return
    }
    blackSinceMs = 0L

    val (raw, text) = Perf.trace("ocr") { recognize(bitmap) }
    bitmap.recycle()
    if (text.isEmpty()) {
      if (now - noTextSinceMs > 20_000) report("no_subtitles")
      candidate = ""; candidateSeen = 0
      return
    }
    noTextSinceMs = now
    report("listening")

    // Stabilise: act when the same text is read on two consecutive frames (~200 ms), which
    // ignores half-faded or animating lines while keeping latency low.
    if (similar(text, candidate)) candidateSeen++ else { candidate = text; candidateRaw = raw; candidateSeen = 1; candidateSince = now }
    if (candidateSeen != STABLE_FRAMES) return
    if (similar(text, lastSpoken)) return
    lastSpoken = text
    onNewLine(text, candidateRaw, candidateSince, now)
  }

  /** Raw recognised lines (kept for speaker cues such as "[WOMAN]") and the cleaned dialogue. */
  private fun recognize(bitmap: Bitmap): Pair<String, String> {
    val image = InputImage.fromBitmap(bitmap, 0)
    val recognizer = if (cfg.sourceLang in DEVANAGARI_LANGS) devanagari else latin
    val result = Tasks.await(recognizer.process(image), 3, TimeUnit.SECONDS)
    // Keep reasonably sized lines (subtitle text), top to bottom; drop tiny UI labels.
    val minHeight = height * 0.025f
    val lines = result.textBlocks.flatMap { it.lines }
      .filter { (it.boundingBox?.height() ?: 0) >= minHeight && it.text.length >= 2 }
      .sortedBy { it.boundingBox?.top ?: 0 }
      .map { it.text }
    val raw = lines.joinToString("\n")
    return raw to SubtitleParser.clean(raw)
  }

  private fun onNewLine(text: String, raw: String, firstSeenAt: Long, seenAt: Long) {
    val gen = speakGeneration.incrementAndGet()
    speakHandler.post {
      try {
        if (gen != speakGeneration.get() || !running) return@post
        val src = if (cfg.sourceLang == "auto") (LanguageDetector.detect(text) ?: "en") else cfg.sourceLang
        val translated = TextNormalizer.punctuateForTarget(EngineHub.translation.translate(text, src, cfg.translateTarget), cfg.translateTarget)
        val latency = (SystemClock.elapsedRealtime() - seenAt).toDouble()
        latencyEma = if (latencyEma == 0.0) latency else latencyEma * 0.7 + latency * 0.3
        DubixEvents.emit(DubixEvents.LIVE_SEGMENT, mapOf(
          "id" to "ocr_$seenAt", "atMs" to seenAt.toDouble(), "sourceText" to text, "sourceLang" to src,
          "translatedText" to translated, "latencyMs" to latency, "avgLatencyMs" to latencyEma, "droppedAudio" to 0
        ))
        if (cfg.captions) listener.onCaption(text, translated)
        val voice = pickVoice(raw, firstSeenAt)
        if (cfg.speak && voice != null && gen == speakGeneration.get()) speak(translated, voice.copy(speed = voice.speed * 1.1f), gen)
      } catch (e: TranslationEngine.PackMissingException) {
        listener.onState("error", e.message)
      } catch (e: Throwable) {
        DubixEvents.warning("live_segment_failed", e.message ?: "line failed")
      }
    }
  }

  /**
   * Gender-matched voice: pitch of the dialogue heard since the line appeared (about speech onset),
   * else explicit subtitle cues, else the previous speaker for a few seconds, else the default.
   * A voice chosen manually by the user (no pools sent) always wins.
   */
  private fun pickVoice(raw: String, firstSeenAt: Long): ai.dubix.engine.ml.VoiceSpec? {
    if (cfg.voicePools.isEmpty()) return cfg.voice
    val now = SystemClock.elapsedRealtime()
    val f0 = pitch?.f0Between(firstSeenAt - 300, now)
    val gender = GenderHint.genderOf(f0) ?: GenderHint.fromText(raw) ?: lastGender?.takeIf { now - lastGenderAt < 4_000 }
    if (gender == null) return cfg.voice
    lastGender = gender; lastGenderAt = now
    return GenderHint.voiceFor(gender, f0, cfg.voicePools) ?: cfg.voice
  }

  /** Newest subtitle wins: a newer line interrupts the current one so speech stays in sync. */
  private fun speak(text: String, voice: ai.dubix.engine.ml.VoiceSpec, gen: Long) {
    val audio = EngineHub.tts().synthesize(text, voice)
    if (audio.isEmpty() || gen != speakGeneration.get()) return
    applyGain(audio, cfg.voiceGainDb)
    runCatching { out.pause(); out.flush() }
    out.play()
    var i = 0
    val chunk = TtsEngine.OUTPUT_RATE / 50
    while (i < audio.size && running && !paused && cfg.speak && gen == speakGeneration.get()) {
      val w = out.write(audio, i, minOf(chunk, audio.size - i), AudioTrack.WRITE_BLOCKING)
      if (w <= 0) break
      i += w
    }
  }

  private fun report(state: String) {
    if (state == reportedState) return
    reportedState = state
    listener.onState(state, null)
  }

  /** Mean luminance of a coarse grid; protected content arrives as solid black. */
  private fun isBlack(b: Bitmap): Boolean {
    var sum = 0L; var n = 0
    val stepX = maxOf(1, b.width / 32); val stepY = maxOf(1, b.height / 8)
    var y = 0
    while (y < b.height) {
      var x = 0
      while (x < b.width) {
        val c = b.getPixel(x, y)
        sum += ((c shr 16 and 0xff) + (c shr 8 and 0xff) + (c and 0xff)) / 3; n++
        x += stepX
      }
      y += stepY
    }
    return n > 0 && sum / n < 3
  }

  override fun setPaused(p: Boolean) {
    paused = p
    speakGeneration.incrementAndGet()
    if (p) runCatching { out.pause(); out.flush() }
    listener.onState(if (p) "paused" else "listening", null)
  }

  override fun setSpeak(on: Boolean) { cfg.speak = on; if (!on) { speakGeneration.incrementAndGet(); runCatching { out.pause(); out.flush() } } }
  override fun setCaptions(on: Boolean) { cfg.captions = on }

  override fun stop() {
    running = false
    speakGeneration.incrementAndGet()
    handler.removeCallbacksAndMessages(null)
    runCatching { pitch?.stop() }
    display?.release(); display = null
    reader?.close(); reader = null
    runCatching { latin.close() }
    runCatching { devanagari.close() }
    runCatching { out.stop() }
    out.release()
    thread.quitSafely(); speakThread.quitSafely()
  }

  companion object {
    private const val TAG = "DubixOCR"
    private const val FRAME_MS = 200L
    private const val STABLE_FRAMES = 2
    private const val REGION = 0.38f
    private val DEVANAGARI_LANGS = setOf("hi", "mr", "ne")

    /** Normalised comparison so OCR jitter (spacing, punctuation, case) does not re-trigger a line. */
    fun similar(a: String, b: String): Boolean {
      if (a.isEmpty() || b.isEmpty()) return false
      val x = a.lowercase().filter { it.isLetterOrDigit() }
      val y = b.lowercase().filter { it.isLetterOrDigit() }
      if (x == y) return true
      val longer = maxOf(x.length, y.length)
      if (longer == 0) return true
      return levenshtein(x, y).toFloat() / longer < 0.15f
    }

    private fun levenshtein(a: String, b: String): Int {
      var prev = IntArray(b.length + 1) { it }
      for (i in 1..a.length) {
        val cur = IntArray(b.length + 1); cur[0] = i
        for (j in 1..b.length) cur[j] = minOf(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
        prev = cur
      }
      return prev[b.length]
    }

    /** Digital voice boost with a soft limiter (keeps the translated voice audible over low-volume apps). */
    fun applyGain(x: FloatArray, gainDb: Float) {
      if (gainDb <= 0f) return
      val g = 10f.pow(gainDb / 20f)
      for (i in x.indices) {
        val v = x[i] * g
        x[i] = if (v > 0.9f) 0.9f + (1f - 0.9f) * kotlin.math.tanh((v - 0.9f) / 0.1f)
          else if (v < -0.9f) -0.9f - (1f - 0.9f) * kotlin.math.tanh((-v - 0.9f) / 0.1f) else v
      }
    }
  }
}
