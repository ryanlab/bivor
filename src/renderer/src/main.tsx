import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyTheme, loadThemePreference, watchSystemTheme } from "./lib/theme";
import { persistLocale, loadLocalePreference } from "./lib/locale";
import { useAppStore } from "./stores/app-store";
import "./styles/index.css";

document.documentElement.dataset.platform = window.pi.system.platform;
applyTheme(loadThemePreference());
persistLocale(loadLocalePreference());
watchSystemTheme(() => useAppStore.getState().theme);

// Exposed for automation/debugging (harmless in a local desktop app)
(window as unknown as Record<string, unknown>).__store = useAppStore;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
