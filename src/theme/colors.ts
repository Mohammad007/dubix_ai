/**
 * Flat palettes (no gradients). Light is the default DubiX look (purple on soft white, matching
 * the reference screens); dark is the optional navy/cyan variant.
 *
 * `colors` is a single mutable object so every component reads the active palette at render
 * time. `applyPalette` swaps it and the root layout remounts the tree.
 */
export type Palette = {
  bg: string;
  surface: string;
  surfaceAlt: string;
  surfacePressed: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentPressed: string;
  accentSoft: string;
  onAccent: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  overlay: string;
  scrim: string;
  shadow: string;
  black: string;
  /** Always-light text drawn over video, independent of theme. */
  onVideo: string;
  onVideoMuted: string;
  statusBar: 'light' | 'dark';
};

export const lightPalette: Palette = {
  bg: '#F8F9FE',
  surface: '#FFFFFF',
  surfaceAlt: '#F0EEFF',
  surfacePressed: '#E4DEFF',
  border: '#E5E7EF',
  text: '#111827',
  textMuted: '#667085',
  textFaint: '#8A94A6',
  accent: '#6848F4',
  accentPressed: '#5635DA',
  accentSoft: '#F0EEFF',
  onAccent: '#FFFFFF',
  success: '#16A34A',
  successSoft: '#E7F7EC',
  warning: '#B45309', // #D97706 fails AA on white for small text; this darker step of the same hue passes
  warningSoft: '#FEF3E2',
  danger: '#DC2626',
  dangerSoft: '#FDECEC',
  overlay: 'rgba(17,24,39,0.72)',
  scrim: 'rgba(17,24,39,0.45)',
  shadow: '#1E1B4B',
  black: '#000000',
  onVideo: '#FFFFFF',
  onVideoMuted: '#D0D5DD',
  statusBar: 'dark',
};

export const darkPalette: Palette = {
  bg: '#101827',
  surface: '#18223A',
  surfaceAlt: '#1F2B46',
  surfacePressed: '#26345A',
  border: '#2A3650',
  text: '#FFFFFF',
  textMuted: '#A9B4C7',
  textFaint: '#7D8AA3',
  accent: '#25BCD6',
  accentPressed: '#1FA3BA',
  accentSoft: '#173A4A',
  onAccent: '#101827',
  success: '#3DD68C',
  successSoft: '#163A33',
  warning: '#F5B544',
  warningSoft: '#3A3222',
  danger: '#FF7A7A',
  dangerSoft: '#3D2230',
  overlay: 'rgba(16,24,39,0.78)',
  scrim: 'rgba(0,0,0,0.6)',
  shadow: '#000000',
  black: '#000000',
  onVideo: '#FFFFFF',
  onVideoMuted: '#D0D5DD',
  statusBar: 'light',
};

export const colors: Palette = { ...lightPalette };

export type ThemeMode = 'light' | 'dark' | 'system';

export function applyPalette(dark: boolean): void {
  Object.assign(colors, dark ? darkPalette : lightPalette);
}
