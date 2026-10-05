import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';

// Previene que la pantalla de carga se oculte antes de tiempo
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [appLista, setAppLista] = useState(false);

  useEffect(() => {
    async function prepararApp() {
      try {
        // Inicializaciones o peticiones asíncronas iniciales
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (e) {
        console.warn(e);
      } finally {
        setAppLista(true);
        await SplashScreen.hideAsync();
      }
    }

    prepararApp();
  }, []);

  if (!appLista) {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ title: 'Pastillero ESP32' }} />
    </Stack>
  );
}