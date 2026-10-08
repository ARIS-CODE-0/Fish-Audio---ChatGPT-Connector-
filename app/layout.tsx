import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fish Audio — Studio de voix off",
  description: "Recherche de voix et génération de voix off MP3 avec Fish Audio, directement depuis ChatGPT.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/fish-audio-icon.png", type: "image/png", sizes: "96x96" }],
    shortcut: "/fish-audio-icon.png",
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
