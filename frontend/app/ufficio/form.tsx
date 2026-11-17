import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { KeyboardAwareScrollView, KeyboardStickyView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";

import { api, ImportResult, isTrasbordo, OrdineForm, Pedana, PedanaRow, TRASPORTATORE_DEFAULT } from "@/src/api";
import { Sheet } from "@/src/components/Sheet";
import { useToast } from "@/src/components/Toast";
import { Button, Field, IconButton } from "@/src/components/ui";
import { fonts, makeStyles, useTheme } from "@/src/theme";

const emptyForm = { numeroOrdine: "", agenzia: "", trasportatore: TRASPORTATORE_DEFAULT, note: "" };
const emptyRow: PedanaRow = { codice: "", destinazione: "", numeroColli: "", numeroPedane: "", mittente: "", merce: "", dataArrivo: "", oraArrivo: "" };

type Errors = {
  numeroOrdine?: string;
  data?: string;
  rows?: Record<number, { codice?: string; destinazione?: string; mittente?: string; dataArrivo?: string; oraArrivo?: string }>;
  internalDup?: number[];
};
type DupResult = { codiceMatches: { codice: string; match: Pedana }[]; numeroMatches: Pedana[] };

const isoToIt = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
};
const itToIso = (s: string) => {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  if (d.getMonth() !== Number(m[2]) - 1) return null;
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};
const dayIt = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

const STICKY_H = 88;

const toApiRow = (r: PedanaRow): PedanaRow => ({ ...r, dataArrivo: itToIso(r.dataArrivo) ?? "", oraArrivo: r.oraArrivo.trim() });

export default function OrdineFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editingId = id || null;
  const [form, setForm] = useState(emptyForm);
  const [data, setData] = useState("");
  const [rows, setRows] = useState<PedanaRow[]>([{ ...emptyRow }]);
  const [errors, setErrors] = useState<Errors>({});
  const [loading, setLoading] = useState(!!editingId);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importInfo, setImportInfo] = useState("");
  const [dragging, setDragging] = useState(false);
  const [dup, setDup] = useState<DupResult | null>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { colors } = useTheme();
  const styles = useStyles();

  useEffect(() => {
    if (!editingId) return;
    api<Pedana>(`/pedane/${editingId}`)
      .then((o) => {
        setForm({ numeroOrdine: o.numeroOrdine, agenzia: o.agenzia, trasportatore: o.trasportatore || TRASPORTATORE_DEFAULT, note: o.note });
        setData(isoToIt(o.dataConsegna));
        setRows([{ codice: o.codice, destinazione: o.destinazione, numeroColli: o.numeroColli, numeroPedane: o.numeroPedane || "", mittente: o.mittente, merce: o.merce || "", dataArrivo: isoToIt(o.dataArrivo || ""), oraArrivo: o.oraArrivo || "" }]);
      })
      .catch((e) => toast(e.message, "error"))
      .finally(() => setLoading(false));
  }, [editingId, toast]);

  // Web: drag & drop a PDF anywhere on the screen to import it
  const uploadRef = useRef<(fd: FormData, name: string) => Promise<void>>(async () => {});
  uploadRef.current = uploadPdf;
  useEffect(() => {
    if (Platform.OS !== "web" || editingId || typeof document === "undefined") return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        toast("Trascina un file PDF", "error");
        return;
      }
      const fd = new FormData();
      fd.append("file", file);
      uploadRef.current(fd, file.name);
    };
    document.addEventListener("dragenter", onEnter);
    document.addEventListener("dragover", onOver);
    document.addEventListener("dragleave", onLeave);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragenter", onEnter);
      document.removeEventListener("dragover", onOver);
      document.removeEventListener("dragleave", onLeave);
      document.removeEventListener("drop", onDrop);
    };
  }, [editingId, toast]);

  const setF = (k: keyof typeof emptyForm) => (t: string) => setForm((f) => ({ ...f, [k]: t }));
  const setRow = (i: number, k: keyof PedanaRow, v: string) => {
    setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    setErrors((e) => (e.rows?.[i] ? { ...e, rows: { ...e.rows, [i]: { ...e.rows[i], [k]: undefined } } } : e));
  };

  async function importaPdf() {
    const res = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const fd = new FormData();
    if (Platform.OS === "web" && a.file) fd.append("file", a.file);
    else fd.append("file", { uri: a.uri, name: a.name || "ordine.pdf", type: "application/pdf" } as any);
    await uploadPdf(fd, a.name || "ordine.pdf");
  }

  async function uploadPdf(fd: FormData, name: string) {
    const a = { name };
    setImporting(true);
    setImportInfo("");
    try {
      const r = await api<ImportResult>("/import-pdf", { method: "POST", form: fd });
      setForm({ numeroOrdine: r.numeroOrdine, agenzia: r.agenzia, trasportatore: r.trasportatore || TRASPORTATORE_DEFAULT, note: r.note });
      setData(isoToIt(r.dataConsegna));
      setRows(
        r.pedane.length
          ? r.pedane.map((p) => ({ ...p, dataArrivo: isoToIt(p.dataArrivo) }))
          : [{ ...emptyRow }],
      );
      setErrors({});
      setImportInfo(`${r.pedane.length} pedane lette da "${a.name}". Controlla i dati prima di registrare.`);
      toast("PDF importato");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setImporting(false);
    }
  }

  function validate(): { e: Errors; iso: string | null } {
    const e: Errors = {};
    if (!form.numeroOrdine.trim()) e.numeroOrdine = "Obbligatorio";
    const iso = itToIso(data);
    if (!data.trim()) e.data = "Obbligatorio";
    else if (!iso) e.data = "Formato GG/MM/AAAA";
    const rowErr: Errors["rows"] = {};
    rows.forEach((r, i) => {
      const re: { codice?: string; destinazione?: string; mittente?: string; dataArrivo?: string; oraArrivo?: string } = {};
      if (r.dataArrivo.trim() && !itToIso(r.dataArrivo)) re.dataArrivo = "Formato GG/MM/AAAA";
      if (r.oraArrivo.trim() && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(r.oraArrivo.trim())) re.oraArrivo = "Formato HH:MM";
      if (!r.codice.trim()) re.codice = "Obbligatorio";
      if (!r.mittente.trim()) re.mittente = "Obbligatorio";
      if (!r.destinazione.trim()) re.destinazione = "Obbligatorio";
      if (Object.keys(re).length) rowErr[i] = re;
    });
    if (Object.keys(rowErr).length) e.rows = rowErr;
    return { e, iso };
  }

  async function doSave() {
    const iso = itToIso(data)!;
    const payloadForm: OrdineForm = { ...form, mittente: "", dataConsegna: iso };
    setSaving(true);
    try {
      if (editingId) {
        await api(`/pedane/${editingId}`, { method: "PUT", body: { form: payloadForm, pedana: toApiRow(rows[0]) } });
        toast("Ordine modificato");
      } else {
        const created = await api<Pedana[]>("/pedane", { method: "POST", body: { form: payloadForm, pedane: rows.map(toApiRow) } });
        toast(created.length > 1 ? `${created.length} pedane registrate` : "Ordine registrato");
      }
      setDup(null);
      if (router.canGoBack()) router.back();
      else router.replace("/ufficio");
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    const { e } = validate();
    if (Object.keys(e).length) {
      setErrors(e);
      toast("Compila i campi obbligatori", "error");
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const d = await api<DupResult>("/pedane/duplicati", {
        method: "POST",
        body: { numeroOrdine: editingId ? "" : form.numeroOrdine, codici: [], excludeId: editingId },
      });
      setSaving(false);
      if (d.codiceMatches.length || d.numeroMatches.length) {
        setDup(d);
        return;
      }
      await doSave();
    } catch (err: any) {
      setSaving(false);
      toast(err.message, "error");
    }
  }

  if (loading)
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator size="large" color={colors.brandSecondary} />
      </View>
    );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <IconButton icon="arrow-left" tone="onBrand" onPress={() => (router.canGoBack() ? router.back() : router.replace("/ufficio"))} testID="form-back-button" />
        <Text style={styles.headerTitle}>{editingId ? "Modifica Ordine" : "Nuovo Ordine"}</Text>
      </View>

      <KeyboardAwareScrollView
        bottomOffset={STICKY_H + 16}
        contentContainerStyle={[styles.content, { paddingBottom: STICKY_H + insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
      >
        {!editingId && (
          <Pressable testID="form-import-pdf-button" onPress={importaPdf} disabled={importing} style={({ pressed }) => [styles.importCard, dragging && styles.importCardDrag, pressed && { opacity: 0.85 }]}>
            {importing ? (
              <ActivityIndicator color={colors.brandSecondary} size="large" />
            ) : (
              <MaterialDesignIcons name={dragging ? "tray-arrow-down" : "file-pdf-box"} size={40} color={dragging ? colors.onBrandSecondary : colors.brandSecondary} />
            )}
            <View style={styles.flex}>
              <Text style={[styles.importTitle, dragging && { color: colors.onBrandSecondary }]}>
                {importing ? "Lettura PDF in corso…" : dragging ? "Rilascia qui il PDF" : "Importa da PDF"}
              </Text>
              <Text style={[styles.importSub, dragging && { color: colors.onBrandSecondary }]}>
                {importing
                  ? "L'AI sta estraendo ordine e posizioni"
                  : Platform.OS === "web"
                    ? "Tocca per scegliere o trascina qui il PDF: i campi si compilano da soli"
                    : "Carica l'ordine di trasporto: i campi si compilano da soli"}
              </Text>
            </View>
          </Pressable>
        )}
        {!!importInfo && (
          <Animated.View entering={FadeInDown} style={styles.importInfo} testID="form-import-info">
            <MaterialDesignIcons name="check-decagram" size={20} color={colors.onSuccessTint} />
            <Text style={styles.importInfoText}>{importInfo}</Text>
          </Animated.View>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Dati ordine</Text>
          <View style={styles.orderBox}>
            <Field label="NUMERO ORDINE *" highlight value={form.numeroOrdine} onChangeText={setF("numeroOrdine")} placeholder="es. 25023467" error={errors.numeroOrdine} testID="form-numero-ordine-input" autoCapitalize="characters" />
          </View>
          <Field
            label="Trasportatore"
            value={form.trasportatore}
            onChangeText={setF("trasportatore")}
            placeholder="es. Antolini Trasporti"
            testID="form-trasportatore-input"
            hint={isTrasbordo(form.trasportatore) ? undefined : "Antolini Trasporti: trasporto diretto"}
          />
          <View style={styles.quickDates}>
            <Pressable onPress={() => setF("trasportatore")(TRASPORTATORE_DEFAULT)} style={[styles.qChip, !isTrasbordo(form.trasportatore) && styles.qChipActive]} testID="form-trasportatore-antolini-chip">
              <Text style={[styles.qChipText, !isTrasbordo(form.trasportatore) && styles.qChipTextActive]}>Antolini Trasporti</Text>
            </Pressable>
            <Pressable onPress={() => setF("trasportatore")("")} style={[styles.qChip, isTrasbordo(form.trasportatore) && styles.qChipWarn]} testID="form-trasportatore-altro-chip">
              <Text style={[styles.qChipText, isTrasbordo(form.trasportatore) && styles.qChipTextActive]}>Altro (trasbordo)</Text>
            </Pressable>
          </View>
          {isTrasbordo(form.trasportatore) && (
            <View style={styles.trasbordoBox} testID="form-trasbordo-warning">
              <MaterialDesignIcons name="swap-horizontal-bold" size={20} color={colors.onWarningTint} />
              <Text style={styles.trasbordoText}>Trasbordo: merce portata da {form.trasportatore.trim()}</Text>
            </View>
          )}
          <Field label="Agenzia" value={form.agenzia} onChangeText={setF("agenzia")} placeholder="Chi ha ordinato" testID="form-agenzia-input" />
          <Field
            label="Data consegna cliente *"
            value={data}
            onChangeText={setData}
            placeholder="GG/MM/AAAA"
            keyboardType="numbers-and-punctuation"
            error={errors.data}
            testID="form-data-input"
          />
          <View style={styles.quickDates}>
            {[["Oggi", 0], ["Domani", 1], ["Dopodomani", 2]].map(([l, o]) => (
              <Pressable key={l} onPress={() => setData(dayIt(o as number))} style={styles.qChip} testID={`form-data-${String(l).toLowerCase()}-chip`}>
                <Text style={styles.qChipText}>{l}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="Note" value={form.note} onChangeText={setF("note")} placeholder="Istruzioni speciali…" multiline testID="form-note-input" style={styles.noteInput} />
        </View>

        <View style={styles.card}>
          <View style={styles.rowHead}>
            <Text style={[styles.cardTitle, { color: colors.onSuccessTint }]}>
              Pedane / Posizioni {rows.length > 1 ? `(${rows.length})` : ""}
            </Text>
          </View>
          {!editingId && <Text style={styles.rowHint}>Stesso ordine, più pedane (anche con la stessa posizione)</Text>}
          {rows.map((r, i) => {
            const re = errors.rows?.[i];
            return (
              <Animated.View key={i} entering={FadeInDown.duration(200)} exiting={FadeOut} style={styles.rowCard} testID={`form-pedana-row-${i}`}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowNum}>#{i + 1}</Text>
                  {rows.length > 1 && (
                    <IconButton icon="trash-can-outline" tone="danger" onPress={() => setRows((p) => p.filter((_, j) => j !== i))} testID={`form-pedana-remove-button-${i}`} />
                  )}
                </View>
                <Field
                  label="Posizione *"
                  value={r.codice}
                  onChangeText={(t) => setRow(i, "codice", t)}
                  placeholder="es. 2619-019320"
                  error={re?.codice}
                  testID={`form-pedana-codice-input-${i}`}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  style={styles.codeInput}
                />
                <Field label="Mittente *" value={r.mittente} onChangeText={(t) => setRow(i, "mittente", t)} placeholder="es. Orchidea, Bertoli Fruit…" error={re?.mittente} testID={`form-pedana-mittente-input-${i}`} />
                <View style={styles.twoCol}>
                  <View style={styles.flex2}>
                    <Field label="Destinazione *" value={r.destinazione} onChangeText={(t) => setRow(i, "destinazione", t)} placeholder="Cliente / reparto / zona" error={re?.destinazione} testID={`form-pedana-destinazione-input-${i}`} />
                  </View>
                  <View style={styles.flex}>
                    <Field label="N° Colli" value={r.numeroColli} onChangeText={(t) => setRow(i, "numeroColli", t.replace(/[^0-9]/g, ""))} placeholder="es. 84" keyboardType="number-pad" testID={`form-pedana-colli-input-${i}`} />
                  </View>
                  <View style={styles.flex}>
                    <Field label="N° Pedane" value={r.numeroPedane} onChangeText={(t) => setRow(i, "numeroPedane", t.replace(/[^0-9]/g, ""))} placeholder="es. 1" keyboardType="number-pad" testID={`form-pedana-numero-pedane-input-${i}`} />
                  </View>
                </View>
                <Field label="Tipo merce" value={r.merce} onChangeText={(t) => setRow(i, "merce", t)} placeholder="es. Uva rossa senza semi, Radicchio…" testID={`form-pedana-merce-input-${i}`} />
                <View style={styles.twoCol}>
                  <View style={styles.flex2}>
                    <Field label="Arrivo in magazzino" value={r.dataArrivo} onChangeText={(t) => setRow(i, "dataArrivo", t)} placeholder="GG/MM/AAAA" keyboardType="numbers-and-punctuation" error={re?.dataArrivo} hint="Giorno dopo la partenza dal fornitore" testID={`form-pedana-data-arrivo-input-${i}`} />
                  </View>
                  <View style={styles.flex}>
                    <Field label="Ora" value={r.oraArrivo} onChangeText={(t) => setRow(i, "oraArrivo", t)} placeholder="HH:MM" keyboardType="numbers-and-punctuation" error={re?.oraArrivo} testID={`form-pedana-ora-arrivo-input-${i}`} />
                  </View>
                </View>
              </Animated.View>
            );
          })}
          {!editingId && (
            <Pressable onPress={() => setRows((p) => [...p, { ...emptyRow }])} style={styles.addRow} testID="form-add-pedana-button">
              <MaterialDesignIcons name="plus-circle-outline" size={22} color={colors.onSuccessTint} />
              <Text style={styles.addRowText}>Aggiungi un&apos;altra pedana</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAwareScrollView>

      <KeyboardStickyView offset={{ opened: insets.bottom }}>
        <View style={[styles.sticky, { paddingBottom: insets.bottom + 12 }]}>
          <Button
            label={editingId ? "Salva modifiche" : rows.length > 1 ? `Registra ${rows.length} pedane` : "Registra ordine"}
            icon="content-save-outline"
            loading={saving}
            onPress={handleSave}
            testID="form-save-button"
          />
        </View>
      </KeyboardStickyView>

      <Sheet visible={!!dup} onClose={() => setDup(null)} testID="form-dup-sheet">
        {dup && (
          <View>
            <View style={styles.dupHead}>
              <MaterialDesignIcons name={dup.codiceMatches.length ? "alert" : "information-outline"} size={40} color={dup.codiceMatches.length ? colors.warning : colors.brandSecondary} />
              <Text style={styles.dupTitle}>
                {dup.codiceMatches.length
                  ? dup.codiceMatches.length === 1
                    ? "Posizione già registrata!"
                    : `${dup.codiceMatches.length} posizioni già registrate!`
                  : "Ordine già registrato"}
              </Text>
              <Text style={styles.dupSub}>
                {dup.codiceMatches.length
                  ? "Queste posizioni sono già assegnate ad altri ordini:"
                  : `Il numero ordine "${form.numeroOrdine}" ha già ${dup.numeroMatches.length} pedan${dup.numeroMatches.length === 1 ? "a" : "e"}. Se è una nuova pedana dello stesso ordine, conferma.`}
              </Text>
            </View>
            {(dup.codiceMatches.length ? dup.codiceMatches.map((m) => m.match) : dup.numeroMatches).map((m) => (
              <View key={m.id} style={styles.dupItem} testID={`form-dup-item-${m.codice}`}>
                <View style={styles.flex}>
                  <Text style={styles.dupCode}>{m.codice}</Text>
                  <Text style={styles.dupMeta} numberOfLines={2}>
                    Ord. {m.numeroOrdine} · {m.mittente} → {m.destinazione}
                  </Text>
                </View>
                <IconButton
                  icon="pencil-outline"
                  onPress={() => {
                    setDup(null);
                    router.replace({ pathname: "/ufficio/form", params: { id: m.id } });
                  }}
                  testID={`form-dup-edit-button-${m.codice}`}
                />
              </View>
            ))}
            <View style={styles.dupBtns}>
              <Button
                label={dup.codiceMatches.length ? "Registra comunque" : "Conferma nuova pedana"}
                variant={dup.codiceMatches.length ? "warning" : "success"}
                icon="check"
                loading={saving}
                onPress={doSave}
                testID="form-dup-confirm-button"
              />
              <Button label="Annulla, correggo" variant="secondary" onPress={() => setDup(null)} testID="form-dup-cancel-button" />
            </View>
          </View>
        )}
      </Sheet>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  center: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1 },
  flex2: { flex: 2 },
  header: { backgroundColor: c.brandPrimary, paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  headerTitle: { fontFamily: fonts.display, fontSize: 26, color: c.onBrandPrimary },
  content: { padding: 16, gap: 14 },
  importCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    minHeight: 84,
    padding: 16,
    borderRadius: 14,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: c.brandSecondary,
    backgroundColor: c.brandTertiary,
  },
  importCardDrag: { backgroundColor: c.brandSecondary, borderStyle: "solid", minHeight: 120 },
  importTitle: { fontFamily: fonts.textBold, fontSize: 17, color: c.brandPrimary },
  importSub: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceTertiary },
  importInfo: { flexDirection: "row", gap: 8, backgroundColor: c.successTint, borderRadius: 10, padding: 12, alignItems: "center" },
  importInfoText: { flex: 1, fontFamily: fonts.textMedium, fontSize: 13, color: c.onSuccessTint },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: c.border },
  cardTitle: { fontFamily: fonts.display, fontSize: 22, color: c.brandPrimary, marginBottom: 12 },
  orderBox: { backgroundColor: c.brandTertiary, borderRadius: 10, padding: 12, paddingBottom: 0, marginBottom: 14 },
  quickDates: { flexDirection: "row", gap: 8, marginTop: -6, marginBottom: 14 },
  qChip: { height: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: c.surfaceTertiary, justifyContent: "center", flexShrink: 0 },
  qChipActive: { backgroundColor: c.brandPrimary },
  qChipWarn: { backgroundColor: c.warning },
  qChipTextActive: { color: c.onBrandPrimary },
  trasbordoBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.warningTint, borderRadius: 10, padding: 10, marginBottom: 14, marginTop: -4 },
  trasbordoText: { flex: 1, fontFamily: fonts.textBold, fontSize: 13, color: c.onWarningTint },
  qChipText: { fontFamily: fonts.textSemi, fontSize: 13, color: c.onSurfaceTertiary },
  noteInput: { minHeight: 72, paddingTop: 12, textAlignVertical: "top" },
  rowHead: { flexDirection: "row", alignItems: "center" },
  rowHint: { fontFamily: fonts.text, fontSize: 12, color: c.muted, marginTop: -8, marginBottom: 12 },
  rowCard: { backgroundColor: c.surfaceTertiary, borderRadius: 12, padding: 12, paddingBottom: 0, marginBottom: 10, borderWidth: 1, borderColor: c.border },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8, minHeight: 44 },
  rowNum: { fontFamily: fonts.display, fontSize: 20, color: c.onSuccessTint },
  codeInput: { fontFamily: fonts.display, fontSize: 22 },
  twoCol: { flexDirection: "row", gap: 10 },
  addRow: {
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: c.success,
    backgroundColor: c.successTint,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  addRowText: { fontFamily: fonts.textBold, fontSize: 15, color: c.onSuccessTint },
  sticky: { backgroundColor: c.surfaceSecondary, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border },
  dupHead: { alignItems: "center", gap: 6, marginBottom: 14 },
  dupTitle: { fontFamily: fonts.textBold, fontSize: 19, color: c.onSurface, textAlign: "center" },
  dupSub: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceTertiary, textAlign: "center" },
  dupItem: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: c.warningTint, borderRadius: 10, padding: 12, marginBottom: 8 },
  dupCode: { fontFamily: fonts.display, fontSize: 20, color: c.onWarningTint },
  dupMeta: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  dupBtns: { gap: 10, marginTop: 8 },
}));
