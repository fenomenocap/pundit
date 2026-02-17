"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { config } from "@/lib/wagmi";
import { NetworkGuard } from "@/components/network-guard";
import { ToastProvider } from "@/components/toast";
import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient();

const customTheme = darkTheme({
  accentColor: "#00c8ff",
  accentColorForeground: "#000000",
  borderRadius: "small",
  overlayBlur: "small",
  fontStack: "system",
});

customTheme.colors.modalBackground = "hsl(228, 45%, 7%)";
customTheme.colors.profileForeground = "hsl(228, 45%, 7%)";
customTheme.colors.connectButtonBackground = "hsl(228, 35%, 12%)";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={customTheme}>
          <ToastProvider>
            <NetworkGuard>
              {children}
            </NetworkGuard>
          </ToastProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
