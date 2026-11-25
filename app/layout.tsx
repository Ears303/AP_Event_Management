import Nav from "./Nav";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div
          style={{
            background: "#ffffff",
            borderBottom: "1px solid #d1d5db",
            padding: "12px 24px",
            display: "flex",
            alignItems: "center",
            gap: "20px",
            flexWrap: "wrap",
          }}
        >
          <img
            src="/logo.JPG"
            alt="AP Timing"
            style={{
              height: "70px",
              width: "auto",
            }}
          />

          <div
            style={{
              color: "#666666",
              fontSize: "18px",
            }}
          >
            Event Management & Live Results
          </div>

          <Nav />
        </div>

        {children}
      </body>
    </html>
  );
}
