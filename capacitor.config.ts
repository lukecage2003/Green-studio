import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "app.greenstudio",
  appName: "Green Studio",
  webDir: "dist",
  backgroundColor: "#070b09",
  android: { backgroundColor: "#070b09" },
  plugins: {
    // La page gère les zones système elle-même (viewport-fit=cover + env(safe-area-inset-*)).
    SystemBars: { insetsHandling: "native", initialViewportFitValueHint: "cover", style: "DARK" },
  },
};
export default config;
