"""Parser for the MyLaps / Orbits scoreboard feed (TCP, lines ending CRLF, comma separated, quoted text).

Record types:
  $B,<session id>,"Race 27"                         session name
  $C,<class id>,"100cc to 125cc 13-U17 Yrs A Grade" classes in the session
  $A,"<reg>","<no>",<transponder>,"FIRST","LAST","STATE",<class id>   competitor
  $G,<pos>,"<no>",<laps>,"<total time>"             race order
  $H,<pos>,"<no>",<best lap no>,"<best lap time>"   ordered by best lap
  $SP,<pos>,"<no>",<best lap no>,"<best time>",<speed x1000>
  $F,<laps to go>,"<time to go>","<time of day>","<race time>","<flag>"   heartbeat every second
Each record type is sent as a block (all riders); a new block replaces the previous one.
"""
import math
import re

_TIME = re.compile(r"^(\d+):(\d+):(\d+(?:\.\d+)?)$")


def split_line(line):
    out, cur, q, i = [], "", False, 0
    while i < len(line):
        c = line[i]
        if q:
            if c == '"':
                if i + 1 < len(line) and line[i + 1] == '"':
                    cur += '"'
                    i += 1
                else:
                    q = False
            else:
                cur += c
        elif c == '"':
            q = True
        elif c == ",":
            out.append(cur)
            cur = ""
        else:
            cur += c
        i += 1
    out.append(cur)
    return out


def clean_time(t):
    """'00:15:43.383' -> '15:43.383'; '00:02:10.668' -> '2:10.668'; '01:02:03.456' -> '1:02:03.456'"""
    m = _TIME.match((t or "").strip())
    if not m:
        return ""
    h, mi, s = int(m.group(1)), int(m.group(2)), m.group(3)
    sec = s.rjust(6 if "." in s else 2, "0")
    return f"{h}:{mi:02d}:{sec}" if h > 0 else f"{mi}:{sec}"


def time_ms(t):
    m = _TIME.match((t or "").strip())
    if not m:
        return None
    return int(math.floor(((int(m.group(1)) * 60 + int(m.group(2))) * 60 + float(m.group(3))) * 1000 + 0.5))


def fmt_gap(ms):
    s = ms / 1000
    if s >= 60:
        m = int(s // 60)
        return f"{m}:{s - m * 60:06.3f}"
    return f"{s:.3f}"


def split_class_grade(cls):
    """'100cc to 125cc 13-U17 Yrs A Grade' -> ('100cc to 125cc 13-U17 Yrs', 'A') (same rule as the CSV import)"""
    cls = str(cls).strip()
    m = re.match(r"^(.*?)\s+([A-Za-z])\s+Grade$", cls, re.I)
    return (m.group(1).strip(), m.group(2).upper()) if m else (cls, None)


def _f(f, i):
    return f[i] if i < len(f) else ""


def _num(s):
    try:
        return int(s) if re.fullmatch(r"-?\d+", s.strip()) else float(s)
    except (ValueError, AttributeError):
        return None


class FeedState:
    def __init__(self):
        self.buf = ""
        self.reset()

    def reset(self):
        # Every entry is stamped with the "dump" it arrived in, so when a new session ($B id) starts the old
        # race's riders can be dropped whether $B arrives before or after that race's $G/$H blocks.
        self.G, self.H, self.SP, self.A, self.C = {}, {}, {}, {}, {}
        self.race = None
        self.race_name = ""
        self.session = None
        self.flag = ""
        self.race_time = ""
        self.time_to_go = ""
        self.time_of_day = ""
        self.laps_to_go = None
        self.has_clock = False
        self.last_type = ""
        self.dump = 0
        self.dirty = False
        self.version = 0
        self.changes = []

    def push(self, chunk):
        """Feed raw bytes/text from the socket; complete lines are parsed, partial ones kept for next time."""
        self.buf += chunk if isinstance(chunk, str) else chunk.decode("latin1")
        while True:
            i = self.buf.find("\n")
            if i < 0:
                break
            line = self.buf[:i].rstrip("\r")
            self.buf = self.buf[i + 1:]
            if line.strip():
                self.line(line)

    def _drop(self, m):
        for k in [k for k, v in m.items() if v["dump"] < self.dump]:
            del m[k]

    def line(self, line):
        if not line or line[0] != "$":
            return
        f = split_line(line)
        typ = f[0][1:]
        if typ == "F":  # heartbeat
            self.laps_to_go = None if _f(f, 1) == "" else _num(_f(f, 1))
            self.time_to_go = _f(f, 2)
            self.time_of_day = _f(f, 3)
            self.race_time = _f(f, 4)
            self.flag = _f(f, 5).strip()
            self.has_clock = True
            self.last_type = "F"
            return
        if typ == "H" and self.last_type != "H":
            self.dump += 1  # a new full update starts with the $H block
        self.last_type = typ

        def st(o):
            o["dump"] = self.dump
            return o

        if typ == "B":
            m = re.search(r"(\d+)", _f(f, 2))
            race = int(m.group(1)) if m else None
            session = _f(f, 1)
            if session != self.session or race != self.race:
                if self.session is not None:
                    self.changes.append(f"session {self.session}->{session} race {self.race}->{race}")
                    for mp in (self.G, self.H, self.SP, self.A, self.C):
                        self._drop(mp)
                self.session, self.race, self.race_name = session, race, _f(f, 2)
        elif typ == "C":
            self.C[_f(f, 1)] = st({"name": _f(f, 2)})
        elif typ == "A":
            self.A[_f(f, 2)] = st({"first": _f(f, 4), "last": _f(f, 5), "state": _f(f, 6), "class_id": _f(f, 7)})
        elif typ == "G":
            self.G[_f(f, 1)] = st({"no": _f(f, 2), "laps": 0 if _f(f, 3) == "" else (_num(_f(f, 3)) or 0), "time": _f(f, 4)})
        elif typ == "H":
            self.H[_f(f, 2)] = st({"lap_no": None if _f(f, 3) == "" else _num(_f(f, 3)), "time": _f(f, 4)})
        elif typ == "SP":
            v = _num(_f(f, 5)) if _f(f, 5) != "" else None
            self.SP[_f(f, 2)] = st({"v": None if v is None else v / 1000})
        else:
            return  # $SR, $COMP, $E ... not needed
        self.dirty = True
        self.version += 1

    def snapshot(self):
        """Current standings in the shape aptiming.live_update_race expects (same fields as the CSV import)."""
        warnings = []
        if self.race is None:
            return {"race": None, "rows": [], "warnings": ["no race number yet"]}
        riders = [v for _, v in sorted(self.G.items(), key=lambda kv: _num(kv[0]) or 0)
                  if v["laps"] > 0 and v["time"] and time_ms(v["time"]) is not None]
        rows, by_base, by_grade = [], {}, {}
        for g in riders:
            a = self.A.get(g["no"])
            raw = self.C.get(a["class_id"]) if a else None
            if not a or raw is None:
                warnings.append(f"rider {g['no']}: no name/class in feed yet")
                continue
            base, grade = split_class_grade(raw["name"])
            pos = by_base.get(base, 0) + 1
            by_base[base] = pos
            gk = base + "|" + (grade or "")
            pic = by_grade.get(gk, 0) + 1
            by_grade[gk] = pic
            h = self.H.get(g["no"])
            best_ms = time_ms(h["time"]) if h else None
            has_best = bool(h and h["time"] and best_ms is not None and best_ms > 0)
            rows.append({
                "pos": pos, "pic": pic, "raceNo": g["no"], "name": f"{a['first']} {a['last']}".strip(),
                "baseClass": base, "grade": grade, "laps": g["laps"],
                "totalTimeText": clean_time(g["time"]), "totalTimeMs": time_ms(g["time"]),
                "bestLapText": clean_time(h["time"]) if has_best else "",
                "bestLapMs": best_ms if has_best else None,
                "bestLapOn": h["lap_no"] if h else None,
                "bestSpeed": (self.SP.get(g["no"]) or {}).get("v") or None,
                "status": "finished", "_lapsMs": time_ms(g["time"]),
            })
        lead, prev = {}, {}
        for r in rows:
            L, P = lead.get(r["baseClass"]), prev.get(r["baseClass"])

            def delta(o):
                if o["laps"] == r["laps"]:
                    return fmt_gap(r["_lapsMs"] - o["_lapsMs"])
                d = o["laps"] - r["laps"]
                return f"{d} Lap{'s' if d > 1 else ''}"

            r["gapText"] = delta(L) if L else ""
            r["diffText"] = delta(P) if P else ""
            if not L:
                lead[r["baseClass"]] = r
            prev[r["baseClass"]] = r
        for r in rows:
            del r["_lapsMs"]
        return {"race": self.race, "flag": self.flag, "rows": rows, "warnings": warnings}
