import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";
import * as Haptics from "expo-haptics";

import { api, formatDateTime, Pedana, Stato } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { Button } from "@/src/components/ui";
import { fonts, makeStyles, useTheme } from "@/src/theme";

type Props = { pedana: Pedana; onUpdated: (p: Pedana) => void; operatore: string | null; onRequestName: () => void };

export function StatoToggle({ pedana, onUpdated, operatore, onRequestName }: Props) {
  const [showParziale, setShowParziale] = useState(false);
  const [note, setNote] = useState(pedana.noteParziale || "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { colors } = useTheme();
  const styles = useStyles();
  const stato = pedana.statoArrivo || "attesa";

  async function update(s: Stato, noteParziale = "") {
    setBusy(true);
    try {
      const p = await api<Pedana>(`/pedane/${pedana.id}/stato`, { method: "PATCH", body: { stato: s, noteParziale, operatore } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onUpdated(p);
      setShowParziale(false);
      if (s === "attesa") setNote("");
      toast(s === "completo" ? "Scarico completo registrato" : s === "parziale" ? "Arrivo parziale registrato" : "Stato annullato");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!operatore)
    return (
      <View style={styles.col} testID="stato-readonly">
        {stato === "attesa" ? (
          <View style={[styles.statusBox, { backgroundColor: colors.brandTertiary, borderColor: colors.brandSecondary }]} testID="stato-badge-attesa">
            <MaterialDesignIcons name="clock-outline" size={30} color={colors.brandSecondary} />
            <Text style={[styles.statusTitle, { color: colors.onBrandTertiary }]}>In attesa di scarico</Text>
          </View>
        ) : (
          <StatusInfo pedana={pedana} />
        )}
        <Pressable onPress={onRequestName} style={({ pressed }) => [styles.lockBtn, pressed && { opacity: 0.8 }]} testID="stato-richiedi-nome-button">
          <MaterialDesignIcons name="account-lock-outline" size={22} color={colors.onWarningTint} />
          <Text style={styles.lockText}>Inserisci il tuo nome per segnare lo scarico</Text>
        </Pressable>
      </View>
    );

  if (showParziale)
    return (
      <View style={styles.parzBox} testID="stato-parziale-form">
        <Text style={styles.parzTitle}>Arrivo Parziale</Text>
        <TextInput
          testID="stato-parziale-note-input"
          value={note}
          onChangeText={setNote}
          multiline
          placeholder="Es: arrivata 1 paletta su 3, mancano colli n°4-10..."
          placeholderTextColor={colors.muted}
          style={styles.parzInput}
        />
        <View style={styles.row}>
          <Button label="Conferma" variant="warning" icon="check" loading={busy} onPress={() => update("parziale", note)} testID="stato-parziale-confirm-button" style={styles.flex} />
          <Button label="Annulla" variant="secondary" onPress={() => setShowParziale(false)} testID="stato-parziale-cancel-button" style={styles.flex} />
        </View>
      </View>
    );

  if (stato === "attesa")
    return (
      <View style={styles.col}>
        <Big
          testID="stato-segna-completo-button"
          icon="check-circle-outline"
          title="Segna Scaricato"
          sub="Tutta la merce è arrivata"
          bg={colors.successTint}
          fg={colors.onSuccessTint}
          border={colors.success}
          onPress={() => update("completo")}
          disabled={busy}
        />
        <Big
          testID="stato-segna-parziale-button"
          icon="circle-half-full"
          title="Arrivo Parziale"
          sub="Merce arrivata in parte"
          bg={colors.warningTint}
          fg={colors.onWarningTint}
          border={colors.warning}
          onPress={() => setShowParziale(true)}
          disabled={busy}
        />
      </View>
    );

  if (stato === "parziale")
    return (
      <View style={styles.col}>
        <StatusInfo pedana={pedana} />
        <View style={styles.row}>
          <Button label="Segna Completo" variant="success" icon="check-all" loading={busy} onPress={() => update("completo")} testID="stato-completa-button" style={styles.flex} />
          <Button label="Annulla" variant="danger" icon="close" onPress={() => update("attesa")} testID="stato-annulla-button" />
        </View>
      </View>
    );

  return (
    <View style={styles.col}>
      <StatusInfo pedana={pedana} />
      <Button label="Annulla stato" variant="danger" icon="close" loading={busy} onPress={() => update("attesa")} testID="stato-annulla-button" />
    </View>
  );
}

function StatusInfo({ pedana }: { pedana: Pedana }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const da = (n?: string) => (n ? ` · da ${n}` : "");
  if (pedana.statoArrivo === "parziale")
    return (
      <View style={[styles.statusBox, { backgroundColor: colors.warningTint, borderColor: colors.warning }]} testID="stato-badge-parziale">
        <MaterialDesignIcons name="circle-half-full" size={30} color={colors.warning} />
        <View style={styles.flex}>
          <Text style={[styles.statusTitle, { color: colors.onWarningTint }]}>Arrivo Parziale</Text>
          {!!pedana.arrivoParzialeAt && (
            <Text style={[styles.statusSub, { color: colors.onWarningTint }]} testID="stato-parziale-by">
              {formatDateTime(pedana.arrivoParzialeAt)}
              {da(pedana.arrivoParzialeDa)}
            </Text>
          )}
          {!!pedana.noteParziale && <Text style={[styles.statusNote, { color: colors.onWarningTint }]}>{pedana.noteParziale}</Text>}
        </View>
      </View>
    );
  return (
    <View style={[styles.statusBox, { backgroundColor: colors.successTint, borderColor: colors.success }]} testID="stato-badge-completo">
      <MaterialDesignIcons name="check-circle" size={30} color={colors.success} />
      <View style={styles.flex}>
        <Text style={[styles.statusTitle, { color: colors.onSuccessTint }]}>Scaricato — Completo</Text>
        {!!pedana.arrivoCompletoAt && (
          <Text style={[styles.statusSub, { color: colors.onSuccessTint }]} testID="stato-completo-by">
            {formatDateTime(pedana.arrivoCompletoAt)}
            {da(pedana.arrivoCompletoDa)}
          </Text>
        )}
        {!!pedana.arrivoParzialeAt && (
          <Text style={[styles.statusNote, { color: colors.onWarningTint }]}>
            Parziale: {formatDateTime(pedana.arrivoParzialeAt)}
            {da(pedana.arrivoParzialeDa)}
            {pedana.noteParziale ? ` — ${pedana.noteParziale}` : ""}
          </Text>
        )}
      </View>
    </View>
  );
}

function Big(p: { icon: string; title: string; sub: string; bg: string; fg: string; border: string; onPress: () => void; disabled?: boolean; testID: string }) {
  const styles = useStyles();
  return (
    <Pressable
      testID={p.testID}
      onPress={p.onPress}
      disabled={p.disabled}
      style={({ pressed }) => [styles.big, { backgroundColor: p.bg, borderColor: p.border, opacity: pressed ? 0.8 : 1 }]}
    >
      <MaterialDesignIcons name={p.icon as any} size={34} color={p.border} />
      <View style={styles.flex}>
        <Text style={[styles.bigTitle, { color: p.fg }]}>{p.title}</Text>
        <Text style={[styles.bigSub, { color: p.fg }]}>{p.sub}</Text>
      </View>
      <MaterialDesignIcons name="chevron-right" size={26} color={p.border} />
    </Pressable>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  col: { gap: 10 },
  row: { flexDirection: "row", gap: 10 },
  big: { minHeight: 72, borderWidth: 2, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 14 },
  bigTitle: { fontFamily: fonts.textBold, fontSize: 17 },
  bigSub: { fontFamily: fonts.text, fontSize: 13, opacity: 0.8 },
  statusBox: { borderWidth: 2, borderRadius: 12, padding: 14, flexDirection: "row", alignItems: "center", gap: 14 },
  statusTitle: { fontFamily: fonts.textBold, fontSize: 17 },
  statusSub: { fontFamily: fonts.textMedium, fontSize: 13 },
  statusNote: { fontFamily: fonts.text, fontSize: 13, marginTop: 4 },
  lockBtn: { minHeight: 56, borderRadius: 12, borderWidth: 2, borderStyle: "dashed", borderColor: c.warning, backgroundColor: c.warningTint, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 12 },
  lockText: { fontFamily: fonts.textBold, fontSize: 14, color: c.onWarningTint, flexShrink: 1 },
  parzBox: { backgroundColor: c.warningTint, borderColor: c.warning, borderWidth: 2, borderRadius: 12, padding: 14, gap: 10 },
  parzTitle: { fontFamily: fonts.textBold, fontSize: 16, color: c.onWarningTint },
  parzInput: {
    minHeight: 84,
    borderWidth: 1.5,
    borderColor: c.warning,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    fontFamily: fonts.text,
    color: c.onSurface,
    backgroundColor: c.surfaceSecondary,
    textAlignVertical: "top",
  },
}));
