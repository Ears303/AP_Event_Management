import type { CSSProperties } from "react";

export type EventRow = { id: string; event_name: string; start_date: string | null; status: string };
export type Message = { type: "ok" | "error"; text: string };

export const NAVY = "#003366";
export const page: CSSProperties = { background: "#f1f5f9", minHeight: "100vh", padding: 24, fontFamily: "system-ui, sans-serif", color: "#0f172a" };
export const card: CSSProperties = { background: "#fff", border: "1px solid #dbe3ee", borderRadius: 8, padding: 16, marginBottom: 16, maxWidth: 1100 };
export const h2: CSSProperties = { margin: "0 0 12px", fontSize: 18, color: NAVY, overflowWrap: "anywhere" };
export const input: CSSProperties = { padding: "8px 10px", border: "1px solid #b6c2d2", borderRadius: 6, fontSize: 15, maxWidth: "100%" };
export const button: CSSProperties = { padding: "10px 18px", border: 0, borderRadius: 6, background: "#0b5fff", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" };
export const buttonOff: CSSProperties = { ...button, background: "#9db4d6", cursor: "not-allowed" };
export const th: CSSProperties = { textAlign: "left", padding: "6px 8px", background: NAVY, color: "#fff", fontSize: 13, whiteSpace: "nowrap" };
export const td: CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #e5ebf3", fontSize: 14, whiteSpace: "nowrap" };
