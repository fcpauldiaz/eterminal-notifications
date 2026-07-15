import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Terminal Notifications",
  description:
    "SPX3 signal alerts via Chrome + ntfy, with retail flow bias and near-cross pills on E.T. Terminal",
  version: "1.0.26",
  action: {
    default_popup: "src/popup/index.html",
    default_title: "Terminal Notifications",
    default_icon: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    },
  },
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["https://terminal.emini.today/*"],
      js: ["src/content/chart-bridge.ts"],
      world: "MAIN",
      run_at: "document_start",
    },
    {
      // Full site: Terminal is a Next.js SPA; users often land on /login then
      // client-navigate to /user/spx3 without a full reload.
      matches: ["https://terminal.emini.today/*"],
      js: ["src/content/pills.ts"],
      css: ["src/content/pills.css"],
      run_at: "document_idle",
    },
  ],
  permissions: ["alarms", "notifications", "storage", "cookies", "tabs"],
  host_permissions: ["https://terminal.emini.today/*", "https://ntfy.sh/*"],
});
