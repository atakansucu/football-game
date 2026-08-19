import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Football Duel",
  description: "Real-time 2-player football knowledge duel",
};

export const viewport: Viewport = {
  themeColor: "#04140b",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <div className="mx-auto flex min-h-full w-full max-w-md flex-col px-4 py-6 sm:max-w-lg">
          {children}
        </div>
      </body>
    </html>
  );
}
