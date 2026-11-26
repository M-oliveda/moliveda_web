import type { Metadata } from "next";

import "./globals.css";

// Placeholder root layout. Phase 3 moves it under `[locale]` with next-intl.
export const metadata: Metadata = {
  title: "Mauricio Oliveda",
  description: "Professional Software Developer",
};

export default function RootLayout({
  children,
}: LayoutProps<"/">): React.JSX.Element {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
