import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, useFonts } from '@expo-google-fonts/inter';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { getDb } from '@/database';
import { cleanupOrphans, enforceAudioCacheLimit, refreshSessions, subscribeDubbingEvents } from '@/services/dubbing';
import { autoDeleteUnused } from '@/services/models';
import { bootEngine, pushWarning } from '@/store/engine';
import { useSetting } from '@/store/settings';
import { applyPalette, colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold });
  const [booted, setBooted] = useState(false);
  const mode = useSetting('themeMode');
  const scheme = useColorScheme();
  const dark = mode === 'dark' || (mode === 'system' && scheme === 'dark');
  // The palette is swapped before children render; keying the tree on it re-renders every screen.
  applyPalette(dark);

  // Never block the first screen on fonts: if Inter is slow to load, render with the system font
  // and switch to Inter when it arrives.
  const [fontTimeout, setFontTimeout] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFontTimeout(true), 4000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const t0 = Date.now();
    const step = (name: string) => console.log(`[startup] ${name} +${Date.now() - t0} ms`);
    (async () => {
      try {
        bootEngine();
        subscribeDubbingEvents();
        await getDb();
        step('database');
        await refreshSessions();
        step('sessions');
      } catch (e) {
        pushWarning({ code: 'startup', message: `Startup problem: ${(e as Error).message}` });
      } finally {
        setBooted(true);
      }
      // Housekeeping runs after the first screen is visible.
      try {
        await cleanupOrphans();
        const removed = await autoDeleteUnused();
        if (removed.length) pushWarning({ code: 'auto_deleted', message: `Removed ${removed.length} unused model pack(s) to free space.` });
        const evicted = await enforceAudioCacheLimit();
        if (evicted) pushWarning({ code: 'audio_cache_trimmed', message: `Generated audio of ${evicted} older session(s) was removed to stay within the cache limit. Transcripts were kept.` });
        step('housekeeping');
      } catch (e) {
        pushWarning({ code: 'startup', message: `Startup housekeeping failed: ${(e as Error).message}` });
      }
    })();
  }, []);

  const ready = booted && (fontsLoaded || !!fontError || fontTimeout);
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  const base = dark ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, background: colors.bg, card: colors.surface, text: colors.text, border: colors.border, primary: colors.accent } };

  return (
    <SafeAreaProvider key={dark ? 'dark' : 'light'}>
      <ThemeProvider value={theme}>
        <StatusBar style={colors.statusBar === 'dark' ? 'dark' : 'light'} />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
          <Stack.Screen name="language" />
          <Stack.Screen name="floating" />
          <Stack.Screen name="sync" />
          <Stack.Screen name="models" />
          <Stack.Screen name="permissions" />
          <Stack.Screen name="history" />
          <Stack.Screen name="session/[id]" />
          <Stack.Screen name="subtitles" />
          <Stack.Screen name="privacy" />
          <Stack.Screen name="about" />
        </Stack>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
