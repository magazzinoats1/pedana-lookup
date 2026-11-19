import React, { useEffect, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";

import { api, BACKEND_ORIGIN, TOKEN_KEY } from "@/src/api";
import { Sheet } from "@/src/components/Sheet";
import { Button, Field } from "@/src/components/ui";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { storage } from "@/src/utils/storage";

let splashShown = false;

export default function Accesso() {
  const [splash, setSplash] = useState(!splashShown);
  const [coop, setCoop] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();

  useEffect(() => {
    if (!splash) return;
    const t = setTimeout(() => {
      splashShown = true;
      setSplash(false);
    }, 2400);
    return () => clearTimeout(t);
  }, [splash]);

  useEffect(() => {
    api<{ cooperativa: string }>("/settings").then((s) => setCoop(s.cooperativa)).catch(() => {});
  }, []);

  async function apriUfficio() {
    const t = await storage.secureGet(TOKEN_KEY, null);
    if (t) {
      try {
        await api("/auth/me");
        router.push("/ufficio");
        return;
      } catch {
        await storage.secureRemove(TOKEN_KEY);
      }
    }
    setShowPass(true);
  }

  async function login() {
    if (!password) return setErrore("Inserisci la password");
    setBusy(true);
    try {
      const r = await api<{ token: string }>("/auth/login", { method: "POST", body: { password } });
      await storage.secureSet(TOKEN_KEY, r.token);
      setShowPass(false);
      setPassword("");
      setErrore("");
      router.push("/ufficio");
    } catch (e: any) {
      setErrore(e.status === 401 ? "Password errata" : e.message);
    } finally {
      setBusy(false);
    }
  }

  if (splash)
    return (
      <Animated.View exiting={FadeOut.duration(400)} style={styles.splash} testID="splash-screen">
        <Animated.View entering={ZoomIn.duration(700)}>
          <Image source={require("../assets/images/logo.png")} style={styles.splashLogo} contentFit="contain" />
        </Animated.View>
        <Animated.Text entering={FadeIn.delay(500)} style={styles.splashText}>
          Gestione Logistica
        </Animated.Text>
      </Animated.View>
    );

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]} testID="accesso-screen">
      <View style={styles.center}>
        <Animated.View entering={FadeInDown.duration(400)} style={styles.brand}>
          <View style={styles.logoCard}>
            <Image source={require("../assets/images/logo.png")} style={styles.logo} contentFit="contain" />
          </View>
          <Text style={styles.title}>Gestione Logistica</Text>
          <Text style={styles.subtitle}>Antolini Trasporti e Spedizioni</Text>
          {!!coop && <Text style={styles.coop} testID="accesso-cooperativa">Cooperativa: {coop}</Text>}
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(120).duration(400)}>
          <Pressable testID="accesso-ufficio-button" onPress={apriUfficio} style={({ pressed }) => [styles.roleWhite, pressed && styles.pressed]}>
            <View style={styles.roleIconWhite}>
              <MaterialDesignIcons name="monitor-dashboard" size={30} color={colors.brandPrimary} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.roleTitleDark}>Accesso Ufficio</Text>
              <Text style={styles.roleSubDark}>Registrazione e gestione ordini</Text>
            </View>
            <MaterialDesignIcons name="lock-outline" size={22} color={colors.muted} />
          </Pressable>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(220).duration(400)}>
          <Pressable testID="accesso-magazzino-button" onPress={() => router.push("/magazzino")} style={({ pressed }) => [styles.roleGlass, pressed && styles.pressed]}>
            <View style={styles.roleIconGlass}>
              <MaterialDesignIcons name="warehouse" size={30} color={colors.onBrand} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.roleTitleLight}>Accesso Magazzino</Text>
              <Text style={styles.roleSubLight}>Ricerca e scarico merce</Text>
            </View>
            <MaterialDesignIcons name="arrow-right" size={24} color={colors.onBrand} />
          </Pressable>
        </Animated.View>
        <Pressable
          testID="accesso-privacy-link"
          onPress={() => Linking.openURL(`${BACKEND_ORIGIN}/api/privacy`)}
          hitSlop={12}
          style={styles.privacy}
        >
          <Text style={styles.privacyText}>Informativa privacy</Text>
        </Pressable>
      </View>

      <Sheet visible={showPass} onClose={() => setShowPass(false)} testID="ufficio-password-sheet">
        <View style={styles.sheetHead}>
          <MaterialDesignIcons name="shield-lock-outline" size={36} color={colors.brandPrimary} />
          <Text style={styles.sheetTitle}>Accesso Ufficio</Text>
        </View>
        <Field
          label="Password"
          testID="ufficio-password-input"
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            setErrore("");
          }}
          secureTextEntry
          autoFocus
          autoCapitalize="none"
          placeholder="Password..."
          onSubmitEditing={login}
          returnKeyType="go"
          error={errore}
        />
        <Button label="Entra" icon="login" onPress={login} loading={busy} testID="ufficio-login-button" />
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  splash: { flex: 1, backgroundColor: c.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  splashLogo: { width: 280, height: 125 },
  splashText: { marginTop: 24, fontFamily: fonts.textMedium, color: c.muted, letterSpacing: 1, fontSize: 14 },
  root: { flex: 1, backgroundColor: c.surfaceSecondary, paddingHorizontal: 20 },
  center: { flex: 1, justifyContent: "center", gap: 14, maxWidth: 460, width: "100%", alignSelf: "center" },
  brand: { alignItems: "center", marginBottom: 18 },
  logoCard: { backgroundColor: c.surfaceSecondary, borderRadius: 16, paddingHorizontal: 20, paddingVertical: 12 },
  logo: { width: 160, height: 72 },
  title: { fontFamily: fonts.displayHeavy, fontSize: 34, color: c.brandPrimary, marginTop: 18 },
  subtitle: { fontFamily: fonts.textMedium, fontSize: 15, color: c.muted },
  coop: { fontFamily: fonts.textMedium, fontSize: 13, color: c.onBrandTertiary, marginTop: 6 },
  roleWhite: { backgroundColor: c.surfaceSecondary, borderWidth: 2, borderColor: c.border, borderRadius: 14, padding: 18, minHeight: 84, flexDirection: "row", alignItems: "center", gap: 14 },
  roleGlass: {
    backgroundColor: c.brandPrimary,
    borderColor: c.brandPrimary,
    borderWidth: 2,
    borderRadius: 14,
    padding: 18,
    minHeight: 84,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  privacy: { alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
  privacyText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.muted, textDecorationLine: "underline" },
  roleIconWhite: { width: 52, height: 52, borderRadius: 12, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  roleIconGlass: { width: 52, height: 52, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  roleTitleDark: { fontFamily: fonts.textBold, fontSize: 17, color: c.brandPrimary },
  roleSubDark: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  roleTitleLight: { fontFamily: fonts.textBold, fontSize: 17, color: c.onBrand },
  roleSubLight: { fontFamily: fonts.text, fontSize: 13, color: c.brandSoftText },
  sheetHead: { alignItems: "center", gap: 6, marginBottom: 16 },
  sheetTitle: { fontFamily: fonts.display, fontSize: 26, color: c.brandPrimary },
}));
