import { DubixNative, requireDubix, type JobSegmentEvent, type JobStateEvent } from 'dubix-native';

import * as db from '@/database';
import { languageAvailability, recommendedAsr } from '@/domain/compatibility';
import { getLanguage } from '@/domain/languages';
import { addRange, leadAt, rangeAt, resumePoint } from '@/domain/ranges';
import { maxPauseSec, toDubConfig } from '@/domain/sync';
import { availableVoices, buildVoiceMap, buildVoicePools, type SpeakerOverride } from '@/domain/voiceMapping';
import { createStore } from '@/store/createStore';
import { engine, pushWarning } from '@/store/engine';
import { getSettings } from '@/store/settings';
import { nativeErrorMessage } from '@/utils/nativeError';

import { forgetSubtitles, getSubtitleChoice, getUsedSignature, loadCues, setUsedSignature, sourceSignature } from './subtitleSource';

export type JobUiState = 'idle' | 'loading' | 'running' | 'waiting' | 'paused' | 'completed' | 'cancelled' | 'error';

export type ActiveSession = {
  session: db.SessionRow;
  segments: db.SegmentRow[];
  speakers: db.SpeakerRow[];
  playerId: string | null;
  jobId: string | null;
  jobMode: 'prepare' | 'live' | null;
  /** media position where the current job started decoding */
  jobStartMs: number;
  jobState: JobUiState;
  jobCode: string | null;
  jobMessage: string | null;
  regenerating: { label: string; done: number; total: number } | null;
  measuredLatencyMs: number;
  driftAvgMs: number;
  /** playback paused automatically while live dubbing catches up */
  gated: boolean;
};

export const sessions = createStore<{ list: db.SessionRow[]; active: ActiveSession | null; loading: boolean }>({
  list: [],
  active: null,
  loading: true,
});

export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function patchActive(patch: Partial<ActiveSession> | ((a: ActiveSession) => Partial<ActiveSession>)): void {
  sessions.set((s) => (s.active ? { active: { ...s.active, ...(typeof patch === 'function' ? patch(s.active) : patch) } } : {}));
}

// ---------------- history & storage ----------------

export async function refreshSessions(): Promise<void> {
  const rows = await db.getRecentSessions();
  // Defensive: overlapping refreshes must never surface the same session twice (duplicate React keys).
  const seen = new Set<string>();
  sessions.set({ list: rows.filter((r) => !seen.has(r.id) && seen.add(r.id)), loading: false });
}

/** Removes audio of deleted/aborted sessions; run once at startup. */
export async function cleanupOrphans(): Promise<void> {
  if (!DubixNative) return;
  const ids = (await db.getRecentSessions(10_000)).map((s) => s.id);
  DubixNative.purgeSessionFiles(ids);
}

/** Keeps generated audio under the configured limit by evicting the least recently used sessions' audio. */
export async function enforceAudioCacheLimit(): Promise<number> {
  if (!DubixNative) return 0;
  const limit = getSettings().audioCacheLimitMb * 1024 * 1024;
  let total = await db.audioCacheBytes();
  let evicted = 0;
  if (total <= limit) return 0;
  const activeId = sessions.get().active?.session.id;
  for (const s of await db.audioCacheBySession()) {
    if (total <= limit) break;
    if (s.sessionId === activeId) continue;
    DubixNative.deleteSessionFiles(s.sessionId);
    await db.clearAudioCache(s.sessionId);
    total -= s.bytes;
    evicted++;
  }
  return evicted;
}

// ---------------- open / load ----------------

export type OpenResult = { ok: true; sessionId: string } | { ok: false; code: 'cancelled' | 'no_audio' | 'file_unreadable'; message?: string };

export async function openLocalVideo(): Promise<OpenResult> {
  const n = requireDubix();
  const picked = await n.pickVideo();
  if (!picked) return { ok: false, code: 'cancelled' };
  try {
    const info = await n.getMediaInfo(picked.uri);
    if (!info.hasAudio) {
      n.releaseUri(picked.uri);
      return { ok: false, code: 'no_audio' };
    }
    const s = getSettings();
    const id = newId('s');
    await db.createSession({
      id, uri: picked.uri, name: info.title || picked.name, thumbnail: info.thumbnail, durationMs: info.durationMs,
      sourceLang: s.sourceLang, targetLang: s.targetLang, sizeBytes: picked.size, mimeType: picked.mimeType,
    });
    await refreshSessions();
    return { ok: true, sessionId: id };
  } catch (e) {
    return { ok: false, code: 'file_unreadable', message: nativeErrorMessage(e) };
  }
}

export async function loadSession(id: string): Promise<void> {
  getSubtitleChoice(id); // hydrate the remembered subtitle source for this movie
  const cur = sessions.get().active;
  if (cur?.session.id === id) return;
  await closeActive();
  const session = await db.getSession(id);
  if (!session) return;
  const [segments, speakers] = await Promise.all([db.getSegments(id), db.getVoiceMappings(id)]);
  sessions.set({
    active: {
      session, segments, speakers, playerId: null, jobId: null, jobMode: null, jobStartMs: 0, jobState: 'idle', jobCode: null,
      jobMessage: null, regenerating: null, measuredLatencyMs: 0, driftAvgMs: 0, gated: false,
    },
  });
}

async function closeActive(): Promise<void> {
  const a = sessions.get().active;
  if (!a) return;
  await detachPlayer();
  if (a.jobId) DubixNative?.cancelJob(a.jobId);
}

// ---------------- player ----------------

const segmentRefs = (segs: db.SegmentRow[]) =>
  segs.filter((s) => s.audioPath).map((s) => ({ id: s.id, startMs: s.startMs, endMs: s.endMs, path: s.audioPath! }));

let attaching: Promise<string | null> | null = null;

export function attachPlayer(): Promise<string | null> {
  attaching ??= doAttach().finally(() => {
    attaching = null;
  });
  return attaching;
}

async function doAttach(): Promise<string | null> {
  const a = sessions.get().active;
  if (!a || !DubixNative) return null;
  if (a.playerId) return a.playerId;
  const playerId = await DubixNative.createPlayer(a.session.uri);
  if (sessions.get().active?.session.id !== a.session.id) {
    await DubixNative.releasePlayer(playerId);
    return null;
  }
  patchActive({ playerId });
  await DubixNative.setDubSegments(playerId, segmentRefs(a.segments));
  await applyMix();
  const s = getSettings();
  if (s.playbackSpeed !== 1) await DubixNative.setPlaybackSpeed(playerId, s.playbackSpeed);
  if (a.session.lastPositionMs > 0) await DubixNative.seekTo(playerId, a.session.lastPositionMs);
  return playerId;
}

export async function detachPlayer(positionMs?: number, durationMs?: number): Promise<void> {
  const a = sessions.get().active;
  if (!a?.playerId || !DubixNative) return;
  const id = a.playerId;
  patchActive({ playerId: null, gated: false });
  if (positionMs !== undefined) {
    await db.savePlaybackProgress(a.session.id, positionMs, durationMs ?? a.session.durationMs, getSettings().playbackSpeed);
    patchActive((cur) => ({ session: { ...cur.session, lastPositionMs: positionMs } }));
  }
  await DubixNative.releasePlayer(id);
}

export async function applyMix(): Promise<void> {
  const a = sessions.get().active;
  if (!a?.playerId || !DubixNative) return;
  const s = getSettings();
  await DubixNative.setDubConfig(
    a.playerId,
    toDubConfig({
      dubEnabled: s.dubEnabled, offsetMs: s.syncOffsetMs, autoSync: s.autoSync, measuredLatencyMs: a.measuredLatencyMs,
      originalVolume: s.originalMuted ? 0 : s.originalVolume, dubVolume: s.dubVolume, duckWhileDubbing: s.duckWhileDubbing, duckLevel: s.duckLevel,
    }),
  );
}

export async function setPlaybackSpeed(speed: number): Promise<void> {
  const a = sessions.get().active;
  if (a?.playerId) await DubixNative?.setPlaybackSpeed(a.playerId, speed);
}

/**
 * Switches the movie's audio track. Dubbing must be redone from the new track (different language
 * or mix), so existing lines are discarded.
 */
export async function selectAudioTrack(ordinal: number): Promise<void> {
  const a = sessions.get().active;
  if (!a || !DubixNative) return;
  if (a.playerId) await DubixNative.selectAudioTrack(a.playerId, ordinal);
  if (ordinal === a.session.audioTrack) return;
  await resetDubbing({ audioTrack: ordinal });
}

/**
 * Called on every player position update. Keeps the live job's lead bounded, restarts it after
 * seeks into undubbed parts, and (optionally) pauses playback until enough dubbing is buffered.
 */
export async function onPlayerTick(positionMs: number, isPlaying: boolean): Promise<void> {
  const a = sessions.get().active;
  if (!a || !DubixNative) return;
  if (a.jobId) DubixNative.setJobPlayhead(a.jobId, positionMs);
  if (a.jobMode !== 'live') return;
  const s = getSettings();
  const ranges = a.session.coveredRanges;
  const jobActive = a.jobId && (a.jobState === 'running' || a.jobState === 'waiting' || a.jobState === 'loading');

  // Seek outside the region the running job is producing: restart it where dubbing is missing.
  if (jobActive && !rangeAt(ranges, positionMs) && (positionMs < a.jobStartMs - 2000 || positionMs > a.session.processedMs + 15_000)) {
    await startDubbing({ mode: 'live', fromMs: resumePoint(ranges, positionMs) });
    return;
  }

  if (!s.waitForDubbing || !a.playerId) return;
  const lead = leadAt(ranges, positionMs);
  if (!a.gated && isPlaying && jobActive && lead < 1500) {
    patchActive({ gated: true });
    await DubixNative.pause(a.playerId);
  } else if (a.gated && (lead > 8000 || !jobActive)) {
    patchActive({ gated: false });
    await DubixNative.play(a.playerId);
  }
}

/** User pressed play while gated: stop waiting and play without dubbing ahead. */
export function releaseGate(): void {
  patchActive({ gated: false });
}

// ---------------- dubbing job ----------------

export type StartCheck = { ok: true } | { ok: false; code: string; missing: string[]; message: string };

export function checkReady(targetLang: string, sourceLang: string, opts: { fromSubtitles?: boolean } = {}): StartCheck {
  const st = engine.get();
  const avail = languageAvailability(targetLang, sourceLang, {
    installed: st.installedIds, translationPacks: st.translationPacks, systemVoices: st.systemVoices, translatable: st.translatable,
  });
  if (avail.status === 'unavailable') return { ok: false, code: 'unsupported_language', missing: [], message: avail.reason ?? 'Language not available' };
  // Subtitles replace speech recognition, so speech packs are not needed in that mode.
  const missing = avail.requirements.filter((r) => !r.satisfied && !(opts.fromSubtitles && (r.key === 'asr' || r.key === 'vad')));
  if (!missing.length) return { ok: true };
  return { ok: false, code: 'missing_models', missing: missing.map((m) => m.installId!).filter(Boolean), message: `Missing: ${missing.map((m) => m.label).join(', ')}` };
}

async function resetDubbing(extra: Partial<Pick<db.SessionRow, 'audioTrack' | 'sourceLang' | 'targetLang'>> = {}): Promise<void> {
  const a = sessions.get().active;
  if (!a || !DubixNative) return;
  if (a.jobId) DubixNative.cancelJob(a.jobId);
  DubixNative.deleteSessionFiles(a.session.id);
  await db.deleteSegments(a.session.id);
  const patch = { processedMs: 0, speakerCentroids: null, coveredRanges: [] as db.Range[], status: 'new' as const, ...extra };
  await db.updateSession(a.session.id, patch);
  patchActive((cur) => ({ segments: [], jobId: null, jobState: 'idle', session: { ...cur.session, ...patch } }));
  if (a.playerId) await DubixNative.setDubSegments(a.playerId, []);
}

export async function startDubbing(opts: { mode?: 'prepare' | 'live'; fromMs?: number } = {}): Promise<StartCheck> {
  const n = requireDubix();
  const s = getSettings();
  let a = sessions.get().active;
  if (!a) return { ok: false, code: 'none', missing: [], message: 'No video selected' };
  const fromSubtitles = s.dubSource === 'subtitles';
  const check = checkReady(s.targetLang, s.sourceLang, { fromSubtitles });
  if (!check.ok) return check;

  const choice = fromSubtitles ? getSubtitleChoice(a.session.id) : null;
  if (fromSubtitles && !choice) {
    return { ok: false, code: 'no_subtitle_source', missing: [], message: 'Choose a subtitle track or a subtitle file first.' };
  }
  let cues: Awaited<ReturnType<typeof loadCues>> = [];
  if (choice) {
    try {
      cues = await loadCues(a.session.uri, choice);
    } catch (e) {
      return { ok: false, code: 'subtitle_unreadable', missing: [], message: nativeErrorMessage(e) };
    }
    if (!cues.length) return { ok: false, code: 'subtitle_empty', missing: [], message: 'No dialogue lines were found in these subtitles.' };
  }

  // A change of language or of what the lines come from (speech vs a subtitle source) re-dubs from scratch.
  const sig = sourceSignature(choice);
  if (a.session.targetLang !== s.targetLang || a.session.sourceLang !== s.sourceLang || (getUsedSignature(a.session.id) !== sig && a.segments.length)) {
    await resetDubbing({ targetLang: s.targetLang, sourceLang: s.sourceLang });
    a = sessions.get().active!;
  }
  setUsedSignature(a.session.id, sig);
  if (a.jobId) n.cancelJob(a.jobId);

  const mode = opts.mode ?? s.dubMode;
  const ranges = a.session.coveredRanges;
  const start = opts.fromMs ?? resumePoint(ranges, mode === 'live' ? a.session.lastPositionMs : 0);

  const st = engine.get();
  const lang = getLanguage(s.targetLang)!;
  const fallbackAsr = recommendedAsr(st.device, st.installedIds).id;
  const asr = [s.asrModelId, fallbackAsr, ...st.installed.filter((m) => m.kind === 'asr').map((m) => m.id)].find((id) => id && st.installedIds.has(id)) ?? '';
  const speakerModel = s.speakerDetection && st.installedIds.has('speaker-campplus') ? 'speaker-campplus' : null;
  const voices = availableVoices(s.targetLang, st.installedIds, st.systemVoices);
  const overrides: Record<number, SpeakerOverride> = {};
  for (const sp of a.speakers) if (sp.voiceKey) overrides[sp.speaker] = { voiceKey: sp.voiceKey, pitch: sp.pitch, speed: sp.speed };

  const jobId = newId('j');
  n.startDubbingJob({
    jobId, sessionId: a.session.id, uri: a.session.uri, startMs: start, durationMs: a.session.durationMs,
    sourceLang: s.sourceLang, translateTarget: lang.translateTarget, vadModelId: 'vad-silero', asrModelId: asr,
    speakerModelId: speakerModel, maxSpeakers: s.maxSpeakers, voices: buildVoiceMap(voices, overrides, s.voiceSpeed),
    voicePools: buildVoicePools(voices, s.voiceSpeed),
    userSpeed: 1, maxSpeed: s.maxStretch, maxPauseSec: maxPauseSec(s.silenceTrim), speakerCentroids: a.session.speakerCentroids ?? [],
    maxLeadMs: mode === 'live' ? s.liveLeadSec * 1000 : 0, spillMs: s.spillMs, audioTrack: a.session.audioTrack,
    cues,
  });
  db.touchModels([fromSubtitles ? null : asr, fromSubtitles ? null : 'vad-silero', speakerModel, ...voices.map((v) => v.spec.modelId)].filter((m): m is string => !!m));
  patchActive({ jobId, jobMode: mode, jobStartMs: start, jobState: 'loading', jobCode: null, jobMessage: null, gated: false });
  await db.updateSession(a.session.id, { status: 'processing', error: null, processedMs: start });
  return { ok: true };
}

export function pauseDubbing(): void {
  const a = sessions.get().active;
  if (a?.jobId) DubixNative?.pauseJob(a.jobId);
}

export function resumeDubbing(): void {
  const a = sessions.get().active;
  if (a?.jobId) {
    DubixNative?.resumeJob(a.jobId);
    patchActive({ jobState: 'running' });
  }
}

export function cancelDubbing(): void {
  const a = sessions.get().active;
  if (a?.jobId) DubixNative?.cancelJob(a.jobId);
}

// ---------------- voices & corrections ----------------

async function revoice(segs: db.SegmentRow[], voiceFor: (seg: db.SegmentRow) => { spec: import('dubix-native').VoiceSpec; id: string | null } | null, label: string): Promise<void> {
  const a = sessions.get().active;
  if (!a) return;
  const n = requireDubix();
  const s = getSettings();
  const dir = `${n.getSessionsDir()}/${a.session.id}`;
  patchActive({ regenerating: { label, done: 0, total: segs.length } });
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const v = voiceFor(seg);
    if (!v) continue;
    try {
      const out = await n.synthesize({
        text: seg.translatedText, voice: v.spec, windowMs: seg.endMs - seg.startMs, maxSpeed: s.maxStretch,
        maxPauseSec: maxPauseSec(s.silenceTrim), spillMs: s.spillMs, outPath: `${dir}/seg_${seg.startMs}_${Date.now().toString(36)}.wav`,
      });
      await db.updateSegmentAudio(a.session.id, seg.id, out.path, out.durationMs, out.speed, out.overflowMs, v.id);
      const updated: db.SegmentRow = { ...seg, audioPath: out.path, audioMs: out.durationMs, speed: out.speed, overflowMs: out.overflowMs, voiceId: v.id, processingState: 'synthesized', error: null };
      patchActive((cur) => ({ segments: cur.segments.map((x) => (x.id === seg.id ? updated : x)), regenerating: { label, done: i + 1, total: segs.length } }));
      const pid = sessions.get().active?.playerId;
      if (pid) await n.addDubSegments(pid, segmentRefs([updated]));
    } catch (e) {
      pushWarning({ code: 'voice_unavailable', message: `Could not re-voice a line: ${nativeErrorMessage(e)}` });
    }
  }
  patchActive({ regenerating: null });
}

function voiceResolver() {
  const a = sessions.get().active!;
  const st = engine.get();
  const s = getSettings();
  const voices = availableVoices(a.session.targetLang, st.installedIds, st.systemVoices);
  const map = buildVoiceMap(voices, Object.fromEntries(a.speakers.filter((x) => x.voiceKey).map((x) => [x.speaker, { voiceKey: x.voiceKey!, pitch: x.pitch, speed: x.speed }])), s.voiceSpeed);
  return (seg: db.SegmentRow) => {
    const spec = map[`speaker:${seg.speaker}`] ?? map[seg.register] ?? map.default;
    return spec ? { spec, id: spec.modelId ?? spec.systemVoice ?? null } : null;
  };
}

export async function saveSpeakerVoices(rows: db.SpeakerRow[], regenerate: boolean): Promise<void> {
  const a = sessions.get().active;
  if (!a) return;
  await db.saveVoiceMappings(rows);
  patchActive({ speakers: rows });
  if (!regenerate) return;
  const changed = new Set(rows.map((r) => r.speaker));
  const resolve = voiceResolver();
  await revoice(a.segments.filter((x) => changed.has(x.speaker)), resolve, 'Updating voices');
}

export async function editTranslation(segmentId: string, text: string): Promise<void> {
  const a = sessions.get().active;
  if (!a) return;
  await db.updateTranslation(a.session.id, segmentId, text);
  const seg = a.segments.find((x) => x.id === segmentId);
  if (!seg) return;
  const edited = { ...seg, translatedText: text, edited: true };
  patchActive((cur) => ({ segments: cur.segments.map((x) => (x.id === segmentId ? edited : x)) }));
  await revoice([edited], voiceResolver(), 'Re-voicing line');
}

export async function reassignSpeaker(segmentId: string, speaker: number): Promise<void> {
  const a = sessions.get().active;
  if (!a) return;
  await db.reassignSegmentSpeaker(a.session.id, segmentId, speaker);
  if (!a.speakers.some((x) => x.speaker === speaker)) {
    const row = { sessionId: a.session.id, speaker, label: `Speaker ${speaker + 1}`, voiceKey: null, pitch: 0, speed: 1 };
    await db.saveVoiceMapping(row);
    patchActive((cur) => ({ speakers: [...cur.speakers, row].sort((x, y) => x.speaker - y.speaker) }));
  }
  const seg = { ...a.segments.find((x) => x.id === segmentId)!, speaker };
  patchActive((cur) => ({ segments: cur.segments.map((x) => (x.id === segmentId ? seg : x)) }));
  await revoice([seg], voiceResolver(), 'Re-voicing line');
}

// ---------------- deletion & privacy ----------------

export async function deleteSession(id: string): Promise<void> {
  const n = DubixNative;
  const a = sessions.get().active;
  if (a?.session.id === id) {
    if (a.jobId) n?.cancelJob(a.jobId);
    await detachPlayer();
    sessions.set({ active: null });
  }
  const row = await db.getSession(id);
  n?.deleteSessionFiles(id);
  if (row) n?.releaseUri(row.uri);
  const sub = getSubtitleChoice(id);
  if (sub?.kind === 'file') n?.releaseUri(sub.uri);
  forgetSubtitles(id);
  await db.deleteSession(id);
  await refreshSessions();
}

export async function clearHistory(): Promise<void> {
  const a = sessions.get().active;
  if (a) await deleteSession(a.session.id);
  const removed = await db.clearHistory();
  removed.forEach((s) => {
    DubixNative?.deleteSessionFiles(s.id);
    DubixNative?.releaseUri(s.uri);
  });
  await refreshSessions();
}

/** Deletes generated speech for all sessions; transcripts stay and can be re-voiced. */
export async function clearGeneratedAudio(): Promise<void> {
  const a = sessions.get().active;
  if (a?.jobId) DubixNative?.cancelJob(a.jobId);
  const all = await db.getRecentSessions(10_000);
  all.forEach((s) => DubixNative?.deleteSessionFiles(s.id));
  await db.clearAudioCache();
  if (a) {
    patchActive((cur) => ({ segments: cur.segments.map((x) => ({ ...x, audioPath: null, audioMs: 0, processingState: 'translated' as const })) }));
    if (a.playerId) await DubixNative?.setDubSegments(a.playerId, []);
  }
}

/** Deletes transcripts, translations, speaker data and audio; sessions (files you opened) remain. */
export async function clearTranscriptCache(): Promise<void> {
  await clearGeneratedAudio();
  await db.clearTranscripts();
  const a = sessions.get().active;
  if (a) {
    patchActive((cur) => ({ segments: [], speakers: [], session: { ...cur.session, processedMs: 0, coveredRanges: [], speakerCentroids: null, status: 'new' } }));
  }
  await refreshSessions();
}

// ---------------- native events ----------------

let pending: db.SegmentRow[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lastProgressWrite = 0;

async function flush(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  const batch = pending;
  pending = [];
  await db.saveTranscriptSegments(batch);
}

async function onSegment(e: JobSegmentEvent): Promise<void> {
  const row = db.eventToRow(e);
  pending.push(row);
  flushTimer ??= setTimeout(flush, 800);
  const a = sessions.get().active;
  if (!a || a.session.id !== e.sessionId) return;
  const segments = [...a.segments.filter((s) => s.id !== e.id), row].sort((x, y) => x.startMs - y.startMs);
  let speakers = a.speakers;
  if (!speakers.some((s) => s.speaker === e.speaker)) {
    const sp: db.SpeakerRow = { sessionId: e.sessionId, speaker: e.speaker, label: `Speaker ${e.speaker + 1}`, voiceKey: null, pitch: 0, speed: 1 };
    speakers = [...speakers, sp].sort((x, y) => x.speaker - y.speaker);
    db.saveVoiceMapping(sp);
  }
  patchActive({ segments, speakers });
  if (a.playerId && e.audioPath && DubixNative) await DubixNative.addDubSegments(a.playerId, segmentRefs([row]));
}

function coveredWith(a: ActiveSession, processedMs: number): db.Range[] {
  return addRange(a.session.coveredRanges, [a.jobStartMs, processedMs]);
}

async function onProgress(sessionId: string, processedMs: number): Promise<void> {
  const a = sessions.get().active;
  if (a?.session.id === sessionId && a.jobId) {
    const covered = coveredWith(a, processedMs);
    patchActive((cur) => ({ session: { ...cur.session, processedMs, coveredRanges: covered } }));
    // Reached a part dubbed earlier: skip over it instead of redoing it.
    const next = a.session.coveredRanges.find((r) => r[0] > a.jobStartMs + 1000 && processedMs >= r[0]);
    if (next && next[1] < a.session.durationMs - 1000) {
      await startDubbing({ mode: a.jobMode ?? undefined, fromMs: next[1] });
      return;
    }
  }
  const now = Date.now();
  if (now - lastProgressWrite > 5000) {
    lastProgressWrite = now;
    const cur = sessions.get().active;
    await db.updateSession(sessionId, { processedMs, ...(cur?.session.id === sessionId ? { coveredRanges: cur.session.coveredRanges } : {}) });
  }
}

async function onJobState(e: JobStateEvent): Promise<void> {
  const a = sessions.get().active;
  const mine = a?.session.id === e.sessionId && a.jobId === e.jobId;
  if (a?.session.id === e.sessionId && a.jobId && a.jobId !== e.jobId) return; // superseded job
  const status: Record<JobStateEvent['state'], db.SessionStatus> = {
    loading: 'processing', running: 'processing', waiting: 'processing', paused: 'paused', completed: 'ready', cancelled: 'paused', error: 'error',
  };
  const terminal = e.state === 'completed' || e.state === 'cancelled' || e.state === 'error';
  if (terminal || e.state === 'paused') await flush();

  const covered = mine && a ? coveredWith(a, e.processedMs) : undefined;
  const finishedAll = e.state === 'completed' && covered && covered.length === 1 && covered[0][0] <= 1000;
  await db.updateSession(e.sessionId, {
    status: e.state === 'completed' && !finishedAll && covered ? 'paused' : status[e.state],
    processedMs: e.processedMs,
    error: e.state === 'error' ? e.message : null,
    ...(covered ? { coveredRanges: covered } : {}),
    ...(e.speakerCentroids ? { speakerCentroids: e.speakerCentroids } : {}),
  });
  if (e.state === 'completed') {
    const p = engine.get().jobProgress[e.sessionId];
    if (p) await db.recordMetrics(e.sessionId, p.realtimeFactor, p.perf);
  }
  if (e.state === 'error') {
    db.logDiagnostic('error', e.code ?? 'pipeline_error', e.message ?? 'job error', { sessionId: e.sessionId, processedMs: e.processedMs });
  }
  if (mine) {
    const wasGated = a!.gated && !!a!.playerId;
    patchActive((cur) => ({
      jobState: e.state,
      jobCode: e.code,
      jobMessage: e.message,
      jobId: terminal ? null : cur.jobId,
      gated: terminal ? false : cur.gated,
      session: {
        ...cur.session,
        processedMs: e.processedMs,
        status: status[e.state],
        coveredRanges: covered ?? cur.session.coveredRanges,
        speakerCentroids: e.speakerCentroids ?? cur.session.speakerCentroids,
      },
    }));
    if (terminal && wasGated) await DubixNative?.play(a!.playerId!);
  }
  refreshSessions();
}

let subscribed = false;
export function subscribeDubbingEvents(): void {
  if (subscribed || !DubixNative) return;
  subscribed = true;
  DubixNative.addListener('onJobSegment', onSegment);
  DubixNative.addListener('onJobState', onJobState);
  DubixNative.addListener('onJobProgress', (e) => onProgress(e.sessionId, e.processedMs));
  DubixNative.addListener('onDubState', (e) => {
    const a = sessions.get().active;
    if (a?.playerId !== e.playerId) return;
    const patch: Partial<ActiveSession> = {};
    if (e.latencyMeasured && Math.abs(a.measuredLatencyMs - e.outputLatencyMs) > 15) patch.measuredLatencyMs = e.outputLatencyMs;
    if (Math.abs(a.driftAvgMs - e.driftAvgMs) > 5) patch.driftAvgMs = e.driftAvgMs;
    if (Object.keys(patch).length) patchActive(patch);
  });
}
