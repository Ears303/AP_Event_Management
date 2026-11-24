"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { supabase, supabaseConfigured } from "../../lib/supabase";

// Trailer / public display. One panel per class; every rider is shown at once and the whole
// screen is scaled so everything fits. Each panel rotates through that class's published races
// (a race that is LIVE stays on screen). Refreshes from the database every 10 seconds.
// Add ?event=<event id> to the address to show a specific event; otherwise the newest live one.

type ClassInfo = { class_name: string; display_order: number | null };
type RaceInfo = { race_number: number | null; classes: ClassInfo | ClassInfo[] | null };
type Row = {
  position: number | null;
  pic: number | null;
  grade: string | null;
  rider_number: number | null;
  rider_name: string | null;
  best_lap: string | null;
  status: string | null;
  provisional: boolean | null;
  races: RaceInfo | RaceInfo[] | null;
};
type EventInfo = { id: string; event_name: string; venue: string | null };
type RaceResults = { race: number; live: boolean; rows: Row[] };
type Panel = { cls: string; order: number; races: RaceResults[]; maxRows: number };

const NAVY = "#003366";
const ROTATE_MS = 8000;
const REFRESH_MS = 10000;
const PAGE = 1000; // Supabase returns at most 1000 rows per request

// Layout constants in "base" pixels. The whole grid is drawn at this size and then scaled to fit.
const BASE_W = 340, GAP = 10;
const BORDER = 2, TITLE_H = 50, SUB_H = 26, THEAD_H = 20, ROW_H = 26, PAD_B = 4;
const panelHeight = (rows: number) => BORDER + TITLE_H + SUB_H + THEAD_H + rows * ROW_H + PAD_B;

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

// "NATE LEES" -> "N. Lees"
function shortName(full: string | null): string {
  if (!full) return "";
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return `${parts[0].charAt(0).toUpperCase()}. ${parts.slice(1).map(cap).join(" ")}`;
}

function buildPanels(rows: Row[]): Panel[] {
  const byClass = new Map<string, { order: number; races: Map<number, RaceResults> }>();
  for (const r of rows) {
    const race = one(r.races);
    const cls = one(race?.classes ?? null);
    if (!race || !cls) continue;
    const c = byClass.get(cls.class_name) ?? { order: cls.display_order ?? 0, races: new Map() };
    const n = race.race_number ?? 0;
    const rr = c.races.get(n) ?? { race: n, live: false, rows: [] };
    rr.rows.push(r);
    if (r.provisional) rr.live = true;
    c.races.set(n, rr);
    byClass.set(cls.class_name, c);
  }
  const panels: Panel[] = [];
  for (const [cls, c] of byClass) {
    const races = Array.from(c.races.values()).sort((a, b) => a.race - b.race);
    for (const r of races) r.rows.sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999));
    panels.push({ cls, order: c.order, races, maxRows: Math.max(...races.map((r) => r.rows.length)) });
  }
  return panels.sort((a, b) => a.order - b.order || a.cls.localeCompare(b.cls));
}

// Pick the number of columns that lets the whole grid be drawn as large as possible.
function bestLayout(panels: Panel[], w: number, h: number) {
  let best = { cols: 1, scale: 0.05, width: BASE_W, height: 1 };
  if (!panels.length || w <= 0 || h <= 0) return best;
  for (let c = 1; c <= Math.min(panels.length, 16); c++) {
    const width = c * BASE_W + (c - 1) * GAP;
    let height = 0;
    for (let i = 0; i < panels.length; i += c) {
      height += Math.max(...panels.slice(i, i + c).map((p) => panelHeight(p.maxRows))) + (i ? GAP : 0);
    }
    const scale = Math.min(w / width, h / height, 2);
    if (scale > best.scale + 1e-9) best = { cols: c, scale, width, height };
  }
  return best;
}

export default function Display() {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState<Date | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const area = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!supabaseConfigured) return;
    let stop = false;

    async function load() {
      const wanted = new URLSearchParams(window.location.search).get("event");
      let q = supabase.from("events").select("id,event_name,venue").limit(1);
      q = wanted ? q.eq("id", wanted) : q.eq("status", "live").order("start_date", { ascending: false });
      const { data: evs, error: evErr } = await q;
      if (stop) return;
      if (evErr) { setError(evErr.message); setLoaded(true); return; }
      const ev = (evs?.[0] ?? null) as EventInfo | null;
      setEvent(ev);
      if (!ev) { setPanels([]); setNotes([]); setError(""); setLoaded(true); return; }

      const all: Row[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error: e } = await supabase
          .from("race_results")
          .select("position,pic,grade,rider_number,rider_name,best_lap,status,provisional,races!inner(race_number,event_id,classes(class_name,display_order))")
          .eq("races.event_id", ev.id)
          .eq("published", true)
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (stop) return;
        if (e) { setError(e.message); setLoaded(true); return; }
        all.push(...((data ?? []) as unknown as Row[]));
        if ((data?.length ?? 0) < PAGE) break;
      }
      const ann = await supabase.from("announcements").select("message").eq("event_id", ev.id).eq("active", true)
        .order("created_at", { ascending: false }).limit(3);
      if (stop) return;
      setError("");
      setPanels(buildPanels(all));
      setNotes(((ann.data ?? []) as { message: string }[]).map((a) => a.message));
      setLoaded(true);
    }

    void load();
    const refresh = setInterval(() => void load(), REFRESH_MS);
    return () => { stop = true; clearInterval(refresh); };
  }, []);

  useEffect(() => {
    setNow(new Date());
    const clock = setInterval(() => setNow(new Date()), 1000);
    const pager = setInterval(() => setTick((t) => t + 1), ROTATE_MS);
    return () => { clearInterval(clock); clearInterval(pager); };
  }, []);

  // Measure the space available for the grid.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [supabaseConfigured]);

  if (!supabaseConfigured) {
    return <Frame><Notice>Supabase settings are missing. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel, then redeploy.</Notice></Frame>;
  }

  const layout = bestLayout(panels, size.w - 16, size.h - 8);
  const left = Math.max(0, (size.w - layout.width * layout.scale) / 2);
  const top = Math.max(0, (size.h - layout.height * layout.scale) / 2);

  return (
    <Frame>
      <div style={bar}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: NAVY }}>AP Timing Live</div>
          <div style={{ color: "#475569", fontSize: 14 }}>
            {event ? `${event.event_name}${event.venue ? " • " + event.venue : ""}` : "Waiting for a live event"}
          </div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: NAVY }}>
          {now ? now.toLocaleTimeString() : ""} <span style={{ color: error ? "#dc2626" : "#16a34a" }}>●</span>
        </div>
      </div>

      {error && <div style={{ padding: "0 16px" }}><Notice>Could not load results: {error}</Notice></div>}
      {!error && loaded && !event && (
        <div style={{ padding: "0 16px" }}><Notice>No live public event found. Set an event&apos;s status to &quot;live&quot; (and make sure the database setup has been run).</Notice></div>
      )}
      {!error && loaded && event && panels.length === 0 && <div style={{ padding: "0 16px" }}><Notice>No results published yet for this event.</Notice></div>}

      <div ref={area} style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}>
        <div
          data-testid="grid"
          data-scale={layout.scale.toFixed(3)}
          data-cols={layout.cols}
          data-est-height={layout.height}
          style={{
            position: "absolute", left, top, width: layout.width,
            transform: `scale(${layout.scale})`, transformOrigin: "0 0",
            display: "grid", gridTemplateColumns: `repeat(${layout.cols}, ${BASE_W}px)`, gap: GAP,
            visibility: size.w ? "visible" : "hidden",
          }}
        >
          {panels.map((p) => <ClassPanel key={p.cls} panel={p} tick={tick} />)}
        </div>
      </div>

      {notes.length > 0 && (
        <div style={{ display: "flex", margin: "0 16px 12px", background: "#fff", border: "1px solid #dbe3ee", borderRadius: 6, overflow: "hidden", flex: "none" }}>
          <div style={{ background: NAVY, color: "#fff", padding: "10px 16px", fontWeight: 800 }}>ANNOUNCEMENTS</div>
          <div style={{ padding: "10px 16px", fontSize: 18 }}>{notes[tick % notes.length]}</div>
        </div>
      )}
    </Frame>
  );
}

function ClassPanel({ panel, tick }: { panel: Panel; tick: number }) {
  // A live race stays on screen; otherwise rotate through the class's races.
  const liveIdx = panel.races.findIndex((r) => r.live);
  const idx = liveIdx >= 0 ? liveIdx : tick % panel.races.length;
  const current = panel.races[idx];
  return (
    <div style={{ background: "#fff", border: "1px solid #dbe3ee", borderRadius: 6, overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ background: NAVY, color: "#fff", padding: "0 12px", height: TITLE_H, display: "flex", alignItems: "center", fontSize: 17, lineHeight: "20px", fontWeight: 800, textTransform: "uppercase", overflow: "hidden" }}>
        {panel.cls}
      </div>
      <div style={{ height: SUB_H, padding: "0 12px", display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, color: NAVY, fontSize: 14, borderBottom: "1px solid #e5ebf3" }}>
        <span>
          RACE {current.race} •{" "}
          {current.live ? <span style={{ background: "#16a34a", color: "#fff", padding: "1px 8px", borderRadius: 4 }}>LIVE</span> : "FINAL"}
        </span>
        {panel.races.length > 1 && (
          <span aria-label={`Race ${idx + 1} of ${panel.races.length}`} style={{ fontSize: 10, letterSpacing: 2 }}>
            {panel.races.map((r, i) => <span key={r.race} style={{ color: i === idx ? "#0b5fff" : "#cbd5e1" }}>●</span>)}
          </span>
        )}
      </div>
      <div style={{ height: THEAD_H + panel.maxRows * ROW_H + PAD_B }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup><col style={{ width: 62 }} /><col style={{ width: 52 }} /><col /><col style={{ width: 86 }} /></colgroup>
          <thead>
            <tr style={{ height: THEAD_H, color: "#475569", fontSize: 11, textAlign: "left" }}>
              <th style={cell}>PLACE</th><th style={cell}>NO</th><th style={cell}>RIDER</th><th style={{ ...cell, textAlign: "right" }}>BEST LAP</th>
            </tr>
          </thead>
          <tbody>
            {current.rows.map((r, i) => {
              const dnf = r.status === "dnf";
              return (
                <tr key={i} style={{ height: ROW_H, background: i === 0 && !dnf ? "#fdf3c8" : undefined, fontSize: 15 }}>
                  <td style={cell}><span style={dnf ? dnfBadge : badge}>{dnf ? "DNF" : r.position}</span></td>
                  <td style={{ ...cell, fontWeight: 700 }}>{r.rider_number}</td>
                  <td style={{ ...cell, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {shortName(r.rider_name)}
                    {r.grade && <span style={{ color: "#94a3b8", fontSize: 11, marginLeft: 5 }}>{r.grade}</span>}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.best_lap}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Full-screen so a TV or trailer screen uses all of its space (covers the site header).
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "#eef2f7", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif", color: "#0f172a" }}>
      {children}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 6, padding: 12, margin: 16 }}>{children}</div>;
}

const bar: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", flex: "none", gap: 8 };
const cell: CSSProperties = { padding: "0 6px", whiteSpace: "nowrap", verticalAlign: "middle" };
const badge: CSSProperties = { display: "inline-block", minWidth: 26, lineHeight: "20px", textAlign: "center", background: "#0b5fff", color: "#fff", borderRadius: 4, fontWeight: 700, padding: "0 6px", fontSize: 14 };
const dnfBadge: CSSProperties = { ...badge, background: "#94a3b8" };
