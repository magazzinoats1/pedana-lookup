import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";

import { api, formatDate, Pedana } from "@/src/api";
import { AppHeader } from "@/src/components/AppHeader";
import { PedanaDetail, statoColor } from "@/src/components/PedanaDetail";
import { Sheet } from "@/src/components/Sheet";
import { useToast } from "@/src/components/Toast";
import { Button, IconButton } from "@/src/components/ui";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function Magazzino() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Pedana[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [coop, setCoop] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("tutte");
  const [dataFiltro, setDataFiltro] = useState<DataFiltro>("tutte");
  const [scaricaOrdine, setScaricaOrdine] = useState<{ numero: string; mancanti: number } | null>(null);
  const [scaricando, setScaricando] = useState(false);
  const toast = useToast();
  const reqId = useRef(0);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();

  useEffect(() => {
    api<{ cooperativa: string }>("/settings").then((s) => setCoop(s.cooperativa)).catch(() => {});
  }, []);

  async function search(text: string) {
    const id = ++reqId.current;
    setLoading(true);
    setError("");
    try {
      const r = await api<Pedana[]>(text.trim() ? `/pedane/cerca?q=${encodeURIComponent(text.trim())}` : "/pedane/tutte");
      if (id !== reqId.current) return;
      setResults(r);
    } catch (e: any) {
      if (id === reqId.current) setError(e.message);
    } finally {
      if (id === reqId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    setSelectedId(null);
    const t = setTimeout(() => search(q), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q]);

  const dateFiltered = dataFiltro === "tutte" ? results : results.filter((p) => p.dataConsegna === isoDay(dataFiltro === "oggi" ? 0 : 1));
  const filtered = filtro === "tutte" ? dateFiltered : dateFiltered.filter((p) => p.statoArrivo === filtro);

  async function confermaScarica() {
    if (!scaricaOrdine) return;
    setScaricando(true);
    try {
      const r = await api<{ aggiornate: number }>("/ordini/scarica", { method: "POST", body: { numeroOrdine: scaricaOrdine.numero } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      toast(`Ordine ${scaricaOrdine.numero}: ${r.aggiornate} pedane scaricate`);
      setScaricaOrdine(null);
      await search(q);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setScaricando(false);
    }
  }
  const selected = q.trim() && results.length === 1 ? results[0] : results.find((r) => r.id === selectedId) ?? null;
  const onUpdated = (p: Pedana) => setResults((rs) => rs.map((r) => (r.id === p.id ? p : r)));

  return (
    <View style={styles.root}>
      <AppHeader
        subtitle={`${coop ? `Coop: ${coop} — ` : ""}Accesso Magazzino`}
        right={<IconButton icon="logout" tone="onBrand" onPress={() => router.replace("/")} testID="magazzino-esci-button" />}
      />
      <View style={styles.searchCard}>
        <Text style={styles.h1}>Cerca Pedana</Text>
        <Text style={styles.hint}>
          Posizione pedana <Text style={styles.bold}>(scarico)</Text> o numero ordine <Text style={styles.bold}>(carico)</Text>
        </Text>
        <View style={styles.inputWrap}>
          <MaterialDesignIcons name="magnify" size={28} color={colors.brandSecondary} />
          <TextInput
            testID="magazzino-search-input"
            value={q}
            onChangeText={setQ}
            placeholder="es. 019320 o 25023467"
            placeholderTextColor={colors.muted}
            autoFocus
            autoCorrect={false}
            autoCapitalize="characters"
            returnKeyType="search"
            style={styles.input}
          />
          {!!q && (
            <Pressable onPress={() => setQ("")} hitSlop={10} testID="magazzino-search-clear-button" style={styles.clear}>
              <MaterialDesignIcons name="close-circle" size={26} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chipRowContent}
        keyboardShouldPersistTaps="handled"
      >
        {DATE_FILTRI.map((f) => {
          const active = dataFiltro === f.key;
          const n = f.key === "tutte" ? results.length : results.filter((p) => p.dataConsegna === isoDay(f.key === "oggi" ? 0 : 1)).length;
          return (
            <Pressable
              key={f.key}
              testID={`magazzino-date-filter-${f.key}`}
              onPress={() => {
                setDataFiltro(f.key);
                setSelectedId(null);
              }}
              style={[styles.chip, { borderColor: active ? colors.brandSecondary : colors.borderStrong, backgroundColor: active ? colors.brandSecondary : colors.surfaceSecondary }]}
            >
              <MaterialDesignIcons name={f.icon as any} size={16} color={active ? colors.onBrandSecondary : colors.muted} />
              <Text style={[styles.chipText, { color: active ? colors.onBrandSecondary : colors.onSurfaceSecondary }]}>{f.label}</Text>
              <Text style={[styles.chipCount, { color: active ? colors.onBrandSecondary : colors.muted }]} testID={`magazzino-date-filter-count-${f.key}`}>{n}</Text>
            </Pressable>
          );
        })}
        <View style={styles.chipDivider} />
        {FILTRI.map((f) => {
          const active = filtro === f.key;
          const n = f.key === "tutte" ? dateFiltered.length : dateFiltered.filter((p) => p.statoArrivo === f.key).length;
          const tone = f.key === "tutte" ? colors.brandPrimary : statoColor(f.key, colors);
          return (
            <Pressable
              key={f.key}
              testID={`magazzino-filter-${f.key}`}
              onPress={() => {
                setFiltro(f.key);
                setSelectedId(null);
              }}
              style={[styles.chip, { borderColor: active ? tone : colors.borderStrong, backgroundColor: active ? tone : colors.surfaceSecondary }]}
            >
              {f.key !== "tutte" && <View style={[styles.chipDot, { backgroundColor: active ? colors.onBrand : tone }]} />}
              <Text style={[styles.chipText, { color: active ? colors.onBrand : colors.onSurfaceSecondary }]}>{f.label}</Text>
              <Text style={[styles.chipCount, { color: active ? colors.onBrand : colors.muted }]} testID={`magazzino-filter-count-${f.key}`}>{n}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); search(q); }} tintColor={colors.brandSecondary} />}
      >
        {loading && results.length === 0 ? (
          <ActivityIndicator size="large" color={colors.brandSecondary} style={styles.loader} testID="magazzino-loading" />
        ) : error ? (
          <View style={styles.empty} testID="magazzino-error">
            <MaterialDesignIcons name="wifi-off" size={56} color={colors.error} />
            <Text style={[styles.emptyTitle, { color: colors.error }]}>Errore di ricerca</Text>
            <Text style={styles.emptySub}>{error}</Text>
            <Button label="Riprova" icon="refresh" variant="ghost" onPress={() => search(q)} testID="magazzino-retry-button" />
          </View>
        ) : !q.trim() && results.length === 0 ? (
          <View style={styles.empty} testID="magazzino-empty-start">
            <MaterialDesignIcons name="package-variant" size={72} color={colors.borderStrong} />
            <Text style={styles.emptyTitle}>Nessuna merce registrata</Text>
            <Text style={styles.emptySub}>Le pedane registrate dall&apos;ufficio appariranno qui</Text>
          </View>
        ) : results.length === 0 ? (
          <View style={styles.empty} testID="magazzino-no-results">
            <MaterialDesignIcons name="help-circle-outline" size={64} color={colors.borderStrong} />
            <Text style={styles.emptyTitle}>Nessuna pedana trovata</Text>
            <Text style={styles.emptySub}>Controlla il codice e riprova</Text>
          </View>
        ) : !selected && filtered.length === 0 ? (
          <View style={styles.empty} testID="magazzino-filter-empty">
            <MaterialDesignIcons name="filter-off-outline" size={64} color={colors.borderStrong} />
            <Text style={styles.emptyTitle}>
              Nessuna pedana{filtro !== "tutte" ? ` ${FILTRI.find((f) => f.key === filtro)?.label.toLowerCase()}` : ""}
              {dataFiltro !== "tutte" ? ` per ${dataFiltro}` : ""}
            </Text>
            <Button
              label="Mostra tutte"
              icon="filter-remove-outline"
              variant="ghost"
              onPress={() => {
                setFiltro("tutte");
                setDataFiltro("tutte");
              }}
              testID="magazzino-filter-reset-button"
            />
          </View>
        ) : selected ? (
          <View style={styles.gap}>
            {results.length > 1 && (
              <Pressable onPress={() => setSelectedId(null)} style={styles.backRow} testID="magazzino-back-to-results-button">
                <MaterialDesignIcons name="arrow-left" size={22} color={colors.brandSecondary} />
                <Text style={styles.backText}>{q.trim() ? `Torna ai ${results.length} risultati` : "Torna alla lista merce"}</Text>
              </Pressable>
            )}
            <PedanaDetail key={selected.id} pedana={selected} onUpdated={onUpdated} />
          </View>
        ) : (
          <View style={styles.gap}>
            <Text style={styles.count} testID="magazzino-results-count">
              {q.trim() ? `${filtered.length} pedane trovate` : filtro === "tutte" && dataFiltro === "tutte" ? `Tutta la merce registrata · ${filtered.length} pedane` : `${filtered.length} pedane`} · {groupByOrder(filtered).length} ordini
            </Text>
            {groupByOrder(filtered).map((g, gi) => {
              const all = results.filter((p) => (p.numeroOrdine || "—") === g.numero);
              const done = all.filter((p) => p.statoArrivo === "completo").length;
              const colli = g.items.reduce((n, p) => n + (parseInt(p.numeroColli, 10) || 0), 0);
              return (
                <Animated.View key={g.numero} entering={FadeInDown.delay(Math.min(gi, 6) * 50).duration(220)} style={styles.group} testID={`magazzino-group-${g.numero}`}>
                  <View style={styles.groupHead}>
                    <MaterialDesignIcons name="truck-outline" size={26} color={colors.onBrandPrimary} />
                    <View style={styles.flex}>
                      <Text style={styles.groupLabel}>ORDINE</Text>
                      <Text style={styles.groupNum} testID={`magazzino-group-numero-${g.numero}`}>{g.numero}</Text>
                    </View>
                    <View style={styles.groupRight}>
                      <Text style={styles.groupDate}>{formatDate(g.items[0].dataConsegna)}</Text>
                      <Text style={styles.groupMeta} testID={`magazzino-group-summary-${g.numero}`}>
                        {g.items.length} pedan{g.items.length === 1 ? "a" : "e"}{colli ? ` · ${colli} colli` : ""}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.progressRow}>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${(done / all.length) * 100}%` }]} />
                    </View>
                    <Text style={styles.progressText} testID={`magazzino-group-progress-${g.numero}`}>Scaricate {done}/{all.length}</Text>
                  </View>
                  {done < all.length ? (
                    <Pressable
                      testID={`magazzino-scarica-ordine-button-${g.numero}`}
                      onPress={() => setScaricaOrdine({ numero: g.numero, mancanti: all.length - done })}
                      style={({ pressed }) => [styles.scaricaBtn, pressed && { opacity: 0.85 }]}
                    >
                      <MaterialDesignIcons name="check-all" size={22} color={colors.onSuccess} />
                      <Text style={styles.scaricaText}>Scarica ordine intero ({all.length - done})</Text>
                    </Pressable>
                  ) : (
                    <View style={styles.scaricatoBox} testID={`magazzino-ordine-completo-${g.numero}`}>
                      <MaterialDesignIcons name="check-circle" size={20} color={colors.success} />
                      <Text style={styles.scaricatoText}>Ordine scaricato</Text>
                    </View>
                  )}
                  <View style={styles.groupItems}>
                    {g.items.map((p) => (
                      <Pressable
                        key={p.id}
                        testID={`magazzino-result-${p.id}`}
                        onPress={() => setSelectedId(p.id)}
                        style={({ pressed }) => [styles.resCard, { borderLeftColor: statoColor(p.statoArrivo, colors) }, pressed && { opacity: 0.8 }]}
                      >
                        <View style={styles.flex}>
                          <Text style={styles.resCode}>{p.codice}</Text>
                          <Text style={styles.resDest} numberOfLines={1}>{p.destinazione}</Text>
                          {!!p.merce && <Text style={styles.resMerce} numberOfLines={1}>{p.merce}</Text>}
                          <Text style={styles.resMeta} numberOfLines={1}>
                            {p.mittente}
                            {p.numeroColli ? ` · ${p.numeroColli} colli` : ""}
                          </Text>
                        </View>
                        <MaterialDesignIcons name="chevron-right" size={30} color={colors.muted} />
                      </Pressable>
                    ))}
                  </View>
                </Animated.View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Sheet visible={!!scaricaOrdine} onClose={() => setScaricaOrdine(null)} testID="magazzino-scarica-sheet">
        <View style={styles.sheetHead}>
          <MaterialDesignIcons name="truck-check-outline" size={44} color={colors.success} />
          <Text style={styles.sheetTitle}>Scaricare tutto l&apos;ordine {scaricaOrdine?.numero}?</Text>
          <Text style={styles.sheetSub}>
            {scaricaOrdine?.mancanti} pedan{scaricaOrdine?.mancanti === 1 ? "a verrà segnata" : "e verranno segnate"} come scaricat{scaricaOrdine?.mancanti === 1 ? "a" : "e"} (completo).
          </Text>
        </View>
        <View style={styles.sheetBtns}>
          <Button label="Sì, scarica tutto" variant="success" icon="check-all" loading={scaricando} onPress={confermaScarica} testID="magazzino-scarica-confirm-button" />
          <Button label="Annulla" variant="secondary" onPress={() => setScaricaOrdine(null)} testID="magazzino-scarica-cancel-button" />
        </View>
      </Sheet>
    </View>
  );
}

type DataFiltro = "tutte" | "oggi" | "domani";
const DATE_FILTRI: { key: DataFiltro; label: string; icon: string }[] = [
  { key: "tutte", label: "Tutte le date", icon: "calendar-blank-outline" },
  { key: "oggi", label: "Oggi", icon: "calendar-today" },
  { key: "domani", label: "Domani", icon: "calendar-arrow-right" },
];

function isoDay(offset: number) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Filtro = "tutte" | "attesa" | "parziale" | "completo";
const FILTRI: { key: Filtro; label: string }[] = [
  { key: "tutte", label: "Tutte" },
  { key: "attesa", label: "In attesa" },
  { key: "parziale", label: "Parziali" },
  { key: "completo", label: "Scaricate" },
];

function groupByOrder(list: Pedana[]) {
  const map = new Map<string, Pedana[]>();
  for (const p of list) {
    const k = p.numeroOrdine || "—";
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(p);
  }
  return [...map.entries()].map(([numero, items]) => ({ numero, items }));
}

const useStyles = makeStyles((c) => ({
  chipRow: { flexGrow: 0, height: 56, backgroundColor: c.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: c.border },
  chipRowContent: { gap: 8, paddingHorizontal: 16, alignItems: "center" },
  chip: { height: 36, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5 },
  chipDivider: { width: 1, height: 28, backgroundColor: c.borderStrong, marginHorizontal: 4 },
  scaricaBtn: { minHeight: 52, marginHorizontal: 10, marginTop: 10, borderRadius: 12, backgroundColor: c.success, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  scaricaText: { fontFamily: fonts.textBold, fontSize: 15, color: c.onSuccess },
  scaricatoBox: { flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 10, marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: c.successTint },
  scaricatoText: { fontFamily: fonts.textBold, fontSize: 14, color: c.onSuccessTint },
  sheetHead: { alignItems: "center", gap: 6, marginBottom: 16 },
  sheetTitle: { fontFamily: fonts.textBold, fontSize: 19, color: c.onSurface, textAlign: "center" },
  sheetSub: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceTertiary, textAlign: "center" },
  sheetBtns: { gap: 10 },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontFamily: fonts.textSemi, fontSize: 14 },
  chipCount: { fontFamily: fonts.textBold, fontSize: 13 },
  group: { backgroundColor: c.surfaceSecondary, borderRadius: 14, borderWidth: 1, borderColor: c.border, overflow: "hidden", marginBottom: 6 },
  groupHead: { backgroundColor: c.brandPrimary, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10 },
  groupLabel: { fontFamily: fonts.textBold, fontSize: 10, letterSpacing: 1.2, color: c.brandSoftText },
  groupNum: { fontFamily: fonts.displayHeavy, fontSize: 26, color: c.onBrandPrimary },
  groupRight: { alignItems: "flex-end" },
  groupDate: { fontFamily: fonts.textBold, fontSize: 14, color: c.onBrandPrimary },
  groupMeta: { fontFamily: fonts.textMedium, fontSize: 12, color: c.brandSoftText },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: c.brandTertiary },
  progressTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: c.border, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: c.success },
  progressText: { fontFamily: fonts.textBold, fontSize: 13, color: c.onBrandTertiary },
  groupItems: { padding: 10, gap: 8 },
  root: { flex: 1, backgroundColor: c.surface },
  flex: { flex: 1 },
  searchCard: { backgroundColor: c.surfaceSecondary, padding: 16, paddingBottom: 4 },
  h1: { fontFamily: fonts.display, fontSize: 28, color: c.brandPrimary },
  hint: { fontFamily: fonts.text, fontSize: 13, color: c.muted, marginBottom: 12 },
  bold: { fontFamily: fonts.textBold, color: c.onSurfaceSecondary },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 2.5,
    borderColor: c.brandSecondary,
    borderRadius: 14,
    paddingHorizontal: 14,
    minHeight: 68,
    backgroundColor: c.surfaceSecondary,
  },
  input: { flex: 1, fontFamily: fonts.display, fontSize: 30, color: c.onSurface, paddingVertical: 8 },
  clear: { padding: 4 },
  content: { padding: 16 },
  loader: { marginTop: 48 },
  gap: { gap: 10 },
  empty: { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyTitle: { fontFamily: fonts.textBold, fontSize: 17, color: c.onSurfaceSecondary },
  emptySub: { fontFamily: fonts.text, fontSize: 14, color: c.muted, textAlign: "center" },
  count: { fontFamily: fonts.textSemi, fontSize: 13, color: c.muted },
  resCard: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: 12,
    borderLeftWidth: 6,
    padding: 14,
    minHeight: 80,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: c.border,
  },
  resCode: { fontFamily: fonts.display, fontSize: 26, color: c.onSuccessTint },
  resDest: { fontFamily: fonts.textBold, fontSize: 16, color: c.onSurface },
  resMerce: { fontFamily: fonts.textSemi, fontSize: 14, color: c.onBrandTertiary },
  resMeta: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  backRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 },
  backText: { fontFamily: fonts.textSemi, fontSize: 15, color: c.brandSecondary },
}));
