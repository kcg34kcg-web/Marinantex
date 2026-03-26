"use client";

import { useEffect } from "react";
import {
  APPEARANCE_CHANGED_EVENT,
  APPEARANCE_STORAGE_KEY,
  applyAppearancePreferences,
  readAppearancePreferences
} from "@/lib/appearance-preferences";

export function AppearanceSync() {
  useEffect(() => {
    const applyCurrent = () => {
      applyAppearancePreferences(readAppearancePreferences());
    };

    applyCurrent();

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== APPEARANCE_STORAGE_KEY) {
        return;
      }
      applyCurrent();
    };
    const handleAppearanceEvent = () => applyCurrent();
    const handleThemeChange = () => applyCurrent();

    window.addEventListener("storage", handleStorage);
    window.addEventListener(APPEARANCE_CHANGED_EVENT, handleAppearanceEvent);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleThemeChange);
    } else {
      media.addListener(handleThemeChange);
    }

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(APPEARANCE_CHANGED_EVENT, handleAppearanceEvent);
      if (typeof media.removeEventListener === "function") {
        media.removeEventListener("change", handleThemeChange);
      } else {
        media.removeListener(handleThemeChange);
      }
    };
  }, []);

  return null;
}
