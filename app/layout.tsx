import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ポコメーター番長",
  description: "Pocochaの目標メーター、残りポイント、アイテムの目安を計算できます。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}<div className="tool-creator-footer" style={{"display":"block","clear":"both","width":"100%","maxWidth":"1200px","boxSizing":"border-box","margin":"24px auto 0","padding":"12px 16px 20px","textAlign":"left","flexBasis":"100%"}}><span className="tool-creator-logo" aria-label="制作者 Yoshi1012" style={{"display":"inline-block","maxWidth":"100%","boxSizing":"border-box","padding":"8px 18px 9px","border":"1px solid #1676bc","borderLeft":"3px solid #36c5ff","borderRadius":"3px","background":"linear-gradient(115deg,#02050b 0%,#0b1d31 55%,#03070e 100%)","color":"#66d5ff","fontFamily":"Arial,Helvetica,sans-serif","fontSize":"18px","fontWeight":900,"fontStyle":"italic","letterSpacing":".08em","lineHeight":"1.3","textShadow":"0 0 8px #008cce","boxShadow":"inset 0 1px 0 #24618a,0 3px 12px #001c3c55"}}>Yoshi1012</span></div></body>
    </html>
  );
}
