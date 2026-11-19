import React from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";

import { Button } from "@/src/components/ui";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function NotFound() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.wrap} testID="not-found-screen">
      <MaterialDesignIcons name="map-marker-question-outline" size={56} color={colors.brandPrimary} />
      <Text style={styles.title}>Pagina non trovata</Text>
      <Text style={styles.sub}>{"L'indirizzo aperto non esiste. Torna alla pagina iniziale per continuare."}</Text>
      <Button label="Torna alla home" icon="home" onPress={() => router.replace("/")} testID="not-found-home-button" />
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12, backgroundColor: c.surface },
  title: { fontFamily: fonts.display, fontSize: 30, color: c.onSurface },
  sub: { fontFamily: fonts.text, fontSize: 15, color: c.onSurfaceSecondary, textAlign: "center", maxWidth: 360, marginBottom: 8 },
}));
