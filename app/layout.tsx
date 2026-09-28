import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "next-themes";
import { Analytics } from "@vercel/analytics/next";
import { getSiteUrl } from "@/lib/site-url";
import "./globals.css";

const SITE_URL = getSiteUrl();

const siteDescription =
  "Personal information aggregator with news, sports, markets, media, and more";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Info Hub",
  description: siteDescription,
  authors: [{ name: "Info Hub" }],
  creator: "Info Hub",
  publisher: "Info Hub",
  appleWebApp: {
    capable: true,
    title: "Info Hub",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: "Info Hub",
    description: siteDescription,
    images: [
      {
        url: `${SITE_URL}/opengraph-image.png`,
        width: 1200,
        height: 630,
        alt: "Info Hub",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Info Hub",
    description: siteDescription,
    images: [`${SITE_URL}/twitter-image.png`],
  },
  manifest: "/manifest.json",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

/**
 * `maximumScale: 1` exists for one reason: iOS Safari zooms the page on focus
 * for any input whose font-size is under 16px, and the auth fields are 12px so
 * that typed text and placeholder share a scale. Without this the login field
 * threw the panel half off-screen on every tap.
 *
 * Trade-off, and the reason it is spelled out rather than just set: capping the
 * maximum scale is normally an accessibility smell. On iOS 10+ it is not —
 * Safari honours it for the *automatic* focus zoom but still allows the user to
 * pinch-zoom past it. Chrome on Android does enforce it, so pinch-zoom there is
 * capped at 1x. If that ever matters more than the focus zoom, remove this and
 * put the auth inputs back to 16px.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

const geistSans = localFont({
  src: [
    { path: "../node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2", weight: "400" },
    { path: "../node_modules/geist/dist/fonts/geist-sans/Geist-Medium.woff2", weight: "500" },
    { path: "../node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.woff2", weight: "600" },
    { path: "../node_modules/geist/dist/fonts/geist-sans/Geist-Bold.woff2", weight: "700" },
  ],
  variable: "--font-geist-sans",
  display: "swap",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
