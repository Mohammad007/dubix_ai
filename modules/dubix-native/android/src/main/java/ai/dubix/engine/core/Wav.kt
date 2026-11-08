package ai.dubix.engine.core

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** Minimal mono WAV IO (16-bit PCM write; 16-bit PCM / 32-bit float read, any channel count). */
object Wav {
  class Audio(val samples: FloatArray, val sampleRate: Int)

  fun encodeMono16(samples: FloatArray, sampleRate: Int): ByteArray {
    val dataLen = samples.size * 2
    val buf = ByteBuffer.allocate(44 + dataLen).order(ByteOrder.LITTLE_ENDIAN)
    buf.put("RIFF".toByteArray()); buf.putInt(36 + dataLen); buf.put("WAVE".toByteArray())
    buf.put("fmt ".toByteArray()); buf.putInt(16); buf.putShort(1); buf.putShort(1)
    buf.putInt(sampleRate); buf.putInt(sampleRate * 2); buf.putShort(2); buf.putShort(16)
    buf.put("data".toByteArray()); buf.putInt(dataLen)
    for (s in samples) buf.putShort((s.coerceIn(-1f, 1f) * 32767f).toInt().toShort())
    return buf.array()
  }

  fun writeMono16(file: File, samples: FloatArray, sampleRate: Int) {
    file.parentFile?.mkdirs()
    val tmp = File(file.path + ".tmp")
    tmp.writeBytes(encodeMono16(samples, sampleRate))
    if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
  }

  fun read(file: File): Audio = decode(file.readBytes())

  fun decode(all: ByteArray): Audio {
    val bb = ByteBuffer.wrap(all).order(ByteOrder.LITTLE_ENDIAN)
    require(all.size >= 12 && String(all, 0, 4) == "RIFF" && String(all, 8, 4) == "WAVE") { "Not a WAV stream" }
    var pos = 12
    var format = 1; var channels = 1; var rate = 16000; var bits = 16
    while (pos + 8 <= all.size) {
      val id = String(all, pos, 4)
      val size = bb.getInt(pos + 4)
      val body = pos + 8
      if (id == "fmt ") {
        format = bb.getShort(body).toInt(); channels = bb.getShort(body + 2).toInt()
        rate = bb.getInt(body + 4); bits = bb.getShort(body + 14).toInt()
      } else if (id == "data") {
        val end = if (size <= 0 || body + size > all.size) all.size else body + size
        val bytesPerSample = bits / 8
        val frameBytes = bytesPerSample * channels
        val frames = (end - body) / frameBytes
        val out = FloatArray(frames)
        for (f in 0 until frames) {
          var acc = 0f
          for (c in 0 until channels) {
            val off = body + f * frameBytes + c * bytesPerSample
            acc += if (format == 3 && bits == 32) bb.getFloat(off) else bb.getShort(off) / 32768f
          }
          out[f] = acc / channels
        }
        return Audio(out, rate)
      }
      pos = body + size + (size and 1)
    }
    error("WAV has no data chunk")
  }
}
