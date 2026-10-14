import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { api } from "@/src/api";
import { Sheet } from "@/src/components/Sheet";
import { useToast } from "@/src/components/Toast";
import { Button, Field } from "@/src/components/ui";
import { fonts, makeStyles } from "@/src/theme";

type Props = { visible: boolean; onClose: () => void; cooperativa: string; onCoopSaved: (c: string) => void };

export function SettingsSheet({ visible, onClose, cooperativa, onCoopSaved }: Props) {
  const [coop, setCoop] = useState(cooperativa);
  const [pw, setPw] = useState({ vecchia: "", nuova: "", conferma: "" });
  const [err, setErr] = useState("");
  const [busyCoop, setBusyCoop] = useState(false);
  const [busyPw, setBusyPw] = useState(false);
  const toast = useToast();
  const styles = useStyles();

  useEffect(() => {
    if (visible) {
      setCoop(cooperativa);
      setPw({ vecchia: "", nuova: "", conferma: "" });
      setErr("");
    }
  }, [visible, cooperativa]);

  async function salvaCoop() {
    setBusyCoop(true);
    try {
      const r = await api<{ cooperativa: string }>("/settings/cooperativa", { method: "PUT", body: { cooperativa: coop } });
      onCoopSaved(r.cooperativa);
      toast("Cooperativa salvata");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusyCoop(false);
    }
  }

  async function cambiaPw() {
    if (pw.nuova.length < 4) return setErr("Minimo 4 caratteri");
    if (pw.nuova !== pw.conferma) return setErr("Le password non coincidono");
    setBusyPw(true);
    try {
      await api("/auth/change-password", { method: "POST", body: { vecchia: pw.vecchia, nuova: pw.nuova } });
      toast("Password aggiornata!");
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusyPw(false);
    }
  }

  const set = (k: keyof typeof pw) => (t: string) => {
    setPw((p) => ({ ...p, [k]: t }));
    setErr("");
  };

  return (
    <Sheet visible={visible} onClose={onClose} testID="settings-sheet">
      <Text style={styles.title}>Impostazioni</Text>
      <Text style={styles.section}>Cooperativa</Text>
      <Field label="Nome cooperativa" value={coop} onChangeText={setCoop} placeholder="es. Coop Verona" testID="settings-coop-input" />
      <Button label="Salva cooperativa" variant="ghost" icon="content-save-outline" loading={busyCoop} onPress={salvaCoop} testID="settings-coop-save-button" />

      <View style={styles.divider} />
      <Text style={styles.section}>Cambia password ufficio</Text>
      <Field label="Password attuale" value={pw.vecchia} onChangeText={set("vecchia")} secureTextEntry autoCapitalize="none" testID="settings-pw-old-input" />
      <Field label="Nuova password" value={pw.nuova} onChangeText={set("nuova")} secureTextEntry autoCapitalize="none" testID="settings-pw-new-input" />
      <Field label="Conferma password" value={pw.conferma} onChangeText={set("conferma")} secureTextEntry autoCapitalize="none" testID="settings-pw-confirm-input" error={err} />
      <Button label="Aggiorna password" icon="key-outline" loading={busyPw} onPress={cambiaPw} testID="settings-pw-save-button" />
    </Sheet>
  );
}

const useStyles = makeStyles((c) => ({
  title: { fontFamily: fonts.display, fontSize: 28, color: c.brandPrimary, marginBottom: 8 },
  section: { fontFamily: fonts.textBold, fontSize: 14, color: c.onSurfaceSecondary, marginBottom: 10, marginTop: 4 },
  divider: { height: 1, backgroundColor: c.divider, marginVertical: 20 },
}));
