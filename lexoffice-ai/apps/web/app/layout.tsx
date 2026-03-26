import type { Metadata } from "next";
import { AppearanceSync } from "@/components/app/appearance-sync";
import "./globals.css";

export const metadata: Metadata = {
  title: "LexOffice AI",
  description: "Hukuk ofisleri için AI destekli çalışma ve mail platformu"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <AppearanceSync />
        {children}
      </body>
    </html>
  );
}
