import type { DeviceInfo, SystemVoice } from 'dubix-native';

import { captionLines, findActiveSegment, stepSubtitleSize, type TimedText } from '@/domain/captions';
import { checkModel, languageAvailability, recommendedAsr, type AvailabilityContext } from '@/domain/compatibility';
import { formatBytes, formatDuration, formatOffset } from '@/utils/format';
import { skeleton, toHinglish, transliterateWord } from '@/domain/hinglish';
import { searchLanguages } from '@/domain/languages';
import { getCatalogModel, MODEL_CATALOG } from '@/domain/modelCatalog';
import { clampOffset, maxPauseSec, speedPreset, toDubConfig } from '@/domain/sync';
import { availableVoices, buildVoiceMap, voiceForRegister } from '@/domain/voiceMapping';

const device: DeviceInfo = {
  apiLevel: 34, release: '14', manufacturer: 'Test', model: 'Phone', abis: ['arm64-v8a'], cpuCores: 8,
  totalRamMb: 8192, availRamMb: 4000, lowRamDevice: false, storageTotalBytes: 128e9, storageFreeBytes: 40e9,
  playbackCaptureSupported: true, canDrawOverlays: false, powerSaveMode: false, thermalStatus: 0, batteryPct: 80, charging: false,
};

describe('Hinglish style layer', () => {
  it('transliterates a full Hindi sentence with loanwords and schwa deletion', () => {
    expect(toHinglish('हम लगभग पाँच मिनट में स्टेशन पहुँचेंगे।')).toBe('Hum lagbhag paanch minute mein station pahunchenge.');
  });
  it('applies word-final schwa deletion and conversational spellings', () => {
    expect(transliterateWord('कमल')).toBe('kamal');
    expect(transliterateWord('समझना')).toBe('samajhna');
    expect(transliterateWord('ज्ञान')).toBe('gyaan');
    expect(transliterateWord('ज़रूर')).toBe('zaroor');
  });
  it('supports Hindi-script, Roman Hindi and Hinglish output styles', () => {
    const hi = 'हम पाँच मिनट में स्टेशन पहुँचेंगे।';
    expect(toHinglish(hi, 'devanagari')).toBe(hi);
    expect(toHinglish(hi, 'roman')).toBe('Hum paanch minat mein steshan pahunchenge.');
    expect(toHinglish(hi, 'hinglish')).toBe('Hum paanch minute mein station pahunchenge.');
  });
  it('restores English names the translator transliterated, using the source line', () => {
    expect(skeleton('station', true)).toBe(skeleton('steshan', false));
    expect(toHinglish('कूपर को बुलाओ।', 'hinglish', 'Call Cooper now.')).toBe('Cooper ko bulao.');
    expect(toHinglish('कूपर को बुलाओ।', 'roman', 'Call Cooper now.')).toBe('Koopar ko bulao.');
  });
  it('leaves Latin text and punctuation untouched and converts digits', () => {
    expect(toHinglish('OK, १२ बजे?')).toBe('OK, 12 baje?');
  });
});

describe('captions', () => {
  const segs: TimedText[] = [
    { id: 'a', startMs: 1000, endMs: 2000, sourceText: 'Hello', translatedText: 'नमस्ते' },
    { id: 'b', startMs: 5000, endMs: 7000, sourceText: 'Bye', translatedText: 'अलविदा' },
  ];
  it('finds the active segment with hold time and offset', () => {
    expect(findActiveSegment(segs, 500)).toBeNull();
    expect(findActiveSegment(segs, 1500)?.id).toBe('a');
    expect(findActiveSegment(segs, 2400)?.id).toBe('a');
    expect(findActiveSegment(segs, 3000)).toBeNull();
    expect(findActiveSegment(segs, 5200, 300)).toBeNull();
    expect(findActiveSegment(segs, 5400, 300)?.id).toBe('b');
  });
  it('renders lines per caption mode and target style', () => {
    expect(captionLines(segs[0], 'both', 'hi')).toEqual(['Hello', 'नमस्ते']);
    expect(captionLines(segs[0], 'translated', 'hinglish')).toEqual(['Namaste']);
    expect(captionLines(segs[0], 'off', 'hi')).toEqual([]);
    expect(stepSubtitleSize('m', 1)).toBe('l');
    expect(stepSubtitleSize('xl', 1)).toBe('xl');
  });
});

describe('compatibility', () => {
  it('flags RAM and storage limits', () => {
    const small = getCatalogModel('asr-whisper-small')!;
    expect(checkModel(small, device)).toEqual([]);
    const issues = checkModel(small, { ...device, totalRamMb: 3000, storageFreeBytes: 1e9 });
    expect(issues.map((i) => i.code).sort()).toEqual(['ram', 'storage']);
    expect(issues.find((i) => i.code === 'ram')?.blocking).toBe(true);
    expect(checkModel(small, { ...device, abis: ['mips'] })[0].code).toBe('abi');
  });
  it('recommends a model that fits the device', () => {
    expect(recommendedAsr({ ...device, totalRamMb: 2500 }, new Set()).id).toBe('asr-whisper-tiny');
    expect(recommendedAsr(device, new Set()).id).toBe('asr-whisper-base');
  });

  const base: AvailabilityContext = {
    installed: new Set(['vad-silero', 'asr-whisper-base', 'tts-hi_IN-rohan-medium']),
    translationPacks: new Set(['en', 'hi']),
    systemVoices: [],
    translatable: new Set(['en', 'hi', 'ta', 'ur', 'ar', 'es']),
  };
  it('reports a language ready only when every requirement is met', () => {
    expect(languageAvailability('hi', 'en', base).status).toBe('ready');
    expect(languageAvailability('hinglish', 'auto', base).status).toBe('ready');
    const ur = languageAvailability('ur', 'en', base);
    expect(ur.status).toBe('download');
    expect(ur.requirements.filter((r) => !r.satisfied).map((r) => r.key)).toEqual(['mt-ur', 'voice']);
  });
  it('marks languages without any offline voice as unavailable', () => {
    expect(languageAvailability('ta', 'en', base).status).toBe('unavailable');
    const sys: SystemVoice[] = [{ name: 'ta-in-x-tag-local', language: 'ta-IN', quality: 400, latency: 200, offline: true }];
    const ta = languageAvailability('ta', 'en', { ...base, systemVoices: sys, translationPacks: new Set(['en', 'hi', 'ta']) });
    expect(ta.status).toBe('ready');
    expect(ta.voiceSource).toBe('system');
  });
});

describe('voice mapping', () => {
  const installed = new Set(['tts-hi_IN-rohan-medium', 'tts-hi_IN-priyamvada-medium']);
  const voices = availableVoices('hinglish', installed, []);
  it('lists installed packs for the voice language', () => {
    expect(voices.map((v) => v.gender)).toEqual(['male', 'female']);
  });
  it('maps registers to genders and falls back to pitch shifting', () => {
    expect(voiceForRegister('low', voices)?.modelId).toBe('tts-hi_IN-rohan-medium');
    expect(voiceForRegister('high', voices)?.modelId).toBe('tts-hi_IN-priyamvada-medium');
    const onlyMale = voices.filter((v) => v.gender === 'male');
    expect(voiceForRegister('high', onlyMale)).toMatchObject({ modelId: 'tts-hi_IN-rohan-medium', pitch: 3 });
    expect(voiceForRegister('low', [])).toBeNull();
  });
  it('applies speaker overrides and global speed', () => {
    const map = buildVoiceMap(voices, { 2: { voiceKey: voices[1].key, pitch: -1, speed: 1.1 } }, 1.1);
    expect(map['speaker:2']).toMatchObject({ modelId: 'tts-hi_IN-priyamvada-medium', pitch: -1 });
    expect(map['speaker:2'].speed).toBeCloseTo(1.21);
    expect(map.low.speed).toBeCloseTo(1.1);
  });
});

describe('sync + format', () => {
  it('clamps and snaps offsets', () => {
    expect(clampOffset(127)).toBe(120);
    expect(clampOffset(5000)).toBe(1000);
    expect(maxPauseSec('aggressive')).toBe(0.6);
    expect(speedPreset(0.9)).toBe('slower');
  });
  it('builds native dub config', () => {
    const cfg = toDubConfig({ dubEnabled: true, offsetMs: 120, autoSync: false, measuredLatencyMs: 200, originalVolume: 1.4, dubVolume: 1, duckWhileDubbing: true, duckLevel: 0.6 });
    expect(cfg).toEqual({ enabled: true, offsetMs: -80, originalVolume: 1, dubVolume: 1, duckWhileDubbing: true, duckLevel: 0.6 });
  });
  it('formats values', () => {
    expect(formatDuration(8_317_000)).toBe('2:18:37');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatBytes(207557382)).toBe('198 MB');
    expect(formatBytes(1.3 * 1024 ** 3)).toBe('1.3 GB');
    expect(formatOffset(-120)).toBe('−120 ms');
  });
  it('searches languages by name, native name and code', () => {
    expect(searchLanguages('esp').map((l) => l.code)).toEqual(['es']);
    expect(searchLanguages('हिन्दी').map((l) => l.code)).toEqual(['hi']);
  });
  it('has well-formed catalog entries', () => {
    for (const m of MODEL_CATALOG) {
      expect(m.url).toMatch(/^https:\/\/github\.com\/k2-fsa\/sherpa-onnx\/releases\/download\//);
      if (m.sha256) expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.sizeBytes).toBeGreaterThan(0);
    }
  });
});
