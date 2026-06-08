import { Stack } from 'expo-router';

import { AppSessionProvider } from '@/context/AppSessionContext';

export default function RootLayout() {
  return (
    <AppSessionProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </AppSessionProvider>
  );
}
