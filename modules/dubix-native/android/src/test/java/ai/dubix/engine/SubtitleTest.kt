package ai.dubix.engine

import ai.dubix.engine.live.SubtitleOcrSession
import ai.dubix.engine.pipeline.AudioRing
import ai.dubix.engine.pipeline.SubtitleParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SubtitleTest {
  @Test fun parsesSrtWithTagsSdhAndSpeakerLabels() {
    val srt = "﻿1\r\n00:00:01,500 --> 00:00:03,250\r\n<i>We have to go.</i>\r\n\r\n2\n00:01:02,000 --> 00:01:04,000\n[DOOR SLAMS]\nCOOPER: Where are you?\n- I'm here.\n\n3\n00:01:05,000 --> 00:01:06,000\n♪ ♪\n"
    val cues = SubtitleParser.parse(srt)
    assertEquals(2, cues.size)
    assertEquals(1500L, cues[0].startMs); assertEquals(3250L, cues[0].endMs)
    assertEquals("We have to go.", cues[0].text)
    assertEquals(62_000L, cues[1].startMs)
    assertEquals("Where are you? I'm here.", cues[1].text)
  }

  @Test fun parsesWebVttAndAss() {
    val vtt = "WEBVTT\n\n00:05.000 --> 00:07.500 align:center\nHello <b>there</b>\n\n01:00:00.000 --> 01:00:02.000\nBye\n"
    val v = SubtitleParser.parse(vtt)
    assertEquals(listOf(5000L, 3_600_000L), v.map { it.startMs })
    assertEquals("Hello there", v[0].text)
    val ass = "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:02.50,0:00:04.00,Default,,0,0,0,,{\\an8}First line\\NSecond, with comma\n"
    val a = SubtitleParser.parse(ass)
    assertEquals(2500L, a[0].startMs); assertEquals(4000L, a[0].endMs)
    assertEquals("First line Second, with comma", a[0].text)
  }

  @Test fun ocrLineMatchingToleratesJitter() {
    assertTrue(SubtitleOcrSession.similar("We have to go.", "we have to go"))
    assertTrue(SubtitleOcrSession.similar("We have to find another planet", "We have to flnd another planet"))
    assertFalse(SubtitleOcrSession.similar("We have to go.", "Where are you?"))
    assertFalse(SubtitleOcrSession.similar("", "x"))
  }

  @Test fun voiceBoostIsLimited() {
    val x = floatArrayOf(0.1f, 0.5f, -0.8f)
    SubtitleOcrSession.applyGain(x, 12f)
    assertEquals(0.398f, x[0], 0.01f)
    assertTrue(x.all { kotlin.math.abs(it) <= 1f })
    val y = floatArrayOf(0.2f); SubtitleOcrSession.applyGain(y, 0f); assertEquals(0.2f, y[0], 1e-6f)
  }

  @Test fun audioRingSlicesByAbsoluteIndex() {
    val r = AudioRing(10)
    r.append(0, FloatArray(8) { it.toFloat() })
    r.append(8, FloatArray(8) { (8 + it).toFloat() })
    assertEquals(listOf(10f, 11f, 12f), r.slice(10, 13).toList())
    assertEquals(listOf(6f, 7f), r.slice(0, 8).toList()) // older samples were overwritten
    assertEquals(0, r.slice(20, 30).size)
  }
}
