import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AfroFlow",
  description: "Afro Asiatic Exporters",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
