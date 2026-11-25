"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { supabase, supabaseConfigured } from "../../lib/supabase";

// Public results page, built for phones: pick any race and see its full results.
// ?event=<id> shows a specific event; otherwise the newest live public one. ?race=<id> opens a race.
type ClassInfo = { class_name: string };
type RaceOpt = { id: string; race_number: number; cls: string; count: number };
type Result = {
  position: number | null; grade: string | null; rider_number: number | null; rider_name: string | null;
  laps: number | null; best_lap: string | null; total_time: string | null; gap_text: string | null;
  status: string | null; provisional: boolean | null;
};
type EventInfo = { id: string; event_name: string; venue: string | null };

const NAVY = "#003366";
const BLUE = "#0b5fff"; // same scheme as the trailer display
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

const MEDAL: Record<number, CSSProperties> = {
  1: { background: "linear-gradient(135deg, #ffe27a, #e0a800)", color: "#4a3600" },
  2: { background: "linear-gradient(135deg, #f1f4f8, #aab3be)", color: "#2b3440" },
  3: { background: "linear-gradient(135deg, #e8a76b, #b8681f)", color: "#2b1500" },
};
const badge = (pos: number | null, dnf: boolean): CSSProperties => ({
  display: "inline-block", minWidth: 32, boxSizing: "border-box", textAlign: "center", borderRadius: 5, padding: "2px 6px",
  fontWeight: 800, fontSize: 15, background: "#fff", color: "#000", border: "1.5px solid #000",
  ...(!dnf && pos != null && MEDAL[pos] ? MEDAL[pos] : {}),
});

export default function Results() {
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [races, setRaces] = useState<RaceOpt[]>([]);
  const [raceId, setRaceId] = useState("");
  const [rows, setRows] = useState<Result[]>([]);
  const [holeshot, setHoleshot] = useState<{ no: number; name: string | null } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<Date | null>(null);

  // Event + the list of races that have published results.
  const loadRaces = useCallback(async () => {
    const q = new URLSearchParams(window.location.search);
    const wanted = q.get("event");
    let eq = supabase.from("events").select("id,event_name,venue").limit(1);
    eq = wanted ? eq.eq("id", wanted) : eq.eq("status", "live").order("start_date", { ascending: false });
    const { data: evs, error: e1 } = await eq;
    if (e1) { setError(e1.message); setLoaded(true); return; }
    const ev = (evs?.[0] ?? null) as EventInfo | null;
    setEvent(ev);
    if (!ev) { setLoaded(true); return; }
    const { data, error: e2 } = await supabase.from("races").select("id,race_number,classes(class_name),race_results(count)").eq("event_id", ev.id).order("race_number");
    if (e2) { setError(e2.message); setLoaded(true); return; }
    const list: RaceOpt[] = [];
    for (const r of (Array.isArray(data) ? data : []) as unknown as { id: string; race_number: number | null; classes: ClassInfo | ClassInfo[] | null; race_results: { count: number }[] | null }[]) {
      const count = r.race_results?.[0]?.count ?? 0;
      if (count > 0 && r.race_number != null) list.push({ id: r.id, race_number: r.race_number, cls: one(r.classes)?.class_name ?? "", count });
    }
    setRaces(list);
    setError("");
    setRaceId((cur) => {
      if (cur && list.some((x) => x.id === cur)) return cur;
      const fromUrl = q.get("race");
      if (fromUrl && list.some((x) => x.id === fromUrl)) return fromUrl;
      return list.length ? list[list.length - 1].id : ""; // newest race by default
    });
    setLoaded(true);
  }, []);

  // Results of the chosen race (+ its holeshot).
  const loadRace = useCallback(async (id: string) => {
    if (!id) { setRows([]); setHoleshot(null); return; }
    const r = await supabase.from("race_results")
      .select("position,grade,rider_number,rider_name,laps,best_lap,total_time,gap_text,status,provisional")
      .eq("race_id", id).eq("published", true).order("position", { ascending: true, nullsFirst: false });
    if (r.error) { setError(r.error.message); return; }
    setRows((Array.isArray(r.data) ? r.data : []) as Result[]);
    const h = await supabase.from("holeshots").select("rider_number,rider_name").eq("race_id", id).limit(1);
    const hr = Array.isArray(h.data) ? (h.data[0] as { rider_number: number; rider_name: string | null } | undefined) : undefined;
    setHoleshot(hr ? { no: hr.rider_number, name: hr.rider_name } : null);
    setUpdated(new Date());
  }, []);

  useEffect(() => {
    if (!supabaseConfigured) return;
    void loadRaces();
    const t = setInterval(() => void loadRaces(), 30000);
    return () => clearInterval(t);
  }, [loadRaces]);
  useEffect(() => {
    if (!supabaseConfigured) return;
    void loadRace(raceId);
    const t = setInterval(() => void loadRace(raceId), 15000);
    return () => clearInterval(t);
  }, [raceId, loadRace]);

  function choose(id: string) {
    if (id !== raceId) { setRows([]); setHoleshot(null); } // don't show the previous race's results under the new heading
    setRaceId(id);
    try { const u = new URL(window.location.href); u.searchParams.set("race", id); window.history.replaceState(null, "", u.toString()); } catch { /* ignore */ }
  }

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "#eef2f7";
    return () => { document.body.style.background = prev; };
  }, []);

  const idx = races.findIndex((r) => r.id === raceId);
  const cur = races[idx];
  const live = rows.some((r) => r.provisional);
  const step = (d: number) => { const n = races[idx + d]; if (n) choose(n.id); };

  if (!supabaseConfigured) return <div style={wrap}><div style={note}>Supabase settings are missing.</div></div>;

  return (
    <div style={wrap}>
      <h1 style={{ margin: "4px 0 0", fontSize: 22, color: NAVY }}>{event ? event.event_name : "Results"}</h1>
      {event?.venue && <div style={{ color: "#475569", fontSize: 14 }}>{event.venue}</div>}

      {error && <div style={{ ...note, borderColor: "#fca5a5", background: "#fef2f2" }}>Could not load results: {error}</div>}
      {loaded && !error && !event && <div style={note}>No live event right now.</div>}
      {loaded && !error && event && races.length === 0 && <div style={note}>No results published yet. Check back soon.</div>}

      {races.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8, margin: "14px 0 10px" }}>
            <button aria-label="Previous race" style={{ ...navBtn, opacity: idx <= 0 ? 0.35 : 1 }} disabled={idx <= 0} onClick={() => step(-1)}>&lsaquo;</button>
            <select aria-label="Choose race" value={raceId} onChange={(e) => choose(e.target.value)} style={{ flex: 1, minWidth: 0, fontSize: 16, padding: "10px 8px", borderRadius: 8, border: "1px solid #0b5fff", background: "#fff", color: "#003366", fontWeight: 600 }}>
              {races.map((r) => <option key={r.id} value={r.id}>Race {r.race_number} - {r.cls}</option>)}
            </select>
            <button aria-label="Next race" style={{ ...navBtn, opacity: idx >= races.length - 1 ? 0.35 : 1 }} disabled={idx >= races.length - 1} onClick={() => step(1)}>&rsaquo;</button>
          </div>

          <div data-testid="results-list" style={{ background: "#fff", border: "1px solid #dbe3ee", borderRadius: 8, overflow: "hidden" }}>
            {cur && (
              <>
                <div data-testid="tile-title" style={{ background: BLUE, color: "#fff", padding: "12px 14px", fontWeight: 800, fontSize: 18, textTransform: "uppercase", overflowWrap: "anywhere" }}>{cur.cls}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", fontWeight: 700, color: NAVY, fontSize: 14, borderBottom: "1px solid #e5ebf3" }}>
                  <span>RACE {cur.race_number}</span>
                  {live ? <span style={{ background: "#16a34a", color: "#fff", borderRadius: 4, padding: "1px 8px" }}>LIVE</span> : <span>FINAL</span>}
                </div>
              </>
            )}
            {rows.map((r, i) => {
              const dnf = r.status === "dnf";
              const bits = [r.laps != null ? `${r.laps} laps` : null, r.gap_text ? `gap +${r.gap_text.replace(/^\+/, "")}` : null].filter(Boolean).join(" \u2022 ");
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: i ? "1px solid #eef2f7" : undefined, background: r.position === 1 && !dnf ? "#fdf3c8" : undefined }}>
                  <span data-medal={!dnf && r.position != null && r.position <= 3 ? r.position : undefined} style={badge(r.position, dnf)}>{dnf ? "DNF" : r.position}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 16, overflowWrap: "anywhere" }}>
                      <span style={{ color: NAVY }}>{r.rider_number}</span> {titleCase(r.rider_name)}
                      {r.grade && <span style={{ color: "#94a3b8", fontSize: 12, marginLeft: 6 }}>{r.grade}</span>}
                    </div>
                    {bits && <div style={{ color: "#64748b", fontSize: 12.5, marginTop: 1 }}>{bits}</div>}
                  </div>
                  <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    <div data-testid="total-time" style={{ fontWeight: 800, fontSize: 16 }}>{r.total_time ?? ""}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>best {r.best_lap}</div>
                  </div>
                </div>
              );
            })}
            {holeshot && (
              <div data-testid="holeshot" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "#fffbea", borderTop: "1px solid #f0e2a0" }}>
                <span style={{ background: "linear-gradient(135deg, #ffe27a, #e0a800)", color: "#4a3600", fontWeight: 800, borderRadius: 4, padding: "1px 8px", fontSize: 12 }}>HOLESHOT</span>
                <b>{holeshot.no}</b> <span>{titleCase(holeshot.name)}</span>
              </div>
            )}
          </div>
          {live && <div data-testid="provisional" style={{ background: "#b91c1c", color: "#fff", borderRadius: 8, textAlign: "center", padding: "10px 12px", marginTop: 10, fontWeight: 800, letterSpacing: 1 }}>RESULTS ARE PROVISIONAL</div>}
          {updated && <div style={{ color: "#94a3b8", fontSize: 12, textAlign: "center", margin: "10px 0" }}>Updated {updated.toLocaleTimeString()} - refreshes automatically</div>}
        </>
      )}
    </div>
  );
}

function titleCase(n: string | null): string {
  if (!n) return "";
  return n.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase());
}

const wrap: CSSProperties = { maxWidth: 640, margin: "0 auto", padding: "12px 12px 40px", fontFamily: "system-ui, sans-serif", color: "#0f172a", boxSizing: "border-box" };
const note: CSSProperties = { background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: 12, margin: "14px 0" };
const navBtn: CSSProperties = { width: 46, fontSize: 24, lineHeight: 1, border: 0, borderRadius: 8, background: BLUE, color: "#fff", cursor: "pointer" };
