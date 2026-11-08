package ai.dubix.engine.player

import ai.dubix.engine.core.DubixEvents
import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import java.util.UUID

/** Owns Media3 ExoPlayer instances (main thread only) and their dub engines. */
object PlayerManager {
  class Entry(val id: String, val player: ExoPlayer, val dub: DubPlaybackEngine)

  private val entries = HashMap<String, Entry>()
  private val main = Handler(Looper.getMainLooper())
  private var ticker: Runnable? = null
  private var tickCount = 0
  private var routeCallback: AudioDeviceCallback? = null

  fun create(context: Context, uri: String): String {
    val id = UUID.randomUUID().toString()
    val player = ExoPlayer.Builder(context.applicationContext).build().apply {
      // Handles audio focus (calls, other media) and pauses when headphones disconnect.
      setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
      setHandleAudioBecomingNoisy(true)
      setMediaItem(MediaItem.fromUri(Uri.parse(uri)))
      prepare()
    }
    val dub = DubPlaybackEngine(id, player)
    player.addListener(object : Player.Listener {
      override fun onIsPlayingChanged(isPlaying: Boolean) { dub.onPlayingChanged(isPlaying); emit(id) }
      override fun onPlaybackStateChanged(state: Int) { emit(id) }
      override fun onPositionDiscontinuity(old: Player.PositionInfo, new: Player.PositionInfo, reason: Int) {
        if (reason == Player.DISCONTINUITY_REASON_SEEK || reason == Player.DISCONTINUITY_REASON_SEEK_ADJUSTMENT) dub.onSeek(new.positionMs)
      }
      override fun onPlaybackParametersChanged(params: PlaybackParameters) { dub.setRate(params.speed); emit(id) }
      override fun onPlayerError(error: PlaybackException) {
        DubixEvents.emit(DubixEvents.PLAYER_STATE, mapOf("playerId" to id, "state" to "error", "message" to (error.message ?: error.errorCodeName)))
      }
    })
    entries[id] = Entry(id, player, dub)
    ensureTicker()
    ensureRouteMonitor(context)
    return id
  }

  fun get(id: String): Entry = entries[id] ?: error("Unknown player '$id'")
  fun find(id: String): Entry? = entries[id]

  fun release(id: String) {
    entries.remove(id)?.let { it.dub.release(); it.player.release() }
    if (entries.isEmpty()) { ticker?.let { main.removeCallbacks(it) }; ticker = null }
  }

  private fun ensureTicker() {
    if (ticker != null) return
    val r = object : Runnable {
      override fun run() {
        entries.values.forEach { it.dub.tick() }
        if (++tickCount % 5 == 0) entries.keys.forEach { emit(it) } // ~100 ms position updates
        main.postDelayed(this, 20)
      }
    }
    ticker = r
    main.post(r)
  }

  fun emit(id: String) {
    val e = entries[id] ?: return
    val p = e.player
    val state = when (p.playbackState) {
      Player.STATE_BUFFERING -> "buffering"; Player.STATE_READY -> "ready"; Player.STATE_ENDED -> "ended"; else -> "idle"
    }
    DubixEvents.emit(DubixEvents.PLAYER_STATE, mapOf(
      "playerId" to id, "state" to state, "isPlaying" to p.isPlaying,
      "positionMs" to p.currentPosition.toDouble(),
      "durationMs" to (if (p.duration == C.TIME_UNSET) 0L else p.duration).toDouble(),
      "bufferedMs" to p.bufferedPosition.toDouble(),
      "speed" to p.playbackParameters.speed.toDouble()
    ))
  }

  // ---------------- audio tracks ----------------

  /** Audio tracks in container order: ordinal matches what the decoder uses for dubbing. */
  fun audioTracks(id: String): List<Map<String, Any?>> {
    val p = get(id).player
    val out = ArrayList<Map<String, Any?>>()
    p.currentTracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }.forEachIndexed { ordinal, g ->
      val f = g.getTrackFormat(0)
      out.add(mapOf(
        "ordinal" to ordinal, "language" to f.language, "label" to f.label,
        "channels" to f.channelCount, "mimeType" to f.sampleMimeType,
        "selected" to g.isSelected, "supported" to g.isSupported
      ))
    }
    return out
  }

  fun selectAudioTrack(id: String, ordinal: Int) {
    val p = get(id).player
    val group = p.currentTracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }.getOrNull(ordinal) ?: error("No audio track $ordinal")
    p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
      .setOverrideForType(androidx.media3.common.TrackSelectionOverride(group.mediaTrackGroup, 0))
      .build()
  }

  // ---------------- audio route (Bluetooth / wired / speaker) ----------------

  private fun ensureRouteMonitor(context: Context) {
    if (routeCallback != null) return
    val am = context.getSystemService(AudioManager::class.java)
    val cb = object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = routeChanged(am)
      override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = routeChanged(am)
    }
    am.registerAudioDeviceCallback(cb, main)
    routeCallback = cb
  }

  private fun routeChanged(am: AudioManager) {
    entries.values.forEach { it.dub.onRouteChanged() }
    DubixEvents.emit(DubixEvents.AUDIO_ROUTE, currentRoute(am))
  }

  fun currentRoute(am: AudioManager): Map<String, Any?> {
    val outs = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS)
    fun has(vararg t: Int) = outs.firstOrNull { it.type in t }
    val bt = has(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLE_SPEAKER)
    val wired = has(AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_USB_HEADSET)
    val dev = bt ?: wired
    return mapOf(
      "type" to when { bt != null -> "bluetooth"; wired != null -> "wired"; else -> "speaker" },
      "name" to (dev?.productName?.toString() ?: "Phone speaker")
    )
  }
}
