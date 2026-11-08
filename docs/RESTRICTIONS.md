# Android and OTT restrictions

This document states what DubiX can and cannot do under Android's public APIs and the policies of
third-party apps. The in-app **Privacy & Limits** screen carries the same information.

## Supported: local video files (main mode)

Videos the user picks from device storage are decoded and played by DubiX itself (Media3), so
DubiX controls both the original track and the dub track. This is the only mode where DubiX can
lower the original audio, schedule dubbed lines precisely, and show synchronized captions.

Use DubiX only with content you own or are authorized to use.

## External-app mode (Android 10+)

DubiX uses `AudioPlaybackCaptureConfiguration` with a `MediaProjection` token:

- **Explicit consent every session.** Android shows its own screen-capture consent dialog. DubiX
  cannot skip, pre-grant or remember it, and the service never restarts itself after being killed.
- **`RECORD_AUDIO` is required** for any `AudioRecord`, including playback capture, so the
  microphone permission is requested even in app-audio mode, and the reason is shown to the user.
- **Foreground service** of type `mediaProjection` with a visible notification and a Stop action.
- **Only capturable audio.** Apps can opt out (`android:allowAudioPlaybackCapture="false"`,
  `AudioAttributes.ALLOW_CAPTURE_BY_NONE/SYSTEM`) and apps targeting older SDKs may default to
  not capturable. Usages other than media/game/unknown are not captured. Opted-out audio arrives
  as **silence**. DubiX detects this and shows "No capturable audio" instead of pretending to work.
- **DRM and secure playback are never captured or bypassed.** Widevine-protected streams and secure
  surfaces stay protected.
- **No universal OTT support.** Many streaming apps (for example Netflix, Prime Video, Disney+,
  and others) opt out of capture or use DRM, so DubiX does not claim to support them. Support
  for any given app depends on that app's settings and can change with its updates.
- **YouTube:** DubiX does not alter YouTube's player, video or audio components. It does not
  inject, replace or add audio tracks to YouTube content, and it does not present alternate
  "YouTube" tracks. Whether YouTube audio is capturable at all is decided by the YouTube app.
- **No per-app muting.** Standard Android APIs do not let one app mute or replace another app's
  output. DubiX's translated voice is an **overlay** and plays on top of the original audio.
  The UI says so, and DubiX never claims to "mute only the source app".
- **No recursive capture.** DubiX excludes its own UID from capture and marks its output as not
  capturable by apps, so it never translates its own synthesized speech.

## On-screen subtitle mode (Android 10+)

Reads the subtitles another app draws on screen and speaks them translated. It needs no audio,
so the source app can be turned down or muted (lowering an app's own volume also lowers what
app-audio capture receives, which is why speech recognition fails in that case).

- Uses the same `MediaProjection` consent dialog every session, and a `mediaProjection`
  foreground service. No microphone permission is needed.
- Frames are read into memory (about 5 per second), only the lower part of the screen is
  passed to on-device ML Kit text recognition, and nothing is saved or uploaded.
- **Protected video stays protected.** Apps using `FLAG_SECURE` or DRM secure surfaces
  (most paid streaming services) show **black** to screen capture. DubiX detects this and
  shows "Screen is protected"; it does not bypass it.
- Works only when the app draws subtitles as text on screen and they are turned on. Stylised,
  very large or picture-based subtitles may be missed. Latin and Devanagari scripts are supported.
- DubiX's own floating controller is marked secure so it is not read back as subtitles.
- **Voice gender is an estimate.** If the microphone permission is granted, the app's audio is
  also captured (in memory, last 8 s only) and the pitch of the dialogue heard while a line is
  on screen picks a lower (male) or higher (female) voice. Without usable audio, explicit
  subtitle cues such as `[WOMAN]` or `OLD MAN:` are used; names are never used to guess gender.
  DubiX does not infer gender from faces or appearance. A voice chosen manually always wins.

## Local movies: dub from subtitles

In the player, "Dub from: Subtitles" uses an embedded text subtitle track (SRT/ASS/WebVTT/TX3G)
or a `.srt`/`.vtt`/`.ass` file instead of speech recognition. Lines start on the subtitle's own
timing and no speech model is needed. The audio is still decoded to pick a voice per speaker.
Picture-based subtitles (PGS, VobSub) are not text and cannot be used.

## Floating controller

Needs `SYSTEM_ALERT_WINDOW` granted by the user in system settings. It controls DubiX only.
Some apps hide or block overlays during secure playback. The overlay draws no content over
protected surfaces beyond its own small panel.

## Audio separation and lip-sync

- The original soundtrack is one mixed stream. Separating dialogue from music and effects on-device
  is not implemented (current source-separation models are too heavy for real-time mobile use at
  acceptable quality). Lowering or muting the original **also lowers the music and effects**,
  and the app warns about this wherever volume or ducking is changed.
- DubiX aligns each dubbed line to its dialogue window (timing and time-stretch). It does **not**
  modify the video, so mouth movements will not match. There is no claim of visual lip-sync.

## Languages and voices

A target language is offered only when every required piece is available on the device: speech
recognition, an ML Kit translation pack (which ML Kit must support), and an offline voice (a
downloadable Piper voice or an installed offline Android system voice). Other languages are listed
as *not available on this device*, with the reason. Hinglish is a transliteration and lexicon
layer on top of Hindi, not a separate model.

## Network use

Inference never uses the network. The network is used only for downloads the user starts:
sherpa-onnx model files from GitHub releases, and ML Kit translation packs through Google Play
services. "Wi-Fi only" is on by default.
