import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host?.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host ?? "localhost:3000"}`);

  return {
    metadataBase,
    title: {
      default: "秋招同行录",
      template: "%s · 秋招同行录",
    },
    description: "清晰记录每一次秋招与提前批投递进度。",
    openGraph: {
      title: "秋招同行录",
      description: "把每一次投递，变成清晰的下一步。",
      images: [{ url: new URL("/og.png", metadataBase).toString() }],
      type: "website",
      locale: "zh_CN",
    },
    twitter: {
      card: "summary_large_image",
      title: "秋招同行录",
      description: "把每一次投递，变成清晰的下一步。",
      images: [new URL("/og.png", metadataBase).toString()],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
