"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  DEFAULT_X_DATA_PROVIDER,
  parseXDataProvider,
  X_DATA_PROVIDER_STORAGE_KEY,
  type XDataProvider,
} from "@/lib/x";

type XDataProviderPreferenceContextValue = {
  provider: XDataProvider;
  setProvider: (provider: XDataProvider) => void;
};

const XDataProviderPreferenceContext = createContext<XDataProviderPreferenceContextValue | null>(null);
const X_DATA_PROVIDER_EVENT = "skaleai:x-data-provider-change";
const COOKIE_NAME = "skaleai.x-data-provider";

export function readStoredXDataProvider(): XDataProvider {
  if (typeof window === "undefined") return DEFAULT_X_DATA_PROVIDER;
  return parseXDataProvider(window.localStorage.getItem(X_DATA_PROVIDER_STORAGE_KEY));
}

export function writeStoredXDataProvider(provider: XDataProvider): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(X_DATA_PROVIDER_STORAGE_KEY, provider);
  document.cookie = `${COOKIE_NAME}=${provider};path=/;max-age=31536000;samesite=lax`;
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

export function XDataProviderPreferenceProvider({
  children,
  initialProvider,
}: {
  children: ReactNode;
  initialProvider?: XDataProvider;
}) {
  const serverSnapshot = useCallback(
    () => initialProvider ?? DEFAULT_X_DATA_PROVIDER,
    [initialProvider],
  );

  const provider = useSyncExternalStore(
    subscribeToXDataProvider,
    readStoredXDataProvider,
    serverSnapshot,
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
