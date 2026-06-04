import { useCallback, useEffect, useState } from "react";

import type { UiKitId } from "./ui/contracts";

export const UI_KITS: readonly UiKitId[] = ["agentview"];

export type UiKit = UiKitId;

const DEFAULT_UI_KIT: UiKit = "agentview";
const STORAGE_KEY = "agentview.uiKit";

export function isUiKit(value: string | null | undefined): value is UiKit {
  return UI_KITS.includes(value as UiKit);
}

function initialUiKit(): UiKit {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("uiKit");
  if (isUiKit(fromUrl)) {
    return fromUrl;
  }

  const fromStorage = window.localStorage.getItem(STORAGE_KEY);
  return isUiKit(fromStorage) ? fromStorage : DEFAULT_UI_KIT;
}

export function useUiKit(): [UiKit, (uiKit: UiKit) => void] {
  const [uiKit, setUiKitState] = useState<UiKit>(initialUiKit);

  const setUiKit = useCallback((nextUiKit: UiKit) => {
    window.localStorage.setItem(STORAGE_KEY, nextUiKit);
    setUiKitState(nextUiKit);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, uiKit);
  }, [uiKit]);

  return [uiKit, setUiKit];
}
