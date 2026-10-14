import React from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts, makeStyles } from "@/src/theme";

export function AppHeader({ subtitle, right }: { subtitle: string; right?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 10 }]} testID="app-header">
      <View style={styles.logoBox}>
        <Image source={require("../../assets/images/logo.png")} style={styles.logo} contentFit="contain" />
      </View>
      <View style={styles.flex}>
        <Text style={styles.title} numberOfLines={1}>Gestione Logistica</Text>
        <Text style={styles.sub} numberOfLines={1} testID="app-header-subtitle">{subtitle}</Text>
      </View>
      {right}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  header: { backgroundColor: c.brandPrimary, paddingHorizontal: 16, paddingBottom: 14, flexDirection: "row", alignItems: "center", gap: 12 },
  logoBox: { backgroundColor: c.surfaceSecondary, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 4 },
  logo: { width: 64, height: 30 },
  flex: { flex: 1 },
  title: { fontFamily: fonts.display, fontSize: 22, color: c.onBrandPrimary },
  sub: { fontFamily: fonts.textMedium, fontSize: 12, color: c.brandSoftText },
}));
