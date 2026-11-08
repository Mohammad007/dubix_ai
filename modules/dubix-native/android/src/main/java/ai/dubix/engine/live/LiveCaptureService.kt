package ai.dubix.engine.live

import ai.dubix.engine.core.DubixEvents
import ai.dubix.engine.ml.EngineHub
import ai.dubix.engine.ml.MODEL_SAMPLE_RATE
import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Process
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Foreground service hosting a [LiveSession]. Required so capture continues while another app
 * is in front. For playback capture, the MediaProjection consent result is passed in and the
 * service is promoted with the mediaProjection type *before* the projection is obtained,
 * as Android 14+ requires.
 */
class LiveCaptureService : Service(), LiveSession.Listener {
  private var session: LiveEngine? = null
  private var projection: MediaProjection? = null
  private var overlay: FloatingController? = null
  private var state = "idle"
  private var stateMessage: String? = null
  private val main = Handler(Looper.getMainLooper())

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    EngineHub.init(this)
    instance = this
    when (intent?.action) {
      ACTION_START -> start(intent)
      ACTION_PAUSE -> session?.setPaused(true)
      ACTION_RESUME -> session?.setPaused(false)
      ACTION_STOP -> { shutdown("stopped"); return START_NOT_STICKY }
      ACTION_OVERLAY -> setOverlayVisible(intent.getBooleanExtra(EXTRA_VISIBLE, true))
    }
    return START_NOT_STICKY // never auto-restart: capture always needs fresh user consent
  }

  @SuppressLint("MissingPermission")
  private fun start(intent: Intent) {
    if (session != null) shutdownSession()
    val cfg = LiveSession.Config.from(JSONObject(intent.getStringExtra(EXTRA_CONFIG) ?: "{}"))
    val screen = cfg.source == "screen"
    // Reading on-screen subtitles needs no audio capture, so no microphone permission.
    if (!screen && ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      onState("error", "Microphone permission is required for live translation and audio capture.")
      stopSelf(); return
    }
    val projected = cfg.source == "playback" || screen
    val type = if (projected) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(cfg), type)
    } catch (e: Exception) {
      onState("error", "Android did not allow the capture service to start: ${e.message}")
      stopSelf(); return
    }

    val engine: LiveEngine = try {
      if (projected) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) error("Capturing other apps requires Android 10 or newer")
        @Suppress("DEPRECATION")
        val data: Intent = intent.getParcelableExtra(EXTRA_PROJECTION_DATA) ?: error("Missing screen-capture consent")
        val mpm = getSystemService(MediaProjectionManager::class.java)
        val mp = mpm.getMediaProjection(intent.getIntExtra(EXTRA_PROJECTION_CODE, 0), data) ?: error("Capture consent was not granted")
        mp.registerCallback(object : MediaProjection.Callback() {
          override fun onStop() { main.post { if (session != null) { onState("projection_stopped", "Capture permission was revoked or ended."); shutdown(null) } } }
        }, main)
        projection = mp
        if (screen) {
          // Voice-gender detection listens to the app's audio; Android requires the microphone
          // permission for any capture. Without it, subtitles still work with cue-based voices.
          val canHear = cfg.voicePools.isNotEmpty() &&
            checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED
          val tracker = if (canHear) runCatching { VoicePitchTracker(playbackRecord(mp), MODEL_SAMPLE_RATE) }.getOrNull() else null
          SubtitleOcrSession(this, mp, cfg, this, tracker)
        } else LiveSession(playbackRecord(mp), cfg, this)
      } else LiveSession(LiveSession.micRecord(), cfg, this)
    } catch (e: Throwable) {
      onState("error", e.message ?: "Could not start capture"); shutdown(null); return
    }

    session = engine.also { it.start() }
    if (Settings.canDrawOverlays(this) && intent.getBooleanExtra(EXTRA_OVERLAY, false)) setOverlayVisible(true)
  }

  @SuppressLint("MissingPermission")
  private fun playbackRecord(mp: MediaProjection): AudioRecord {
    val capture = AudioPlaybackCaptureConfiguration.Builder(mp)
      .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
      .addMatchingUsage(AudioAttributes.USAGE_GAME)
      .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
      .excludeUid(Process.myUid()) // never capture our own synthesized speech
      .build()
    return AudioRecord.Builder()
      .setAudioPlaybackCaptureConfig(capture)
      .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(MODEL_SAMPLE_RATE)
        .setChannelMask(AudioFormat.CHANNEL_IN_MONO).build())
      .setBufferSizeInBytes(MODEL_SAMPLE_RATE * 2)
      .build()
  }

  fun setOverlayVisible(visible: Boolean) {
    if (visible) {
      if (!Settings.canDrawOverlays(this)) { DubixEvents.warning("overlay_denied", "Allow 'Display over other apps' to use the floating controller."); return }
      val s = session ?: return
      if (overlay == null) overlay = FloatingController(this, s.config(), object : FloatingController.Actions {
        override fun togglePause() { session?.let { it.setPaused(!it.paused) } }
        override fun setCaptions(on: Boolean) { session?.setCaptions(on) }
        override fun setSpeak(on: Boolean) { session?.setSpeak(on) }
        override fun close() { shutdown("stopped") }
      }).also { it.show() }
      overlay?.setState(state, stateMessage)
    } else {
      overlay?.hide(); overlay = null
    }
    publish()
  }

  // ---------------- LiveSession.Listener ----------------

  override fun onState(state: String, message: String?) {
    this.state = state; this.stateMessage = message
    main.post { overlay?.setState(state, message) }
    publish()
  }

  override fun onCaption(original: String, translated: String) {
    main.post { overlay?.setCaption(translated) }
  }

  private fun publish() {
    val cfg = session?.config()
    DubixEvents.emit(DubixEvents.LIVE_STATE, mapOf(
      "state" to state, "message" to stateMessage, "source" to cfg?.source,
      "speak" to cfg?.speak, "captions" to cfg?.captions, "overlay" to (overlay != null),
      "paused" to (session?.paused ?: false)
    ))
  }

  fun setOptions(speak: Boolean?, captions: Boolean?) {
    speak?.let { session?.setSpeak(it) }
    captions?.let { session?.setCaptions(it) }
    publish()
  }

  private fun shutdownSession() {
    session?.stop(); session = null
    projection?.stop(); projection = null
  }

  private fun shutdown(finalState: String?) {
    shutdownSession()
    overlay?.hide(); overlay = null
    if (finalState != null) onState("idle", null) else publish()
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    shutdownSession()
    overlay?.hide(); overlay = null
    if (state != "idle" && state != "error" && state != "projection_stopped") onState("idle", null)
    instance = null
    super.onDestroy()
  }

  private fun notification(cfg: LiveSession.Config): Notification {
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(NotificationChannel(CHANNEL, "Live translation", NotificationManager.IMPORTANCE_LOW))
    }
    val stop = PendingIntent.getService(this, 1, Intent(this, LiveCaptureService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
    // Notification controls work even when "display over other apps" is not granted.
    val pause = PendingIntent.getService(this, 3, Intent(this, LiveCaptureService::class.java).setAction(ACTION_PAUSE), PendingIntent.FLAG_IMMUTABLE)
    val resume = PendingIntent.getService(this, 4, Intent(this, LiveCaptureService::class.java).setAction(ACTION_RESUME), PendingIntent.FLAG_IMMUTABLE)
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let { PendingIntent.getActivity(this, 2, it, PendingIntent.FLAG_IMMUTABLE) }
    val what = when (cfg.source) {
      "screen" -> "Reading on-screen subtitles (where the app allows screen capture)"
      "playback" -> "Translating audio from other apps (where the app allows capture)"
      else -> "Translating speech from the microphone"
    }
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("DubiX AI live translation")
      .setContentText(what)
      .setOngoing(true)
      .setContentIntent(open)
      .addAction(0, "Pause", pause)
      .addAction(0, "Resume", resume)
      .addAction(0, "Stop", stop)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  companion object {
    const val ACTION_START = "ai.dubix.live.START"
    const val ACTION_PAUSE = "ai.dubix.live.PAUSE"
    const val ACTION_RESUME = "ai.dubix.live.RESUME"
    const val ACTION_STOP = "ai.dubix.live.STOP"
    const val ACTION_OVERLAY = "ai.dubix.live.OVERLAY"
    const val EXTRA_CONFIG = "config"
    const val EXTRA_PROJECTION_CODE = "projectionCode"
    const val EXTRA_PROJECTION_DATA = "projectionData"
    const val EXTRA_OVERLAY = "overlay"
    const val EXTRA_VISIBLE = "visible"
    private const val CHANNEL = "dubix_live"
    private const val NOTIFICATION_ID = 4107

    @Volatile var instance: LiveCaptureService? = null; private set

    fun command(context: Context, action: String, extras: Intent.() -> Unit = {}) {
      val i = Intent(context, LiveCaptureService::class.java).setAction(action).apply(extras)
      if (action == ACTION_START) ContextCompat.startForegroundService(context, i) else context.startService(i)
    }
  }
}
