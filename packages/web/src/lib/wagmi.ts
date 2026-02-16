import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { baseSepolia } from "wagmi/chains";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

if (!projectId || projectId === "PLACEHOLDER") {
  console.warn(
    "[Sports Predict] Missing NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID. " +
    "WalletConnect will not work. Get one at https://cloud.walletconnect.com"
  );
}

export const config = getDefaultConfig({
  appName: "Sports Predict",
  projectId: projectId || "00000000000000000000000000000000",
  chains: [baseSepolia],
  ssr: true,
});
