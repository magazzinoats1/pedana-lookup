import React, { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";

import { api, ApiError, formatDate, formatDateTime, Pedana, TOKEN_KEY } from "@/src/api";
import { AppHeader } from "@/src/components/AppHeader";
import { statoColor } from "@/src/components/PedanaDetail";
import { SettingsSheet } from "@/src/components/SettingsSheet";
import { Sheet } from "@/src/components/Sheet";
import { useToast } from "@/src/components/Toast";
import { Button, IconButton } from "@/src/components/ui";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { storage } from "@/src/utils/storage";

const STATO_LABEL = { attesa: "In attesa", parziale: "Parziale", completo: "Scaricato" } as const;

export default function Ufficio() {
  const [items, setItems] = useState<Pedana[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [coop, setCoop] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [toDelete, setToDelete] = useState<Pedana | null>(null);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { colors } = useTheme();
  const styles = useStyles();

  const load = useCallback(
    async (query: string) => {
      setError("");
      try {
        const [list, s] = await Promise.all([
          api<Pedana[]>(`/pedane?q=${encodeURIComponent(query.trim())}`),
          api<{ cooperativa: string }>("/settings"),
        ]);
        setItems(list);
        setCoop(s.cooperativa);
      } catch (e: any) {
        if (e instanceof ApiError && e.status === 401) {
          await storage.secureRemove(TOKEN_KEY);
          router.replace("/");
          return;
        }
        setError(e.message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router],
  );

  useFocusEffect(
    useCallback(() => {
      const t = setTimeout(() => load(q), q ? 250 : 0);
      return () => clearTimeout(t);
    }, [q, load]),
  );

  async function esci() {
    try {
      await api("/auth/logout", { method: "POST" });
    } catch {}
    await storage.secureRemove(TOKEN_KEY);
    router.replace("/");
  }

  async function confermaElimina() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api(`/pedane/${toDelete.id}`, { method: "DELETE" });
      setItems((p) => p.filter((x) => x.id !== toDelete.id));
      toast("Registrazione eliminata", "error");
      setToDelete(null);
    } catch (e: any) {
      toast(e.message, "error");
    } finally {
      setDeleting(false);
    }
  }

  const renderItem = ({ item: o, index }: { item: Pedana; index: number }) => {
    const sc = statoColor(o.statoArrivo, colors);
    return (
      <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 30).duration(220)}>
        <View style={[styles.card, { borderLeftColor: sc }]} testID={`ufficio-ordine-card-${o.codice}`}>
          <View style={styles.cardTop}>
            <View style={styles.chips}>
              <View style={styles.chipOrder}>
                <Text style={styles.chipOrderText}>{o.numeroOrdine || "—"}</Text>
              </View>
              <View style={styles.chipCode}>
                <MaterialDesignIcons name="tag-outline" size={14} color={colors.onSuccessTint} />
                <Text style={styles.chipCodeText}>{o.codice}</Text>
              </View>
              <View style={[styles.statoPill, { borderColor: sc }]}>
                <View style={[styles.dot, { backgroundColor: sc }]} />
                <Text style={[styles.statoText, { color: sc }]}>{STATO_LABEL[o.statoArrivo]}</Text>
              </View>
            </View>
            <View style={styles.actions}>
              <IconButton icon="pencil-outline" onPress={() => router.push({ pathname: "/ufficio/form", params: { id: o.id } })} testID={`ufficio-edit-button-${o.codice}`} />
              <IconButton icon="trash-can-outline" tone="danger" onPress={() => setToDelete(o)} testID={`ufficio-delete-button-${o.codice}`} />
            </View>
          </View>
          <Text style={styles.dest} numberOfLines={2}>{o.destinazione}</Text>
          {!!o.merce && <Text style={styles.merce} numberOfLines={2}>{o.merce}</Text>}
          <View style={styles.metaGrid}>
            <Meta label="MITTENTE" value={o.mittente} />
            <Meta label="DATA" value={formatDate(o.dataConsegna)} />
            {!!o.numeroColli && <Meta label="COLLI" value={o.numeroColli} />}
            {!!o.numeroPedane && <Meta label="PEDANE" value={o.numeroPedane} />}
            {!!o.agenzia && <Meta label="AGENZIA" value={o.agenzia} />}
          </View>
          {!!o.note && <Text style={styles.note} numberOfLines={2}>{o.note}</Text>}
          {!!o.ultimaRettifica && <Text style={[styles.log, { color: colors.warning }]}>Rettifica: {formatDateTime(o.ultimaRettifica)}</Text>}
          {!!o.arrivoParzialeAt && (
            <Text style={[styles.log, { color: colors.onWarningTint }]}>
              Parziale: {formatDateTime(o.arrivoParzialeAt)}
              {o.arrivoParzialeDa ? ` · da ${o.arrivoParzialeDa}` : ""}
              {o.noteParziale ? ` — ${o.noteParziale}` : ""}
            </Text>
          )}
          {!!o.arrivoCompletoAt && <Text style={[styles.log, { color: colors.success }]}>Completo: {formatDateTime(o.arrivoCompletoAt)}{o.arrivoCompletoDa ? ` · da ${o.arrivoCompletoDa}` : ""}</Text>}
        </View>
      </Animated.View>
    );
  };

  return (
    <View style={styles.root}>
      <AppHeader
        subtitle={coop ? `Coop: ${coop} — Ufficio` : "Cooperativa non impostata — Ufficio"}
        right={
          <View style={styles.headActions}>
            <IconButton icon="view-dashboard-outline" tone="onBrand" onPress={() => router.push("/ufficio/riepilogo")} testID="ufficio-riepilogo-button" />
            <IconButton icon="cog-outline" tone="onBrand" onPress={() => setShowSettings(true)} testID="ufficio-settings-button" />
            <IconButton icon="logout" tone="onBrand" onPress={esci} testID="ufficio-esci-button" />
          </View>
        }
      />
      <View style={styles.searchBar}>
        <View style={styles.searchWrap}>
          <MaterialDesignIcons name="magnify" size={22} color={colors.muted} />
          <TextInput
            testID="ufficio-search-input"
            value={q}
            onChangeText={setQ}
            placeholder="Cerca N° ordine, pedana, agenzia, mittente…"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
            autoCorrect={false}
          />
          {!!q && (
            <Pressable onPress={() => setQ("")} hitSlop={10} testID="ufficio-search-clear-button">
              <MaterialDesignIcons name="close-circle" size={20} color={colors.muted} />
            </Pressable>
          )}
        </View>
        <Text style={styles.count} testID="ufficio-count">
          {items.length} pedan{items.length === 1 ? "a" : "e"} trovat{items.length === 1 ? "a" : "e"}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.brandSecondary} style={styles.loader} />
      ) : error ? (
        <View style={styles.empty} testID="ufficio-error">
          <MaterialDesignIcons name="wifi-off" size={56} color={colors.error} />
          <Text style={styles.emptyText}>{error}</Text>
          <Button label="Riprova" icon="refresh" variant="ghost" onPress={() => load(q)} testID="ufficio-retry-button" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(q); }} tintColor={colors.brandSecondary} />}
          ListEmptyComponent={
            <View style={styles.empty} testID="ufficio-empty">
              <MaterialDesignIcons name="clipboard-text-outline" size={64} color={colors.borderStrong} />
              <Text style={styles.emptyText}>{q ? "Nessun risultato" : "Nessun ordine registrato"}</Text>
            </View>
          }
        />
      )}

      <Pressable
        testID="ufficio-nuovo-ordine-button"
        onPress={() => router.push("/ufficio/form")}
        style={({ pressed }) => [styles.fab, { bottom: insets.bottom + 16 }, pressed && { transform: [{ scale: 0.96 }] }]}
      >
        <MaterialDesignIcons name="plus" size={26} color={colors.onBrandSecondary} />
        <Text style={styles.fabText}>Nuovo Ordine</Text>
      </Pressable>

      <SettingsSheet visible={showSettings} onClose={() => setShowSettings(false)} cooperativa={coop} onCoopSaved={setCoop} />

      <Sheet visible={!!toDelete} onClose={() => setToDelete(null)} testID="ufficio-delete-sheet">
        <View style={styles.delHead}>
          <MaterialDesignIcons name="trash-can-outline" size={40} color={colors.error} />
          <Text style={styles.delTitle}>Eliminare questa registrazione?</Text>
          <Text style={styles.delSub}>
            Pedana {toDelete?.codice} — Ordine {toDelete?.numeroOrdine}
          </Text>
        </View>
        <View style={styles.delBtns}>
          <Button label="Elimina" icon="trash-can-outline" variant="danger" loading={deleting} onPress={confermaElimina} testID="ufficio-delete-confirm-button" />
          <Button label="Annulla" variant="secondary" onPress={() => setToDelete(null)} testID="ufficio-delete-cancel-button" />
        </View>
      </Sheet>
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.meta}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={1}>{value || "—"}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  headActions: { flexDirection: "row", gap: 8 },
  searchBar: { backgroundColor: c.surfaceSecondary, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderColor: c.borderStrong, borderRadius: 12, paddingHorizontal: 12, minHeight: 50 },
  searchInput: { flex: 1, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  count: { fontFamily: fonts.textMedium, fontSize: 12, color: c.muted, marginTop: 8 },
  loader: { marginTop: 48 },
  list: { padding: 16, gap: 10 },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: 12, borderLeftWidth: 5, padding: 14, borderWidth: 1, borderColor: c.border, gap: 8 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  chips: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chipOrder: { backgroundColor: c.brandPrimary, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  chipOrderText: { fontFamily: fonts.display, fontSize: 16, color: c.onBrandPrimary },
  chipCode: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: c.successTint, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipCodeText: { fontFamily: fonts.display, fontSize: 16, color: c.onSuccessTint },
  statoPill: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statoText: { fontFamily: fonts.textSemi, fontSize: 12 },
  actions: { flexDirection: "row", gap: 6 },
  dest: { fontFamily: fonts.display, fontSize: 22, color: c.onSurface },
  merce: { fontFamily: fonts.textSemi, fontSize: 14, color: c.onBrandTertiary },
  metaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  meta: { minWidth: "40%", flexShrink: 1 },
  metaLabel: { fontFamily: fonts.textBold, fontSize: 10, color: c.muted, letterSpacing: 0.8 },
  metaValue: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurfaceSecondary },
  note: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceTertiary },
  log: { fontFamily: fonts.textSemi, fontSize: 12 },
  empty: { alignItems: "center", paddingVertical: 56, gap: 10 },
  emptyText: { fontFamily: fonts.textMedium, fontSize: 15, color: c.muted, textAlign: "center" },
  fab: {
    position: "absolute",
    right: 16,
    minHeight: 60,
    borderRadius: 999,
    paddingHorizontal: 22,
    backgroundColor: c.brandSecondary,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    shadowColor: c.brandPrimary,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabText: { fontFamily: fonts.textBold, fontSize: 16, color: c.onBrandSecondary },
  delHead: { alignItems: "center", gap: 6, marginBottom: 16 },
  delTitle: { fontFamily: fonts.textBold, fontSize: 18, color: c.onSurface, textAlign: "center" },
  delSub: { fontFamily: fonts.text, fontSize: 14, color: c.muted },
  delBtns: { gap: 10 },
}));
