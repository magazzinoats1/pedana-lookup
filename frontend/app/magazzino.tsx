import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";

import { api, Pedana } from "@/src/api";
import { AppHeader } from "@/src/components/AppHeader";
import { PedanaDetail, statoColor } from "@/src/components/PedanaDetail";
import { Button, IconButton } from "@/src/components/ui";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export default function Magazzino() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Pedana[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [coop, setCoop] = useState("");
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
    if (!text.trim()) {
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const r = await api<Pedana[]>(`/pedane/cerca?q=${encodeURIComponent(text.trim())}`);
      if (id !== reqId.current) return;
      setResults(r);
    } catch (e: any) {
      if (id === reqId.current) setError(e.message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }

  useEffect(() => {
    setSelectedId(null);
    const t = setTimeout(() => search(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const selected = results.length === 1 ? results[0] : results.find((r) => r.id === selectedId) ?? null;
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
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
        ) : !q.trim() ? (
          <View style={styles.empty} testID="magazzino-empty-start">
            <MaterialDesignIcons name="package-variant" size={72} color={colors.borderStrong} />
            <Text style={styles.emptySub}>Scrivi la posizione pedana o il numero ordine</Text>
          </View>
        ) : results.length === 0 ? (
          <View style={styles.empty} testID="magazzino-no-results">
            <MaterialDesignIcons name="help-circle-outline" size={64} color={colors.borderStrong} />
            <Text style={styles.emptyTitle}>Nessuna pedana trovata</Text>
            <Text style={styles.emptySub}>Controlla il codice e riprova</Text>
          </View>
        ) : selected ? (
          <View style={styles.gap}>
            {results.length > 1 && (
              <Pressable onPress={() => setSelectedId(null)} style={styles.backRow} testID="magazzino-back-to-results-button">
                <MaterialDesignIcons name="arrow-left" size={22} color={colors.brandSecondary} />
                <Text style={styles.backText}>Torna ai {results.length} risultati</Text>
              </Pressable>
            )}
            <PedanaDetail key={selected.id} pedana={selected} onUpdated={onUpdated} />
          </View>
        ) : (
          <View style={styles.gap}>
            <Text style={styles.count} testID="magazzino-results-count">{results.length} pedane trovate</Text>
            {results.map((p, i) => (
              <Animated.View key={p.id} entering={FadeInDown.delay(i * 40).duration(220)}>
                <Pressable
                  testID={`magazzino-result-${p.codice}`}
                  onPress={() => setSelectedId(p.id)}
                  style={({ pressed }) => [styles.resCard, { borderLeftColor: statoColor(p.statoArrivo, colors) }, pressed && { opacity: 0.8 }]}
                >
                  <View style={styles.flex}>
                    <Text style={styles.resCode}>{p.codice}</Text>
                    <Text style={styles.resDest} numberOfLines={1}>{p.destinazione}</Text>
                    {!!p.merce && <Text style={styles.resMerce} numberOfLines={1}>{p.merce}</Text>}
                    <Text style={styles.resMeta} numberOfLines={1}>
                      Ord. {p.numeroOrdine} · {p.mittente}
                      {p.numeroColli ? ` · ${p.numeroColli} colli` : ""}
                    </Text>
                  </View>
                  <MaterialDesignIcons name="chevron-right" size={30} color={colors.muted} />
                </Pressable>
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  flex: { flex: 1 },
  searchCard: { backgroundColor: c.surfaceSecondary, padding: 16, borderBottomWidth: 1, borderBottomColor: c.border },
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
