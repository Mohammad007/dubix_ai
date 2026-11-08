import { DubixNative, requireDubix } from 'dubix-native';

import { checkModel, languageAvailability } from '@/domain/compatibility';
import { getCatalogModel, MODEL_CATALOG } from '@/domain/modelCatalog';
import { getInstalledModels as getModelRows } from '@/database';
import { getSettings } from '@/store/settings';
import { nativeErrorMessage } from '@/utils/nativeError';

import { engine, pushWarning, refreshModels, refreshTranslationPacks } from '@/store/engine';

export function installModel(id: string): void {
  const n = requireDubix();
  if (id.startsWith('mlkit-')) {
    const lang = id.slice('mlkit-'.length);
    n.downloadTranslationPack(lang, getSettings().wifiOnlyDownloads).then(refreshTranslationPacks, (e: Error) =>
      pushWarning({ code: `download_${id}`, message: `Translation pack download failed: ${nativeErrorMessage(e)}` }),
    );
    return;
  }
  const model = getCatalogModel(id);
  if (!model) throw new Error(`Unknown model ${id}`);
  const device = engine.get().device;
  const blocking = device ? checkModel(model, device).filter((i) => i.blocking) : [];
  if (blocking.length) {
    pushWarning({ code: blocking[0].code === 'storage' ? 'insufficient_storage' : `compat_${id}`, message: `${model.title}: ${blocking[0].message}` });
    return;
  }
  n.downloadModel({
    id: model.id, version: model.version, kind: model.kind, url: model.url, sha256: model.sha256,
    sizeBytes: model.sizeBytes, archive: model.archive, fileName: model.fileName, wifiOnly: getSettings().wifiOnlyDownloads,
  });
}

export function cancelInstall(id: string): void {
  DubixNative?.cancelDownload(id);
}

export async function removeModel(id: string): Promise<void> {
  const n = requireDubix();
  if (id.startsWith('mlkit-')) {
    await n.deleteTranslationPack(id.slice('mlkit-'.length));
    await refreshTranslationPacks();
    return;
  }
  await n.deleteModel(id);
  refreshModels();
}

/** Everything still missing for the currently selected language pair. */
export function missingForCurrentPair(): string[] {
  const s = getSettings();
  const st = engine.get();
  const a = languageAvailability(s.targetLang, s.sourceLang, {
    installed: st.installedIds,
    translationPacks: st.translationPacks,
    systemVoices: st.systemVoices,
    translatable: st.translatable,
  });
  return a.requirements.filter((r) => !r.satisfied && r.installId).map((r) => r.installId!);
}

/** Deletes optional packs not used within the configured number of days. Required packs are kept. */
export async function autoDeleteUnused(): Promise<string[]> {
  const days = getSettings().autoDeleteUnusedDays;
  if (!DubixNative || days <= 0) return [];
  const cutoff = Date.now() - days * 86_400_000;
  const removed: string[] = [];
  const rows = new Map((await getModelRows()).map((r) => [r.id, r]));
  for (const m of engine.get().installed) {
    const cat = getCatalogModel(m.id);
    if (cat?.required) continue;
    const last = rows.get(m.id)?.lastUsedAt ?? m.installedAt;
    if (last < cutoff) {
      await DubixNative.deleteModel(m.id);
      removed.push(m.id);
    }
  }
  if (removed.length) refreshModels();
  return removed;
}

export const OPTIONAL_KINDS_ORDER = ['vad', 'asr', 'speaker', 'tts'] as const;
export const catalogByKind = (kind: string) => MODEL_CATALOG.filter((m) => m.kind === kind);
