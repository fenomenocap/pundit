import type { Metadata } from "next";
import { DynamicProviders } from "@/components/dynamic-providers";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Pundit — Sports Prediction Markets",
    template: "%s | Pundit",
  },
  description:
    "Your edge in sports prediction markets. Trade on football outcomes with limit orders on Base.",
  keywords: ["prediction markets", "sports betting", "football", "crypto", "USDC", "Base", "onchain"],
  openGraph: {
    type: "website",
    siteName: "Pundit",
    title: "Pundit — Sports Prediction Markets",
    description: "Your edge in sports prediction markets. Trade on football outcomes with limit orders on Base.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pundit — Sports Prediction Markets",
    description: "Your edge in sports prediction markets.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        {/* Space Grotesk (FTX-style geometric sans) + Space Mono */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-body antialiased">
        <DynamicProviders>
          <div className="flex min-h-screen flex-col">
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </DynamicProviders>
      </body>
    </html>
  );
}
