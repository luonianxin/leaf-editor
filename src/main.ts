import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

performance.mark("leaf:entry");
try {
  const stored = localStorage.getItem("leaf:theme");
  document.documentElement.dataset.theme = stored === "dark" || (!stored && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
} catch { /* Editing does not depend on persisted preferences. */ }
createApp(App).mount("#app");
performance.mark("leaf:shell-mounted");
