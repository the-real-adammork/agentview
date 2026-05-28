import { useCallback, useState } from "react";

import { PALETTES, type Palette } from "./components/PaletteSwitcher";

const STORAGE_KEY = "agentview:palette";

const isPalette = (value: unknown): value is Palette =>
  typeof value === "string" && (PALETTES as readonly string[]).includes(value);

function readStoredPalette(): Palette {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isPalette(stored)) {
      return stored;
    }
  } catch {
    // Access to localStorage can throw in private/sandboxed contexts; fall back to default.
  }
  return "orange";
}

export function usePalette(): [Palette, (palette: Palette) => void] {
  const [palette, setPalette] = useState<Palette>(readStoredPalette);

  const changePalette = useCallback((next: Palette) => {
    setPalette(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort; the in-memory value still drives the UI.
    }
  }, []);

  return [palette, changePalette];
}
