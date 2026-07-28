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
    "Premier League and Champions League qualifier probabilities, live fixture odds, and grounded football analysis.",
  keywords: ["football predictions", "Premier League", "Champions League qualifiers", "sports analysis", "match analysis"],
  openGraph: {
    type: "website",
    siteName: "Pundit",
    title: "Pundit — Football Prediction Analysis",
    description: "Club-season probabilities, live fixture odds, and grounded football analysis.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Pundit — Football Prediction Analysis",
    description: "Club-season probabilities, live fixture odds, and grounded football analysis.",
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
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          Skip to main content
        </a>
        <div className="flex min-h-screen flex-col">
          <Navbar />
          <main id="main-content" className="flex-1">{children}</main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
