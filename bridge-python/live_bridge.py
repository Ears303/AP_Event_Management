"""AP Timing live bridge: reads the MyLaps scoreboard feed (TCP) and keeps the app's live results up to date.

Run on a PC on the timing network (double-click start-bridge.bat, or: python live_bridge.py [config.json]).
Needs only Python 3.8+ - no extra packages.
"""
import getpass
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

from parse_feed import FeedState

HERE = os.path.dirname(os.path.abspath(__file__))


def say(msg):
    print(msg, flush=True)


# ---------------------------------------------------------------- Supabase (plain REST, no packages)
class Supabase:
    def __init__(self, url, anon_key, schema="aptiming"):
        self.url, self.key, self.schema = url.rstrip("/"), anon_key, schema
        self.token = self.refresh_token = self.email = self.password = None
        self.expires = 0.0

    def _call(self, method, path, body=None, headers=None, auth=True):
        h = {"apikey": self.key, "Content-Type": "application/json", "Accept": "application/json"}
        if auth and self.token:
            h["Authorization"] = "Bearer " + self.token
        h.update(headers or {})
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(self.url + path, data=data, method=method, headers=h)
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                raw = r.read()
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                j = json.loads(raw)
                msg = j.get("message") or j.get("msg") or j.get("error_description") or j.get("error") or raw.decode("utf-8", "replace")
            except ValueError:
                msg = raw.decode("utf-8", "replace")
            raise RuntimeError(f"{msg} (HTTP {e.code})") from None
        except urllib.error.URLError as e:
            raise RuntimeError(f"cannot reach Supabase: {e.reason}") from None
        return json.loads(raw) if raw else None

    def _store(self, j):
        self.token, self.refresh_token = j["access_token"], j.get("refresh_token")
        self.expires = time.time() + float(j.get("expires_in", 3600))

    def sign_in(self, email, password):
        self.email, self.password = email, password
        self._store(self._call("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": password}, auth=False))

    def _ensure_token(self):
        if time.time() < self.expires - 60:
            return
        try:
            if not self.refresh_token:
                raise RuntimeError("no refresh token")
            self._store(self._call("POST", "/auth/v1/token?grant_type=refresh_token", {"refresh_token": self.refresh_token}, auth=False))
        except RuntimeError:
            self.sign_in(self.email, self.password)

    def rpc(self, fn, args):
        self._ensure_token()
        return self._call("POST", "/rest/v1/rpc/" + fn, args, {"Content-Profile": self.schema})

    def find_events(self, name):
        self._ensure_token()
        q = urllib.parse.urlencode({"select": "id,event_name,start_date", "event_name": "ilike.*" + name + "*",
                                    "order": "start_date.desc", "limit": "5"})
        return self._call("GET", "/rest/v1/events?" + q, headers={"Accept-Profile": self.schema}) or []


# ---------------------------------------------------------------- the bridge
class Bridge:
    def __init__(self, cfg, rpc, log=say, connect=None, now=time.time):
        self.cfg, self.rpc, self.log, self.now = cfg, rpc, log, now
        self.connect = connect or (lambda host, port: socket.create_connection((host, int(port)), timeout=10))
        self.state = FeedState()
        self.lock = threading.Lock()
        self.quiet_s = float(cfg.get("liveTimeoutMinutes", 5)) * 60
        self.push_every = float(cfg.get("pushEverySeconds", 2))
        self.raw_log = os.path.join(HERE, "feed-raw.log") if cfg.get("saveRaw") else None
        self.last_status = 0.0
        self.status_failed = False
        self.last_change = now()
        self.ended = False
        self.last_sent = self.last_push = 0.0
        self.last_hash = ""
        self.last_race = None
        self.stop_flag = threading.Event()
        self.sock = None
        self.bytes = 0

    def _err(self, e):
        return str(e)

    def maybe_push(self, force=False):
        with self.lock:
            if not self.state.dirty and not force:
                return
            if not force and self.now() - self.last_push < self.push_every:
                return
            snap = self.state.snapshot()
            if snap["race"] is None or not snap["rows"]:
                self.state.dirty = False  # never wipe results with an empty snapshot
                return
            h = str(snap["race"]) + json.dumps(snap["rows"], sort_keys=True)
            self.state.dirty = False
        if h != self.last_hash:
            self.last_change, self.ended = self.now(), False
        if self.ended:
            return
        if h == self.last_hash and self.now() - self.last_sent < 20:
            return  # identical data is re-sent every 20 s so the 'live' flag stays fresh
        self.last_push = self.now()
        try:
            self.rpc("live_update_race", {"p_event": self.cfg["eventId"], "p_race_number": snap["race"], "p_rows": snap["rows"]})
            self.last_hash, self.last_sent = h, self.now()
            if snap["race"] != self.last_race:
                self.log(f"Race {snap['race']}: sending results ({len(snap['rows'])} riders)")
                self.last_race = snap["race"]
            else:
                self.log(f"{datetime.now():%H:%M:%S}  race {snap['race']}  {len(snap['rows'])} riders  {snap.get('flag') or ''}")
        except Exception as e:
            with self.lock:
                self.state.dirty = True  # try again next tick
            self.log("Could not send results (will retry): " + self._err(e))

    def send_status(self):
        """The feed's clock (time to go, flag) every 5 s, for the enduro display's time remaining."""
        with self.lock:
            s = self.state
            if not s.has_clock or s.race is None or self.now() - self.last_status < 5:
                return
            args = {"p_event": self.cfg["eventId"], "p_race_number": s.race, "p_flag": s.flag,
                    "p_time_to_go": s.time_to_go, "p_race_time": s.race_time, "p_laps_to_go": s.laps_to_go}
        self.last_status = self.now()
        try:
            self.rpc("live_status_update", args)
            self.status_failed = False
        except Exception as e:
            if not self.status_failed:
                self.log("Could not send the race clock (run 008_enduro_display.sql?): " + self._err(e))
            self.status_failed = True

    def tick(self):
        self.send_status()
        # No lap crossings for a while = nothing is being timed: tell the app the race is no longer live.
        quiet = self.last_sent > 0 and self.now() - self.last_change > self.quiet_s
        if quiet and not self.ended:
            try:
                self.rpc("live_end", {"p_event": self.cfg["eventId"]})
                self.log(f"No timing activity for {self.quiet_s / 60:g} min - race marked as no longer live.")
            except Exception as e:
                self.log("Could not mark race as ended: " + self._err(e))
            self.ended = True
            return
        self.maybe_push(not self.ended and self.last_sent > 0 and self.now() - self.last_sent >= 20)

    def _reader(self):
        while not self.stop_flag.is_set():
            self.log(f"Connecting to feed {self.cfg['feedHost']}:{self.cfg['feedPort']} ...")
            try:
                self.sock = self.connect(self.cfg["feedHost"], self.cfg["feedPort"])
                self.sock.settimeout(1.0)
                self.log("Connected to feed.")
                while not self.stop_flag.is_set():
                    try:
                        d = self.sock.recv(65536)
                    except socket.timeout:
                        continue
                    if not d:
                        break
                    self.bytes += len(d)
                    if self.raw_log:
                        with open(self.raw_log, "ab") as fh:
                            fh.write(d)
                    with self.lock:
                        self.state.push(d)
                        while self.state.changes:
                            self.log("Feed started a new session: " + self.state.changes.pop(0))
            except OSError as e:
                self.log("Feed error: " + str(e))
            finally:
                try:
                    if self.sock:
                        self.sock.close()
                except OSError:
                    pass
            if self.stop_flag.is_set():
                return
            self.log("Feed closed - reconnecting in 3 s")
            self.stop_flag.wait(3)

    def start(self):
        self.reader = threading.Thread(target=self._reader, daemon=True)
        self.reader.start()

    def run_forever(self):
        self.start()
        while not self.stop_flag.is_set():
            try:
                self.tick()
            except Exception as e:  # never let one bad tick stop the bridge
                self.log("Unexpected error (carrying on): " + str(e))
            self.stop_flag.wait(1)

    def stop(self):
        self.stop_flag.set()
        try:
            if self.sock:
                self.sock.close()
        except OSError:
            pass


# ---------------------------------------------------------------- first-run set-up and main
def ask(prompt, default="", secret=False):
    shown = f" [{default}]" if default else ""
    v = (getpass.getpass if secret else input)(f"{prompt}{shown}: ").strip()
    return v or default


def first_run_setup(path):
    say("No config.json yet - let's set it up (answers are saved, you only do this once).\n")
    say("Supabase URL and anon key: Supabase > Project Settings > API (use the anon public key).")
    cfg = {
        "supabaseUrl": ask("Supabase project URL (https://xxxx.supabase.co)"),
        "supabaseAnonKey": ask("Supabase anon public key"),
        "email": ask("Your timing login email"),
        "password": ask("Your password (typing is hidden)", secret=True),
        "eventName": ask("Part of the event name (or leave blank and use the event id)"),
        "eventId": "",
        "feedHost": ask("MyLaps feed IP address", "192.168.1.241"),
        "feedPort": int(ask("MyLaps feed port", "50000")),
        "pushEverySeconds": 2,
    }
    if not cfg["eventName"]:
        cfg["eventId"] = ask("Event id")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2)
    say(f"\nSaved to {path}. Edit that file any time to change event or add \"saveRaw\": true.\n")
    return cfg


def main(argv):
    path = os.path.abspath(argv[1]) if len(argv) > 1 else os.path.join(HERE, "config.json")
    cfg = json.load(open(path, encoding="utf-8-sig")) if os.path.exists(path) else first_run_setup(path)
    for k in ("supabaseUrl", "supabaseAnonKey", "email", "password", "feedHost", "feedPort"):
        if not cfg.get(k):
            say(f"config.json is missing \"{k}\". Fix it (or delete config.json to run the set-up again).")
            return 1
    sb = Supabase(cfg["supabaseUrl"], cfg["supabaseAnonKey"])
    try:
        sb.sign_in(cfg["email"], cfg["password"])
    except RuntimeError as e:
        say("Sign-in failed: " + str(e) + "\nCheck the email, password and anon key in config.json.")
        return 1
    say("Signed in as " + cfg["email"])
    if not cfg.get("eventId"):
        try:
            ev = sb.find_events(cfg.get("eventName", ""))
        except RuntimeError as e:
            ev, _ = [], say("Event lookup failed: " + str(e))
        if not ev:
            say("Could not find the event. Put its id in config.json as eventId.")
            return 1
        cfg["eventId"] = ev[0]["id"]
        say(f"Using event \"{ev[0]['event_name']}\" ({cfg['eventId']})")
        if len(ev) > 1:
            say("  (other matches: " + ", ".join(e["event_name"] for e in ev[1:]) + ") - set eventId to be sure")
    bridge = Bridge(cfg, sb.rpc)
    try:
        bridge.run_forever()
    except KeyboardInterrupt:
        bridge.stop()
        say("Stopped.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
