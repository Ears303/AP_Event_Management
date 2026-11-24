// Parses a race schedule (rows from an Excel sheet) into schedule rows.
// Header names are matched loosely, so "Race", "Race No", "#" all work. Only Race + Class are required.

export type ScheduleRow = {
  raceNo: number;
  className: string;
  moto: number | null;
  startsAt: string | null; // "YYYY-MM-DDTHH:MM" local time, or null
  timeText: string | null; // "HH:MM" as shown on the sheet
  holeshot: boolean;
};
export type ScheduleResult = { rows: ScheduleRow[]; warnings: string[]; errors: string[] };

type Cell = unknown;
const norm = (v: Cell) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const HEADERS: Record<string, string[]> = {
  race: ["race", "race no", "race number", "race #", "no", "number", "#"],
  cls: ["class", "classes", "category", "class name", "grade"],
  moto: ["moto", "heat", "round", "session", "race of", "moto no"],
  time: ["time", "start", "start time", "scheduled", "scheduled time", "gate"],
  date: ["date", "day"],
  holeshot: ["holeshot", "hole shot", "hs", "holeshots", "holeshot prize", "holeshot award"],
};

function findHeader(rows: Cell[][]): { idx: number; cols: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cols: Record<string, number> = {};
    rows[i].forEach((c, j) => {
      const n = norm(c);
      for (const [k, names] of Object.entries(HEADERS)) if (!(k in cols) && names.includes(n)) cols[k] = j;
    });
    if ("race" in cols && "cls" in cols) return { idx: i, cols };
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function toDate(v: Cell): string | null {
  if (v instanceof Date && !isNaN(+v)) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`; // Excel cells arrive as UTC wall-clock
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/); // day/month/year (Australian)
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
  return null;
}

// Returns [HH, MM] or null. Handles Date cells, Excel day-fractions, "9:30", "9.30am", "1330".
function toTime(v: Cell): [number, number] | null {
  if (v instanceof Date && !isNaN(+v)) return [v.getUTCHours(), v.getUTCMinutes()];
  if (typeof v === "number" && v >= 0 && v < 1) { const mins = Math.round(v * 1440); return [Math.floor(mins / 60) % 24, mins % 60]; }
  const s = String(v ?? "").trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?:[:.h]?(\d{2}))?(?::\d{2})?\s*(am|pm)?$/);
  if (!m) return null;
  let h = +m[1]; const mi = m[2] ? +m[2] : 0;
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  return h < 24 && mi < 60 ? [h, mi] : null;
}

// moto: 1, "Moto 2", "2" -> number; holeshot: Y/Yes/True/1/X/✓/HS -> true
const toMoto = (v: Cell): number | null => { const m = String(v ?? "").match(/\d+/); return m ? +m[0] : null; };
const toBool = (v: Cell): boolean => {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v > 0;
  return ["y", "yes", "true", "1", "x", "hs", "holeshot", "✓", "✔"].includes(norm(v));
};

export function parseSchedule(rows: Cell[][], defaultDate: string | null = null): ScheduleResult {
  const out: ScheduleResult = { rows: [], warnings: [], errors: [] };
  const h = findHeader(rows);
  if (!h) { out.errors.push("Could not find a header row with at least 'Race' and 'Class' columns."); return out; }
  const { cols } = h;
  if (!("holeshot" in cols)) out.warnings.push("No Holeshot column found - no races will be marked for holeshots.");
  if (!("time" in cols)) out.warnings.push("No Time column found - Next Race will use race order only.");
  const seen = new Set<string>();
  let lastDate = defaultDate;
  rows.slice(h.idx + 1).forEach((r, i) => {
    const line = h.idx + 2 + i;
    if (r.every((c) => String(c ?? "").trim() === "")) return;
    const raceNo = Number(String(r[cols.race] ?? "").replace(/[^\d]/g, ""));
    const className = String(r[cols.cls] ?? "").trim();
    if (!raceNo && !className) return;
    if (!raceNo || !className) { out.errors.push(`Row ${line}: needs both a race number and a class.`); return; }
    const key = `${raceNo}|${className.toLowerCase()}`;
    if (seen.has(key)) { out.errors.push(`Row ${line}: race ${raceNo} / ${className} appears twice.`); return; }
    seen.add(key);
    if ("date" in cols) lastDate = toDate(r[cols.date]) ?? lastDate;
    const t = "time" in cols ? toTime(r[cols.time]) : null;
    if ("time" in cols && String(r[cols.time] ?? "").trim() !== "" && !t) out.warnings.push(`Row ${line}: could not read time "${r[cols.time]}".`);
    out.rows.push({
      raceNo, className,
      moto: "moto" in cols ? toMoto(r[cols.moto]) : null,
      timeText: t ? `${pad(t[0])}:${pad(t[1])}` : null,
      startsAt: t && lastDate ? `${lastDate}T${pad(t[0])}:${pad(t[1])}` : null,
      holeshot: "holeshot" in cols ? toBool(r[cols.holeshot]) : false,
    });
  });
  if (!out.rows.length && !out.errors.length) out.errors.push("No schedule rows found under the header.");
  if (out.rows.some((r) => r.timeText && !r.startsAt)) out.warnings.push("No date on the sheet, so times will be saved without a date. Add a Date column or set the event start date.");
  return out;
}
