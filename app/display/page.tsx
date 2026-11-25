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
  laps: number | null;
  total_time: string | null;
  status: string | null;
  provisional: boolean | null;
  races: RaceInfo | RaceInfo[] | null;
};
type EventInfo = { id: string; event_name: string; venue: string | null };
type RaceResults = { race: number; live: boolean; rows: Row[] };
type Upcoming = { race: number; cls: string; moto: number | null; time: string | null; holeshot: boolean };
type Zone = { zone_no: number; zone_type: string; class_names: string[] };
type Sponsor = { name: string; image: string };
type Holeshot = { no: number; name: string | null };
type Panel = { cls: string; order: number; races: RaceResults[]; maxRows: number; holes: Record<number, Holeshot> };

const NAVY = "#003366";
const ROTATE_MS = 8000;
const REFRESH_MS = 10000;
const PAGE = 1000; // Supabase returns at most 1000 rows per request
const PAGE_ROWS = 20; // most riders shown at once in a tile; longer races roll through in equal pages

// Split a race into equal pages of at most PAGE_ROWS riders (40 -> 20 + 20, 25 -> 13 + 12).
const pagesNeeded = (n: number) => Math.max(1, Math.ceil(n / PAGE_ROWS));
const pageSize = (n: number) => Math.ceil(n / pagesNeeded(n));
function splitRows(rows: Row[]): Row[][] {
  const pages = pagesNeeded(rows.length), size = pageSize(rows.length);
  return Array.from({ length: pages }, (_, i) => rows.slice(i * size, (i + 1) * size));
}

// Layout constants in "base" pixels. The whole grid is drawn at this size and then scaled to fit.
const BASE_W = 460, GAP = 10;
const BORDER = 3 /* 2 outer + 1 divider under the race bar */, TITLE_H = 50, SUB_H = 26, THEAD_H = 20, ROW_H = 26, PAD_B = 4;
const HS_H = 26; // holeshot line at the foot of a tile (only for classes that have a holeshot entered)
const panelHeight = (rows: number, hs = false) => BORDER + TITLE_H + SUB_H + THEAD_H + rows * ROW_H + PAD_B + (hs ? HS_H : 0);
const panelH = (p: Panel) => panelHeight(p.maxRows, Object.keys(p.holes).length > 0);

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

// "NATE LEES" -> "N. Lees"
function shortName(full: string | null): string {
  if (!full) return "";
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  return `${parts[0].charAt(0).toUpperCase()}. ${parts.slice(1).map(cap).join(" ")}`;
}

function buildPanels(rows: Row[], holes: Map<string, Holeshot>): Panel[] {
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
    panels.push({ cls, order: c.order, races, maxRows: Math.max(...races.map((r) => pageSize(r.rows.length))),
      holes: Object.fromEntries(races.filter((r) => holes.has(`${cls}|${r.race}`)).map((r) => [r.race, holes.get(`${cls}|${r.race}`)!])) });
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
      height += Math.max(...panels.slice(i, i + c).map((p) => panelH(p))) + (i ? GAP : 0);
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
  const [next, setNext] = useState<Upcoming[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
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
          .select("position,pic,grade,rider_number,rider_name,best_lap,laps,total_time,status,provisional,races!inner(race_number,event_id,classes(class_name,display_order))")
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
      // Schedule (optional: empty until a schedule is uploaded / 003_schedule.sql is run).
      const sched = await supabase.from("races").select("race_number,moto,holeshot,scheduled_time,classes(class_name)")
        .eq("event_id", ev.id).order("race_number", { ascending: true });
      if (stop) return;
      const done = new Set<string>();
      for (const r of all) { const rc = one(r.races); const c = one(rc?.classes ?? null); if (rc && c) done.add(`${rc.race_number}|${c.class_name}`); }
      const upcoming: Upcoming[] = [];
      for (const s of (sched.data ?? []) as unknown as { race_number: number | null; moto: number | null; holeshot: boolean | null; scheduled_time: string | null; classes: ClassInfo | ClassInfo[] | null }[]) {
        const c = one(s.classes);
        if (!c || s.race_number == null || done.has(`${s.race_number}|${c.class_name}`)) continue;
        upcoming.push({ race: s.race_number, cls: c.class_name, moto: s.moto, holeshot: !!s.holeshot,
          time: s.scheduled_time ? new Date(s.scheduled_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null });
      }
      setNext(upcoming.slice(0, 3));
      // Screen layout (optional): up to 10 areas, each a stack of classes, the sponsors, or empty.
      const zr = await supabase.from("display_zones").select("zone_no,zone_type,class_names").eq("event_id", ev.id).order("zone_no");
      const sr = await supabase.from("event_sponsors").select("display_order,sponsors(sponsor_name,image_url)").eq("event_id", ev.id).order("display_order");
      if (stop) return;
      setZones(Array.isArray(zr.data) ? (zr.data as Zone[]) : []);
      const sp: Sponsor[] = [];
      if (Array.isArray(sr.data)) for (const x of sr.data as unknown as { sponsors: { sponsor_name: string; image_url: string | null } | { sponsor_name: string; image_url: string | null }[] | null }[]) {
        const o = one(x.sponsors); if (o?.image_url) sp.push({ name: o.sponsor_name, image: o.image_url });
      }
      setSponsors(sp);
      setError("");
      const hr = await supabase.from("holeshots").select("rider_number,rider_name,races(race_number),classes(class_name)").eq("event_id", ev.id);
      if (stop) return;
      const holes = new Map<string, Holeshot>();
      if (Array.isArray(hr.data)) for (const h of hr.data as unknown as { rider_number: number; rider_name: string | null; races: { race_number: number | null } | { race_number: number | null }[] | null; classes: ClassInfo | ClassInfo[] | null }[]) {
        const rn = one(h.races)?.race_number, cn = one(h.classes)?.class_name;
        if (rn != null && cn) holes.set(`${cn}|${rn}`, { no: h.rider_number, name: h.rider_name });
      }
      setPanels(buildPanels(all, holes));
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

  const layout = bestLayout(zones.length ? [] : panels, size.w - 16, size.h - 8);
  const zoneMode = zones.length > 0;
  const zoneView = zoneMode ? buildZoneView(zones, panels, size.w - 16, size.h - 8) : null;
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
      {!error && loaded && event && panels.length === 0 && !zoneMode && <div style={{ padding: "0 16px" }}><Notice>No results published yet for this event.</Notice></div>}

      <div ref={area} style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}>
        {zoneView && (
          <div
            data-testid="zones"
            data-scale={zoneView.scale.toFixed(3)}
            data-rows={zoneView.rows}
            style={{
              position: "absolute", left: 8, top: 4, display: "grid", gap: GAP,
              gridTemplateColumns: `repeat(${ZONE_COLS}, ${zoneView.cellW}px)`, gridTemplateRows: `repeat(${zoneView.rows}, ${zoneView.cellH}px)`,
              visibility: size.w ? "visible" : "hidden",
            }}
          >
            {zones.map((z) => {
              const place = { gridColumn: ((z.zone_no - 1) % ZONE_COLS) + 1, gridRow: Math.floor((z.zone_no - 1) / ZONE_COLS) + 1 };
              const cell: CSSProperties = { ...place, position: "relative", overflow: "hidden", minWidth: 0, minHeight: 0 };
              if (z.zone_type === "sponsors") {
                return (
                  <div key={z.zone_no} data-testid={`zone-${z.zone_no}`} style={{ ...cell, background: "#fff", border: "1px solid #dbe3ee", borderRadius: 6, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-evenly", padding: 8, boxSizing: "border-box" }}>
                    {sponsors.map((sp, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={sp.image} alt={sp.name} style={{ maxWidth: "100%", maxHeight: `${Math.floor(100 / Math.max(sponsors.length, 1)) - 2}%`, objectFit: "contain" }} />
                    ))}
                  </div>
                );
              }
              if (z.zone_type !== "results") return <div key={z.zone_no} style={cell} />;
              const blocks = zoneView.blocksFor(z);
              const lay = zoneView.layoutFor(z);
              return (
                <div key={z.zone_no} data-testid={`zone-${z.zone_no}`} data-scale={lay.scale.toFixed(3)} style={cell}>
                  <div style={{ position: "absolute", left: 0, top: 0, width: lay.innerW, transform: `scale(${lay.scale})`, transformOrigin: "0 0", display: "flex", flexDirection: "column", gap: GAP }}>
                    {blocks.map((b) => <ClassPanel key={b.cls} panel={b} tick={tick} />)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div
          data-testid="grid"
          data-scale={layout.scale.toFixed(3)}
          data-cols={layout.cols}
          data-est-height={layout.height}
          style={{
            position: "absolute", left, top, width: layout.width,
            transform: `scale(${layout.scale})`, transformOrigin: "0 0",
            display: "grid", gridTemplateColumns: `repeat(${layout.cols}, ${BASE_W}px)`, gap: GAP,
            visibility: size.w && !zoneMode ? "visible" : "hidden",
          }}
        >
          {(zoneMode ? [] : panels).map((p) => <ClassPanel key={p.cls} panel={p} tick={tick} />)}
        </div>
      </div>

      {next.length > 0 && (
        <div data-testid="next" style={{ display: "flex", margin: "0 16px 8px", background: "#fff", border: "1px solid #dbe3ee", borderRadius: 6, overflow: "hidden", flex: "none" }}>
          <div style={{ background: "#0b5fff", color: "#fff", padding: "8px 16px", fontWeight: 800, display: "flex", alignItems: "center" }}>NEXT RACE</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 28px", padding: "8px 16px", fontSize: 16, alignItems: "center" }}>
            {next.map((n, i) => (
              <span key={n.race + n.cls} style={{ opacity: i === 0 ? 1 : 0.7, fontWeight: i === 0 ? 700 : 400 }}>
                Race {n.race} • {n.cls}{n.moto ? ` • Moto ${n.moto}` : ""}{n.time ? ` • ${n.time}` : ""}
                {n.holeshot && <span style={{ marginLeft: 8, background: "#fdf3c8", border: "1px solid #e6c84f", borderRadius: 4, padding: "0 6px", fontSize: 12, fontWeight: 700 }}>HOLESHOT</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {notes.length > 0 && (
        <div style={{ display: "flex", margin: "0 16px 12px", background: "#fff", border: "1px solid #dbe3ee", borderRadius: 6, overflow: "hidden", flex: "none" }}>
          <div style={{ background: NAVY, color: "#fff", padding: "10px 16px", fontWeight: 800 }}>ANNOUNCEMENTS</div>
          <div style={{ padding: "10px 16px", fontSize: 18 }}>{notes[tick % notes.length]}</div>
        </div>
      )}
    </Frame>
  );
}

const ZONE_COLS = 5; // 5 across, 2 down for the full 10 areas
const ZONE_MAX_SCALE = 2.5;

// Works out the size of the zone grid. Each area is scaled on its own to be as large as fits its box, and the
// tiles are widened to fill the box so no space is wasted beside them.
function buildZoneView(zones: Zone[], panels: Panel[], w: number, h: number) {
  const byName = new Map(panels.map((p) => [p.cls, p]));
  const rows = Math.max(1, Math.ceil(Math.max(...zones.map((z) => z.zone_no)) / ZONE_COLS));
  const cellW = Math.max(1, Math.floor((w - (ZONE_COLS - 1) * GAP) / ZONE_COLS));
  const cellH = Math.max(1, Math.floor((h - (rows - 1) * GAP) / rows));
  const blocksFor = (z: Zone): Panel[] =>
    z.class_names.map((n) => byName.get(n) ?? { cls: n, order: 0, races: [], maxRows: 3, holes: {} });
  const layoutFor = (z: Zone) => {
    const b = blocksFor(z);
    if (!b.length) return { scale: 1, innerW: BASE_W };
    const contentH = b.reduce((t, p) => t + panelH(p), 0) + (b.length - 1) * GAP;
    const scale = Math.min(cellH / contentH, cellW / BASE_W, ZONE_MAX_SCALE);
    return { scale, innerW: cellW / scale };
  };
  let minScale = ZONE_MAX_SCALE;
  for (const z of zones) if (z.zone_type === "results") minScale = Math.min(minScale, layoutFor(z).scale);
  return { rows, cellW, cellH, scale: minScale, blocksFor, layoutFor };
}

function ClassPanel({ panel, tick }: { panel: Panel; tick: number }) {
  // Views = every (race, page) pair. A live race stays on screen (paging through its own pages);
  // otherwise the tile rolls through all races and pages.
  const none = panel.races.length === 0;
  const liveOnly = panel.races.some((r) => r.live);
  const views = panel.races
    .filter((r) => !liveOnly || r.live)
    .flatMap((r) => splitRows(r.rows).map((rows, i, all) => ({ race: r, rows, page: i + 1, pages: all.length })));
  const idx = views.length ? tick % views.length : 0;
  const view = views[idx];
  const current = view?.race ?? { race: 0, live: false, rows: [] as Row[] };
  const shown = view?.rows ?? [];
  return (
    <div style={{ background: "#fff", border: "1px solid #dbe3ee", borderRadius: 6, overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ background: NAVY, color: "#fff", padding: "0 12px", height: TITLE_H, display: "flex", alignItems: "center", fontSize: 17, lineHeight: "20px", fontWeight: 800, textTransform: "uppercase", overflow: "hidden" }}>
        {panel.cls}
      </div>
      <div style={{ height: SUB_H, padding: "0 12px", display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, color: NAVY, fontSize: 14, borderBottom: "1px solid #e5ebf3" }}>
        <span>
          {none ? "NO RESULTS YET" : <>RACE {current.race} •{" "}</>}
          {none ? null : current.live ? <span style={{ background: "#16a34a", color: "#fff", padding: "1px 8px", borderRadius: 4 }}>LIVE</span> : "FINAL"}
          {view && view.pages > 1 && <span data-testid="page-label" style={{ marginLeft: 6 }}>• {view.page}/{view.pages}</span>}
        </span>
        {views.length > 1 && (
          <span aria-label={`View ${idx + 1} of ${views.length}`} style={{ fontSize: 10, letterSpacing: 2 }}>
            {views.map((v, i) => <span key={`${v.race.race}-${v.page}`} style={{ color: i === idx ? "#0b5fff" : "#cbd5e1" }}>●</span>)}
          </span>
        )}
      </div>
      <div style={{ height: THEAD_H + panel.maxRows * ROW_H + PAD_B + (Object.keys(panel.holes).length ? HS_H : 0), position: "relative" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup><col style={{ width: 54 }} /><col style={{ width: 46 }} /><col /><col style={{ width: 40 }} /><col style={{ width: 92 }} /><col style={{ width: 84 }} /></colgroup>
          <thead>
            <tr style={{ height: THEAD_H, color: "#475569", fontSize: 11, textAlign: "left" }}>
              <th style={cell}>PLACE</th><th style={cell}>NO</th><th style={cell}>RIDER</th><th style={{ ...cell, textAlign: "right" }}>LAPS</th><th style={{ ...cell, textAlign: "right" }}>TIME</th><th style={{ ...cell, textAlign: "right" }}>BEST</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => {
              const dnf = r.status === "dnf";
              return (
                <tr key={i} style={{ height: ROW_H, background: r.position === 1 && !dnf ? "#fdf3c8" : undefined, fontSize: 15 }}>
                  <td style={cell}><span data-medal={!dnf && r.position != null && r.position <= 3 ? r.position : undefined} style={dnf ? dnfBadge : placeBadge(r.position)}>{dnf ? "DNF" : r.position}</span></td>
                  <td style={{ ...cell, fontWeight: 700 }}>{r.rider_number}</td>
                  <td style={{ ...cell, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {shortName(r.rider_name)}
                    {r.grade && <span style={{ color: "#94a3b8", fontSize: 11, marginLeft: 5 }}>{r.grade}</span>}
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.laps ?? ""}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.total_time ?? ""}</td>
                  <td style={{ ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.best_lap}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {Object.keys(panel.holes).length > 0 && (
          <div data-testid="holeshot" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: HS_H, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderTop: "1px solid #e5ebf3", fontSize: 13, background: "#fffbea" }}>
            {panel.holes[current.race] && (
              <>
                <span style={{ background: "linear-gradient(135deg, #ffe27a, #e0a800)", color: "#4a3600", fontWeight: 800, borderRadius: 4, padding: "0 6px", fontSize: 11 }}>HOLESHOT</span>
                <b>{panel.holes[current.race].no}</b>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortName(panel.holes[current.race].name)}</span>
              </>
            )}
          </div>
        )}
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
// 1st, 2nd and 3rd get gold, silver and bronze badges.
const MEDALS: Record<number, CSSProperties> = {
  1: { background: "linear-gradient(135deg, #ffe27a, #e0a800)", color: "#4a3600", boxShadow: "0 0 0 1px #b88a00" },
  2: { background: "linear-gradient(135deg, #f1f4f8, #aab3be)", color: "#2b3440", boxShadow: "0 0 0 1px #8b95a1" },
  3: { background: "linear-gradient(135deg, #e8a76b, #b8681f)", color: "#2b1500", boxShadow: "0 0 0 1px #8f4e14" },
};
const placeBadge = (pos: number | null): CSSProperties => (pos != null && MEDALS[pos] ? { ...badge, ...MEDALS[pos] } : badge);
const dnfBadge: CSSProperties = { ...badge, background: "#94a3b8" };
