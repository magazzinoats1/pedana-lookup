import React from "react";
import { Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";

import { formatDate, formatDateTime, isTrasbordo, Pedana } from "@/src/api";
import { StatoToggle } from "@/src/components/StatoToggle";
import { InfoTile } from "@/src/components/ui";
import { fonts, makeStyles, useTheme } from "@/src/theme";

export function statoColor(stato: string, colors: ReturnType<typeof useTheme>["colors"]) {
  return stato === "completo" ? colors.success : stato === "parziale" ? colors.warning : colors.brandSecondary;
}

export function PedanaDetail({
  pedana,
  items,
  onUpdated,
  operatore,
  onRequestName,
}: {
  pedana: Pedana;
  items?: Pedana[];
  onUpdated: (p: Pedana) => void;
  operatore: string | null;
  onRequestName: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Animated.View entering={FadeInDown.duration(250)} style={[styles.card, { borderTopColor: statoColor(pedana.statoArrivo, colors) }]} testID="pedana-detail-card">
      <View style={styles.destBox}>
        <Text style={styles.destLabel}>DESTINAZIONE</Text>
        <Text style={styles.dest} testID="pedana-detail-destinazione">{pedana.destinazione}</Text>
      </View>

      <View style={styles.codeRow}>
        <View style={styles.flex}>
          <Text style={styles.smallLabel}>POSIZIONE PEDANA</Text>
          <Text style={styles.code} testID="pedana-detail-codice">{pedana.codice}</Text>
        </View>
        <View style={styles.orderPill}>
          <Text style={styles.smallLabelOn}>N° ORDINE</Text>
          <Text style={styles.order} testID="pedana-detail-numero-ordine">{pedana.numeroOrdine || "—"}</Text>
        </View>
      </View>

      {items && items.length > 1 ? (
        <View style={styles.merceBox} testID="pedana-detail-merce-list">
          <Text style={styles.smallLabel}>{items.length} MERCI SU QUESTA POSIZIONE · si scaricano insieme</Text>
          {items.map((it) => (
            <View key={it.id} style={styles.merceRow} testID={`pedana-detail-merce-item-${it.id}`}>
              <Text style={styles.merceItem} numberOfLines={2}>{it.merce || "—"}</Text>
              <Text style={styles.merceQty}>
                {[it.numeroPedane ? `${it.numeroPedane} ped.` : "", it.numeroColli ? `${it.numeroColli} colli` : ""].filter(Boolean).join(" · ")}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        !!pedana.merce && (
          <View style={styles.merceBox}>
            <Text style={styles.smallLabel}>TIPO MERCE</Text>
            <Text style={styles.merce} testID="pedana-detail-merce">{pedana.merce}</Text>
          </View>
        )
      )}

      <View style={styles.section}>
        <StatoToggle pedana={pedana} items={items} onUpdated={onUpdated} operatore={operatore} onRequestName={onRequestName} />
      </View>

      <View style={styles.grid}>
        <InfoTile label="MITTENTE" value={pedana.mittente} icon="truck-delivery-outline" testID="pedana-detail-mittente" />
        <InfoTile label="DATA CONSEGNA" value={formatDate(pedana.dataConsegna)} icon="calendar" testID="pedana-detail-data" />
        <InfoTile label="N° PEDANE" value={pedana.numeroPedane ?? ""} icon="layers-triple-outline" testID="pedana-detail-numero-pedane" />
        <InfoTile label="N° COLLI" value={pedana.numeroColli} icon="package-variant-closed" testID="pedana-detail-colli" />
        <InfoTile label="AGENZIA" value={pedana.agenzia} icon="domain" testID="pedana-detail-agenzia" />
        <InfoTile
          label={isTrasbordo(pedana.trasportatore) ? "TRASBORDO" : "TRASPORTATORE"}
          value={pedana.trasportatore || "Antolini Trasporti"}
          icon={isTrasbordo(pedana.trasportatore) ? "swap-horizontal-bold" : "truck-outline"}
          testID="pedana-detail-trasportatore"
        />
      </View>

      {!!pedana.note && (
        <View style={styles.note}>
          <MaterialDesignIcons name="note-text-outline" size={18} color={colors.onWarningTint} />
          <Text style={styles.noteText} testID="pedana-detail-note">{pedana.note}</Text>
        </View>
      )}
      {!!pedana.ultimaRettifica && (
        <Text style={styles.rett}>Ultima rettifica: {formatDateTime(pedana.ultimaRettifica)}</Text>
      )}
    </Animated.View>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1 },
  card: { backgroundColor: c.surfaceSecondary, borderRadius: 14, borderTopWidth: 6, padding: 16, gap: 14, borderWidth: 1, borderColor: c.border },
  destBox: { backgroundColor: c.brandPrimary, borderRadius: 12, padding: 16 },
  destLabel: { fontFamily: fonts.textBold, fontSize: 11, letterSpacing: 1.2, color: c.brandSoftText },
  dest: { fontFamily: fonts.displayHeavy, fontSize: 40, lineHeight: 44, color: c.onBrandPrimary, marginTop: 2 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  smallLabel: { fontFamily: fonts.textBold, fontSize: 11, letterSpacing: 1, color: c.muted },
  smallLabelOn: { fontFamily: fonts.textBold, fontSize: 10, letterSpacing: 1, color: c.onBrandTertiary },
  code: { fontFamily: fonts.display, fontSize: 30, color: c.onSuccessTint },
  orderPill: { backgroundColor: c.brandTertiary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignItems: "flex-end" },
  order: { fontFamily: fonts.display, fontSize: 24, color: c.brandPrimary },
  section: {},
  merceBox: { backgroundColor: c.brandTertiary, borderRadius: 10, padding: 12 },
  merceRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 8, marginTop: 6, borderTopWidth: 1, borderTopColor: c.border },
  merceItem: { flex: 1, fontFamily: fonts.textBold, fontSize: 16, color: c.onBrandTertiary },
  merceQty: { fontFamily: fonts.textSemi, fontSize: 13, color: c.onSurfaceTertiary },
  merce: { fontFamily: fonts.textBold, fontSize: 17, color: c.onBrandTertiary, marginTop: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  note: { flexDirection: "row", gap: 8, backgroundColor: c.warningTint, borderRadius: 10, padding: 12 },
  noteText: { flex: 1, fontFamily: fonts.text, fontSize: 14, color: c.onWarningTint },
  rett: { fontFamily: fonts.textMedium, fontSize: 12, color: c.warning },
}));
