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

          <nav style={{ marginLeft: "auto", display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {[
              ["/manager/event", "Set up event"],
              ["/manager", "Import results"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                style={{
                  padding: "10px 18px",
                  borderRadius: "6px",
                  background: "#0b5fff",
                  color: "#ffffff",
                  fontSize: "15px",
                  fontWeight: 600,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>

        {children}
      </body>
    </html>
  );
}
