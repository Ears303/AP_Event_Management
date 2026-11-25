"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "../../../lib/supabase";
import StaffGate from "../StaffGate";
import { logoBlobFromFile, logoKind } from "../../../lib/image/logoFile";
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
  const [sFile, setSFile] = useState<File | null>(null);
  const [sBusy, setSBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"motocross" | "enduro">("motocross");
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
    const dm = await supabase.from("events").select("display_mode").eq("id", eventId).limit(1); // column added by 008
    setMode(Array.isArray(dm.data) && (dm.data[0] as { display_mode?: string } | undefined)?.display_mode === "enduro" ? "enduro" : "motocross");
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);

  function setType(i: number, type: Area["type"]) {
    setAreas((cur) => cur.map((a, k) => (k === i ? { type, classNames: type === a.type ? a.classNames : [] } : a)));
  }
  // A class lives in one area only: ticking it here removes it from any other area.
  function toggleClass(i: number, name: string, on: boolean) {
    setAreas((cur) => cur.map((a, k) => {
      if (k === i) return { ...a, classNames: on ? [...a.classNames.filter((n) => n !== name), name] : a.classNames.filter((n) => n !== name) };
      return a.classNames.includes(name) && on ? { ...a, classNames: a.classNames.filter((n) => n !== name) } : a;
    }));
  }
  // Sponsor areas keep the ids of the chosen sponsors in the same list (none ticked = all sponsors).
  function toggleSponsor(i: number, id: string, on: boolean) {
    setAreas((cur) => cur.map((a, k) => (k === i ? { ...a, classNames: on ? [...a.classNames.filter((n) => n !== id), id] : a.classNames.filter((n) => n !== id) } : a)));
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

  async function saveMode(next: "motocross" | "enduro") {
    setMode(next);
    const { error } = await supabase.rpc("set_display_mode", { p_event: eventId, p_mode: next });
    setMessage(error ? { type: "error", text: "Could not change the display type: " + error.message + " (has 008_enduro_display.sql been run?)" } : { type: "ok", text: next === "enduro" ? "Display set to Enduro / Pony Express: live results list with time remaining." : "Display set to Motocross: class tiles." });
  }

  const BUCKET = "sponsor-logos";

  function pickLogo(f: File | null) {
    setSFile(f);
    if (f && !sName.trim()) setSName(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim());
  }

  // JPEG / PNG / PDF -> web-sized image -> Supabase Storage -> sponsor row.
  async function addSponsor(e: React.FormEvent) {
    e.preventDefault();
    if (!sFile) return;
    setSBusy(true);
    try {
      if (!logoKind(sFile)) throw new Error("Please choose a JPEG, PNG or PDF file.");
      const logo = await logoBlobFromFile(sFile);
      const slug = sName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "logo";
      const path = `${eventId}/${Date.now()}-${slug}.${logo.ext}`;
      const up = await supabase.storage.from(BUCKET).upload(path, logo.blob, { contentType: logo.contentType, upsert: false });
      if (up.error) throw new Error("Upload failed: " + up.error.message + " (has 006_sponsor_storage.sql been run?)");
      const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      const { error } = await supabase.rpc("add_event_sponsor", { p_event: eventId, p_name: sName, p_image_url: url });
      if (error) { await supabase.storage.from(BUCKET).remove([path]); throw new Error(error.message); }
      setSName(""); setSFile(null);
      setMessage({ type: "ok", text: `Sponsor "${sName}" added.` });
      await load();
    } catch (err) {
      setMessage({ type: "error", text: "Could not add sponsor: " + (err instanceof Error ? err.message : String(err)) });
    } finally {
      setSBusy(false);
    }
  }
  async function removeSponsor(id: string) {
    const image = sponsors.find((x) => x.id === id)?.image ?? "";
    const { error } = await supabase.rpc("remove_event_sponsor", { p_event: eventId, p_sponsor: id });
    if (error) { setMessage({ type: "error", text: "Could not remove sponsor: " + error.message }); return; }
    const m = image.match(/\/sponsor-logos\/(.+)$/); // also tidy the stored file (best effort)
    if (m) await supabase.storage.from(BUCKET).remove([decodeURIComponent(m[1])]);
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

      <div style={card}>
        <h2 style={h2}>Display type</h2>
        <label style={{ display: "block", padding: "2px 0" }}><input type="radio" name="display-type" checked={mode === "motocross"} disabled={!eventId} onChange={() => void saveMode("motocross")} aria-label="Motocross display" /> Motocross - class tiles in the areas below</label>
        <label style={{ display: "block", padding: "2px 0" }}><input type="radio" name="display-type" checked={mode === "enduro"} disabled={!eventId} onChange={() => void saveMode("enduro")} aria-label="Enduro display" /> Enduro / Pony Express - one live results list (Rider, Class, Total Time, Laps, Best Time) with time remaining. The areas below are not used.</label>
      </div>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", maxWidth: 1100, marginBottom: 16 }}>
        {areas.map((a, i) => (
          <div key={i} data-testid={`area-${i + 1}`} style={{ background: "#fff", border: "1px solid #dbe3ee", borderRadius: 8, padding: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <strong style={{ color: NAVY }}>Area {i + 1}</strong>
              {i === AREAS - 1 ? <span style={{ fontSize: 14, color: "#16a34a", fontWeight: 700 }}>Live race (automatic)</span> :
              <select style={{ ...input, padding: "4px 6px", fontSize: 14 }} value={a.type} onChange={(e) => setType(i, e.target.value as Area["type"])} aria-label={`Area ${i + 1} type`}>
                <option value="empty">Empty</option>
                <option value="results">Results</option>
                <option value="sponsors">Sponsors</option>
              </select>}
            </div>
            {i === AREAS - 1 && <div style={{ color: "#64748b", fontSize: 14 }}>Always shows the race being timed right now (automatic).</div>}
            {i !== AREAS - 1 && a.type === "results" && (
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
            {i !== AREAS - 1 && a.type === "sponsors" && (
              <div style={{ maxHeight: 190, overflowY: "auto", fontSize: 14 }}>
                <div style={{ color: "#64748b", marginBottom: 4 }}>Logos scroll through this area. Tick the sponsors to show here - none ticked shows all.</div>
                {sponsors.length === 0 && <div style={{ color: "#64748b" }}>No sponsors yet - add logos below.</div>}
                {sponsors.map((sp) => (
                  <label key={sp.id} style={{ display: "block", padding: "2px 0", overflowWrap: "anywhere" }}>
                    <input type="checkbox" checked={a.classNames.includes(sp.id)} onChange={(e) => toggleSponsor(i, sp.id, e.target.checked)} aria-label={`Area ${i + 1} sponsor: ${sp.name}`} /> {sp.name}
                  </label>
                ))}
              </div>
            )}
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
          <label>Logo file (JPEG, PNG or PDF)<br /><input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" aria-label="Logo file" onChange={(e) => { pickLogo(e.target.files?.[0] ?? null); e.target.value = ""; }} /></label>
          <label>Sponsor name<br /><input style={input} value={sName} onChange={(e) => setSName(e.target.value)} required aria-label="Sponsor name" /></label>
          <button style={!eventId || !sFile || sBusy ? buttonOff : button} disabled={!eventId || !sFile || sBusy}>{sBusy ? "Uploading..." : "Add sponsor"}</button>
          {sFile && <span style={{ color: "#64748b", fontSize: 13 }}>Selected: {sFile.name}</span>}
        </form>
        <div style={{ color: "#64748b", fontSize: 13, marginTop: 6 }}>A PDF uses its first page. Logos are resized for the screen automatically.</div>
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
