import { requireDubix, type LiveConfig } from 'dubix-native';

import { languageAvailability, recommendedAsr } from '@/domain/compatibility';
import { getLanguage } from '@/domain/languages';
import { availableVoices, buildVoicePools } from '@/domain/voiceMapping';
import { getSettings } from '@/store/settings';

import { clearLiveLines, engine } from '@/store/engine';
import { requestMicrophone, requestNotifications } from '@/services/permissions';

export type LiveStartResult =
  | { ok: true }
  | { ok: false; reason: 'permission' | 'consent_denied' | 'unsupported' | 'missing_models'; message: string; missing?: string[] };

/**
 * Starts live translation from the microphone or, on Android 10+, from other apps' playback
 * (only apps that allow capture; DRM/secure content and opted-out apps produce silence).
 */
export async function startLive(source: 'mic' | 'playback' | 'screen', showOverlay: boolean): Promise<LiveStartResult> {
  const n = requireDubix();
  const s = getSettings();
  const st = engine.get();

  if (source !== 'mic' && !st.device?.playbackCaptureSupported) {
    return { ok: false, reason: 'unsupported', message: 'Capturing other apps requires Android 10 or newer.' };
  }
  const avail = languageAvailability(s.targetLang, s.sourceLang, {
    installed: st.installedIds, translationPacks: st.translationPacks, systemVoices: st.systemVoices, translatable: st.translatable,
  });
  // Subtitle reading replaces speech recognition, so ASR/VAD packs are not needed for it.
  const unmet = avail.requirements.filter((r) => !r.satisfied && !(source === 'screen' && (r.key === 'asr' || r.key === 'vad')));
  if (avail.status === 'unavailable' || unmet.length) {
    const missing = unmet.map((r) => r.installId!).filter(Boolean);
    return { ok: false, reason: 'missing_models', message: avail.reason ?? 'Download the required offline packs first.', missing };
  }
  // Subtitle reading needs no audio. The microphone permission (Android's rule for any capture)
  // is still asked once so DubiX can hear the app's voices and pick a male/female voice per line;
  // if refused, subtitles are still read and voices follow cues like "[WOMAN]".
  if (source === 'screen' && !s.defaultVoiceKey) await requestMicrophone();
  if (source !== 'screen' && (await requestMicrophone()) !== 'granted') {
    return {
      ok: false,
      reason: 'permission',
      message: source === 'playback'
        ? 'Android requires the microphone permission for any audio capture, including other apps’ playback.'
        : 'Microphone permission is needed to translate speech around you.',
    };
  }
  await requestNotifications(); // the foreground-service notification is shown regardless; this enables it on 13+

  const lang = getLanguage(s.targetLang)!;
  const asr = s.asrModelId && st.installedIds.has(s.asrModelId) ? s.asrModelId : recommendedAsr(st.device, st.installedIds).id;
  const voices = availableVoices(s.targetLang, st.installedIds, st.systemVoices);
  const voice = voices.find((v) => v.key === s.defaultVoiceKey)?.spec ?? voices[0]?.spec ?? null;
  const config: LiveConfig = {
    source, sourceLang: s.sourceLang, targetLang: lang.short, translateTarget: lang.translateTarget,
    vadModelId: 'vad-silero', asrModelId: asr, voice,
    // A manually chosen default voice is respected; otherwise each utterance gets a pitch-matched voice.
    voicePools: s.defaultVoiceKey ? null : buildVoicePools(voices, s.voiceSpeed),
    speak: s.liveSpeak && voice !== null, captions: s.liveCaptions, voiceGainDb: s.voiceGainDb,
  };
  clearLiveLines();
  const r = await n.startLiveSession(config, showOverlay && n.canDrawOverlays());
  if (r === 'consent_denied' || r === 'cancelled') {
    return { ok: false, reason: 'consent_denied', message: source === 'screen' ? 'Screen-capture consent was not given, so subtitles cannot be read.' : 'Screen-capture consent was not given, so no audio can be captured.' };
  }
  return { ok: true };
}

export function stopLive(): void {
  requireDubix().stopLiveSession();
}

export function setLivePaused(paused: boolean): void {
  const n = requireDubix();
  if (paused) n.pauseLiveSession();
  else n.resumeLiveSession();
}

export const LIVE_STATE_COPY: Record<string, { title: string; body: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  idle: { title: 'Ready', body: 'Start to translate speech in real time.', tone: 'neutral' },
  listening: { title: 'Listening', body: 'Speech is transcribed and translated on this device.', tone: 'success' },
  paused: { title: 'Paused', body: 'Capture continues, but nothing is translated.', tone: 'neutral' },
  screen_blocked: {
    title: 'Screen is protected',
    body: 'This app blocks screen capture for its video (DRM / secure content), so its subtitles cannot be read. DubiX does not bypass this protection. Use app-audio mode if the app allows audio capture, or open the video file in DubiX’s player.',
    tone: 'warning',
  },
  no_subtitles: {
    title: 'No subtitles on screen',
    body: 'Turn on subtitles (CC) in the app you are watching. DubiX reads the lower part of the screen.',
    tone: 'warning',
  },
  capture_silent: {
    title: 'No capturable audio',
    body: 'The playing app may block capture (DRM-protected or secure content, or the app has opted out). DubiX cannot bypass this.',
    tone: 'warning',
  },
  mic_silent: { title: 'Microphone is silent', body: 'Check that the microphone is not blocked or used by another app.', tone: 'warning' },
  projection_stopped: { title: 'Capture ended', body: 'Android stopped audio capture (permission revoked or casting ended).', tone: 'danger' },
  error: { title: 'Stopped', body: 'Live translation stopped because of an error.', tone: 'danger' },
};
