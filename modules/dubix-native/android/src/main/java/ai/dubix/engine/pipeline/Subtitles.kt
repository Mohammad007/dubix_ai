package ai.dubix.engine.pipeline

import android.content.Context
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.nio.ByteBuffer

/** One timed subtitle line. */
data class Cue(val startMs: Long, val endMs: Long, val text: String)

/**
 * Subtitle parsing and clean-up. Subtitles give exact dialogue timing and text, so dubbing from
 * them skips speech recognition entirely: faster, and timing matches the video precisely.
 */
object SubtitleParser {
  private val srtTime = Regex("""(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})""")
  private val vttTime = Regex("""(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{1,3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}):(\d{2})\.(\d{1,3})""")

  /** Auto-detects SRT / WebVTT / ASS by content. */
  fun parse(content: String): List<Cue> {
    val text = content.removePrefix("﻿").replace("\r\n", "\n").replace('\r', '\n')
    return when {
      text.trimStart().startsWith("WEBVTT") -> parseVtt(text)
      text.contains("[Events]") && text.contains("Dialogue:") -> parseAss(text)
      else -> parseSrt(text)
    }.filter { it.text.isNotBlank() && it.endMs > it.startMs }.sortedBy { it.startMs }
  }

  fun parseSrt(text: String): List<Cue> = text.split(Regex("\n\\s*\n")).mapNotNull { block ->
    val lines = block.trim().lines()
    val i = lines.indexOfFirst { srtTime.containsMatchIn(it) }
    if (i < 0) return@mapNotNull null
    val m = srtTime.find(lines[i])!!.groupValues
    val start = ms(m[1], m[2], m[3], m[4]); val end = ms(m[5], m[6], m[7], m[8])
    Cue(start, end, clean(lines.drop(i + 1).joinToString("\n")))
  }

  fun parseVtt(text: String): List<Cue> = text.split(Regex("\n\\s*\n")).mapNotNull { block ->
    val lines = block.trim().lines()
    val i = lines.indexOfFirst { vttTime.containsMatchIn(it) }
    if (i < 0) return@mapNotNull null
    val m = vttTime.find(lines[i])!!.groupValues
    val start = ms(m[1].ifEmpty { "0" }, m[2], m[3], m[4]); val end = ms(m[5].ifEmpty { "0" }, m[6], m[7], m[8])
    Cue(start, end, clean(lines.drop(i + 1).joinToString("\n")))
  }

  /** ASS/SSA "Dialogue: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text". */
  fun parseAss(text: String): List<Cue> = text.lines().filter { it.startsWith("Dialogue:") }.mapNotNull { line ->
    val parts = line.removePrefix("Dialogue:").split(",", limit = 10)
    if (parts.size < 10) return@mapNotNull null
    Cue(assTime(parts[1]), assTime(parts[2]), clean(parts[9].replace("\\N", "\n").replace("\\n", "\n")))
  }

  private fun assTime(t: String): Long {
    val p = t.trim().split(":", ".")
    if (p.size < 4) return 0
    return ((p[0].toLong() * 60 + p[1].toLong()) * 60 + p[2].toLong()) * 1000 + p[3].padEnd(3, '0').take(3).toLong()
  }

  private fun ms(h: String, m: String, s: String, f: String): Long =
    ((h.toLong() * 60 + m.toLong()) * 60 + s.toLong()) * 1000 + f.padEnd(3, '0').take(3).toLong()

  private val tags = Regex("""<[^>]+>|\{[^}]*\}""")
  private val sdh = Regex("""\[[^\]]*]|\([^)]*\)|[♪♫]+""")
  private val speakerLabel = Regex("""^(?:-\s*)?[A-Z][A-Z .'-]{1,24}:\s+""", RegexOption.MULTILINE)
  private val dash = Regex("""^\s*-\s*""", RegexOption.MULTILINE)

  /**
   * Strips formatting tags, hearing-impaired annotations ([MUSIC], (laughs)), speaker labels
   * ("JOHN:") and dialogue dashes; joins lines into one sentence.
   */
  fun clean(raw: String): String = raw
    .replace(tags, "")
    .replace(sdh, " ")
    .replace(speakerLabel, "")
    .replace(dash, "")
    .lines().map { it.trim() }.filter { it.isNotEmpty() }
    .joinToString(" ")
    .replace(Regex("\\s+"), " ")
    .trim()
}

/** Reads subtitle tracks embedded in the video container (MKV SubRip/ASS/WebVTT, MP4 tx3g). */
object SubtitleExtractor {
  private val SUPPORTED = setOf("application/x-subrip", "text/x-ssa", "text/vtt", "text/3gpp-tt", "application/x-mp4-vtt")

  data class Track(val index: Int, val mime: String, val language: String?)

  fun tracks(context: Context, uri: Uri): List<Track> {
    val ex = MediaExtractor()
    return try {
      ex.setDataSource(context, uri, null)
      (0 until ex.trackCount).mapNotNull { i ->
        val f = ex.getTrackFormat(i)
        val mime = f.getString(MediaFormat.KEY_MIME) ?: return@mapNotNull null
        if (mime !in SUPPORTED) return@mapNotNull null
        Track(i, mime, if (f.containsKey(MediaFormat.KEY_LANGUAGE)) f.getString(MediaFormat.KEY_LANGUAGE) else null)
      }
    } catch (e: Exception) {
      emptyList()
    } finally {
      ex.release()
    }
  }

  /**
   * Containers expose a start time per sample but not always a duration, so a cue ends at the
   * next cue's start, capped by a reading-speed estimate.
   */
  fun extract(context: Context, uri: Uri, trackIndex: Int): List<Cue> {
    val ex = MediaExtractor()
    try {
      ex.setDataSource(context, uri, null)
      val mime = ex.getTrackFormat(trackIndex).getString(MediaFormat.KEY_MIME) ?: return emptyList()
      ex.selectTrack(trackIndex)
      val buf = ByteBuffer.allocate(64 * 1024)
      val raw = ArrayList<Pair<Long, String>>()
      while (true) {
        buf.clear()
        val n = ex.readSampleData(buf, 0)
        if (n < 0) break
        val bytes = ByteArray(n).also { buf.get(it, 0, n) }
        val t = ex.sampleTime / 1000
        val text = when (mime) {
          "text/3gpp-tt" -> if (n >= 2) String(bytes, 2, minOf(n - 2, ((bytes[0].toInt() and 0xff) shl 8) or (bytes[1].toInt() and 0xff)), Charsets.UTF_8) else ""
          "text/x-ssa" -> String(bytes, Charsets.UTF_8).split(",", limit = 9).last().replace("\\N", "\n")
          else -> String(bytes, Charsets.UTF_8)
        }
        raw.add(t to SubtitleParser.clean(text))
        ex.advance()
      }
      return raw.mapIndexedNotNull { i, (start, text) ->
        if (text.isBlank()) return@mapIndexedNotNull null
        val next = raw.getOrNull(i + 1)?.first ?: Long.MAX_VALUE
        val estimate = start + (1200L + text.length * 70L).coerceAtMost(7000L)
        Cue(start, minOf(next, estimate), text)
      }
    } finally {
      ex.release()
    }
  }
}
