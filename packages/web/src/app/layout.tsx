import type { Metadata } from "next";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Pundit — Football Prediction Analysis",
    template: "%s | Pundit",
  },
  description:
    "World Cup win probabilities, live fixture odds, and a conversational match-analysis agent.",
  keywords: ["prediction market", "sports analysis", "football", "world cup", "match analysis"],
  openGraph: {
    type: "website",
    siteName: "Pundit",
    title: "Pundit — Football Prediction Analysis",
    description: "World Cup win probabilities, live fixture odds, and a conversational match-analysis agent.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pundit — Football Prediction Analysis",
    description: "World Cup win probabilities and live fixture odds.",
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
        <div className="flex min-h-screen flex-col">
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
