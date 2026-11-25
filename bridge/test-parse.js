// node test-parse.js <capture.bin>   - parses a capture (in odd-sized chunks) and prints the standings.
const fs = require("fs"); const { FeedState } = require("./parseFeed");
const d = fs.readFileSync(process.argv[2]); const s = new FeedState();
for (let i = 0; i < d.length; i += 97) s.push(d.subarray(i, i + 97));
const snap = s.snapshot(); console.log("race", snap.race, "flag", snap.flag, "rows", snap.rows.length, "warnings", snap.warnings);
for (const r of snap.rows) console.log([r.baseClass, r.grade, "pos", r.pos, "pic", r.pic, r.raceNo, r.name, r.laps, r.totalTimeText, "best", r.bestLapText, "lap" + r.bestLapOn, "gap", r.gapText, "diff", r.diffText].join(" | "));
