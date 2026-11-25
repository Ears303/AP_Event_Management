"use client";

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "../../lib/supabase";
import { detectCsvKind, importRace } from "../../lib/import/importRace";
import type { RaceImportResult } from "../../lib/import/importRace";
import readXlsxFile from "read-excel-file";
import { parseSchedule } from "../../lib/import/importSchedule";
import type { ScheduleResult } from "../../lib/import/importSchedule";
import { importPoints } from "../../lib/import/importPoints";
import type { ImportResult } from "../../lib/import/importPoints";
import {
  publishImport,
  raceNumberFromLabel,
  stagePointsImport,
  stageRaceImport,
} from "../../lib/import/stage";

type EventRow = { id: string; event_name: string; start_date: string | null; status: string };
type ImportRow = {
  id: string;
  kind: string;
  filename: string | null;
  row_count: number | null;
  created_at: string;
  published_at: string | null;
};
type Parsed =
  | { kind: "race"; filename: string; result: RaceImportResult }
  | { kind: "points"; filename: string; result: ImportResult };
type Message = { type: "ok" | "error"; text: string };

const NAVY = "#003366";
const page: CSSProperties = { background: "#f1f5f9", minHeight: "100vh", padding: 24, fontFamily: "system-ui, sans-serif", color: "#0f172a" };
const card: CSSProperties = { background: "#fff", border: "1px solid #dbe3ee", borderRadius: 8, padding: 16, marginBottom: 16, maxWidth: 1100 };
const h2: CSSProperties = { margin: "0 0 12px", fontSize: 18, color: NAVY, overflowWrap: "anywhere" };
const input: CSSProperties = { padding: "8px 10px", border: "1px solid #b6c2d2", borderRadius: 6, fontSize: 15, maxWidth: "100%" };
const button: CSSProperties = { padding: "10px 18px", border: 0, borderRadius: 6, background: "#0b5fff", color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer" };
const buttonOff: CSSProperties = { ...button, background: "#9db4d6", cursor: "not-allowed" };
const th: CSSProperties = { textAlign: "left", padding: "6px 8px", background: NAVY, color: "#fff", fontSize: 13, whiteSpace: "nowrap" };
const td: CSSProperties = { padding: "6px 8px", borderBottom: "1px solid #e5ebf3", fontSize: 14, whiteSpace: "nowrap" };

export default function Manager() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventId, setEventId] = useState("");
  const [history, setHistory] = useState<ImportRow[]>([]);

  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [raceNumber, setRaceNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  // ---- sign in state ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // ---- load events once signed in ----
  useEffect(() => {
    if (!session) return;
    supabase
      .from("events")
      .select("id,event_name,start_date,status")
      .order("start_date", { ascending: false })
      .then(({ data, error }) => {
        if (error) { setMessage({ type: "error", text: "Could not load events: " + error.message }); return; }
        const rows = (data ?? []) as EventRow[];
        setEvents(rows);
        setEventId((cur) => cur || (rows[0]?.id ?? ""));
      });
  }, [session]);

  const loadHistory = useCallback(async (id: string) => {
    if (!id) { setHistory([]); return; }
    const { data } = await supabase
      .from("imports")
      .select("id,kind,filename,row_count,created_at,published_at")
      .eq("event_id", id)
      .order("created_at", { ascending: false })
      .limit(10);
    setHistory((data ?? []) as ImportRow[]);
  }, []);

  useEffect(() => { if (session) void loadHistory(eventId); }, [session, eventId, loadHistory]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
  }

  async function onFile(file: File | undefined) {
    setMessage(null);
    setParsed(null);
    if (!file) return;
    const text = await file.text();
    const kind = detectCsvKind(text);
    if (kind === "race") {
      const result = importRace(text, file.name);
      setRaceNumber(String(raceNumberFromLabel(result.raceLabel) ?? ""));
      setParsed({ kind, filename: file.name, result });
    } else if (kind === "points") {
      setParsed({ kind, filename: file.name, result: importPoints(text) });
    } else {
      setMessage({ type: "error", text: "This does not look like a MyLaps race or points results file." });
    }
  }

  async function publish() {
    if (!parsed || !eventId) return;
    setBusy(true);
    setMessage(null);
    try {
      const importId =
        parsed.kind === "race"
          ? await stageRaceImport(supabase, eventId, parsed.filename, parsed.result, Number(raceNumber))
          : await stagePointsImport(supabase, eventId, parsed.filename, parsed.result);
      await publishImport(supabase, importId);
      setMessage({ type: "ok", text: `Published ${parsed.filename}.` });
      setParsed(null);
      await loadHistory(eventId);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  // ---------------- screens ----------------
  if (!supabaseConfigured) {
    return (
      <div style={page}>
        <div style={{ ...card, borderColor: "#fca5a5", background: "#fef2f2" }}>
          <h2 style={h2}>Supabase settings are missing</h2>
          Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in Vercel
          (Project Settings, then Environment Variables), then redeploy.
        </div>
      </div>
    );
  }

  if (!authReady) return <div style={page}>Loading…</div>;

  if (!session) {
    return (
      <div style={page}>
        <form onSubmit={signIn} style={{ ...card, maxWidth: 380 }}>
          <h2 style={h2}>Timing team sign in</h2>
          <div style={{ display: "grid", gap: 10 }}>
            <input style={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input style={input} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button style={button} type="submit">Sign in</button>
            {authError && <div style={{ color: "#b91c1c" }}>{authError}</div>}
          </div>
        </form>
      </div>
    );
  }

  const errors = parsed?.result.errors ?? [];
  const warnings = parsed?.result.warnings ?? [];
  const raceNumberOk = parsed?.kind !== "race" || /^\d+$/.test(raceNumber);
  const canPublish = !!parsed && !!eventId && errors.length === 0 && raceNumberOk && !busy;

  return (
    <div style={page}>
      <div style={{ ...card, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ ...h2, margin: 0 }}>Import results</h2>
        <select style={input} value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Event">
          {events.length === 0 && <option value="">No events found</option>}
          {events.map((ev) => (
            <option key={ev.id} value={ev.id}>
              {ev.event_name}{ev.start_date ? ` (${ev.start_date})` : ""} - {ev.status}
            </option>
          ))}
        </select>
        <span style={{ flex: 1 }} />
        <span style={{ color: "#64748b", fontSize: 14 }}>{session.user.email}</span>
        <button style={{ ...button, background: "#475569" }} onClick={() => void supabase.auth.signOut()}>Sign out</button>
      </div>

      {message && (
        <div style={{ ...card, borderColor: message.type === "ok" ? "#86efac" : "#fca5a5", background: message.type === "ok" ? "#f0fdf4" : "#fef2f2" }}>
          {message.text}
        </div>
      )}

      <NewEventCard onCreated={(ev) => { setEvents((cur) => [ev, ...cur]); setEventId(ev.id); }} setMessage={setMessage} />

      <ScheduleCard eventId={eventId} eventDate={events.find((e) => e.id === eventId)?.start_date ?? null} setMessage={setMessage} />

      <div style={card}>
        <h2 style={h2}>1. Choose a MyLaps CSV</h2>
        <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} aria-label="Results file" />
        <p style={{ color: "#64748b", fontSize: 14, marginBottom: 0 }}>
          Works with the per-race "Results" export and the "Graded Results" points export. Nothing is saved until you press Publish.
        </p>
      </div>

      {parsed && (
        <div style={card}>
          <h2 style={h2}>
            2. Check the preview - {parsed.kind === "race" ? "race results" : "points results"}: {parsed.filename}
          </h2>

          {errors.length > 0 && (
            <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 6, padding: 10, marginBottom: 12 }}>
              <strong>Fix these before importing:</strong>
              <ul style={{ margin: "6px 0 0" }}>{errors.map((m, i) => <li key={i}>{m}</li>)}</ul>
            </div>
          )}
          {warnings.length > 0 && (
            <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 6, padding: 10, marginBottom: 12 }}>
              <strong>{warnings.length} thing{warnings.length === 1 ? "" : "s"} to check:</strong>
              <ul style={{ margin: "6px 0 0" }}>{warnings.map((m, i) => <li key={i}>{m}</li>)}</ul>
            </div>
          )}

          {parsed.kind === "race" && (
            <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}>
              <label htmlFor="raceNo">Race number</label>
              <input id="raceNo" style={{ ...input, width: 80 }} value={raceNumber} onChange={(e) => setRaceNumber(e.target.value)} inputMode="numeric" />
              {!raceNumberOk && <span style={{ color: "#b91c1c" }}>Enter the race number</span>}
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            {parsed.kind === "race" ? <RaceTable result={parsed.result} /> : <PointsTable result={parsed.result} />}
          </div>

          <div style={{ marginTop: 16 }}>
            <button style={canPublish ? button : buttonOff} disabled={!canPublish} onClick={() => void publish()}>
              {busy ? "Publishing…" : "Publish results"}
            </button>
            <span style={{ marginLeft: 12, color: "#64748b", fontSize: 14 }}>
              Replaces any results already published for the same race{parsed.kind === "points" ? " or class" : ""}.
            </span>
          </div>
        </div>
      )}

      <HoleshotsCard eventId={eventId} setMessage={setMessage} />

      <div style={card}>
        <h2 style={h2}>Recent imports for this event</h2>
        {history.length === 0 ? (
          <div style={{ color: "#64748b" }}>Nothing imported yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead><tr>{["File", "Type", "Rows", "Uploaded", "Status"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td style={td}>{h.filename}</td>
                    <td style={td}>{h.kind}</td>
                    <td style={td}>{h.row_count}</td>
                    <td style={td}>{new Date(h.created_at).toLocaleString()}</td>
                    <td style={td}>{h.published_at ? "Published" : "Preview only"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function RaceTable({ result }: { result: RaceImportResult }) {
  const cls = result.rows[0]?.baseClass;
  return (
    <>
      {cls && <div style={{ marginBottom: 6, fontWeight: 600 }}>{cls} - {result.rows.length} riders</div>}
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>{["Pos", "PIC", "Grade", "No", "Rider", "Laps", "Total", "Best lap", "Pts"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => (
            <tr key={i} style={r.status === "dnf" ? { background: "#fef2f2" } : undefined}>
              <td style={td}>{r.status === "dnf" ? "DNF" : r.pos}</td>
              <td style={td}>{r.status === "dnf" ? "" : r.pic}</td>
              <td style={td}>{r.grade ?? "-"}</td>
              <td style={td}>{r.raceNo}</td>
              <td style={td}>{r.name}</td>
              <td style={td}>{r.laps}</td>
              <td style={td}>{r.totalTimeText}</td>
              <td style={td}>{r.bestLapText}</td>
              <td style={td}>{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function PointsTable({ result }: { result: ImportResult }) {
  const classes = Array.from(new Set(result.rows.map((r) => r.baseClass)));
  return (
    <>
      {classes.map((cls) => (
        <div key={cls} style={{ marginBottom: 14 }}>
          <div style={{ marginBottom: 6, fontWeight: 600 }}>{cls}</div>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                {["Pos", "Grade", "No", "Rider", ...result.raceColumns, "Total", ""].map((h, i) => <th key={i} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {result.rows.filter((r) => r.baseClass === cls).map((r, i) => (
                <tr key={i} style={r.tieNote ? { background: "#fffbeb" } : undefined}>
                  <td style={td}>{r.pos}</td>
                  <td style={td}>{r.grade ?? "-"}</td>
                  <td style={td}>{r.raceNo}</td>
                  <td style={td}>{r.name}</td>
                  {r.racePoints.map((p, j) => <td key={j} style={td}>{p}</td>)}
                  <td style={td}><strong>{r.totalPoints}</strong></td>
                  <td style={{ ...td, color: "#b45309" }}>{r.tieNote ? "Tie - decide manually" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

// Upload the event's race schedule (Excel). Needs columns Race and Class; Moto, Time, Date and Holeshot are optional.
function ScheduleCard({ eventId, eventDate, setMessage }: { eventId: string; eventDate: string | null; setMessage: (m: Message) => void }) {
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
function NewEventCard({ onCreated, setMessage }: { onCreated: (ev: EventRow) => void; setMessage: (m: Message) => void }) {
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

type HsRace = { id: string; race_number: number | null; moto: number | null; classes: { class_name: string } | { class_name: string }[] | null };
type HsRow = { id: string; rider_number: number; rider_name: string; prize_amount: number | null; races: { race_number: number | null } | { race_number: number | null }[] | null; classes: { class_name: string } | { class_name: string }[] | null };
const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

// Holeshot entry: only races marked "Holeshot" in the schedule are offered. One holeshot per race.
function HoleshotsCard({ eventId, setMessage }: { eventId: string; setMessage: (m: Message) => void }) {
  const [races, setRaces] = useState<HsRace[]>([]);
  const [saved, setSaved] = useState<HsRow[]>([]);
  const [raceId, setRaceId] = useState("");
  const [num, setNum] = useState("");
  const [rname, setRname] = useState("");
  const [prize, setPrize] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!eventId) { setRaces([]); setSaved([]); return; }
    const r = await supabase.from("races").select("id,race_number,moto,classes(class_name)").eq("event_id", eventId).eq("holeshot", true).order("race_number");
    const h = await supabase.from("holeshots").select("id,rider_number,rider_name,prize_amount,races(race_number),classes(class_name)").eq("event_id", eventId).order("entered_at", { ascending: false });
    const rows = (Array.isArray(r.data) ? r.data : []) as unknown as HsRace[];
    setRaces(rows);
    setSaved((Array.isArray(h.data) ? h.data : []) as unknown as HsRow[]);
    setRaceId((cur) => (rows.some((x) => x.id === cur) ? cur : rows[0]?.id ?? ""));
  }, [eventId]);
  useEffect(() => { void load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("save_holeshot", {
      p_race: raceId, p_rider_number: Number(num), p_rider_name: rname || null, p_prize: prize ? Number(prize) : null,
    });
    setBusy(false);
    if (error) { setMessage({ type: "error", text: "Could not save holeshot: " + error.message }); return; }
    setMessage({ type: "ok", text: "Holeshot saved." });
    setNum(""); setRname(""); setPrize("");
    await load();
  }

  const label = (r: HsRace) => `Race ${r.race_number} - ${first(r.classes)?.class_name ?? ""}${r.moto ? ` (Moto ${r.moto})` : ""}`;
  const done = new Set(saved.map((h) => first(h.races)?.race_number));
  return (
    <div style={card}>
      <h2 style={h2}>Holeshots</h2>
      {races.length === 0 ? (
        <div style={{ color: "#64748b" }}>No races are marked for a holeshot. Put Y in the Holeshot column of the schedule and upload it again.</div>
      ) : (
        <form onSubmit={(e) => void save(e)} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
          <label>Race<br /><select style={input} value={raceId} onChange={(e) => setRaceId(e.target.value)} aria-label="Holeshot race">
            {races.map((r) => <option key={r.id} value={r.id}>{label(r)}{done.has(r.race_number) ? " - done" : ""}</option>)}
          </select></label>
          <label>Rider no<br /><input style={{ ...input, width: 90 }} inputMode="numeric" value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ""))} aria-label="Holeshot rider number" required /></label>
          <label>Name (if not found)<br /><input style={input} value={rname} onChange={(e) => setRname(e.target.value)} /></label>
          <label>Prize $ (optional)<br /><input style={{ ...input, width: 100 }} inputMode="decimal" value={prize} onChange={(e) => setPrize(e.target.value.replace(/[^\d.]/g, ""))} /></label>
          <button style={busy || !num ? buttonOff : button} disabled={busy || !num}>{busy ? "Saving..." : "Save holeshot"}</button>
        </form>
      )}
      {saved.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead><tr>{["Race", "Class", "No", "Rider", "Prize"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{saved.map((h) => (
              <tr key={h.id}><td style={td}>{first(h.races)?.race_number}</td><td style={td}>{first(h.classes)?.class_name}</td><td style={td}>{h.rider_number}</td><td style={td}>{h.rider_name}</td><td style={td}>{h.prize_amount != null ? "$" + h.prize_amount : "-"}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
