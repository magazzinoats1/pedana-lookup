import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";

import { api, ApiError, formatDate, formatDateTime, Pedana, TOKEN_KEY } from "@/src/api";
import { useToast } from "@/src/components/Toast";
import { Button, IconButton } from "@/src/components/ui";
import { groupOrders } from "@/src/report";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { storage } from "@/src/utils/storage";

const PAGE = 200;

export default function Archivio() {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Pedana[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [running, setRunning] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const reqId = useRef(0);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { colors } = useTheme();
  const styles = useStyles();

  const load = useCallback(
    async (query: string, skip = 0) => {
      const id = ++reqId.current;
      if (skip) setMore(true);
      else setLoading(true);
      try {
        const r = await api<{ total: number; items: Pedana[] }>(`/archivio?q=${encodeURIComponent(query.trim())}&skip=${skip}&limit=${PAGE}`);
        if (id !== reqId.current) return;
        setTotal(r.total);
        setItems((prev) => (skip ? [...prev, ...r.items] : r.items));
      } catch (e: any) {
        if (e instanceof ApiError && e.status === 401) {
          await storage.secureRemove(TOKEN_KEY);
          router.replace("/");
          return;
        }
        toast(e.message, "error");
      } finally {
        if (id === reqId.current) {
          setLoading(false);
          setMore(false);
        }
      }
    },
    [router, toast],
  );

  useEffect(() => {
    const t = setTimeout(() => load(q), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, load]);

  async function archiviaOra() {
    setRunning(true);
    try {
      const r = await api<{ archiviati: number }>("/archivio/esegui", { method: "POST" });
      toast(r.archiviati ? `${r.archiviati} ordini archiviati` : "Nessun ordine da archiviare");
      load(q);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setRunning(false);
    }
  }

  async function ripristina(numero: string) {
    setRestoring(numero);
    try {
      await api("/archivio/ripristina", { method: "POST", body: { numeroOrdine: numero } });
      toast(`Ordine ${numero} ripristinato nelle liste`);
      load(q);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setRestoring(null);
    }
  }

  const groups = groupOrders(items);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <IconButton icon="arrow-left" tone="onBrand" onPress={() => router.back()} testID="archivio-back-button" />
        <View style={styles.flex}>
          <Text style={styles.headerTitle}>Archivio ordini</Text>
          <Text style={styles.headerSub}>Ordini scaricati da più di 30 giorni</Text>
        </View>
      </View>
      <View style={styles.searchBar}>
        <View style={styles.searchWrap}>
          <MaterialDesignIcons name="magnify" size={22} color={colors.muted} />
          <TextInput
            testID="archivio-search-input"
            value={q}
            onChangeText={setQ}
            placeholder="Cerca N° ordine, posizione, merce…"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            autoCorrect={false}
          />
          {!!q && (
            <Pressable onPress={() => setQ("")} hitSlop={10} testID="archivio-search-clear-button">
              <MaterialDesignIcons name="close-circle" size={20} color={colors.muted} />
            </Pressable>
          )}
        </View>
        <View style={styles.barRow}>
          <Text style={styles.count} testID="archivio-count">{total} pedane archiviate · {groups.length} ordini</Text>
          <Pressable onPress={archiviaOra} disabled={running} style={styles.runBtn} testID="archivio-esegui-button">
            {running ? <ActivityIndicator size="small" color={colors.onBrandTertiary} /> : <MaterialDesignIcons name="archive-arrow-down-outline" size={18} color={colors.onBrandTertiary} />}
            <Text style={styles.runText}>Archivia ora</Text>
          </Pressable>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.brandSecondary} style={styles.loader} />
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.numero}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            <View style={styles.empty} testID="archivio-empty">
              <MaterialDesignIcons name="archive-outline" size={64} color={colors.borderStrong} />
              <Text style={styles.emptyText}>{q ? "Nessun risultato in archivio" : "Archivio vuoto"}</Text>
              <Text style={styles.emptySub}>Gli ordini completamente scaricati vengono archiviati in automatico dopo 30 giorni</Text>
            </View>
          }
          ListFooterComponent={
            items.length < total ? (
              <Button label={`Carica altri (${total - items.length})`} variant="ghost" icon="chevron-down" loading={more} onPress={() => load(q, items.length)} testID="archivio-load-more-button" />
            ) : undefined
          }
          renderItem={({ item: g }) => (
            <View style={styles.card} testID={`archivio-ordine-${g.numero}`}>
              <View style={styles.cardHead}>
                <View style={styles.flex}>
                  <Text style={styles.cardNum}>Ord. {g.numero}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    {formatDate(g.items[0].dataConsegna)} · {g.items.length} posizioni{g.items[0].agenzia ? ` · ${g.items[0].agenzia}` : ""}
                  </Text>
                  {!!g.items[0].archiviatoAt && <Text style={styles.cardArch}>Archiviato il {formatDateTime(g.items[0].archiviatoAt)}</Text>}
                </View>
                <Pressable onPress={() => ripristina(g.numero)} disabled={restoring === g.numero} style={styles.restoreBtn} testID={`archivio-ripristina-button-${g.numero}`}>
                  {restoring === g.numero ? <ActivityIndicator size="small" color={colors.brandSecondary} /> : <MaterialDesignIcons name="restore" size={18} color={colors.brandSecondary} />}
                  <Text style={styles.restoreText}>Ripristina</Text>
                </Pressable>
              </View>
              {g.items.map((p) => (
                <View key={p.id} style={styles.row}>
                  <Text style={styles.rowCode}>{p.codice}</Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {[p.mittente, p.merce, p.arrivoCompletoDa ? `da ${p.arrivoCompletoDa}` : ""].filter(Boolean).join(" · ")}
                  </Text>
                </View>
              ))}
            </View>
          )}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  flex: { flex: 1 },
  header: { backgroundColor: c.brandPrimary, paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  headerTitle: { fontFamily: fonts.display, fontSize: 26, color: c.onBrandPrimary },
  headerSub: { fontFamily: fonts.textMedium, fontSize: 12, color: c.brandSoftText },
  searchBar: { backgroundColor: c.surfaceSecondary, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderColor: c.borderStrong, borderRadius: 12, paddingHorizontal: 12, minHeight: 50 },
  searchInput: { flex: 1, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  barRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, gap: 8 },
  count: { fontFamily: fonts.textMedium, fontSize: 12, color: c.muted, flexShrink: 1 },
  runBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 999, backgroundColor: c.brandTertiary },
  runText: { fontFamily: fonts.textBold, fontSize: 13, color: c.onBrandTertiary },
  loader: { marginTop: 48 },
  list: { padding: 16, gap: 10 },
  empty: { alignItems: "center", paddingVertical: 48, gap: 8, paddingHorizontal: 16 },
  emptyText: { fontFamily: fonts.textBold, fontSize: 16, color: c.onSurfaceSecondary },
  emptySub: { fontFamily: fonts.text, fontSize: 13, color: c.muted, textAlign: "center" },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: 12, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: c.surfaceTertiary },
  cardNum: { fontFamily: fonts.displayHeavy, fontSize: 22, color: c.brandPrimary },
  cardMeta: { fontFamily: fonts.textMedium, fontSize: 12, color: c.onSurfaceTertiary },
  cardArch: { fontFamily: fonts.text, fontSize: 11, color: c.muted },
  restoreBtn: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 40, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5, borderColor: c.brandSecondary },
  restoreText: { fontFamily: fonts.textBold, fontSize: 13, color: c.brandSecondary },
  row: { paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: c.divider },
  rowCode: { fontFamily: fonts.display, fontSize: 18, color: c.onSurface },
  rowMeta: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
}));
