package ai.dubix.engine.audio

import ai.dubix.engine.core.Perf
import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.nio.ByteOrder

/**
 * Streams the first audio track of a local media file as mono float PCM at [outRate], starting
 * at [startMs]. Memory use is bounded by codec buffers: multi-hour films are never held in RAM.
 */
class AudioDecoder(private val context: Context, private val uri: Uri, private val outRate: Int = 16_000, private val audioTrackOrdinal: Int = 0) {
  class NoAudioTrackException : IllegalStateException("This video has no decodable audio track")

  /**
   * @param onChunk receives (samples, absoluteStartSample at [outRate]); return false to stop.
   */
  fun decode(startMs: Long, isCancelled: () -> Boolean, onChunk: (FloatArray, Long) -> Boolean) {
    val extractor = MediaExtractor()
    extractor.setDataSource(context, uri, null)
    val audioTracks = (0 until extractor.trackCount).filter {
      extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
    }
    if (audioTracks.isEmpty()) { extractor.release(); throw NoAudioTrackException() }
    // Same container order as the player's audio track list, so the dubbed language matches the selected track.
    val track = audioTracks[audioTrackOrdinal.coerceIn(0, audioTracks.size - 1)]
    extractor.selectTrack(track)
    val format = extractor.getTrackFormat(track)
    if (startMs > 0) extractor.seekTo(startMs * 1000, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

    val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
    codec.configure(format, null, null, 0)
    codec.start()

    var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    var inRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
    var floatPcm = false
    var resampler = StreamingResampler(inRate, outRate)
    var absSample = -1L
    val skipBeforeSample = startMs * outRate / 1000
    val info = MediaCodec.BufferInfo()
    var inputDone = false
    try {
      while (!isCancelled()) {
        if (!inputDone) {
          val inIdx = codec.dequeueInputBuffer(10_000)
          if (inIdx >= 0) {
            val buf = codec.getInputBuffer(inIdx)!!
            val n = extractor.readSampleData(buf, 0)
            if (n < 0) {
              codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              codec.queueInputBuffer(inIdx, 0, n, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        val outIdx = codec.dequeueOutputBuffer(info, 10_000)
        when {
          outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val of = codec.outputFormat
            channels = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            inRate = of.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            floatPcm = of.containsKey(MediaFormat.KEY_PCM_ENCODING) &&
              of.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
            resampler = StreamingResampler(inRate, outRate)
          }
          outIdx >= 0 -> {
            if (info.size > 0) {
              val out = codec.getOutputBuffer(outIdx)!!.order(ByteOrder.nativeOrder())
              out.position(info.offset); out.limit(info.offset + info.size)
              val mono = Perf.trace("decode") {
                val frames = if (floatPcm) info.size / 4 / channels else info.size / 2 / channels
                val m = FloatArray(frames)
                if (floatPcm) {
                  val fb = out.asFloatBuffer()
                  for (f in 0 until frames) { var a = 0f; for (c in 0 until channels) a += fb.get(); m[f] = a / channels }
                } else {
                  val sb = out.asShortBuffer()
                  for (f in 0 until frames) { var a = 0f; for (c in 0 until channels) a += sb.get() / 32768f; m[f] = a / channels }
                }
                resampler.process(m)
              }
              if (absSample < 0) absSample = info.presentationTimeUs * outRate / 1_000_000
              var chunk = mono
              var chunkStart = absSample
              absSample += mono.size
              // drop audio before the requested start (seek lands on a previous sync frame)
              if (chunkStart < skipBeforeSample) {
                val drop = (skipBeforeSample - chunkStart).coerceAtMost(chunk.size.toLong()).toInt()
                chunk = chunk.copyOfRange(drop, chunk.size); chunkStart += drop
              }
              if (chunk.isNotEmpty() && !onChunk(chunk, chunkStart)) { codec.releaseOutputBuffer(outIdx, false); break }
            }
            codec.releaseOutputBuffer(outIdx, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
          }
        }
      }
    } finally {
      runCatching { codec.stop() }
      codec.release()
      extractor.release()
    }
  }

  companion object {
    /** Peak envelope of [startMs, endMs) in [buckets] bins, for the sync preview waveform. */
    fun envelope(context: Context, uri: Uri, startMs: Long, endMs: Long, buckets: Int): FloatArray {
      val rate = 8_000
      val total = ((endMs - startMs) * rate / 1000).coerceAtLeast(1)
      val per = (total / buckets).coerceAtLeast(1)
      val out = FloatArray(buckets)
      val startSample = startMs * rate / 1000
      AudioDecoder(context, uri, rate).decode(startMs, { false }) { chunk, abs ->
        for (i in chunk.indices) {
          val b = ((abs + i - startSample) / per).toInt()
          if (b in 0 until buckets) { val a = kotlin.math.abs(chunk[i]); if (a > out[b]) out[b] = a }
        }
        abs + chunk.size < startSample + total
      }
      return out
    }
  }
}
