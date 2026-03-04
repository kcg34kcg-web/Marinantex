import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marinantex Legal Editor",
  description: "Web tabanli avukat belge editoru",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
