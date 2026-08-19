import { Stack } from 'expo-router';

import { earning } from '@/theme';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: earning.bg },
        animation: 'slide_from_right',
      }}
    />
  );
}
