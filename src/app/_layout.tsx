import { OpenFeatureProvider } from "@openfeature/react-sdk";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppProvider, useSessionState, useUpgradeRequired } from "../AppContext";
import { startErrors } from "../errors";
import { flagProvider, startFlags } from "../flags";
import { protectScreens } from "../privacy";
import { SignInScreen } from "../screens/SignInScreen";
import { UpdateScreen } from "../screens/UpdateScreen";
import { createServices, type Services } from "../services";
import { Body, Screen, Title } from "../ui/components";

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Gate() {
  const state = useSessionState();
  const upgrade = useUpgradeRequired();
  if (upgrade) return <UpdateScreen />;
  if (state === "signedOut") return <SignInScreen />;
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  const [services, setServices] = useState<Services | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    createServices()
      .then(async (s) => {
        startErrors(s.config);
        await protectScreens(s.config.phi);
        void startFlags(flagProvider(s.config.origin));
        setServices(s);
      })
      .catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e)))
      .finally(() => void SplashScreen.hideAsync().catch(() => undefined));
  }, []);

  return (
    <SafeAreaProvider>
      {failure ? (
        <Screen>
          <Title>The app couldn't start</Title>
          <Body muted>{failure}</Body>
        </Screen>
      ) : services ? (
        <OpenFeatureProvider>
          <AppProvider services={services}>
            <Gate />
          </AppProvider>
        </OpenFeatureProvider>
      ) : null}
    </SafeAreaProvider>
  );
}
