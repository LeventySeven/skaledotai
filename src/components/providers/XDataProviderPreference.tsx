"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  DEFAULT_X_DATA_PROVIDER,
  parseXDataProvider,
  X_DATA_PROVIDER_STORAGE_KEY,
  type XDataProvider,
} from "@/lib/x-provider";

type XDataProviderPreferenceContextValue = {
  provider: XDataProvider;
  setProvider: (provider: XDataProvider) => void;
};

const XDataProviderPreferenceContext = createContext<XDataProviderPreferenceContextValue | null>(null);
const X_DATA_PROVIDER_EVENT = "skaleai:x-data-provider-change";

export function readStoredXDataProvider(): XDataProvider {
  if (typeof window === "undefined") return DEFAULT_X_DATA_PROVIDER;
  return parseXDataProvider(window.localStorage.getItem(X_DATA_PROVIDER_STORAGE_KEY));
}

export function writeStoredXDataProvider(provider: XDataProvider): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(X_DATA_PROVIDER_STORAGE_KEY, provider);
  window.dispatchEvent(new Event(X_DATA_PROVIDER_EVENT));
}

function subscribeToXDataProvider(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  window.addEventListener("storage", callback);
  window.addEventListener(X_DATA_PROVIDER_EVENT, callback);

  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(X_DATA_PROVIDER_EVENT, callback);
  };
}

export function XDataProviderPreferenceProvider({ children }: { children: ReactNode }) {
  const provider = useSyncExternalStore(
    subscribeToXDataProvider,
    readStoredXDataProvider,
    () => DEFAULT_X_DATA_PROVIDER,
  );

  const value = useMemo<XDataProviderPreferenceContextValue>(() => ({
    provider,
    setProvider: writeStoredXDataProvider,
  }), [provider]);

  return (
    <XDataProviderPreferenceContext.Provider value={value}>
      {children}
    </XDataProviderPreferenceContext.Provider>
  );
}

export function useXDataProviderPreference(): XDataProviderPreferenceContextValue {
  const value = useContext(XDataProviderPreferenceContext);
  if (!value) {
    throw new Error("useXDataProviderPreference must be used within XDataProviderPreferenceProvider");
  }
  return value;
}
