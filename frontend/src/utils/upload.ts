import { Platform } from "react-native";
import { fetch as expoFetch } from "expo/fetch";

// Build a FormData with a local file (image/pdf) in a way that works on web AND real devices.
export async function uploadForm(field: string, uri: string, name: string, type: string): Promise<FormData> {
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append(field, blob, name);
  } else {
    const blob = await (await expoFetch(uri)).blob();
    form.append(field, blob as any, name);
  }
  return form;
}
