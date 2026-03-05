import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Info Aggregator",
  description: "Personal information aggregator with news, sports, markets, media, and more",
  icons: {
    icon: "/assets/website_logos/info_agg.svg",
    shortcut: "/assets/website_logos/info_agg.svg",
    apple: "/assets/website_logos/info_agg.svg",
  },
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
      </body>
    </html>
  );
}
