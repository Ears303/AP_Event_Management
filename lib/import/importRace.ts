// Per-race CSV importer (MyLaps "Race N - Results" export).
// Reuses the CSV parser and class/grade splitter from importPoints.ts.
import { parseCsv, splitClassGrade } from "./importPoints";

export type RaceStatus = "finished" | "dnf";   // matches race_results.status in schema.sql

export interface RaceRow {
  status: RaceStatus;
  pos: number | null;       // overall position in the class file
  pic: number | null;       // position in grade (or same as pos when ungraded)
  raceNo: string;
  name: string;
  baseClass: string;
  grade: string | null;
  laps: number;
  totalTimeMs: number | null;
  totalTimeText: string;    // as exported, e.g. "9:13.561" (shown on screens)
  bestLapText: string;      // as exported, e.g. "1:30.219"
  diffText: string;
  gapText: string;
  bestLapMs: number | null;
  bestLapOn: number | null;   // "In Lap": lap the best time was set on
  avgSpeed: number | null;
  bestSpeed: number | null;
  points: number;
  state: string;
}

export interface RaceImportResult {
  raceLabel: string;        // from the filename, e.g. "Race 3"; null-ish if not found
  rows: RaceRow[];
  warnings: string[];
  errors: string[];
}

// "9:13.561" -> 553561, "1:02:03.456" -> 3723456, "58.2" -> 58200
export function parseTimeMs(s: string | undefined): number | null {
  if (!s || !s.trim()) return null;
  const parts = s.trim().split(":");
  if (parts.length > 3 || parts.some((p) => p === "" || Number.isNaN(Number(p)))) return null;
  const secs = parts.reduce((acc, p) => acc * 60 + Number(p), 0);
  return Math.round(secs * 1000);
}

const num = (s: string | undefined): number | null =>
  s === undefined || s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s);

// Returns the status plus any text we did not recognise (so the caller can warn).
function statusOf(posText: string): { status: RaceStatus; pos: number | null; unknown?: string } {
  const t = posText.trim().toUpperCase();
  if (t === "DNF") return { status: "dnf", pos: null };
  const n = Number(t);
  if (Number.isInteger(n) && n > 0) return { status: "finished", pos: n };
  return { status: "dnf", pos: null, unknown: posText.trim() || "(blank)" };
}

// "50cc Auto 6-U9 Yrs - Race 3 - Results.csv" -> "Race 3"
export function raceLabelFromFilename(filename: string): string {
  const m = filename.match(/race[\s_-]*(\d+)/i);
  return m ? `Race ${m[1]}` : "";
}

// Decide which importer a file needs from its column headers (not its file name).
export function detectCsvKind(csvText: string): "points" | "race" | "unknown" {
  const first = parseCsv(csvText)[0] ?? [];
  const h = first.map((x) => x.trim().toLowerCase());
  if (h.includes("total points") && h.some((x) => /^r\d+\.?$/.test(x))) return "points";
  if (h.includes("total tm") && h.includes("best tm")) return "race";
  return "unknown";
}

export function importRace(csvText: string, filename = ""): RaceImportResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const raceLabel = raceLabelFromFilename(filename);
  if (!raceLabel) warnings.push("No race number found in the file name - choose the race when importing.");

  const table = parseCsv(csvText);
  if (table.length < 2) return { raceLabel, rows: [], warnings, errors: ["File has no data rows."] };

  const headers = table[0].map((h) => h.trim());
  const col = (n: string) => headers.findIndex((h) => h.toLowerCase() === n.toLowerCase());
  const I = {
    pos: col("Pos"), pic: col("PIC"), no: col("No."), name: col("Name"), cls: col("Class"),
    laps: col("Laps"), total: col("Total Tm"), diff: col("Diff"), gap: col("Gap"),
    avg: col("Avg. Speed"), best: col("Best Tm"), bestSpd: col("Best Speed"), inLap: col("In Lap"),
    state: col("State"), points: col("Points"),
  };
  for (const [label, idx] of [["Pos", I.pos], ["PIC", I.pic], ["No.", I.no], ["Name", I.name],
    ["Class", I.cls], ["Laps", I.laps], ["Total Tm", I.total], ["Best Tm", I.best]] as const) {
    if (idx < 0) errors.push(`Missing required column: ${label}`);
  }
  if (errors.length) return { raceLabel, rows: [], warnings, errors };
  if (I.points < 0) warnings.push("No Points column - points will be blank for this race.");

  const rows: RaceRow[] = [];
  table.slice(1).forEach((r, n) => {
    const line = n + 2;
    const name = (r[I.name] ?? "").trim();
    const raceNo = (r[I.no] ?? "").trim();
    if (!raceNo || !name) { errors.push(`Line ${line}: missing rider number or name.`); return; }
    if (!/^\d+$/.test(raceNo)) { errors.push(`Line ${line} (${name}): rider number "${raceNo}" is not a whole number.`); return; }

    const { status, pos, unknown } = statusOf(r[I.pos] ?? "");
    if (unknown) warnings.push(`Line ${line} (${name}): position "${unknown}" is not a number or DNF - stored as DNF, please check (DNS/DQ are not supported yet).`);
    const picText = (r[I.pic] ?? "").trim();
    const pic = /^\d+$/.test(picText) ? Number(picText) : null;
    const { baseClass, grade } = splitClassGrade(r[I.cls] ?? "");
    const laps = num(r[I.laps]);
    if (laps === null) { errors.push(`Line ${line} (${name}): laps is not a number.`); return; }

    const totalTimeMs = parseTimeMs(r[I.total]);
    const bestLapMs = parseTimeMs(r[I.best]);
    if (status === "finished" && totalTimeMs === null) warnings.push(`Line ${line} (${name}): no total time.`);
    if (bestLapMs === null) warnings.push(`Line ${line} (${name}): no best lap time.`);
    const pts = I.points >= 0 ? num(r[I.points]) : null;

    rows.push({
      status, pos, pic, raceNo, name, baseClass, grade, laps, totalTimeMs,
      totalTimeText: (r[I.total] ?? "").trim(),
      bestLapText: (r[I.best] ?? "").trim(),
      diffText: (r[I.diff] ?? "").trim(),
      gapText: (I.gap >= 0 ? r[I.gap] ?? "" : "").trim(),
      bestLapMs,
      bestLapOn: num(I.inLap >= 0 ? r[I.inLap] : undefined),
      avgSpeed: num(I.avg >= 0 ? r[I.avg] : undefined),
      bestSpeed: num(I.bestSpd >= 0 ? r[I.bestSpd] : undefined),
      points: pts ?? 0,
      state: (I.state >= 0 ? r[I.state] ?? "" : "").trim(),
    });
  });

  // ---- Consistency checks ----
  const finishers = rows.filter((r) => r.status === "finished");

  // Overall positions should run 1..N with no gaps or repeats.
  const posSorted = finishers.map((r) => r.pos!).sort((a, b) => a - b);
  posSorted.forEach((p, i) => {
    if (p !== i + 1) warnings.push(`Overall positions are not 1..${posSorted.length} in order (problem near position ${p}).`);
  });
  if (new Set(posSorted).size !== posSorted.length) warnings.push("Duplicate overall positions in this file.");

  // PIC should run 1..N within each grade (or equal Pos when the class has no grades).
  const grades = new Set(finishers.map((r) => r.grade ?? ""));
  for (const g of grades) {
    const inGrade = finishers.filter((r) => (r.grade ?? "") === g);
    const pics = inGrade.map((r) => r.pic).sort((a, b) => (a ?? 0) - (b ?? 0));
    pics.forEach((p, i) => {
      if (p !== i + 1) warnings.push(`Position in class (PIC) for ${g ? `${g} Grade` : "ungraded"} is not 1..${pics.length} in order.`);
    });
    if (g === "") {
      inGrade.forEach((r) => {
        if (r.pic !== r.pos) warnings.push(`#${r.raceNo} ${r.name}: ungraded class but PIC (${r.pic}) differs from Pos (${r.pos}).`);
      });
    }
  }

  // Finishing order should follow laps (desc), then total time (asc).
  const byPos = [...finishers].sort((a, b) => a.pos! - b.pos!);
  for (let i = 1; i < byPos.length; i++) {
    const a = byPos[i - 1], b = byPos[i];
    if (b.laps > a.laps || (b.laps === a.laps && (b.totalTimeMs ?? 0) < (a.totalTimeMs ?? 0))) {
      warnings.push(`#${b.raceNo} ${b.name} (Pos ${b.pos}) has more laps or a faster time than the rider ahead of them.`);
    }
  }

  // Best lap cannot be slower than the average lap for finishers.
  finishers.forEach((r) => {
    if (r.bestLapMs && r.totalTimeMs && r.laps > 0 && r.bestLapMs * r.laps > r.totalTimeMs * 1.02) {
      warnings.push(`#${r.raceNo} ${r.name}: best lap is slower than their average lap - check the times.`);
    }
  });

  // Same rider twice
  const seen = new Set<string>();
  rows.forEach((r) => {
    const k = `${r.raceNo}|${r.name}`;
    if (seen.has(k)) warnings.push(`Duplicate entry: #${r.raceNo} ${r.name}.`);
    seen.add(k);
  });

  // A file should be one base class
  const classes = new Set(rows.map((r) => r.baseClass));
  if (classes.size > 1) warnings.push(`File contains more than one class: ${[...classes].join(" | ")}`);

  // Non-finishers score zero
  rows.filter((r) => r.status !== "finished" && r.points !== 0)
    .forEach((r) => warnings.push(`#${r.raceNo} ${r.name}: ${r.status.toUpperCase()} but has ${r.points} points.`));

  return { raceLabel, rows, warnings, errors };
}
