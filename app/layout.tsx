import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { ME, SITE_URL } from "@/lib/site/me";
import { DEFAULT_HTML_LANG, PreferencesScript } from "./preferences";
import "./globals.css";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // 文章页只给自己的 title，模板补上站点名
  title: { default: `${ME.user}@${ME.host}:~$`, template: `%s — ${ME.name}` },
  description: `${ME.name} 的终端风个人网站 —— 输入命令来认识我。A terminal you can actually use: pipes, cd and man pages all work.`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 虚拟键盘弹出时收缩布局视口，输入行自己就留在可见区域 ——
  // 比在页面底部塞一大块空白靠谱
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning：内联脚本会在 React 之前改掉 lang 和 data-theme，
    // 服务端渲染的值和客户端不一致是预期内的
    <html lang={DEFAULT_HTML_LANG} className={geistMono.variable} suppressHydrationWarning>
      <head>
        <PreferencesScript />
      </head>
      <body>
        {children}
        {/* 只统计页面浏览，不种 cookie、不跨站跟踪，所以不需要同意横幅。
            /var/log/visits.log 里的说法已经跟着改过，别让文案撒谎 */}
        <Analytics />
      </body>
    </html>
  );
}
