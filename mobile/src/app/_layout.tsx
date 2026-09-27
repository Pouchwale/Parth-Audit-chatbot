import { Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Colors, navigationTheme, useColorSchemeSetting } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ConversationsProvider } from '@/lib/conversations';
import { SettingsProvider } from '@/lib/settings';

SplashScreen.preventAutoHideAsync();

// Opening /settings or /admin directly (e.g. reloading the page) still puts the chat underneath, to go back to.
export const unstable_settings = { anchor: '(app)' };

export default function RootLayout() {
  return (
    <SettingsProvider>
      <AuthProvider>
        <ConversationsProvider>
          <ThemedApp />
        </ConversationsProvider>
      </AuthProvider>
    </SettingsProvider>
  );
}

function ThemedApp() {
  const scheme = useColorSchemeSetting();
  const background = Colors[scheme].background;

  useEffect(() => {
    // The window behind the app (and the page on web), seen during transitions and overscroll.
    void SystemUI.setBackgroundColorAsync(background);
    if (Platform.OS === 'web') document.documentElement.style.colorScheme = scheme;
  }, [background, scheme]);

  return (
    <ThemeProvider value={navigationTheme(scheme)}>
      {/* An explicit style: 'auto' follows the device, not the choice made in Settings. */}
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Screens />
    </ThemeProvider>
  );
}

function Screens() {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync();
  }, [status]);
  if (status === 'loading') return null;

  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="(app)" options={{ headerShown: false, title: 'Assistant' }} />
        <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        <Stack.Protected guard={user?.role === 'super_admin'}>
          <Stack.Screen name="admin/index" options={{ title: 'Accounts' }} />
          <Stack.Screen name="admin/[userId]" options={{ title: 'Account' }} />
          <Stack.Screen name="admin/security" options={{ title: 'Security' }} />
          <Stack.Screen name="admin/exports/[exportId]" options={{ title: 'Download' }} />
          <Stack.Screen name="admin/reports/[weekStart]" options={{ title: 'Weekly report' }} />
        </Stack.Protected>
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="sign-in" options={{ headerShown: false, title: 'Sign in' }} />
      </Stack.Protected>
    </Stack>
  );
}
