"use client";

import { useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "../lib/supabase";

const btn = {
  padding: "10px 18px", borderRadius: "6px", background: "#0b5fff", color: "#ffffff", fontSize: "15px",
  fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap",
} as const;

// Timing-team buttons only; the public never sees them (and the header hides them on public pages).
export default function Nav() {
  const [staff, setStaff] = useState(false);
  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setStaff(Boolean(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setStaff(Boolean(s)));
    return () => data.subscription.unsubscribe();
  }, []);
  const links: [string, string][] = [];
  if (staff) links.push(["/results", "Results"], ["/manager/event", "Set up event"], ["/manager", "Import results"], ["/manager/screen", "Screen layout"], ["/display", "Display"], ["/display?mode=enduro", "Enduro display"]);
  if (!links.length) return null;
  return (
    <nav style={{ marginLeft: "auto", display: "flex", gap: "10px", flexWrap: "wrap" }}>
      {links.map(([href, label]) => (
        <a key={href} href={href} style={btn} {...(href.startsWith("/display") ? { target: "_blank", rel: "noopener" } : {})}>{label}</a>
      ))}
    </nav>
  );
}
