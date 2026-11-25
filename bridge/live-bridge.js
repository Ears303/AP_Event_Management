// AP Timing live bridge: reads the MyLaps scoreboard feed (TCP) and keeps the app's live results up to date.
// Run on a PC on the timing network:   node live-bridge.js [config.json]
"use strict";
const net = require("net");
const fs = require("fs");
const path = require("path");
const { FeedState } = require("./parseFeed");

function createBridge({ cfg, rpc, log = console.log, connect = (h, p) => net.connect(p, h) }) {
  const state = new FeedState();
  const pushEvery = (cfg.pushEverySeconds ?? 2) * 1000;
  let lastPush = 0, lastHash = "", lastRace = null, sock = null, stopped = false, timer = null, reconnect = null, bytes = 0;

  async function maybePush(force) {
    if (!state.dirty && !force) return;
    if (!force && Date.now() - lastPush < pushEvery) return;
    const snap = state.snapshot();
    if (snap.race == null || snap.rows.length === 0) { state.dirty = false; return; } // never wipe results with an empty snapshot
    const hash = snap.race + JSON.stringify(snap.rows);
    state.dirty = false;
    if (hash === lastHash) return;
    lastPush = Date.now();
    try {
      await rpc("live_update_race", { p_event: cfg.eventId, p_race_number: snap.race, p_rows: snap.rows });
      lastHash = hash;
      if (snap.race !== lastRace) { log(`Race ${snap.race}: sending results (${snap.rows.length} riders)`); lastRace = snap.race; }
      else log(`${new Date().toLocaleTimeString()}  race ${snap.race}  ${snap.rows.length} riders  ${snap.flag || ""}`);
    } catch (e) {
      state.dirty = true; // try again next tick
      log("Could not send results (will retry): " + (e && e.message ? e.message : e));
    }
  }

  function open() {
    if (stopped) return;
    log(`Connecting to feed ${cfg.feedHost}:${cfg.feedPort} ...`);
    sock = connect(cfg.feedHost, cfg.feedPort);
    sock.on("connect", () => log("Connected to feed."));
    sock.on("data", (d) => { bytes += d.length; state.push(d); });
    sock.on("error", (e) => log("Feed error: " + e.message));
    sock.on("close", () => { if (stopped) return; log("Feed closed - reconnecting in 3 s"); reconnect = setTimeout(open, 3000); });
  }

  return {
    state,
    start() { open(); timer = setInterval(() => void maybePush(false), 1000); },
    flush: () => maybePush(true),
    tick: () => maybePush(false),
    stop() { stopped = true; clearInterval(timer); clearTimeout(reconnect); if (sock) sock.destroy(); },
    get bytes() { return bytes; },
  };
}

async function main() {
  const cfgPath = path.resolve(process.argv[2] || path.join(__dirname, "config.json"));
  if (!fs.existsSync(cfgPath)) { console.error(`No config file at ${cfgPath}. Copy config.example.json to config.json and fill it in.`); process.exit(1); }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const { createClient } = require("@supabase/supabase-js");
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { db: { schema: "aptiming" }, auth: { persistSession: false, autoRefreshToken: true } });
  const si = await sb.auth.signInWithPassword({ email: cfg.email, password: cfg.password });
  if (si.error) { console.error("Sign-in failed: " + si.error.message); process.exit(1); }
  console.log("Signed in as " + cfg.email);
  if (!cfg.eventId) {
    const ev = await sb.from("events").select("id,event_name,start_date").ilike("event_name", `%${cfg.eventName || ""}%`).order("start_date", { ascending: false }).limit(5);
    if (ev.error || !ev.data?.length) { console.error("Could not find the event. Put its id in config.json as eventId."); process.exit(1); }
    cfg.eventId = ev.data[0].id; console.log(`Using event "${ev.data[0].event_name}" (${cfg.eventId})`);
    if (ev.data.length > 1) console.log("  (other matches: " + ev.data.slice(1).map((e) => e.event_name).join(", ") + ") - set eventId to be sure");
  }
  const bridge = createBridge({ cfg, rpc: async (fn, args) => { const r = await sb.rpc(fn, args); if (r.error) throw new Error(r.error.message); return r.data; } });
  bridge.start();
  process.on("SIGINT", () => { bridge.stop(); process.exit(0); });
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { createBridge };
