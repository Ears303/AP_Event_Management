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

          <div>
            <div
              style={{
                fontSize: "32px",
                fontWeight: "bold",
                color: "#003366",
              }}
            >
              AP Timing
            </div>

            <div
              style={{
                color: "#666666",
              }}
            >
              Event Management & Live Results
            </div>
          </div>
        </div>

        {children}
      </body>
    </html>
  );
}
