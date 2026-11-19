import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { LogBox, Platform, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/src/components/error-boundary";
import { ToastProvider } from "@/src/components/Toast";
import { queryClient } from "@/src/query-client";
import { useTheme } from "@/src/theme";

// Disable logbox errors etc so that users can see the app
// and agent works as expected.
LogBox.ignoreAllLogs(true)

export default function RootLayout() {
  const { colors } = useTheme();
  const [loaded, error] = useFonts({
    "BarlowCondensed-Bold": require("../assets/fonts/BarlowCondensed-Bold.ttf"),
    "BarlowCondensed-ExtraBold": require("../assets/fonts/BarlowCondensed-ExtraBold.ttf"),
    "BarlowCondensed-SemiBold": require("../assets/fonts/BarlowCondensed-SemiBold.ttf"),
    "IBMPlexSans-Regular": require("../assets/fonts/IBMPlexSans-Regular.ttf"),
    "IBMPlexSans-Medium": require("../assets/fonts/IBMPlexSans-Medium.ttf"),
    "IBMPlexSans-SemiBold": require("../assets/fonts/IBMPlexSans-SemiBold.ttf"),
    "IBMPlexSans-Bold": require("../assets/fonts/IBMPlexSans-Bold.ttf"),
  });

  // One app level ErrorBoundary; a render crash shows a reload screen
  // instead of a blank app.
  if (!loaded && !error) return <View style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} />;

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <KeyboardProvider>
            <ToastProvider>
              <StatusBar style="dark" />
              {/* Web on wide screens: keep the phone-like layout centred and readable */}
              <View style={Platform.OS === "web" ? { flex: 1, backgroundColor: colors.border } : { flex: 1 }}>
                <View style={Platform.OS === "web" ? { flex: 1, width: "100%", maxWidth: 900, alignSelf: "center" } : { flex: 1 }}>
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
                </View>
              </View>
            </ToastProvider>
          </KeyboardProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
