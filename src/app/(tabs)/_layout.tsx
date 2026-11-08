import { Redirect } from 'expo-router';
import { Tabs } from 'expo-router/tabs';

import { TabBar } from '@/navigation/TabBar';
import { useLayout } from '@/hooks/useLayout';
import { useSettings } from '@/store/settings';
import { colors } from '@/theme/tokens';

export default function TabsLayout() {
  const { isTablet } = useLayout();
  const { onboardingDone } = useSettings();
  if (!onboardingDone) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} rail={isTablet} />}
      screenOptions={{ headerShown: false, tabBarPosition: isTablet ? 'left' : 'bottom', sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="translate" options={{ title: 'Translate' }} />
      <Tabs.Screen name="player" options={{ title: 'Player' }} />
      <Tabs.Screen name="voices" options={{ title: 'Voices' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
