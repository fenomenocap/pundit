"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { config } from "@/lib/wagmi";
import { ToastProvider } from "@/components/toast";
import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient();

const customTheme = darkTheme({
  accentColor: "#3b82f6",
  accentColorForeground: "white",
  borderRadius: "medium",
  overlayBlur: "small",
});

// Override the background colors to match our navy theme
customTheme.colors.modalBackground = "#111827";
customTheme.colors.profileForeground = "#111827";
customTheme.colors.connectButtonBackground = "#1e293b";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={customTheme}>
          <ToastProvider>
            {children}
          </ToastProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
