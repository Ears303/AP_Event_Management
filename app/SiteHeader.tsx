"use client";

import { usePathname } from "next/navigation";
import Nav from "./Nav";

// Staff pages get the full header with buttons. The public pages (results, home) show only the logo.
export default function SiteHeader() {
  const path = usePathname() ?? "";
  const isPublic = path === "/" || path.startsWith("/results");
  return (
    <div
      style={{
        background: "#ffffff",
        borderBottom: "1px solid #d1d5db",
        padding: isPublic ? "8px 16px" : "12px 24px",
        display: "flex",
        alignItems: "center",
        gap: "20px",
        flexWrap: "wrap",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.JPG" alt="AP Timing" style={{ height: isPublic ? "48px" : "70px", width: "auto" }} />
      {!isPublic && (
        <>
          <div style={{ color: "#666666", fontSize: "18px" }}>Event Management &amp; Live Results</div>
          <Nav />
        </>
      )}
    </div>
  );
}
