import type { Metadata } from "next";
import localFont from "next/font/local";
import { DynamicProviders } from "@/components/dynamic-providers";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-heading",
  weight: "100 900",
});

const geistBody = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-body",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: {
    default: "Sports Predict — Onchain Prediction Markets",
    template: "%s | Sports Predict",
  },
  description:
    "Trade on FIFA World Cup 2026 outcomes with USDC on Base. Parimutuel prediction markets powered by smart contracts.",
  keywords: ["prediction markets", "FIFA World Cup 2026", "crypto", "USDC", "Base", "onchain"],
  openGraph: {
    type: "website",
    siteName: "Sports Predict",
    title: "Sports Predict — Onchain Prediction Markets",
    description:
      "Trade on FIFA World Cup 2026 outcomes with USDC on Base. Parimutuel prediction markets powered by smart contracts.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Sports Predict — Onchain Prediction Markets",
    description:
      "Trade on FIFA World Cup 2026 outcomes with USDC on Base.",
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
      <body
        className={`${geistSans.variable} ${geistBody.variable} ${geistMono.variable} font-body antialiased`}
      >
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
