import React from "react";
import { Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { makeStyles } from "@/src/theme";

type Props = { visible: boolean; onClose: () => void; children: React.ReactNode; testID?: string };

export function Sheet({ visible, onClose, children, testID }: Props) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <Pressable style={styles.scrim} onPress={onClose} testID={testID ? `${testID}-backdrop` : undefined} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} testID={testID}>
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} bounces={false}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((c) => ({
  flex: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const), backgroundColor: c.scrim },
  sheet: {
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
    backgroundColor: c.surfaceSecondary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "90%",
    paddingTop: 8,
  },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: c.borderStrong, marginBottom: 8 },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 },
}));
