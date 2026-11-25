"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import StaffGate from "../StaffGate";
import { page, card, h2, input, button, buttonOff, NAVY } from "../ui";
import type { EventRow, Message } from "../ui";

// Screen layout for the trailer display: 10 areas (5 across x 2 down). Each area shows one or more classes
// stacked one under the other, the event's sponsor logos, or nothing.
type Area = { type: "results" | "sponsors" | "empty"; classNames: string[] };
type SponsorRow = { id: string; name: string; image: string };
const AREAS = 10;
const blank = (): Area[] => Array.from({ length: AREAS }, () => ({ type: "empty" as const, classNames: [] }));
const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

export default function ScreenLayout() {
  return <StaffGate>{() => <Editor />}</StaffGate>;
}

function Editor() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventId, setEventId] = useState("");
  const [areas, setAreas] = useState<Area[]>(blank());
  const [classes, setClasses] = useState<string[]>([]);
  const [sponsors, setSponsors] = useState<SponsorRow[]>([]);
  const [sName, setSName] = useState("");
  const [sUrl, setSUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    supabase.from("events").select("id,event_name,start_date,status").order("start_date", { ascending: false }).limit(50)
      .then(({ data, error }) => {
        if (error) { setMessage({ type: "error", text: "Could not load events: " + error.message }); return; }
        const rows = (Array.isArray(data) ? data : []) as EventRow[];
        setEvents(rows);
        setEventId((cur) => cur || rows[0]?.id || "");
      });
  }, []);

  const load = useCallback(async () => {
    if (!eventId) return;
    const z = await supabase.from("display_zones").select("zone_no,zone_type,class_names").eq("event_id", eventId);
    const next = blank();
    const known = new Set<string>();
    for (const r of (Array.isArray(z.data) ? z.data : []) as { zone_no: number; zone_type: Area["type"]; class_names: string[] }[]) {
      if (r.zone_no >= 1 && r.zone_no <= AREAS) next[r.zone_no - 1] = { type: r.zone_type, classNames: r.class_names ?? [] };
      (r.class_names ?? []).forEach((n) => known.add(n));
    }
    setAreas(next);
    const rc = await supabase.from("races").select("classes(class_name)").eq("event_id", eventId);
    for (const r of (Array.isArray(rc.data) ? rc.data : []) as unknown as { classes: { class_name: string } | { class_name: string }[] | null }[]) {
      const n = one(r.classes)?.class_name; if (n) known.add(n);
    }
    setClasses(Array.from(known).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
    const sp = await supabase.from("event_sponsors").select("sponsor_id,display_order,sponsors(sponsor_name,image_url)").eq("event_id", eventId).order("display_order");
    const list: SponsorRow[] = [];
    for (const x of (Array.isArray(sp.data) ? sp.data : []) as unknown as { sponsor_id: string; sponsors: { sponsor_name: string; image_url: string | null } | { sponsor_name: string; image_url: string | null }[] | null }[]) {
      const o = one(x.sponsors); if (o) list.push({ id: x.sponsor_id, name: o.sponsor_name, image: o.image_url ?? "" });
    }
    setSponsors(list);
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);

  function setType(i: number, type: Area["type"]) {
    setAreas((cur) => cur.map((a, k) => (k === i ? { type, classNames: type === "results" ? a.classNames : [] } : a)));
  }
  // A class lives in one area only: ticking it here removes it from any other area.
  function toggleClass(i: number, name: string, on: boolean) {
    setAreas((cur) => cur.map((a, k) => {
      if (k === i) return { ...a, classNames: on ? [...a.classNames.filter((n) => n !== name), name] : a.classNames.filter((n) => n !== name) };
      return a.classNames.includes(name) && on ? { ...a, classNames: a.classNames.filter((n) => n !== name) } : a;
    }));
  }
  const where = (name: string) => areas.findIndex((a) => a.classNames.includes(name));

  // One area per group of classes with the same first word (65cc, 85cc ...).
  function autoFill() {
    const groups = new Map<string, string[]>();
    for (const c of classes) { const k = c.split(/\s+/)[0].toLowerCase(); groups.set(k, [...(groups.get(k) ?? []), c]); }
    const lists = Array.from(groups.values());
    const next = blank();
    lists.forEach((l, i) => {
      const slot = Math.min(i, AREAS - 1);
      next[slot] = { type: "results", classNames: [...next[slot].classNames, ...l] };
    });
    setAreas(next);
    setMessage({ type: "ok", text: `Auto-filled ${Math.min(lists.length, AREAS)} areas from ${classes.length} classes. Adjust, then Save layout.` });
  }

  async function save() {
    setBusy(true);
    const zones = areas.map((a, i) => ({ zoneNo: i + 1, type: a.type, classNames: a.classNames }))
      .filter((z) => (z.type === "results" && z.classNames.length > 0) || z.type === "sponsors");
    const { error } = await supabase.rpc("save_display_zones", { p_event: eventId, p_zones: zones });
    setBusy(false);
    setMessage(error ? { type: "error", text: "Could not save layout: " + error.message } : { type: "ok", text: zones.length ? `Layout saved (${zones.length} areas).` : "Layout cleared - the display will arrange classes automatically." });
  }

  async function addSponsor(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc("add_event_sponsor", { p_event: eventId, p_name: sName, p_image_url: sUrl });
    if (error) { setMessage({ type: "error", text: "Could not add sponsor: " + error.message }); return; }
    setSName(""); setSUrl("");
    await load();
  }
  async function removeSponsor(id: string) {
    const { error } = await supabase.rpc("remove_event_sponsor", { p_event: eventId, p_sponsor: id });
    if (error) { setMessage({ type: "error", text: "Could not remove sponsor: " + error.message }); return; }
    await load();
  }

  return (
    <div style={page}>
      <div style={{ ...card, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ margin: 0, fontSize: 22, color: NAVY }}>Screen layout</h1>
        <select style={input} value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Event">
          {events.map((e) => <option key={e.id} value={e.id}>{e.event_name}{e.start_date ? ` (${e.start_date})` : ""} - {e.status}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        {eventId && <a href={`/display?event=${eventId}`} target="_blank" rel="noopener" style={{ color: "#0b5fff", fontWeight: 600 }}>Preview display &#8599;</a>}
      </div>

      {message && <div style={{ ...card, background: message.type === "ok" ? "#f0fdf4" : "#fef2f2", borderColor: message.type === "ok" ? "#86efac" : "#fca5a5" }}>{message.text}</div>}

      <div style={card}>
        <div style={{ color: "#475569", fontSize: 14, marginBottom: 10 }}>
          The display has 10 areas, 5 across and 2 down. Choose what each area shows. Several classes in one area are stacked one under the other. Next Race and Announcements stay along the bottom.
          Classes come from the schedule and results for this event, so upload the schedule first.
        </div>
        <button style={eventId && classes.length ? button : buttonOff} disabled={!eventId || !classes.length} onClick={autoFill}>Auto-fill by class group</button>{" "}
        <button style={{ ...button, background: "#475569" }} onClick={() => setAreas(blank())}>Clear all</button>
      </div>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", maxWidth: 1100, marginBottom: 16 }}>
        {areas.map((a, i) => (
          <div key={i} data-testid={`area-${i + 1}`} style={{ background: "#fff", border: "1px solid #dbe3ee", borderRadius: 8, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <strong style={{ color: NAVY }}>Area {i + 1}</strong>
              <select style={{ ...input, padding: "4px 6px", fontSize: 14 }} value={a.type} onChange={(e) => setType(i, e.target.value as Area["type"])} aria-label={`Area ${i + 1} type`}>
                <option value="empty">Empty</option>
                <option value="results">Results</option>
                <option value="sponsors">Sponsors</option>
              </select>
            </div>
            {a.type === "results" && (
              <div style={{ maxHeight: 190, overflowY: "auto", fontSize: 14 }}>
                {classes.length === 0 && <div style={{ color: "#64748b" }}>No classes yet - upload the schedule first.</div>}
                {classes.map((c) => {
                  const at = where(c);
                  return (
                    <label key={c} style={{ display: "block", padding: "2px 0", overflowWrap: "anywhere" }}>
                      <input type="checkbox" checked={at === i} onChange={(e) => toggleClass(i, c, e.target.checked)} aria-label={`Area ${i + 1}: ${c}`} /> {c}
                      {at >= 0 && at !== i && <span style={{ color: "#94a3b8" }}> (area {at + 1})</span>}
                    </label>
                  );
                })}
              </div>
            )}
            {a.type === "sponsors" && <div style={{ color: "#64748b", fontSize: 14 }}>Shows this event&apos;s sponsor logos ({sponsors.length}).</div>}
          </div>
        ))}
      </div>

      <div style={card}>
        <button style={busy || !eventId ? buttonOff : button} disabled={busy || !eventId} onClick={() => void save()}>{busy ? "Saving..." : "Save layout"}</button>
        <span style={{ color: "#64748b", fontSize: 13, marginLeft: 12 }}>With nothing saved (or all areas empty) the display arranges classes automatically.</span>
      </div>

      <div style={card}>
        <h2 style={h2}>Sponsor logos</h2>
        <form onSubmit={(e) => void addSponsor(e)} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label>Sponsor name<br /><input style={input} value={sName} onChange={(e) => setSName(e.target.value)} required aria-label="Sponsor name" /></label>
          <label>Link to logo image (https://...)<br /><input style={{ ...input, width: 320 }} value={sUrl} onChange={(e) => setSUrl(e.target.value)} required aria-label="Logo link" /></label>
          <button style={eventId ? button : buttonOff} disabled={!eventId}>Add sponsor</button>
        </form>
        {sponsors.length > 0 && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
            {sponsors.map((s) => (
              <div key={s.id} style={{ border: "1px solid #dbe3ee", borderRadius: 6, padding: 8, textAlign: "center", width: 150 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.image} alt={s.name} style={{ maxWidth: "100%", maxHeight: 60, objectFit: "contain" }} />
                <div style={{ fontSize: 13, margin: "4px 0" }}>{s.name}</div>
                <button style={{ ...button, background: "#b91c1c", padding: "4px 10px", fontSize: 13 }} onClick={() => void removeSponsor(s.id)}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
