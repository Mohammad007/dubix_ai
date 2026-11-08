import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { DubixNative, DubixPlayerView } from 'dubix-native';

import { IconButton } from '@/components/buttons/Button';
import { Slider } from '@/components/controls/Slider';
import { T } from '@/components/primitives/Text';
import { SubtitleOverlay } from '@/components/subtitles/SubtitleOverlay';
import type { SegmentRow } from '@/database';
import type { CaptionMode } from '@/domain/captions';
import type { PlayerSnapshot } from '@/hooks/usePlayer';
import { releaseGate } from '@/services/dubbing';
import { getSettings, updateSettings, useSettings } from '@/store/settings';
import { colors, radius, space } from '@/theme/tokens';
import { formatDuration } from '@/utils/format';

const NEXT_MODE: Record<CaptionMode, CaptionMode> = { translated: 'both', both: 'original', original: 'off', off: 'translated' };
const MODE_LABEL: Record<CaptionMode, string> = { translated: 'Translated captions', both: 'Both captions', original: 'Original captions', off: 'Captions off' };

/** Native video surface + timed captions + playback controls (all controls light-on-dark over video). */
export function VideoStage({
  playerId,
  snap,
  segments,
  targetLang,
  fullscreen,
  gated,
  onToggleFullscreen,
  onOpenOptions,
  onPip,
  showSurface = true,
}: {
  playerId: string | null;
  snap: PlayerSnapshot;
  segments: SegmentRow[];
  targetLang: string;
  fullscreen?: boolean;
  gated?: boolean;
  onToggleFullscreen: () => void;
  onOpenOptions?: () => void;
  onPip?: () => void;
  showSurface?: boolean;
}) {
  const s = useSettings();
  const [seeking, setSeeking] = useState<number | null>(null);
  const pos = seeking ?? snap.positionMs;

  const toggle = () => {
    if (!playerId || !DubixNative) return;
    if (snap.isPlaying) DubixNative.pause(playerId);
    else {
      if (gated) releaseGate();
      DubixNative.play(playerId);
    }
  };

  return (
    <View style={{ backgroundColor: colors.black, borderRadius: fullscreen ? 0 : radius.lg, overflow: 'hidden', aspectRatio: fullscreen ? undefined : 16 / 9, flex: fullscreen ? 1 : undefined }}>
      {DubixPlayerView && showSurface ? <DubixPlayerView playerId={playerId} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
      <Pressable style={{ flex: 1 }} onPress={toggle} accessibilityRole="button" accessibilityLabel={snap.isPlaying ? 'Pause video' : 'Play video'} />

      <View style={{ position: 'absolute', top: space.sm, right: space.sm, flexDirection: 'row', gap: space.xs }}>
        <IconButton
          tone="onVideo"
          icon={s.captionMode === 'off' ? 'captions-off' : 'captions'}
          label={`${MODE_LABEL[s.captionMode]}. Change caption mode`}
          onPress={() => updateSettings({ captionMode: NEXT_MODE[getSettings().captionMode] })}
          style={{ backgroundColor: colors.overlay }}
        />
        {onPip ? <IconButton tone="onVideo" icon="pip" label="Picture in picture" onPress={onPip} style={{ backgroundColor: colors.overlay }} /> : null}
        <IconButton tone="onVideo" icon={fullscreen ? 'fullscreen-exit' : 'fullscreen'} label={fullscreen ? 'Exit full screen' : 'Full screen'} onPress={onToggleFullscreen} style={{ backgroundColor: colors.overlay }} />
      </View>

      {gated ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: '38%', alignSelf: 'center', alignItems: 'center', gap: space.sm, backgroundColor: colors.overlay, borderRadius: radius.md, padding: space.md }}>
          <ActivityIndicator color={colors.onVideo} />
          <T v="bodyStrong" color={colors.onVideo}>
            Preparing dubbing…
          </T>
          <T v="caption" color={colors.onVideoMuted}>
            Tap play to continue without waiting
          </T>
        </View>
      ) : snap.state === 'buffering' ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: '45%', alignSelf: 'center' }}>
          <ActivityIndicator color={colors.onVideo} size="large" />
        </View>
      ) : null}

      <SubtitleOverlay segments={segments} positionMs={snap.positionMs} targetLang={targetLang} scale={fullscreen ? 1.25 : 1} />

      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.xs, backgroundColor: colors.overlay, flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <IconButton tone="onVideo" icon={snap.isPlaying ? 'pause' : 'play'} label={snap.isPlaying ? 'Pause' : 'Play'} onPress={toggle} disabled={!playerId} />
        <T v="mono" color={colors.onVideo}>
          {formatDuration(pos)}
        </T>
        <View style={{ flex: 1, marginHorizontal: space.xs }}>
          <Slider
            onVideo
            label="Seek"
            value={pos}
            min={0}
            max={Math.max(1, snap.durationMs)}
            step={1000}
            formatValue={(v) => formatDuration(v)}
            onChange={setSeeking}
            onCommit={(v) => {
              setSeeking(null);
              if (playerId) DubixNative?.seekTo(playerId, v);
            }}
            disabled={!playerId || snap.durationMs <= 0}
          />
        </View>
        <T v="mono" color={colors.onVideoMuted}>
          {formatDuration(snap.durationMs)}
        </T>
        <IconButton
          tone="onVideo"
          icon={s.dubEnabled ? 'volume' : 'volume-off'}
          label={s.dubEnabled ? 'Dubbed voice on. Turn off' : 'Dubbed voice off. Turn on'}
          onPress={() => updateSettings({ dubEnabled: !s.dubEnabled })}
        />
        {onOpenOptions ? <IconButton tone="onVideo" icon="more" label="Playback options: speed, audio track" onPress={onOpenOptions} /> : null}
      </View>
    </View>
  );
}
