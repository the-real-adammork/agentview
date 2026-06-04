import { createContext, useContext, type ReactNode } from "react";

import { agentViewKit } from "./kits/agentview";
import type { UiKitComponents, UiKitId } from "./contracts";

const kits: Record<UiKitId, UiKitComponents> = {
  agentview: agentViewKit,
};

const UiKitContext = createContext<UiKitComponents>(agentViewKit);

export function UiKitProvider({ children, kit }: { children: ReactNode; kit: UiKitId }) {
  return <UiKitContext.Provider value={kits[kit]}>{children}</UiKitContext.Provider>;
}

export function useUiKitComponents() {
  return useContext(UiKitContext);
}
