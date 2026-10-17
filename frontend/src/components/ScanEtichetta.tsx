import React, { useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";

import { api } from "@/src/api";
import { Sheet } from "@/src/components/Sheet";
import { useToast } from "@/src/components/Toast";
import { Button } from "@/src/components/ui";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { uploadForm } from "@/src/utils/upload";

type Candidato = { codice: string; pedane: number };

export function ScanEtichetta({ onCode, big }: { onCode: (code: string) => void; big?: boolean }) {
  const [perm, setPerm] = useState<"none" | "ask" | "blocked">("none");
  const [reading, setReading] = useState(false);
  const [scelte, setScelte] = useState<Candidato[] | null>(null);
  const toast = useToast();
  const { colors } = useTheme();
  const styles = useStyles();

  async function avvia() {
    const p = await ImagePicker.getCameraPermissionsAsync();
    if (p.granted) return scatta();
    setPerm(p.canAskAgain ? "ask" : "blocked");
  }

  async function chiediPermesso() {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (p.granted) {
      setPerm("none");
      scatta();
    } else setPerm(p.canAskAgain ? "ask" : "blocked");
  }

  async function scatta() {
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6 });
    if (!res.canceled && res.assets?.[0]) leggi(res.assets[0].uri, res.assets[0].mimeType);
  }

  async function galleria() {
    setPerm("none");
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6 });
    if (!res.canceled && res.assets?.[0]) leggi(res.assets[0].uri, res.assets[0].mimeType);
  }

  async function leggi(uri: string, mime?: string | null) {
    setReading(true);
    try {
      const type = mime || "image/jpeg";
      const form = await uploadForm("file", uri, type === "image/png" ? "etichetta.png" : "etichetta.jpg", type);
      const r = await api<{ candidati: Candidato[] }>("/scan-etichetta", { method: "POST", form });
      const found = r.candidati.filter((c) => c.pedane > 0);
      if (found.length === 1 || (found.length > 0 && r.candidati.length === 1)) {
        onCode(found[0].codice);
        toast(`Letto: ${found[0].codice}`);
      } else if (r.candidati.length > 0) {
        setScelte(r.candidati);
      } else {
        toast("Nessun codice letto: riprova con più luce e più vicino", "error");
      }
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setReading(false);
    }
  }

  return (
    <>
      {big ? (
        <Pressable onPress={avvia} disabled={reading} style={({ pressed }) => [styles.bigBtn, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]} testID="magazzino-scan-button">
          <MaterialDesignIcons name="camera" size={30} color={colors.onBrandSecondary} />
          <View style={styles.bigTextWrap}>
            <Text style={styles.bigTitle}>Fotografa la posizione</Text>
            <Text style={styles.bigSub}>Scatta al cartello e vedi dove va la merce</Text>
          </View>
        </Pressable>
      ) : (
        <Pressable onPress={avvia} disabled={reading} hitSlop={6} style={({ pressed }) => [styles.btn, pressed && { opacity: 0.8 }]} testID="magazzino-scan-button">
          <MaterialDesignIcons name="camera-outline" size={26} color={colors.onBrandPrimary} />
        </Pressable>
      )}

      <Modal visible={reading} transparent animationType="fade">
        <View style={styles.overlay} testID="scan-reading-overlay">
          <View style={styles.readingBox}>
            <ActivityIndicator size="large" color={colors.brandSecondary} />
            <Text style={styles.readingText}>Lettura etichetta…</Text>
          </View>
        </View>
      </Modal>

      <Sheet visible={perm !== "none"} onClose={() => setPerm("none")} testID="scan-permission-sheet">
        <View style={styles.head}>
          <MaterialDesignIcons name="camera-outline" size={44} color={colors.brandPrimary} />
          <Text style={styles.title}>Fotografa l&apos;etichetta</Text>
          <Text style={styles.sub}>
            {perm === "blocked"
              ? "L'accesso alla fotocamera è disattivato. Attivalo nelle impostazioni del telefono."
              : "Serve la fotocamera per leggere la posizione stampata sull'etichetta e trovare subito la pedana."}
          </Text>
        </View>
        <View style={styles.btns}>
          {perm === "blocked" ? (
            <Button label="Apri impostazioni" icon="cog-outline" onPress={() => { setPerm("none"); Linking.openSettings(); }} testID="scan-open-settings-button" />
          ) : (
            <Button label="Consenti fotocamera" icon="camera" onPress={chiediPermesso} testID="scan-allow-camera-button" />
          )}
          <Button label="Scegli dalla galleria" variant="secondary" icon="image-outline" onPress={galleria} testID="scan-gallery-button" />
        </View>
      </Sheet>

      <Sheet visible={!!scelte} onClose={() => setScelte(null)} testID="scan-choices-sheet">
        <Text style={styles.title}>Quale codice cerchi?</Text>
        <Text style={[styles.sub, styles.subLeft]}>Ho letto questi codici dall&apos;etichetta</Text>
        <View style={styles.btns}>
          {(scelte ?? []).map((c) => (
            <Pressable
              key={c.codice}
              onPress={() => {
                setScelte(null);
                onCode(c.codice);
              }}
              style={({ pressed }) => [styles.choice, pressed && { opacity: 0.8 }]}
              testID={`scan-choice-${c.codice}`}
            >
              <Text style={styles.choiceCode}>{c.codice}</Text>
              <Text style={[styles.choiceN, c.pedane === 0 && { color: colors.muted }]}>{c.pedane > 0 ? `${c.pedane} pedane` : "non registrato"}</Text>
            </Pressable>
          ))}
        </View>
      </Sheet>
    </>
  );
}

const useStyles = makeStyles((c) => ({
  btn: { width: 52, height: 52, borderRadius: 12, backgroundColor: c.brandSecondary, alignItems: "center", justifyContent: "center" },
  bigBtn: { minHeight: 60, borderRadius: 14, backgroundColor: c.brandSecondary, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 16, marginTop: 10 },
  bigTextWrap: { flex: 1 },
  bigTitle: { fontFamily: fonts.textBold, fontSize: 17, color: c.onBrandSecondary },
  bigSub: { fontFamily: fonts.textMedium, fontSize: 12, color: c.onBrandSecondary, opacity: 0.85 },
  overlay: { flex: 1, backgroundColor: c.scrim, alignItems: "center", justifyContent: "center" },
  readingBox: { backgroundColor: c.surfaceSecondary, borderRadius: 16, padding: 24, alignItems: "center", gap: 12, minWidth: 220 },
  readingText: { fontFamily: fonts.textBold, fontSize: 16, color: c.onSurface },
  head: { alignItems: "center", gap: 6, marginBottom: 16 },
  title: { fontFamily: fonts.textBold, fontSize: 19, color: c.onSurface, textAlign: "center" },
  sub: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceTertiary, textAlign: "center" },
  subLeft: { marginBottom: 12, marginTop: 4 },
  btns: { gap: 10 },
  choice: { minHeight: 60, borderRadius: 12, borderWidth: 1.5, borderColor: c.borderStrong, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  choiceCode: { fontFamily: fonts.display, fontSize: 24, color: c.onSurface },
  choiceN: { fontFamily: fonts.textBold, fontSize: 13, color: c.onSuccessTint },
}));
