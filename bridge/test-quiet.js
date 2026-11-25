// A quiet feed ends the live race; new activity restarts it. node test-quiet.js <capture.bin>
const net = require("net"), fs = require("fs"); const { createBridge } = require("./live-bridge");
const cap = fs.readFileSync(process.argv[2]).toString("latin1"); let pass = 0, fail = 0;
const check = (n, ok, e = "") => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : " -> " + e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let sock; const srv = net.createServer((c) => { sock = c; c.write(cap); }); await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const calls = []; const real = Date.now; let off = 0; Date.now = () => real() + off;
  const b = createBridge({ cfg: { eventId: "e", feedHost: "127.0.0.1", feedPort: srv.address().port, pushEverySeconds: 0.1 }, log: () => {},
    rpc: async (fn) => { calls.push(fn); } });
  b.start(); await sleep(2500);
  check("live results sent while active", calls.filter((c) => c === "live_update_race").length === 1, calls.join());
  off = 25000; await sleep(1500);
  check("unchanged data refreshes the live flag after 20 s", calls.filter((c) => c === "live_update_race").length === 2, calls.join());
  off = 6 * 60000; await sleep(1500);
  check("after 5 quiet minutes the race is ended once", calls.filter((c) => c === "live_end").length === 1, calls.join());
  const n = calls.length; off = 12 * 60000; await sleep(2500);
  check("nothing more is sent while quiet", calls.length === n, calls.join());
  sock.write('$G,1,"12",8,"00:17:50.000"\r\n'); await sleep(2500);
  check("new lap crossing restarts live updates", calls.filter((c) => c === "live_update_race").length === 3, calls.join());
  Date.now = real; b.stop(); srv.close(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
