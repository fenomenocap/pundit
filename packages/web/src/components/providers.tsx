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
  accentColor: "#2dd4bf",
  accentColorForeground: "#000000",
  borderRadius: "small",
  overlayBlur: "small",
});

customTheme.colors.modalBackground = "hsl(220, 20%, 6%)";
customTheme.colors.profileForeground = "hsl(220, 20%, 6%)";
customTheme.colors.connectButtonBackground = "hsl(220, 15%, 10%)";

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
