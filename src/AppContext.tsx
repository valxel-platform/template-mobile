import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import * as Network from "expo-network";
import type { SessionState } from "./auth/session";
import type { Command } from "./outbox/outbox";
import type { Services } from "./services";

const Context = createContext<Services | null>(null);

export function AppProvider({ services, children }: { services: Services; children: ReactNode }) {
  const { outbox, session } = services;
  useEffect(() => {
    // Send waiting changes whenever there may be a chance: back online, back in the foreground,
    // and every 30 seconds while open (for backoff retries).
    const flush = () => {
      if (session.state === "signedIn") void outbox.flush().catch(() => undefined);
    };
    const network = Network.addNetworkStateListener((state) => {
      if (state.isInternetReachable !== false && state.isConnected) flush();
    });
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") flush();
    });
    const timer = setInterval(flush, 30_000);
    const unsubscribe = session.subscribe((state) => {
      if (state === "signedIn") flush();
    });
    flush();
    return () => {
      network.remove();
      app.remove();
      clearInterval(timer);
      unsubscribe();
    };
  }, [outbox, session]);
  return <Context.Provider value={services}>{children}</Context.Provider>;
}

export function useServices(): Services {
  const services = useContext(Context);
  if (!services) throw new Error("useServices outside AppProvider");
  return services;
}

export function useSessionState(): SessionState {
  const { session } = useServices();
  const subscribe = useCallback((changed: () => void) => session.subscribe(changed), [session]);
  return useSyncExternalStore(subscribe, () => session.state);
}

/** The changes waiting to be sent, conflicting or rejected. */
export function useOutbox(): Command[] {
  const { outbox } = useServices();
  const [commands, setCommands] = useState<Command[]>([]);
  useEffect(() => {
    let live = true;
    void outbox.list().then((list) => {
      if (live) setCommands(list);
    });
    const unsubscribe = outbox.subscribe(setCommands);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [outbox]);
  return commands;
}

export function useUpgradeRequired(): boolean {
  const { upgrade } = useServices();
  const subscribe = useCallback(
    (changed: () => void) => {
      upgrade.listeners.add(changed);
      return () => {
        upgrade.listeners.delete(changed);
      };
    },
    [upgrade],
  );
  return useSyncExternalStore(subscribe, () => upgrade.required);
}
