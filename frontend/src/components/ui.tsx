import React from "react";
import { ActivityIndicator, Platform, Pressable, Text, TextInput, TextInputProps, View, ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";

import { fonts, makeStyles, useTheme } from "@/src/theme";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success" | "warning";

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: string;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const map: Record<Variant, { bg: string; fg: string; border: string }> = {
    primary: { bg: colors.brandPrimary, fg: colors.onBrandPrimary, border: colors.brandPrimary },
    secondary: { bg: colors.surfaceSecondary, fg: colors.onSurfaceSecondary, border: colors.borderStrong },
    ghost: { bg: colors.brandTertiary, fg: colors.onBrandTertiary, border: colors.brandTertiary },
    danger: { bg: colors.errorTint, fg: colors.error, border: colors.errorTint },
    success: { bg: colors.success, fg: colors.onSuccess, border: colors.success },
    warning: { bg: colors.warning, fg: colors.onWarning, border: colors.warning },
  };
  const v = map[variant];
  return (
    <Animated.View style={[anim, style]}>
      <Pressable
        testID={testID}
        disabled={disabled || loading}
        onPress={onPress}
        onPressIn={() => (scale.value = withSpring(0.97))}
        onPressOut={() => (scale.value = withSpring(1))}
        style={[styles.btn, { backgroundColor: v.bg, borderColor: v.border, opacity: disabled ? 0.5 : 1 }]}
      >
        {loading ? (
          <ActivityIndicator color={v.fg} />
        ) : (
          <>
            {icon && <MaterialDesignIcons name={icon as any} size={22} color={v.fg} />}
            <Text style={[styles.btnText, { color: v.fg }]}>{label}</Text>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function IconButton({
  icon,
  onPress,
  testID,
  tone = "default",
}: {
  icon: string;
  onPress: () => void;
  testID?: string;
  tone?: "default" | "danger" | "onBrand";
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const bg = tone === "danger" ? colors.errorTint : tone === "onBrand" ? "rgba(255,255,255,0.16)" : colors.brandTertiary;
  const fg = tone === "danger" ? colors.error : tone === "onBrand" ? colors.onBrand : colors.onBrandTertiary;
  return (
    <Pressable testID={testID} onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.iconBtn, { backgroundColor: bg, opacity: pressed ? 0.7 : 1 }]}>
      <MaterialDesignIcons name={icon as any} size={22} color={fg} />
    </Pressable>
  );
}

export function Field({
  label,
  error,
  hint,
  highlight,
  ...props
}: TextInputProps & { label: string; error?: string; hint?: string; highlight?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, highlight && { color: colors.onBrandTertiary }]}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.muted}
        {...props}
        style={[
          styles.input,
          highlight && { borderColor: colors.brandSecondary, borderWidth: 2, fontFamily: fonts.textSemi },
          !!error && { borderColor: colors.error },
          props.editable === false && { backgroundColor: colors.surfaceTertiary, color: colors.muted },
          props.style,
        ]}
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      {!!hint && !error && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

export function InfoTile({ label, value, icon, testID }: { label: string; value: string; icon: string; testID?: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.tile}>
      <View style={styles.tileHead}>
        <MaterialDesignIcons name={icon as any} size={16} color={colors.muted} />
        <Text style={styles.tileLabel}>{label}</Text>
      </View>
      <Text style={styles.tileValue} testID={testID}>{value || "—"}</Text>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  btn: {
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  btnText: { fontFamily: fonts.textBold, fontSize: 16 },
  iconBtn: { width: 44, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  field: { marginBottom: 14 },
  label: { fontFamily: fonts.textSemi, fontSize: 13, color: c.onSurfaceSecondary, marginBottom: 6 },
  input: {
    minHeight: 52,
    borderWidth: 1.5,
    borderColor: c.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: fonts.text,
    color: c.onSurface,
    backgroundColor: c.surfaceSecondary,
    ...(Platform.OS === "web" ? ({ outlineWidth: 0, outlineStyle: "none" } as object) : {}),
  },
  error: { color: c.error, fontSize: 12, marginTop: 4, fontFamily: fonts.textMedium },
  hint: { color: c.muted, fontSize: 12, marginTop: 4, fontFamily: fonts.text },
  tile: { flexGrow: 1, flexBasis: "45%", backgroundColor: c.surfaceTertiary, borderRadius: 10, padding: 14 },
  tileHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  tileLabel: { fontFamily: fonts.textBold, fontSize: 11, color: c.muted, letterSpacing: 0.8 },
  tileValue: { fontFamily: fonts.textBold, fontSize: 16, color: c.onSurface },
}));
