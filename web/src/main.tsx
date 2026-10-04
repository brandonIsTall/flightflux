import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// The last snapshot is persisted in IndexedDB, so a repeat visit draws flights (dead-reckoned
// forward) before the network answers. Queries older than 6 h are dropped: positions
// extrapolated that far would be fiction.
const queryClient = new QueryClient({
  defaultOptions: { queries: { gcTime: 6 * 3600_000 } },
});

const persister = createAsyncStoragePersister({
  storage: {
    getItem: (k) => get(k).then((v) => (v == null ? null : (v as string))),
    setItem: (k, v) => set(k, v),
    removeItem: (k) => del(k),
  },
  key: "ff:query-cache",
  throttleTime: 2000,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 6 * 3600_000, buster: "v1" }}>
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
);
