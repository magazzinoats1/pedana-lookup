// Design tokens for this app. Light theme only, based on the Antolini brand
// (navy #1A3A6B + blue #2563EB) from the user's reference design.
// The keys match the "color" block of /app/design_guidelines.json.

import { useMemo } from "react";
import { Appearance, StyleSheet, useColorScheme } from "react-native";

export type ColorScheme = "light" | "dark";

const light = {
  surface: "#F0F4F8",
  onSurface: "#0F172A",
  surfaceSecondary: "#FFFFFF",
  onSurfaceSecondary: "#1F2937",
  surfaceTertiary: "#F1F5F9",
  onSurfaceTertiary: "#475569",
  surfaceInverse: "#1A3A6B",
  onSurfaceInverse: "#FFFFFF",
  muted: "#64748B",

  brand: "#1A3A6B",
  onBrand: "#FFFFFF",
  brandPrimary: "#1A3A6B",
  onBrandPrimary: "#FFFFFF",
  brandSecondary: "#2563EB",
  onBrandSecondary: "#FFFFFF",
  brandTertiary: "#EFF6FF",
  onBrandTertiary: "#1D4ED8",
  brandSoftText: "#BFDBFE",

  success: "#16A34A",
  onSuccess: "#FFFFFF",
  successTint: "#F0FDF4",
  onSuccessTint: "#15803D",
  warning: "#D97706",
  onWarning: "#FFFFFF",
  warningTint: "#FFFBEB",
  onWarningTint: "#92400E",
  error: "#DC2626",
  onError: "#FFFFFF",
  errorTint: "#FEF2F2",
  info: "#2563EB",
  onInfo: "#FFFFFF",

  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  divider: "#E2E8F0",
  scrim: "rgba(15,23,42,0.55)",
};

export type ThemeColors = typeof light;

export const defaultScheme = "light" satisfies ColorScheme;

export const themes: { light: ThemeColors; dark?: ThemeColors } = { light };

export function setColorScheme(scheme: ColorScheme | null) {
  Appearance.setColorScheme?.(scheme ?? "unspecified");
}

setColorScheme?.(themes.dark ? null : defaultScheme);

export function useTheme(): { scheme: ColorScheme; colors: ThemeColors } {
  const system = useColorScheme();
  const scheme: ColorScheme = system && themes[system] ? system : defaultScheme;
  return { scheme, colors: themes[scheme] ?? themes.light };
}

export function makeStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: (colors: ThemeColors) => T & StyleSheet.NamedStyles<any>,
): () => T {
  return function useStyles(): T {
    const { colors } = useTheme();
    return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
  };
}

export const fonts = {
  display: "BarlowCondensed-Bold",
  displayHeavy: "BarlowCondensed-ExtraBold",
  displaySemi: "BarlowCondensed-SemiBold",
  text: "IBMPlexSans-Regular",
  textMedium: "IBMPlexSans-Medium",
  textSemi: "IBMPlexSans-SemiBold",
  textBold: "IBMPlexSans-Bold",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 };
export const radius = { sm: 6, md: 12, lg: 20, pill: 999 };
