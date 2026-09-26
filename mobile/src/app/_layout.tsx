import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { useTheme } from '@/constants/theme';
import { AuthProvider, useAuth } from '@/lib/auth';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <StatusBar style="auto" />
        <Screens />
      </AuthProvider>
    </ThemeProvider>
  );
}

function Screens() {
  const { status, user } = useAuth();
  const theme = useTheme();

  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync();
  }, [status]);
  if (status === 'loading') return null;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.background },
      }}>
      <Stack.Protected guard={status === 'signedIn'}>
        <Stack.Screen name="index" options={{ headerShown: false, title: 'Assistant' }} />
        <Stack.Protected guard={user?.role === 'super_admin'}>
          <Stack.Screen name="admin/index" options={{ title: 'Accounts' }} />
          <Stack.Screen name="admin/[userId]" options={{ title: 'Account' }} />
        </Stack.Protected>
      </Stack.Protected>
      <Stack.Protected guard={status === 'signedOut'}>
        <Stack.Screen name="sign-in" options={{ headerShown: false, title: 'Sign in' }} />
      </Stack.Protected>
    </Stack>
  );
}
