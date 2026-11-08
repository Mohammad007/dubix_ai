import {
  AArrowDown, AArrowUp, ArrowLeft, ArrowLeftRight, ArrowRight, AudioLines, AudioWaveform, Bell, Bluetooth, Captions, CaptionsOff,
  ChartColumn, Check, ChevronDown, ChevronRight, Circle, CircleAlert, CircleCheck, CircleDot, CircleUserRound, CircleX, Clapperboard,
  Clock, Cpu, Database, Download, EllipsisVertical, Eraser, FileText, Film, Folder, FolderOpen, Gauge, Globe, GripVertical, Headphones,
  History, Hourglass, House, Info, Languages, Layers, LoaderCircle, Maximize, Mic, MicOff, Minimize, Minus, Moon, Music, Pause, Pencil,
  PictureInPicture2, Play, Plus, Radio, RefreshCw, Scissors, Search, Settings, ShieldCheck, SlidersHorizontal, Smartphone, Sparkles,
  Speaker, Square, SquarePlay, Sun, Timer, Trash2, TriangleAlert, User, Users, Volume2, VolumeX, Wifi, X, Zap,
  type LucideIcon,
} from 'lucide-react-native';

import { colors } from '@/theme/tokens';

/** Semantic icon names → Lucide line icons (one consistent stroke style across the app). */
const ICONS = {
  home: House, translate: Languages, player: SquarePlay, voices: Mic, settings: Settings,
  mic: Mic, 'mic-off': MicOff, folder: Folder, 'folder-open': FolderOpen, live: Radio, waveform: AudioLines, 'audio-wave': AudioWaveform,
  users: Users, user: User, 'user-voice': CircleUserRound,
  'chevron-right': ChevronRight, 'chevron-down': ChevronDown, back: ArrowLeft, next: ArrowRight, more: EllipsisVertical,
  check: Check, 'check-circle': CircleCheck, warning: TriangleAlert, error: CircleAlert, info: Info, close: X, 'close-circle': CircleX,
  download: Download, trash: Trash2, bell: Bell, bluetooth: Bluetooth, headphones: Headphones, speaker: Speaker,
  chip: Cpu, storage: Database, captions: Captions, 'captions-off': CaptionsOff, fullscreen: Maximize, 'fullscreen-exit': Minimize,
  pause: Pause, play: Play, stop: Square, plus: Plus, minus: Minus, volume: Volume2, 'volume-off': VolumeX, speed: Gauge,
  music: Music, scissors: Scissors, shield: ShieldCheck, phone: Smartphone, layers: Layers, pip: PictureInPicture2, wifi: Wifi,
  edit: Pencil, search: Search, swap: ArrowLeftRight, sync: RefreshCw, bolt: Zap, clapper: Clapperboard, film: Film,
  'text-smaller': AArrowDown, 'text-larger': AArrowUp, drag: GripVertical, 'radio-off': Circle, 'radio-on': CircleDot,
  clock: Clock, sliders: SlidersHorizontal, sparkles: Sparkles, globe: Globe, file: FileText, history: History, moon: Moon, sun: Sun,
  eraser: Eraser, chart: ChartColumn, timer: Timer, hourglass: Hourglass, loading: LoaderCircle, dot: CircleDot,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22, color = colors.text, strokeWidth = 1.9 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const C = ICONS[name];
  return <C size={size} color={color} strokeWidth={strokeWidth} />;
}
