// Parser for the MyLaps / Orbits scoreboard feed (TCP, lines ending CRLF, comma separated, quoted text).
// Record types seen in a real capture (Pinjar Park, Race 27):
//   $B,<session id>,"Race 27"                        session name
//   $C,<class id>,"100cc to 125cc 13-U17 Yrs A Grade" classes in the session
//   $A,"<reg>","<no>",<transponder>,"FIRST","LAST","STATE",<class id>   competitor
//   $G,<pos>,"<no>",<laps>,"<total time>"            race order (laps completed, race time at last crossing)
//   $H,<pos>,"<no>",<best lap no>,"<best lap time>"  ordered by best lap
//   $SP,<pos>,"<no>",<best lap no>,"<best time>",<speed x1000>   best-lap speed
//   $F,<laps to go>,"<time to go>","<time of day>","<race time>","<flag>"   heartbeat every second
// Each record type is sent as a block (all riders); a new block replaces the previous one.
"use strict";

function splitLine(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// "00:15:43.383" -> "15:43.383"; "00:02:10.668" -> "2:10.668"; "01:02:03.456" -> "1:02:03.456"
function cleanTime(t) {
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec((t || "").trim());
  if (!m) return "";
  const [h, mi, s] = [Number(m[1]), Number(m[2]), m[3]];
  const sec = s.padStart(s.includes(".") ? 6 : 2, "0");
  return h > 0 ? `${h}:${String(mi).padStart(2, "0")}:${sec}` : `${mi}:${sec}`;
}
function timeMs(t) {
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec((t || "").trim());
  if (!m) return null;
  return Math.round(((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000);
}
function fmtGap(ms) {
  const s = ms / 1000;
  if (s >= 60) { const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`; }
  return s.toFixed(3);
}
// "100cc to 125cc 13-U17 Yrs A Grade" -> { baseClass: "100cc to 125cc 13-U17 Yrs", grade: "A" }  (same rule as the CSV import)
function splitClassGrade(cls) {
  const m = String(cls).trim().match(/^(.*?)\s+([A-Z])\s+Grade$/i);
  return m ? { baseClass: m[1].trim(), grade: m[2].toUpperCase() } : { baseClass: String(cls).trim(), grade: null };
}

class FeedState {
  constructor() { this.reset(); this.buf = ""; }
  reset() {
    this.blocks = { A: new Map(), C: new Map(), G: [], H: new Map(), SP: new Map() };
    this.race = null; this.raceName = ""; this.flag = ""; this.raceTime = "";
    this.lastType = ""; this.dirty = false; this.version = 0;
  }
  // Feed raw bytes/text from the socket; complete lines are parsed, partial ones kept for next time.
  push(chunk) {
    this.buf += typeof chunk === "string" ? chunk : chunk.toString("latin1");
    let i;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, ""); this.buf = this.buf.slice(i + 1);
      if (line.trim()) this.line(line);
    }
  }
  line(line) {
    if (line[0] !== "$") return;
    const f = splitLine(line); const type = f[0].slice(1);
    if (type === "F") { this.flag = (f[5] || "").trim(); this.raceTime = f[4] || ""; return; } // heartbeat: not a data change
    const newBlock = type !== this.lastType; this.lastType = type;
    if (type === "G" && newBlock) this.blocks.G = [];
    if (type === "H" && newBlock) this.blocks.H = new Map();
    if (type === "SP" && newBlock) this.blocks.SP = new Map();
    if (type === "A" && newBlock) this.blocks.A = new Map();
    if (type === "C" && newBlock) this.blocks.C = new Map();
    switch (type) {
      case "B": { const m = /(\d+)/.exec(f[2] || ""); this.race = m ? Number(m[1]) : null; this.raceName = f[2] || ""; break; }
      case "C": this.blocks.C.set(f[1], f[2] || ""); break;
      case "A": this.blocks.A.set(f[2], { first: f[4] || "", last: f[5] || "", state: f[6] || "", classId: f[7] || "" }); break;
      case "G": this.blocks.G.push({ no: f[2], laps: f[3] === "" ? 0 : Number(f[3]), time: f[4] || "" }); break;
      case "H": this.blocks.H.set(f[2], { lapNo: f[3] === "" ? null : Number(f[3]), time: f[4] || "" }); break;
      case "SP": this.blocks.SP.set(f[2], f[5] === "" ? null : Number(f[5]) / 1000); break;
      default: return; // $SR, $COMP, $E ... not needed
    }
    this.dirty = true; this.version++;
  }

  // Current standings in the shape aptiming.live_update_race expects (same fields as the CSV import).
  snapshot() {
    const warnings = [];
    if (this.race == null) return { race: null, rows: [], warnings: ["no race number yet"] };
    const riders = this.blocks.G.filter((g) => g.laps > 0 && g.time && timeMs(g.time) !== null);
    const classOf = (no) => {
      const a = this.blocks.A.get(no); const raw = a ? this.blocks.C.get(a.classId) : undefined;
      if (raw === undefined) return null; return splitClassGrade(raw);
    };
    const rows = [];
    const byBase = new Map(), byGrade = new Map();
    for (const g of riders) {
      const a = this.blocks.A.get(g.no); const cg = classOf(g.no);
      if (!a || !cg) { warnings.push(`rider ${g.no}: no name/class in feed yet`); continue; }
      const bKey = cg.baseClass, gKey = cg.baseClass + "|" + (cg.grade || "");
      const pos = (byBase.get(bKey) || 0) + 1; byBase.set(bKey, pos);
      const pic = (byGrade.get(gKey) || 0) + 1; byGrade.set(gKey, pic);
      const h = this.blocks.H.get(g.no);
      rows.push({
        pos, pic, raceNo: g.no, name: `${a.first} ${a.last}`.trim(), baseClass: cg.baseClass, grade: cg.grade,
        laps: g.laps, totalTimeText: cleanTime(g.time), totalTimeMs: timeMs(g.time),
        bestLapText: h && h.time && timeMs(h.time) > 0 ? cleanTime(h.time) : "",
        bestLapMs: h && timeMs(h.time) > 0 ? timeMs(h.time) : null, bestLapOn: h ? h.lapNo : null,
        bestSpeed: this.blocks.SP.get(g.no) || null, status: "finished", _lapsMs: timeMs(g.time),
      });
    }
    // diff (to rider ahead) and gap (to leader) within each base class
    const lead = new Map(), prev = new Map();
    for (const r of rows) {
      const L = lead.get(r.baseClass), P = prev.get(r.baseClass);
      const delta = (o) => (o.laps === r.laps ? fmtGap(r._lapsMs - o._lapsMs) : `${o.laps - r.laps} Lap${o.laps - r.laps > 1 ? "s" : ""}`);
      r.gapText = L ? delta(L) : ""; r.diffText = P ? delta(P) : "";
      if (!L) lead.set(r.baseClass, r); prev.set(r.baseClass, r);
    }
    rows.forEach((r) => delete r._lapsMs);
    return { race: this.race, flag: this.flag, rows, warnings };
  }
}

module.exports = { FeedState, splitLine, cleanTime, timeMs, splitClassGrade };
