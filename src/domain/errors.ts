/**
 * User-facing error catalog. Every error states what happened, what the user can do, and whether
 * retrying makes sense. Codes come from the native engine (job/live/download/warning codes) or JS.
 */
export type ErrorAction = 'models' | 'language' | 'permissions' | 'settings' | 'retry' | 'storage' | 'open_file' | 'sync' | 'none';

export type ErrorInfo = { title: string; what: string; todo: string; retry: boolean; action: ErrorAction; actionLabel?: string };

const E: Record<string, ErrorInfo> = {
  missing_models: { title: 'Offline packs needed', what: 'A speech, translation or voice pack for this language pair is not installed.', todo: 'Download the missing packs once; after that everything works offline.', retry: true, action: 'models', actionLabel: 'Download packs' },
  translation_pack_missing: { title: 'Translation pack missing', what: 'The on-device translation pack for this language is not installed.', todo: 'Download it in Offline AI Models, then continue dubbing.', retry: true, action: 'models', actionLabel: 'Open models' },
  unsupported_language: { title: 'Language not supported', what: 'This device has no offline translator or voice for the selected language.', todo: 'Choose another language, or install an offline voice in Android text-to-speech settings.', retry: false, action: 'language', actionLabel: 'Choose language' },
  voice_pack_fallback: { title: 'Using an Android voice', what: 'The downloaded neural voice could not run on this engine build, so an installed offline Android voice speaks instead.', todo: 'Nothing to do; the neural voice returns after an app update.', retry: false, action: 'none' },
  live_segment_failed: { title: 'A line could not be spoken', what: 'Translation worked, but no offline voice could speak this line.', todo: 'Install an offline voice for this language in Android text-to-speech settings, or download a voice pack.', retry: false, action: 'models', actionLabel: 'Get voices' },
  voice_unavailable: { title: 'Voice unavailable', what: 'The selected voice is not installed on this device.', todo: 'Pick another voice or download a voice pack.', retry: true, action: 'models', actionLabel: 'Get voices' },
  out_of_memory: { title: 'Not enough memory', what: 'The device ran out of memory while running the AI models.', todo: 'Close other apps or switch to the Light performance profile, then continue.', retry: true, action: 'settings', actionLabel: 'Performance settings' },
  low_memory: { title: 'Memory is low', what: 'Android asked DubiX to free memory; unused voice models were unloaded.', todo: 'Processing continues, possibly slower.', retry: false, action: 'none' },
  permission_mic: { title: 'Microphone not allowed', what: 'Live translation and app-audio capture need the microphone permission.', todo: 'Allow it, or keep using local movie dubbing which does not need it.', retry: true, action: 'permissions', actionLabel: 'Permissions' },
  consent_denied: { title: 'Capture not allowed', what: 'Android’s screen-capture consent was declined, so nothing from other apps can be captured.', todo: 'Start again and choose “Start now” in the Android dialog.', retry: true, action: 'retry', actionLabel: 'Try again' },
  no_subtitle_source: { title: 'Choose subtitles', what: 'Dubbing from subtitles needs a subtitle track in the movie or a subtitle file (.srt, .vtt, .ass).', todo: 'Tap “Choose subtitles”, or switch “Dub from” to Speech.', retry: false, action: 'none' },
  subtitle_unreadable: { title: 'Subtitles could not be read', what: 'The subtitle track or file could not be opened or is in an unsupported format (picture-based subtitles such as PGS/VobSub are not text).', todo: 'Pick a text subtitle file (.srt, .vtt or .ass), or dub from Speech.', retry: false, action: 'none' },
  subtitle_empty: { title: 'No dialogue in subtitles', what: 'The chosen subtitles contain no spoken lines.', todo: 'Choose another track or file, or dub from Speech.', retry: false, action: 'none' },
  screen_blocked: { title: 'Screen is protected', what: 'This app shows black to screen capture (DRM / secure video), so its subtitles cannot be read. DubiX does not bypass this protection.', todo: 'Try App audio mode, or open the video file in DubiX’s player and dub it from its subtitles.', retry: false, action: 'open_file', actionLabel: 'Open local movie' },
  no_subtitles: { title: 'No subtitles found', what: 'No subtitle text was seen at the bottom of the screen for a while.', todo: 'Turn on subtitles (CC) in the video app and keep the video playing. Large or stylised subtitles may not be recognised.', retry: true, action: 'retry', actionLabel: 'Try again' },
  capture_silent: { title: 'No capturable audio', what: 'The playing app blocks audio capture or plays protected (DRM) content. DubiX cannot bypass this.', todo: 'Use an app that allows capture, or open the video file in DubiX’s player.', retry: false, action: 'open_file', actionLabel: 'Open local movie' },
  projection_stopped: { title: 'Capture ended', what: 'Android stopped audio capture (consent revoked, casting ended or the token expired).', todo: 'Start live translation again to give new consent.', retry: true, action: 'retry', actionLabel: 'Start again' },
  no_audio: { title: 'No audio track', what: 'This video file has no audio track to translate.', todo: 'Choose a different file.', retry: false, action: 'open_file', actionLabel: 'Open another file' },
  file_unreadable: { title: 'File not available', what: 'The video was moved, deleted, or access to it was revoked.', todo: 'Open the file again from the picker.', retry: true, action: 'open_file', actionLabel: 'Open file' },
  decode_failed: { title: 'Audio format not supported', what: 'This device has no decoder for the movie’s audio format.', todo: 'Choose another audio track, or convert the file (for example to AAC audio).', retry: false, action: 'open_file', actionLabel: 'Open another file' },
  playback_error: { title: 'Cannot play this video', what: 'The video format or codec is not supported by this device.', todo: 'Try another file or format.', retry: false, action: 'open_file', actionLabel: 'Open another file' },
  pipeline_error: { title: 'Dubbing stopped', what: 'An unexpected error interrupted processing. Already dubbed lines are kept.', todo: 'Continue dubbing to resume from where it stopped.', retry: true, action: 'retry', actionLabel: 'Continue' },
  insufficient_storage: { title: 'Not enough storage', what: 'There is not enough free space for this download or for generated audio.', todo: 'Free space or remove unused packs and old sessions.', retry: true, action: 'storage', actionLabel: 'Manage storage' },
  download_failed: { title: 'Download failed', what: 'The model pack could not be downloaded or failed verification.', todo: 'Check the connection (Wi-Fi only may be on) and retry; partial downloads resume.', retry: true, action: 'models', actionLabel: 'Retry' },
  cancelled: { title: 'Processing cancelled', what: 'Dubbing was stopped. Lines that were already dubbed are kept.', todo: 'Continue any time to resume.', retry: true, action: 'retry', actionLabel: 'Continue' },
  route_changed: { title: 'Audio output changed', what: 'Headphones or a Bluetooth device connected or disconnected.', todo: 'Dub timing is re-measured automatically; fine-tune in Audio Sync if needed.', retry: false, action: 'sync', actionLabel: 'Audio Sync' },
  battery_restricted: { title: 'Stopped by battery optimization', what: 'Android stopped background work to save battery.', todo: 'Keep DubiX open while dubbing, or allow unrestricted battery use for DubiX.', retry: true, action: 'settings', actionLabel: 'App settings' },
  service_stopped: { title: 'Background service stopped', what: 'Android ended the live translation service.', todo: 'Start live translation again.', retry: true, action: 'retry', actionLabel: 'Start again' },
  throttled_thermal: { title: 'Device is hot', what: 'Dubbing slowed down to let the device cool.', todo: 'It continues automatically.', retry: false, action: 'none' },
  throttled_battery_critical: { title: 'Battery critically low', what: 'Dubbing pauses until the device is charging.', todo: 'Connect a charger.', retry: false, action: 'none' },
  engine_unavailable: { title: 'Native engine not available', what: 'This build does not contain the DubiX Android engine (Expo Go and web cannot load it).', todo: 'Install a development or release build (npx expo run:android).', retry: false, action: 'none' },
};

export function errorInfo(code: string | null | undefined, fallbackMessage?: string | null): ErrorInfo {
  if (code && E[code]) return E[code];
  return { title: 'Something went wrong', what: fallbackMessage ?? 'An unexpected error occurred.', todo: 'Try again. If it keeps happening, check Settings › Diagnostics.', retry: true, action: 'retry', actionLabel: 'Try again' };
}
