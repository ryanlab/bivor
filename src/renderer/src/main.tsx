import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { EditorWindow } from "./components/EditorWindow";
import { applyTheme, loadThemePreference, watchSystemTheme } from "./lib/theme";
import { persistLocale, loadLocalePreference } from "./lib/locale";
import { useAppStore } from "./stores/app-store";
import "./styles/index.css";

applyTheme(loadThemePreference());
persistLocale(loadLocalePreference());
watchSystemTheme(() => useAppStore.getState().theme);

// Exposed for automation/debugging (harmless in a local desktop app)
(window as unknown as Record<string, unknown>).__store = useAppStore;

const editorWindow = window.location.hash === "#editor";
if (editorWindow) document.title = "Bivor";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {editorWindow ? <EditorWindow /> : <App />}
  </React.StrictMode>,
);
