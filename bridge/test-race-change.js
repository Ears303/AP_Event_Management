// Synthetic checks: race changes, repeated dumps between heartbeats, single-line updates.
const { FeedState } = require("./parseFeed"); let pass = 0, fail = 0;
const check = (n, ok, e = "") => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : " -> " + e)); };
const F = '$F,9999,"00:00:00","10:36:16","00:25:26","Green "\r\n';
const dump = (sid, race, riders, bBefore) => {
  const B = `$B,${sid},"Race ${race}"\r\n`;
  const H = riders.map((r, i) => `$H,${i + 1},"${r.no}",2,"00:02:${10 + i}.000"\r\n`).join("");
  const G = riders.map((r, i) => `$G,${i + 1},"${r.no}",${r.laps},"00:0${r.laps}:00.${r.no}"\r\n`).join("");
  const SP = riders.map((r, i) => `$SP,${i + 1},"${r.no}",2,"00:02:10.000",40000\r\n`).join("");
  const A = riders.map((r) => `$A,"${r.no}","${r.no}",1,"F${r.no}","L${r.no}","WA",${r.cls}\r\n`).join("");
  const C = `$C,1,"65cc 7-U10 Yrs"\r\n$C,2,"85cc 9-U12 Yrs"\r\n`;
  return (bBefore ? B : "") + H + G + SP + (bBefore ? "" : B) + A + C;
};
const r1 = [{ no: 10, laps: 5, cls: 1 }, { no: 11, laps: 5, cls: 1 }, { no: 12, laps: 4, cls: 1 }];
const r2 = [{ no: 20, laps: 3, cls: 2 }, { no: 21, laps: 3, cls: 2 }];
let s = new FeedState();
s.push(dump(1, 5, r1, false) + F + F);
let sn = s.snapshot(); check("race 5 read", sn.race === 5 && sn.rows.length === 3, JSON.stringify(sn.rows.length));
s.push(dump(1, 5, r1.map((r) => ({ ...r, laps: r.laps + 1 })), false) + F + dump(1, 5, r1.map((r) => ({ ...r, laps: r.laps + 2 })), false) + F);
sn = s.snapshot(); check("repeated dumps between heartbeats replace (not append): latest laps shown", sn.rows.length === 3 && sn.rows[0].laps === 7, JSON.stringify(sn.rows.map((r) => r.laps)));
s.push(dump(2, 6, r2, false) + F);   // new race, $B after the G block
sn = s.snapshot(); check("race change ($B after $G): shows race 6 only", sn.race === 6 && sn.rows.length === 2 && sn.rows.every((r) => r.baseClass === "85cc 9-U12 Yrs"), JSON.stringify(sn.rows.map((r) => r.raceNo)));
check("race change reported", s.changes.length === 1 && /5->6/.test(s.changes[0]), s.changes.join());
s.push(dump(3, 7, r1, true) + F);    // $B before the blocks
sn = s.snapshot(); check("race change ($B first): shows race 7 only", sn.race === 7 && sn.rows.length === 3 && sn.rows.every((r) => r.baseClass === "65cc 7-U10 Yrs"), JSON.stringify(sn.rows.map((r) => r.raceNo)));
s.push('$G,1,"11",9,"00:09:00.000"\r\n' + F + '$G,2,"10",8,"00:09:30.000"\r\n');
sn = s.snapshot(); check("single-line updates change just that rider", sn.rows.length === 3 && sn.rows[0].raceNo === "11" && sn.rows[0].laps === 9, JSON.stringify(sn.rows.map((r) => r.raceNo + ":" + r.laps)));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
