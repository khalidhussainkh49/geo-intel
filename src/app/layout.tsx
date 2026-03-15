import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "WorldWideView | Geospatial Intelligence",
  description: "Next-generation, open-source geospatial intelligence platform.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Load CesiumJS base styles (optional, but helps with UI widgets if used later) */}
        <link rel="stylesheet" href="/cesium/Widgets/widgets.css" />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
