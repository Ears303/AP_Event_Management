"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { supabase } from "../../lib/supabase";

// Enduro / Pony Express display: only the live results, one list for everyone, with the race clock at the bottom.
// Columns: Rider, Class, Total Time, Laps, Best Time. Long lists roll through in pages.

const NAVY = "#003366";
const BLUE = "#0b5fff";
const ROTATE_MS = 8000;
const RESULTS_MS = 5000;
const STATUS_MS = 3000;
const PAGE = 1000;

type Ev = { id: string; event_name: string; venue: string | null };
type Row = {
  position: number | null; rider_number: number | null; rider_name: string | null; laps: number | null;
  total_time: string | null; total_time_ms: number | null; best_lap: string | null; provisional: boolean | null;
  races: { race_number: number | null; classes: { class_name: string } | { class_name: string }[] | null } | { race_number: number | null; classes: { class_name: string } | { class_name: string }[] | null }[] | null;
};
type Status = { race_number: number | null; flag: string | null; time_to_go: string | null; race_time: string | null; laps_to_go: number | null };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const secs = (t: string | null | undefined): number | null => {
  const m = /^(\d+):(\d+):(\d+)/.exec((t ?? "").trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
};
const hms = (n: number) => { const s = Math.max(0, Math.floor(n)); return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
function shortName(full: string | null): string {
  if (!full) return "";
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return `${parts[0].charAt(0).toUpperCase()}. ${parts.slice(1).map(cap).join(" ")}`;
}
const MEDAL: Record<number, CSSProperties> = {
  1: { background: "linear-gradient(135deg, #ffe27a, #e0a800)", color: "#4a3600" },
  2: { background: "linear-gradient(135deg, #f1f4f8, #aab3be)", color: "#2b3440" },
  3: { background: "linear-gradient(135deg, #e8a76b, #b8681f)", color: "#2b1500" },
};

export default function EnduroView({ event }: { event: Ev }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [size, setSize] = useState({ w: 0, h: 0 });
  const area = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let stop = false;
    async function loadStatus() {
      const r = await supabase.from("live_status").select("race_number,flag,time_to_go,race_time,laps_to_go").eq("event_id", event.id).limit(1);
      if (stop) return;
      setStatus(Array.isArray(r.data) && r.data[0] ? (r.data[0] as Status) : null);
      setFetchedAt(Date.now());
    }
    async function loadResults() {
      const all: Row[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error: e } = await supabase.from("race_results")
          .select("position,rider_number,rider_name,laps,total_time,total_time_ms,best_lap,provisional,races!inner(race_number,classes(class_name))")
          .eq("races.event_id", event.id).eq("published", true).eq("provisional", true).order("id", { ascending: true }).range(from, from + PAGE - 1);
        if (stop) return;
        if (e) { setError(e.message); setLoaded(true); return; }
        all.push(...((data ?? []) as unknown as Row[]));
        if ((data?.length ?? 0) < PAGE) break;
      }
      const ann = await supabase.from("announcements").select("message").eq("event_id", event.id).eq("active", true).order("created_at", { ascending: false }).limit(3);
      if (stop) return;
      setNotes(((ann.data ?? []) as { message: string }[]).map((a) => a.message));
      setRows(all); setError(""); setLoaded(true);
    }
    void loadStatus(); void loadResults();
    const a = setInterval(() => void loadStatus(), STATUS_MS);
    const b = setInterval(() => void loadResults(), RESULTS_MS);
    const c = setInterval(() => setNow(Date.now()), 1000);
    const d = setInterval(() => setTick((t) => t + 1), ROTATE_MS);
    return () => { stop = true; clearInterval(a); clearInterval(b); clearInterval(c); clearInterval(d); };
  }, [event.id]);

  useEffect(() => {
    const el = area.current; if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure(); const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect();
  }, []);

  // The live race = the one the feed's clock belongs to (else the newest race with live results).
  const newest = rows.reduce((m, r) => Math.max(m, one(r.races)?.race_number ?? 0), 0);
  const raceNo = status?.race_number ?? (newest || null);
  const live = rows.filter((r) => one(r.races)?.race_number === raceNo);
  live.sort((a, b) => (b.laps ?? 0) - (a.laps ?? 0) || (a.total_time_ms ?? 1e12) - (b.total_time_ms ?? 1e12) || (a.position ?? 999) - (b.position ?? 999));

  const headH = 46;
  const rowH = size.h ? Math.max(34, Math.min(64, Math.floor((size.h - headH) / 14))) : 48;
  const perPage = Math.max(1, size.h ? Math.floor((size.h - headH) / rowH) : 14);
  const pages = Math.max(1, Math.ceil(live.length / perPage));
  const page = tick % pages;
  const shown = live.slice(page * perPage, (page + 1) * perPage);
  const font = Math.round(rowH * 0.5);

  // Race clock: counts down (time to go) or up (race time), ticking locally between updates while the flag is green.
  const running = /green/i.test(status?.flag ?? "");
  const since = running && fetchedAt ? (now - fetchedAt) / 1000 : 0;
  const toGo = secs(status?.time_to_go);
  const elapsed = secs(status?.race_time);
  const clock = toGo && toGo > 0 ? { label: "TIME REMAINING", value: hms(toGo - since) }
    : elapsed != null && status ? { label: "RACE TIME", value: hms(elapsed + since) }
    : { label: "TIME REMAINING", value: "--:--:--" };
  const flag = (status?.flag ?? "").trim();
  const flagColor = /green/i.test(flag) ? "#16a34a" : /red/i.test(flag) ? "#dc2626" : /yellow/i.test(flag) ? "#eab308" : "#475569";

  const th: CSSProperties = { textAlign: "left", padding: "0 10px", fontSize: 16, color: "#fff", fontWeight: 700, letterSpacing: 1 };
  const td: CSSProperties = { padding: "0 10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: font };

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", flex: "none", gap: 8 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: NAVY }}>AP Timing Live</div>
          <div style={{ color: "#475569", fontSize: 14 }}>{event.event_name}{event.venue ? ` • ${event.venue}` : ""}</div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: NAVY }}>{new Date(now).toLocaleTimeString()} <span style={{ color: error ? "#dc2626" : "#16a34a" }}>●</span></div>
      </div>

      <div ref={area} style={{ flex: 1, minHeight: 0, margin: "0 16px 8px", position: "relative", overflow: "hidden", background: "#fff", border: "1px solid #dbe3ee", borderRadius: 6 }}>
        {error && <div style={{ padding: 16 }}>Could not load results: {error}</div>}
        {!error && loaded && live.length === 0 && (
          <div data-testid="awaiting" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 56, fontWeight: 800, letterSpacing: 2, color: "#64748b" }}>AWAITING RESULTS</div>
        )}
        {live.length > 0 && (
          <table data-testid="enduro-table" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
            <colgroup><col style={{ width: "7%" }} /><col style={{ width: "27%" }} /><col style={{ width: "25%" }} /><col style={{ width: "15%" }} /><col style={{ width: "10%" }} /><col style={{ width: "16%" }} /></colgroup>
            <thead>
              <tr style={{ background: BLUE, height: headH }}>
                <th style={th}>POS</th><th style={th}>RIDER</th><th style={th}>CLASS</th><th style={th}>TOTAL TIME</th><th style={th}>LAPS</th><th style={th}>BEST TIME</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const pos = page * perPage + i + 1;
                const medal = MEDAL[pos];
                return (
                  <tr key={`${r.rider_number}-${pos}`} data-testid="enduro-row" style={{ height: rowH, borderBottom: "1px solid #e5ebf3", background: pos === 1 ? "#fdf3c8" : undefined }}>
                    <td style={td}>
                      <span data-medal={medal ? pos : undefined} style={{ display: "inline-block", minWidth: font * 1.5, textAlign: "center", border: "2px solid #000", borderRadius: 6, fontWeight: 800, padding: "0 6px", ...(medal ?? { background: "#fff", color: "#000" }) }}>{pos}</span>
                    </td>
                    <td style={{ ...td, fontWeight: 700 }}><span style={{ color: "#475569", marginRight: 12 }}>{r.rider_number}</span>{shortName(r.rider_name)}</td>
                    <td style={td}>{one(one(r.races)?.classes)?.class_name ?? ""}</td>
                    <td style={td}>{r.total_time ?? ""}</td>
                    <td style={td}>{r.laps ?? ""}</td>
                    <td style={td}>{r.best_lap ?? ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {pages > 1 && <div style={{ position: "absolute", right: 12, top: 10, color: "#fff", fontSize: 14, fontWeight: 700 }}>PAGE {page + 1} / {pages}</div>}
      </div>

      {notes.length > 0 && (
        <div style={{ display: "flex", margin: "0 16px 8px", background: "#fff", border: "1px solid #dbe3ee", borderRadius: 6, overflow: "hidden", flex: "none" }}>
          <div style={{ background: BLUE, color: "#fff", padding: "10px 16px", fontWeight: 800 }}>ANNOUNCEMENTS</div>
          <div style={{ padding: "10px 16px", fontSize: 18 }}>{notes[tick % notes.length]}</div>
        </div>
      )}

      <div data-testid="clock" style={{ margin: "0 16px 8px", background: NAVY, color: "#fff", borderRadius: 6, padding: "10px 24px", flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: 2 }}>{clock.label}</span>
        <span data-testid="clock-value" style={{ fontSize: 56, fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{clock.value}</span>
        <span style={{ fontSize: 22, fontWeight: 800, color: "#fff", background: flagColor, borderRadius: 6, padding: "4px 14px", minWidth: 110, textAlign: "center", visibility: flag ? "visible" : "hidden" }}>{flag.toUpperCase() || "-"}</span>
      </div>

      {live.length > 0 && (
        <div data-testid="provisional" style={{ margin: "0 16px 10px", background: BLUE, color: "#fff", borderRadius: 6, textAlign: "center", padding: "4px 16px", fontWeight: 700, fontSize: 14, letterSpacing: 2, flex: "none" }}>
          RESULTS ARE PROVISIONAL
        </div>
      )}
    </>
  );
}
