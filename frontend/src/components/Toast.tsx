import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Text, View } from "react-native";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";

import { fonts, makeStyles, useTheme } from "@/src/theme";

type ToastType = "success" | "error";
const Ctx = createContext<(msg: string, type?: ToastType) => void>(() => {});

export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; type: ToastType; key: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const { colors } = useTheme();

  const show = useCallback((msg: string, type: ToastType = "success") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, type, key: Date.now() });
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 8 }]}>
          <Animated.View
            key={toast.key}
            entering={FadeInUp}
            exiting={FadeOutUp}
            testID="toast-message"
            style={[styles.toast, { backgroundColor: toast.type === "error" ? colors.error : colors.success }]}
          >
            <MaterialDesignIcons
              name={toast.type === "error" ? "alert-circle" : "check-circle"}
              size={22}
              color={colors.onSuccess}
            />
            <Text style={styles.text}>{toast.msg}</Text>
          </Animated.View>
        </View>
      )}
    </Ctx.Provider>
  );
}

const useStyles = makeStyles((c) => ({
  wrap: { position: "absolute", left: 16, right: 16, alignItems: "center" },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    maxWidth: 520,
    width: "100%",
  },
  text: { color: c.onSuccess, fontFamily: fonts.textSemi, fontSize: 15, flex: 1 },
}));
