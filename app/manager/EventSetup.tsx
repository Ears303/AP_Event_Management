"use client";

import { useEffect, useState } from "react";
import readXlsxFile from "read-excel-file";
import { supabase } from "../../lib/supabase";
import { parseSchedule } from "../../lib/import/importSchedule";
import type { ScheduleResult } from "../../lib/import/importSchedule";
import { card, h2, input, button, buttonOff, th, td } from "./ui";
import type { EventRow, Message } from "./ui";

// Upload the event's race schedule (Excel). Needs columns Race and Class; Moto, Time, Date and Holeshot are optional.
export function ScheduleCard({ eventId, eventDate, setMessage }: { eventId: string; eventDate: string | null; setMessage: (m: Message) => void }) {
  const [res, setRes] = useState<ScheduleResult | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setSaved(null); setName(f.name);
    try {
      const rows = (await readXlsxFile(f)) as unknown[][];
      setRes(parseSchedule(rows, eventDate));
    } catch (err) {
      setRes({ rows: [], warnings: [], errors: ["Could not read that file as an Excel sheet (.xlsx): " + (err instanceof Error ? err.message : String(err))] });
    }
  }

  async function save() {
    if (!res || !eventId) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("stage_schedule", { p_event: eventId, p_rows: res.rows });
    setBusy(false);
    if (error) { setMessage({ type: "error", text: "Could not save schedule: " + error.message }); return; }
    setSaved(Number(data)); setRes(null);
    setMessage({ type: "ok", text: `Schedule saved: ${data} races.` });
  }

  const hs = res?.rows.filter((r) => r.holeshot).length ?? 0;
  return (
    <div style={card}>
      <h2 style={h2}>Race schedule (Excel)</h2>
      <input type="file" accept=".xlsx" aria-label="Schedule file" onChange={(e) => void onFile(e)} />
      <div style={{ color: "#64748b", fontSize: 13, marginTop: 6 }}>
        Columns: Race, Class (required); Time, Date, Moto, Holeshot (optional). Put Y in Holeshot for races that have a holeshot prize. Uploading again updates the schedule; results are kept.
      </div>
      {saved !== null && <div style={{ marginTop: 8 }}>Saved {saved} races.</div>}
      {res && (
        <div style={{ marginTop: 10 }}>
          {res.errors.length > 0 && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: 8, marginBottom: 8 }}><strong>Fix these before saving:</strong><ul>{res.errors.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
          {res.warnings.length > 0 && <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 6, padding: 8, marginBottom: 8 }}><strong>to check:</strong><ul>{res.warnings.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
          {res.rows.length > 0 && (
            <>
              <div style={{ marginBottom: 6, fontWeight: 600 }}>{name} - {res.rows.length} races, {hs} with holeshots</div>
              <div style={{ overflowX: "auto", maxHeight: 320, overflowY: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead><tr>{["Race", "Class", "Moto", "Time", "Holeshot"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {res.rows.map((r, i) => (
                      <tr key={i}><td style={td}>{r.raceNo}</td><td style={td}>{r.className}</td><td style={td}>{r.moto ?? "-"}</td><td style={td}>{r.timeText ?? "-"}</td><td style={td}>{r.holeshot ? "Yes" : "-"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <button style={{ ...button, marginTop: 10, opacity: res.errors.length || busy || !eventId ? 0.5 : 1 }} disabled={res.errors.length > 0 || busy || !eventId || !res.rows.length} onClick={() => void save()}>
            {busy ? "Saving..." : "Save schedule"}
          </button>
        </div>
      )}
    </div>
  );
}


// Create a new event (in your own organisation). The schedule can then be uploaded straight after.
export function NewEventCard({ onCreated, setMessage }: { onCreated: (ev: EventRow) => void; setMessage: (m: Message) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc("create_event", {
      p_name: name, p_venue: venue || null, p_start: start || null, p_end: end || null, p_public: isPublic,
    });
    setBusy(false);
    if (error) { setMessage({ type: "error", text: "Could not create event: " + error.message }); return; }
    onCreated({ id: String(data), event_name: name.trim(), start_date: start || null, status: "live" });
    setMessage({ type: "ok", text: `Event "${name.trim()}" created. Now upload its race schedule below.` });
    setName(""); setVenue(""); setStart(""); setEnd(""); setOpen(false);
  }

  if (!open) return <div style={card}><button style={button} onClick={() => setOpen(true)}>+ New event</button></div>;
  return (
    <form style={card} onSubmit={(e) => void create(e)}>
      <h2 style={h2}>New event</h2>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        <label>Event name<input style={{ ...input, width: "100%", boxSizing: "border-box" }} value={name} onChange={(e) => setName(e.target.value)} required placeholder="WA MX Championship - Round 4" /></label>
        <label>Venue<input style={{ ...input, width: "100%", boxSizing: "border-box" }} value={venue} onChange={(e) => setVenue(e.target.value)} /></label>
        <label>Start date<input type="date" style={{ ...input, width: "100%", boxSizing: "border-box" }} value={start} onChange={(e) => setStart(e.target.value)} required /></label>
        <label>End date (if more than one day)<input type="date" style={{ ...input, width: "100%", boxSizing: "border-box" }} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      <label style={{ display: "block", margin: "10px 0" }}><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> Show results publicly</label>
      <button style={busy || !name.trim() || !start ? buttonOff : button} disabled={busy || !name.trim() || !start}>{busy ? "Creating..." : "Create event"}</button>{" "}
      <button type="button" style={{ ...button, background: "#475569" }} onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

