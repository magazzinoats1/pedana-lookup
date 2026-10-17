import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";

import { api, ApiError, isTrasbordo, Pedana, TOKEN_KEY } from "@/src/api";
import { statoColor } from "@/src/components/PedanaDetail";
import { useToast } from "@/src/components/Toast";
import { Button, IconButton } from "@/src/components/ui";
import { condividiReport, groupOrders, ora } from "@/src/report";
import { inRitardo } from "@/src/ritardi";
import { fonts, makeStyles, useTheme } from "@/src/theme";
import { storage } from "@/src/utils/storage";

const STATO = { attesa: "In attesa", parziale: "Parziale", completo: "Scaricato" } as const;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const REFRESH_MS = 15000;

export default function Riepilogo() {
  const [offset, setOffset] = useState(0);
  const [list, setList] = useState<Pedana[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [sharing, setSharing] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { colors } = useTheme();
  const styles = useStyles();

  const day = new Date();
  day.setDate(day.getDate() + offset);
  const dataIso = iso(day);
  const label = offset === 0 ? "Oggi" : offset === 1 ? "Domani" : offset === -1 ? "Ieri" : day.toLocaleDateString("it-IT", { weekday: "long" });

  const load = useCallback(async () => {
    try {
      const r = await api<Pedana[]>(`/riepilogo?data=${dataIso}`);
      setList(r);
      setError("");
      setUpdatedAt(new Date());
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
  }, [dataIso, router]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load();
      const t = setInterval(load, REFRESH_MS);
      return () => clearInterval(t);
    }, [load]),
  );

  async function condividi() {
    setSharing(true);
    try {
      const s = await api<{ cooperativa: string }>("/settings");
      await condividiReport(dataIso, list, s.cooperativa);
    } catch (e: any) {
      toast(e?.message || "Impossibile creare il report", "error");
    } finally {
      setSharing(false);
    }
  }

  const done = list.filter((p) => p.statoArrivo === "completo").length;
  const parz = list.filter((p) => p.statoArrivo === "parziale").length;
  const groups = groupOrders(list);
  const camionFatti = groups.filter((g) => g.items.every((p) => p.statoArrivo === "completo")).length;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <IconButton icon="arrow-left" tone="onBrand" onPress={() => router.back()} testID="riepilogo-back-button" />
        <View style={styles.flex}>
          <Text style={styles.headerTitle}>Riepilogo scarichi</Text>
          <View style={styles.liveRow}>
            <View style={styles.liveDot} />
            <Text style={styles.headerSub} testID="riepilogo-updated-at">
              Live · aggiornato {updatedAt ? updatedAt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "…"}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.dateBar}>
        <IconButton icon="chevron-left" onPress={() => setOffset((o) => o - 1)} testID="riepilogo-prev-day-button" />
        <Pressable style={styles.dateCenter} onPress={() => setOffset(0)} testID="riepilogo-today-button">
          <Text style={styles.dateLabel} testID="riepilogo-date-label">{label}</Text>
          <Text style={styles.dateValue} testID="riepilogo-date-value">{day.toLocaleDateString("it-IT")}</Text>
        </Pressable>
        <IconButton icon="chevron-right" onPress={() => setOffset((o) => o + 1)} testID="riepilogo-next-day-button" />
      </View>

      {loading && list.length === 0 ? (
        <ActivityIndicator size="large" color={colors.brandSecondary} style={styles.loader} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandSecondary} />}
        >
          {!!error && (
            <View style={styles.errorBox} testID="riepilogo-error">
              <MaterialDesignIcons name="wifi-off" size={20} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.stats}>
            <Stat label="Camion" value={`${camionFatti}/${groups.length}`} icon="truck-outline" tone={colors.brandPrimary} testID="riepilogo-stat-camion" />
            <Stat label="Pedane" value={String(list.length)} icon="package-variant-closed" tone={colors.brandPrimary} testID="riepilogo-stat-pedane" />
            <Stat label="Scaricate" value={String(done)} icon="check-circle-outline" tone={colors.success} testID="riepilogo-stat-scaricate" />
            <Stat label="Parziali" value={String(parz)} icon="circle-half-full" tone={colors.warning} testID="riepilogo-stat-parziali" />
            <Stat label="In attesa" value={String(list.length - done - parz)} icon="clock-outline" tone={colors.brandSecondary} testID="riepilogo-stat-attesa" />
            <Stat label="In ritardo" value={String(list.filter((p) => inRitardo(p)).length)} icon="clock-alert-outline" tone={colors.error} testID="riepilogo-stat-ritardo" />
          </View>

          {list.length > 0 && (
            <View style={styles.totalBox}>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${(done / list.length) * 100}%` }]} />
              </View>
              <Text style={styles.totalText} testID="riepilogo-total-progress">{Math.round((done / list.length) * 100)}% scaricato</Text>
            </View>
          )}

          {groups.length === 0 ? (
            <View style={styles.empty} testID="riepilogo-empty">
              <MaterialDesignIcons name="truck-remove-outline" size={64} color={colors.borderStrong} />
              <Text style={styles.emptyText}>Nessun camion previsto per questa data</Text>
            </View>
          ) : (
            groups.map((g, gi) => {
              const d = g.items.filter((p) => p.statoArrivo === "completo").length;
              const colli = g.items.reduce((n, p) => n + (parseInt(p.numeroColli, 10) || 0), 0);
              const pal = g.items.reduce((n, p) => n + (parseInt(p.numeroPedane ?? "", 10) || 0), 0);
              const complete = d === g.items.length;
              return (
                <Animated.View key={g.numero} entering={FadeInDown.delay(Math.min(gi, 6) * 40).duration(220)} style={styles.card} testID={`riepilogo-ordine-${g.numero}`}>
                  <View style={styles.cardHead}>
                    <MaterialDesignIcons name={complete ? "truck-check" : "truck-outline"} size={26} color={complete ? colors.success : colors.brandPrimary} />
                    <View style={styles.flex}>
                      <Text style={styles.cardNum}>{g.numero}</Text>
                      {isTrasbordo(g.items[0].trasportatore) && (
                        <Text style={styles.trasbordo} numberOfLines={1} testID={`riepilogo-trasbordo-${g.numero}`}>TRASBORDO · {g.items[0].trasportatore}</Text>
                      )}
                      <Text style={styles.cardMeta} numberOfLines={1}>
                        {g.items[0].agenzia || "—"} · {g.items.length} posizioni{pal ? ` · ${pal} pedane` : ""}{colli ? ` · ${colli} colli` : ""}
                      </Text>
                    </View>
                    <Text style={[styles.cardCount, { color: complete ? colors.success : colors.brandPrimary }]} testID={`riepilogo-ordine-progress-${g.numero}`}>
                      {d}/{g.items.length}
                    </Text>
                  </View>
                  <View style={styles.track}>
                    <View style={[styles.fill, { width: `${(d / g.items.length) * 100}%` }]} />
                  </View>
                  {g.items.map((p) => {
                    const when = p.statoArrivo === "completo" ? p.arrivoCompletoAt : p.statoArrivo === "parziale" ? p.arrivoParzialeAt : null;
                    const who = p.statoArrivo === "completo" ? p.arrivoCompletoDa : p.statoArrivo === "parziale" ? p.arrivoParzialeDa : "";
                    const sc = statoColor(p.statoArrivo, colors);
                    return (
                      <View key={p.id} style={styles.row} testID={`riepilogo-pedana-${p.id}`}>
                        <View style={[styles.rowDot, { backgroundColor: sc }]} />
                        <View style={styles.flex}>
                          <Text style={styles.rowCode}>{p.codice}</Text>
                          <Text style={styles.rowMeta} numberOfLines={1}>
                            {[p.mittente, p.merce, p.numeroPedane ? `${p.numeroPedane} ped.` : "", p.numeroColli ? `${p.numeroColli} colli` : ""].filter(Boolean).join(" · ")}
                          </Text>
                        </View>
                        <View style={styles.rowRight}>
                          <Text style={[styles.rowStato, { color: inRitardo(p) ? colors.error : sc }]} testID={inRitardo(p) ? `riepilogo-ritardo-${p.id}` : undefined}>
                            {inRitardo(p) ? "In ritardo" : STATO[p.statoArrivo]}
                          </Text>
                          {!!when && (
                            <Text style={styles.rowWho} numberOfLines={1}>
                              {ora(when)}
                              {who ? ` · ${who}` : ""}
                            </Text>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </Animated.View>
              );
            })
          )}
        </ScrollView>
      )}

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <Button label="Condividi report del giorno" icon="file-pdf-box" loading={sharing} disabled={loading} onPress={condividi} testID="riepilogo-share-report-button" />
      </View>
    </View>
  );
}

function Stat({ label, value, icon, tone, testID }: { label: string; value: string; icon: string; tone: string; testID: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <MaterialDesignIcons name={icon as any} size={20} color={tone} />
      <Text style={[styles.statValue, { color: tone }]} testID={testID}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  flex: { flex: 1 },
  header: { backgroundColor: c.brandPrimary, paddingHorizontal: 16, paddingBottom: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  headerTitle: { fontFamily: fonts.display, fontSize: 26, color: c.onBrandPrimary },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.success },
  headerSub: { fontFamily: fonts.textMedium, fontSize: 12, color: c.brandSoftText },
  dateBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: c.surfaceSecondary, borderBottomWidth: 1, borderBottomColor: c.border },
  dateCenter: { flex: 1, alignItems: "center", minHeight: 44, justifyContent: "center" },
  dateLabel: { fontFamily: fonts.display, fontSize: 22, color: c.brandPrimary, textTransform: "capitalize" },
  dateValue: { fontFamily: fonts.textMedium, fontSize: 12, color: c.muted },
  loader: { marginTop: 48 },
  content: { padding: 16, gap: 12 },
  errorBox: { flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: c.errorTint, borderRadius: 10, padding: 10 },
  errorText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.error, flex: 1 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stat: { flexGrow: 1, flexBasis: "30%", backgroundColor: c.surfaceSecondary, borderRadius: 12, borderWidth: 1, borderColor: c.border, padding: 12, gap: 2 },
  statValue: { fontFamily: fonts.displayHeavy, fontSize: 30 },
  statLabel: { fontFamily: fonts.textSemi, fontSize: 12, color: c.muted },
  totalBox: { gap: 6 },
  totalText: { fontFamily: fonts.textBold, fontSize: 13, color: c.onSuccessTint },
  track: { height: 8, borderRadius: 4, backgroundColor: c.border, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4, backgroundColor: c.success },
  empty: { alignItems: "center", paddingVertical: 48, gap: 10 },
  emptyText: { fontFamily: fonts.textMedium, fontSize: 15, color: c.muted, textAlign: "center" },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 14, gap: 10 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardNum: { fontFamily: fonts.displayHeavy, fontSize: 24, color: c.brandPrimary },
  trasbordo: { fontFamily: fonts.textBold, fontSize: 12, color: c.onWarningTint },
  cardMeta: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  cardCount: { fontFamily: fonts.displayHeavy, fontSize: 26 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: c.divider },
  rowDot: { width: 10, height: 10, borderRadius: 5 },
  rowCode: { fontFamily: fonts.display, fontSize: 18, color: c.onSurface },
  rowMeta: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  rowRight: { alignItems: "flex-end", maxWidth: "42%" },
  rowStato: { fontFamily: fonts.textBold, fontSize: 13 },
  rowWho: { fontFamily: fonts.textMedium, fontSize: 12, color: c.onSurfaceTertiary },
  bottomBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: c.surfaceSecondary, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: c.border },
}));
