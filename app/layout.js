export const metadata = {
  title: "mcstructure viewer",
  description: "A browser-based viewer for Minecraft Bedrock .mcstructure files",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
