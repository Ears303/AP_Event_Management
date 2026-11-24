"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { supabase, supabaseConfigured } from "../../lib/supabase";

// Trailer / public display: the latest published race for each class, top 5 at a time,
// rotating through pages. Refreshes from the database every 10 seconds.
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
type Panel = { cls: string; order: number; race: number; live: boolean; rows: Row[] };

const PAGE_SIZE = 5;
const NAVY = "#003366";

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
  const latest = new Map<string, number>();
  for (const r of rows) {
    const race = one(r.races);
    const cls = one(race?.classes ?? null);
    if (!race || !cls) continue;
    latest.set(cls.class_name, Math.max(latest.get(cls.class_name) ?? 0, race.race_number ?? 0));
  }
  const panels = new Map<string, Panel>();
  for (const r of rows) {
    const race = one(r.races);
    const cls = one(race?.classes ?? null);
    if (!race || !cls || (race.race_number ?? 0) !== latest.get(cls.class_name)) continue;
    const p = panels.get(cls.class_name) ?? {
      cls: cls.class_name, order: cls.display_order ?? 0, race: race.race_number ?? 0, live: false, rows: [],
    };
    p.rows.push(r);
    if (r.provisional) p.live = true;
    panels.set(cls.class_name, p);
  }
  const list = Array.from(panels.values());
  for (const p of list) {
    p.rows.sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999));
  }
  return list.sort((a, b) => a.order - b.order || a.cls.localeCompare(b.cls));
}

export default function Display() {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [panels, setPanels] = useState<Panel[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState<Date | null>(null);

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

      const [res, ann] = await Promise.all([
        supabase
          .from("race_results")
          .select("position,pic,grade,rider_number,rider_name,best_lap,status,provisional,races!inner(race_number,event_id,classes(class_name,display_order))")
          .eq("races.event_id", ev.id)
          .eq("published", true),
        supabase.from("announcements").select("message").eq("event_id", ev.id).eq("active", true)
          .order("created_at", { ascending: false }).limit(3),
      ]);
      if (stop) return;
      if (res.error) { setError(res.error.message); setLoaded(true); return; }
      setError("");
      setPanels(buildPanels((res.data ?? []) as unknown as Row[]));
      setNotes(((ann.data ?? []) as { message: string }[]).map((a) => a.message));
      setLoaded(true);
    }

    void load();
    const refresh = setInterval(() => void load(), 10000);
    return () => { stop = true; clearInterval(refresh); };
  }, []);

  useEffect(() => {
    setNow(new Date());
    const clock = setInterval(() => setNow(new Date()), 1000);
    const pager = setInterval(() => setTick((t) => t + 1), 8000);
    return () => { clearInterval(clock); clearInterval(pager); };
  }, []);

  if (!supabaseConfigured) {
    return <Shell><Notice>Supabase settings are missing. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel, then redeploy.</Notice></Shell>;
  }

  return (
    <Shell>
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

      {error && <Notice>Could not load results: {error}</Notice>}
      {!error && loaded && !event && (
        <Notice>No live public event found. Set an event&apos;s status to &quot;live&quot; (and make sure the database setup has been run).</Notice>
      )}
      {!error && loaded && event && panels.length === 0 && <Notice>No results published yet for this event.</Notice>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 12 }}>
        {panels.map((p) => <ClassPanel key={p.cls} panel={p} tick={tick} />)}
      </div>

      {notes.length > 0 && (
        <div style={{ display: "flex", marginTop: 12, background: "#fff", border: "1px solid #dbe3ee", borderRadius: 6, overflow: "hidden" }}>
          <div style={{ background: NAVY, color: "#fff", padding: "12px 16px", fontWeight: 800 }}>ANNOUNCEMENTS</div>
          <div style={{ padding: "12px 16px", fontSize: 18 }}>{notes[tick % notes.length]}</div>
        </div>
      )}
    </Shell>
  );
}

function ClassPanel({ panel, tick }: { panel: Panel; tick: number }) {
  const pages = Math.max(1, Math.ceil(panel.rows.length / PAGE_SIZE));
  const page = tick % pages;
  const shown = panel.rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const from = page * PAGE_SIZE + 1;
  return (
    <div style={{ background: "#fff", border: "1px solid #dbe3ee", borderRadius: 6, overflow: "hidden" }}>
      <div style={{ background: NAVY, color: "#fff", padding: "10px 14px", fontSize: 20, fontWeight: 800, textTransform: "uppercase", overflowWrap: "anywhere" }}>
        {panel.cls}
      </div>
      <div style={{ padding: "6px 14px", fontWeight: 700, color: NAVY, fontSize: 14, borderBottom: "1px solid #e5ebf3" }}>
        RACE {panel.race} •{" "}
        {panel.live ? <span style={{ background: "#16a34a", color: "#fff", padding: "1px 8px", borderRadius: 4 }}>LIVE</span> : "FINAL"}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ color: "#475569", fontSize: 12, textAlign: "left" }}>
            <th style={cell}>PLACE</th><th style={cell}>NO</th><th style={cell}>RIDER</th><th style={{ ...cell, textAlign: "right" }}>BEST LAP</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => {
            const dnf = r.status === "dnf";
            return (
              <tr key={i} style={{ background: page === 0 && i === 0 && !dnf ? "#fdf3c8" : undefined, fontSize: 16 }}>
                <td style={cell}><span style={dnf ? dnfBadge : badge}>{dnf ? "DNF" : r.position}</span></td>
                <td style={{ ...cell, fontWeight: 700 }}>{r.rider_number}</td>
                <td style={cell}>
                  {shortName(r.rider_name)}
                  {r.grade && <span style={{ color: "#94a3b8", fontSize: 12, marginLeft: 6 }}>{r.grade}</span>}
                </td>
                <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.best_lap}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ padding: "6px 14px", color: "#64748b", fontSize: 12, display: "flex", justifyContent: "space-between" }}>
        <span>Places {from}-{Math.min(from + PAGE_SIZE - 1, panel.rows.length)} of {panel.rows.length}</span>
        <span aria-label={`Page ${page + 1} of ${pages}`}>
          {Array.from({ length: pages }, (_, i) => <span key={i} style={{ color: i === page ? "#0b5fff" : "#cbd5e1" }}>● </span>)}
        </span>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "#eef2f7", minHeight: "100vh", padding: 16, fontFamily: "system-ui, sans-serif", color: "#0f172a" }}>{children}</div>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 6, padding: 12, marginBottom: 12 }}>{children}</div>;
}

const bar: CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 };
const cell: CSSProperties = { padding: "6px 14px", whiteSpace: "nowrap" };
const badge: CSSProperties = { display: "inline-block", minWidth: 26, textAlign: "center", background: "#0b5fff", color: "#fff", borderRadius: 4, fontWeight: 700, padding: "2px 6px" };
const dnfBadge: CSSProperties = { ...badge, background: "#94a3b8" };
