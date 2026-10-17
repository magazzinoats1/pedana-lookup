import React, { useCallback, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";

import { api, ApiError, TOKEN_KEY } from "@/src/api";
import { Sheet } from "@/src/components/Sheet";
import { useToast } from "@/src/components/Toast";
import { Button, Field, IconButton } from "@/src/components/ui";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { storage } from "@/src/utils/storage";

type Worker = { id: string; nome: string; createdAt?: string };
const PIN_RE = /^\d{4,6}$/;

export default function Magazzinieri() {
  const [list, setList] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [nome, setNome] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState<{ nome?: string; pin?: string }>({});
  const [busy, setBusy] = useState(false);
  const [pinFor, setPinFor] = useState<Worker | null>(null);
  const [newPin, setNewPin] = useState("");
  const [newPinErr, setNewPinErr] = useState("");
  const [toDelete, setToDelete] = useState<Worker | null>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { colors } = useTheme();
  const styles = useStyles();

  const load = useCallback(async () => {
    try {
      setList(await api<Worker[]>("/magazzinieri"));
    } catch (e: any) {
      if (e instanceof ApiError && e.status === 401) {
        await storage.secureRemove(TOKEN_KEY);
        router.replace("/");
        return;
      }
      toast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [router, toast]);

  useFocusEffect(useCallback(() => void load(), [load]));

  async function aggiungi() {
    const e: typeof err = {};
    if (nome.trim().length < 2) e.nome = "Minimo 2 caratteri";
    if (!PIN_RE.test(pin)) e.pin = "PIN di 4-6 cifre";
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await api("/magazzinieri", { method: "POST", body: { nome: nome.trim(), pin } });
      toast(`${nome.trim()} aggiunto`);
      setNome("");
      setPin("");
      load();
    } catch (e: any) {
      setErr({ nome: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function salvaPin() {
    if (!pinFor) return;
    if (!PIN_RE.test(newPin)) return setNewPinErr("PIN di 4-6 cifre");
    setBusy(true);
    try {
      await api(`/magazzinieri/${pinFor.id}/pin`, { method: "PUT", body: { pin: newPin } });
      toast(`PIN di ${pinFor.nome} aggiornato`);
      setPinFor(null);
    } catch (e: any) {
      setNewPinErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function elimina() {
    if (!toDelete) return;
    setBusy(true);
    try {
      await api(`/magazzinieri/${toDelete.id}`, { method: "DELETE" });
      toast(`${toDelete.nome} eliminato`, "error");
      setToDelete(null);
      load();
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  const onlyDigits = (t: string) => t.replace(/[^0-9]/g, "").slice(0, 6);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <IconButton icon="arrow-left" tone="onBrand" onPress={() => router.back()} testID="magazzinieri-back-button" />
        <Text style={styles.headerTitle}>Magazzinieri e PIN</Text>
      </View>
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nuovo magazziniere</Text>
          <Text style={styles.hint}>Solo chi ha nome e PIN può segnare gli scarichi. Tutti possono vedere la lista.</Text>
          <Field label="Nome e cognome" value={nome} onChangeText={setNome} placeholder="es. Mario Rossi" autoCapitalize="words" error={err.nome} testID="magazzinieri-nome-input" />
          <Field label="PIN (4-6 cifre)" value={pin} onChangeText={(t) => setPin(onlyDigits(t))} placeholder="es. 1234" keyboardType="number-pad" maxLength={6} error={err.pin} testID="magazzinieri-pin-input" />
          <Button label="Aggiungi magazziniere" icon="account-plus-outline" loading={busy && !pinFor && !toDelete} onPress={aggiungi} testID="magazzinieri-add-button" />
        </View>

        <Text style={styles.section} testID="magazzinieri-count">{list.length} magazzinier{list.length === 1 ? "e" : "i"}</Text>
        {loading ? (
          <ActivityIndicator color={colors.brandSecondary} />
        ) : list.length === 0 ? (
          <View style={styles.empty} testID="magazzinieri-empty">
            <MaterialDesignIcons name="account-hard-hat-outline" size={56} color={colors.borderStrong} />
            <Text style={styles.emptyText}>Nessun magazziniere ancora</Text>
          </View>
        ) : (
          list.map((w) => (
            <View key={w.id} style={styles.row} testID={`magazzinieri-row-${w.id}`}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{w.nome.slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text style={styles.rowName} numberOfLines={1}>{w.nome}</Text>
              <IconButton
                icon="form-textbox-password"
                onPress={() => {
                  setNewPin("");
                  setNewPinErr("");
                  setPinFor(w);
                }}
                testID={`magazzinieri-pin-button-${w.id}`}
              />
              <IconButton icon="trash-can-outline" tone="danger" onPress={() => setToDelete(w)} testID={`magazzinieri-delete-button-${w.id}`} />
            </View>
          ))
        )}
      </KeyboardAwareScrollView>

      <Sheet visible={!!pinFor} onClose={() => setPinFor(null)} testID="magazzinieri-pin-sheet">
        <Text style={styles.sheetTitle}>Nuovo PIN per {pinFor?.nome}</Text>
        <Field label="Nuovo PIN (4-6 cifre)" value={newPin} onChangeText={(t) => { setNewPin(onlyDigits(t)); setNewPinErr(""); }} keyboardType="number-pad" maxLength={6} autoFocus error={newPinErr} testID="magazzinieri-new-pin-input" />
        <Button label="Salva PIN" icon="check" loading={busy} onPress={salvaPin} testID="magazzinieri-new-pin-save-button" />
      </Sheet>

      <Sheet visible={!!toDelete} onClose={() => setToDelete(null)} testID="magazzinieri-delete-sheet">
        <Text style={styles.sheetTitle}>Eliminare {toDelete?.nome}?</Text>
        <Text style={styles.hint}>Non potrà più segnare scarichi. Gli scarichi già fatti restano registrati con il suo nome.</Text>
        <View style={styles.btns}>
          <Button label="Elimina" variant="danger" icon="trash-can-outline" loading={busy} onPress={elimina} testID="magazzinieri-delete-confirm-button" />
          <Button label="Annulla" variant="secondary" onPress={() => setToDelete(null)} testID="magazzinieri-delete-cancel-button" />
        </View>
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { backgroundColor: c.brandPrimary, paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  headerTitle: { fontFamily: fonts.display, fontSize: 26, color: c.onBrandPrimary },
  content: { padding: 16, gap: 10 },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: c.border, marginBottom: 8 },
  cardTitle: { fontFamily: fonts.display, fontSize: 22, color: c.brandPrimary },
  hint: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceTertiary, marginBottom: 12 },
  section: { fontFamily: fonts.textBold, fontSize: 13, color: c.muted },
  empty: { alignItems: "center", paddingVertical: 32, gap: 8 },
  emptyText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.muted },
  row: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.surfaceSecondary, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: c.border },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.brandTertiary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.display, fontSize: 20, color: c.brandPrimary },
  rowName: { flex: 1, fontFamily: fonts.textBold, fontSize: 16, color: c.onSurface },
  sheetTitle: { fontFamily: fonts.textBold, fontSize: 19, color: c.onSurface, marginBottom: 12 },
  btns: { gap: 10 },
}));
