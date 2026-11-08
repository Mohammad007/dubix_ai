import { createMMKV } from 'react-native-mmkv';

import { requireDubix, type Cue, type SubtitleTrack } from 'dubix-native';

import { createStore } from '@/store/createStore';

/**
 * Which subtitles a local movie is dubbed from: an embedded text track or a .srt/.vtt/.ass file.
 * Dubbing from subtitles skips speech recognition, so it is faster and uses the movie's exact
 * line timings. Choices are remembered per session (MMKV); parsed cues are cached in memory.
 */
export type SubtitleChoice = { kind: 'track'; index: number; label: string } | { kind: 'file'; uri: string; name: string };

const storage = createMMKV({ id: 'dubix-subtitles' });
const choiceKey = (id: string) => `choice.${id}`;
const usedKey = (id: string) => `used.${id}`;

export const subtitleChoices = createStore<Record<string, SubtitleChoice | null>>({});
const cueCache = new Map<string, Cue[]>();

export function getSubtitleChoice(sessionId: string): SubtitleChoice | null {
  const cur = subtitleChoices.get()[sessionId];
  if (cur !== undefined) return cur;
  let c: SubtitleChoice | null = null;
  try {
    const raw = storage.getString(choiceKey(sessionId));
    c = raw ? (JSON.parse(raw) as SubtitleChoice) : null;
  } catch {
    c = null;
  }
  subtitleChoices.set({ [sessionId]: c });
  return c;
}

export function useSubtitleChoice(sessionId: string): SubtitleChoice | null {
  return subtitleChoices.useValue((s) => (s[sessionId] === undefined ? null : s[sessionId]));
}

export function setSubtitleChoice(sessionId: string, c: SubtitleChoice | null): void {
  if (c) storage.set(choiceKey(sessionId), JSON.stringify(c));
  else storage.remove(choiceKey(sessionId));
  subtitleChoices.set({ [sessionId]: c });
}

export function forgetSubtitles(sessionId: string): void {
  storage.remove(choiceKey(sessionId));
  storage.remove(usedKey(sessionId));
  subtitleChoices.set({ [sessionId]: null });
}

/** Identifies what produced a session's dubbed lines, so switching source re-dubs from scratch. */
export function sourceSignature(c: SubtitleChoice | null): string {
  if (!c) return 'speech';
  return c.kind === 'track' ? `track:${c.index}` : `file:${c.uri}`;
}
export const getUsedSignature = (sessionId: string) => storage.getString(usedKey(sessionId)) ?? 'speech';
export const setUsedSignature = (sessionId: string, sig: string) => storage.set(usedKey(sessionId), sig);

export async function listSubtitleTracks(videoUri: string): Promise<SubtitleTrack[]> {
  return requireDubix().getSubtitleTracks(videoUri);
}

export async function pickSubtitleFile(): Promise<SubtitleChoice | null> {
  const f = await requireDubix().pickSubtitleFile();
  return f ? { kind: 'file', uri: f.uri, name: f.name } : null;
}

export async function loadCues(videoUri: string, c: SubtitleChoice): Promise<Cue[]> {
  const key = `${videoUri}|${sourceSignature(c)}`;
  const hit = cueCache.get(key);
  if (hit) return hit;
  const n = requireDubix();
  const cues = c.kind === 'track' ? await n.loadSubtitleCues(videoUri, c.index, null) : await n.loadSubtitleCues(null, null, c.uri);
  cueCache.set(key, cues);
  return cues;
}

export function trackLabel(t: SubtitleTrack): string {
  const fmt = t.mime.includes('subrip') ? 'SRT' : t.mime.includes('ssa') ? 'ASS' : t.mime.includes('vtt') ? 'WebVTT' : 'Text';
  return `${t.language ? t.language.toUpperCase() : `Track ${t.index + 1}`} · ${fmt}`;
}
