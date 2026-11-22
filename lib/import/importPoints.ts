// Points-results CSV importer (MyLaps "Graded Results" export).
// Pure functions, no dependencies: parse -> validate -> rank -> preview.

export interface PointsRow {
  filePos: number;
  raceNo: string;
  name: string;
  baseClass: string;      // e.g. "128cc/150cc/200cc/250cc 13-U16 Yrs"
  grade: string | null;   // "A" | "B" | "C" | null
  totalPoints: number;
  racePoints: number[];   // R1..Rn
  state: string;
  pos: number;            // position after applying our tie-break
  tieNote?: string;       // set when a tie could not be broken
}

export interface ImportResult {
  rows: PointsRow[];
  raceColumns: string[];
  warnings: string[];
  errors: string[];
}

// Minimal RFC4180-style CSV parser (handles quoted fields, "" escapes, CRLF).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
  }
  return rows;
}

// "128cc/150cc 13-U16 Yrs A Grade" -> { baseClass: "128cc/150cc 13-U16 Yrs", grade: "A" }
export function splitClassGrade(cls: string): { baseClass: string; grade: string | null } {
  const m = cls.trim().match(/^(.*?)\s+([A-Z])\s+Grade$/i);
  if (m) return { baseClass: m[1].trim(), grade: m[2].toUpperCase() };
  return { baseClass: cls.trim(), grade: null };
}

const isRaceCol = (h: string) => /^R\d+\.?$/i.test(h.trim());

export function importPoints(csvText: string): ImportResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const table = parseCsv(csvText);
  if (table.length < 2) {
    return { rows: [], raceColumns: [], warnings, errors: ["File has no data rows."] };
  }

  const headers = table[0].map((h) => h.trim());
  const col = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iPos = col("Pos"), iNo = col("No."), iName = col("Name"), iClass = col("Class");
  const iTotal = col("Total points"), iState = col("State");
  const raceIdx = headers.map((h, i) => (isRaceCol(h) ? i : -1)).filter((i) => i >= 0);

  for (const [label, idx] of [["Pos", iPos], ["No.", iNo], ["Name", iName], ["Class", iClass], ["Total points", iTotal]] as const) {
    if (idx < 0) errors.push(`Missing required column: ${label}`);
  }
  if (raceIdx.length === 0) errors.push("No race columns (R1, R2, ...) found.");
  if (errors.length) return { rows: [], raceColumns: [], warnings, errors };

  const raceColumns = raceIdx.map((i) => headers[i].replace(/\.$/, "").trim());
  const rows: PointsRow[] = [];

  table.slice(1).forEach((r, n) => {
    const line = n + 2;
    const num = (s: string | undefined) => (s === undefined || s.trim() === "" ? 0 : Number(s));
    const racePoints = raceIdx.map((i) => num(r[i]));
    const total = Number(r[iTotal]);
    const { baseClass, grade } = splitClassGrade(r[iClass] ?? "");

    if (!r[iNo]?.trim()) { errors.push(`Line ${line}: missing rider number.`); return; }
    if (!r[iName]?.trim()) { errors.push(`Line ${line}: missing rider name.`); return; }
    if (!/^\d+$/.test(r[iNo].trim())) { errors.push(`Line ${line} (${r[iName]}): rider number "${r[iNo]}" is not a whole number.`); return; }
    if ([total, ...racePoints].some((v) => Number.isNaN(v))) {
      errors.push(`Line ${line} (${r[iName]}): points are not numbers.`);
      return;
    }
    const sum = racePoints.reduce((a, b) => a + b, 0);
    if (sum !== total) {
      warnings.push(`Line ${line} (${r[iName]}): race points add to ${sum} but Total points is ${total}.`);
    }
    if (!grade) warnings.push(`Line ${line} (${r[iName]}): no grade found in class "${r[iClass]}".`);

    rows.push({
      filePos: Number(r[iPos]),
      raceNo: r[iNo].trim(),
      name: r[iName].trim(),
      baseClass,
      grade,
      totalPoints: total,
      racePoints,
      state: (iState >= 0 ? r[iState] : "")?.trim() ?? "",
      pos: 0,
    });
  });

  // Duplicate rider in the same base class
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.baseClass}|${row.raceNo}|${row.name}`;
    if (seen.has(key)) warnings.push(`Duplicate entry: #${row.raceNo} ${row.name} in ${row.baseClass}.`);
    seen.add(key);
  }

  // Rank within each base class (positions run across all grades).
  // Order: total points, then points in the LAST race of the day (organiser rule).
  const byClass = new Map<string, PointsRow[]>();
  for (const row of rows) {
    if (!byClass.has(row.baseClass)) byClass.set(row.baseClass, []);
    byClass.get(row.baseClass)!.push(row);
  }
  const last = raceColumns.length - 1;
  for (const [cls, list] of byClass) {
    list.sort((a, b) =>
      b.totalPoints - a.totalPoints ||
      b.racePoints[last] - a.racePoints[last]);
    let rank = 0;
    list.forEach((row, i) => {
      const prev = list[i - 1];
      const tied = prev && prev.totalPoints === row.totalPoints && prev.racePoints[last] === row.racePoints[last];
      if (tied) {
        row.pos = prev.pos;
        const note = `Tie on ${row.totalPoints} points and ${row.racePoints[last]} in ${raceColumns[last]} - needs a manual decision.`;
        row.tieNote = note; prev.tieNote = note;
        warnings.push(`${cls}: #${prev.raceNo} ${prev.name} and #${row.raceNo} ${row.name} - ${note}`);
      } else {
        rank = i + 1;
        row.pos = rank;
      }
      if (row.pos !== row.filePos && !tied && !row.tieNote) {
        warnings.push(`${cls}: #${row.raceNo} ${row.name} - file says position ${row.filePos}, we calculate ${row.pos}.`);
      }
    });
  }

  rows.sort((a, b) => a.baseClass.localeCompare(b.baseClass) || a.pos - b.pos);
  return { rows, raceColumns, warnings, errors };
}
