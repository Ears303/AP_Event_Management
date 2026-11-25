// Replays a capture through a fake TCP feed and checks what the bridge would send. node test-bridge.js <capture.bin>
const net = require("net"), fs = require("fs"); const { createBridge } = require("./live-bridge");
const cap = fs.readFileSync(process.argv[2]); let pass = 0, fail = 0;
const check = (n, ok, e = "") => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : " -> " + e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let conns = 0;
  const srv = net.createServer((c) => { conns++; if (conns === 1) { c.write(cap.subarray(0, 4000)); setTimeout(() => { c.write(cap.subarray(4000, 9000)); setTimeout(() => c.destroy(), 300); }, 100); } else c.write(cap); }); await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port; const calls = []; const logs = []; let fail1 = true;
  const b = createBridge({ cfg: { eventId: "e1", feedHost: "127.0.0.1", feedPort: port, pushEverySeconds: 0.1 }, log: (m) => logs.push(m),
    rpc: async (fn, a) => { if (fail1) { fail1 = false; throw new Error("network down"); } calls.push({ fn, a }); } });
  b.start(); await sleep(6000);
  check("sent live_update_race for event e1 race 27", calls.length > 0 && calls[0].fn === "live_update_race" && calls[0].a.p_event === "e1" && calls[0].a.p_race_number === 27, JSON.stringify(calls[0]).slice(0, 200));
  check("retried after first send failed", logs.some((l) => /retry/.test(l)));
  check("reconnected after feed dropped", conns >= 2 && logs.some((l) => /reconnecting/.test(l)), conns);
  const last = calls[calls.length - 1].a.p_rows; check("13 riders over 3 grades, positions correct", last.length === 13 && last[0].name === "DEEGAN FORT" && last.find((r) => r.raceNo === "29").pic === 1 && last.find((r) => r.raceNo === "29").pos === 3);
  check("identical data not re-sent every tick (only a periodic refresh)", calls.length <= 3, calls.length);
  b.stop(); srv.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
