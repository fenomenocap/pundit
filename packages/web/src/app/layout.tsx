import type { Metadata } from "next";
import { Navbar, MobileDock } from "@/components/navbar";
import { Footer } from "@/components/footer";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Pundit",
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
        {/* Barlow + Barlow Condensed — desk type */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Barlow:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Barlow+Condensed:wght@500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-bg text-fg font-body antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-fg"
        >
          Skip to main content
        </a>
        <div className="flex min-h-dvh flex-col bg-bg text-fg">
          <Navbar />
          <main id="main-content" className="flex-1 min-h-0 bg-bg pb-14 md:pb-0">
            {children}
          </main>
          <Footer />
          <MobileDock />
        </div>
      </body>
    </html>
  );
}
