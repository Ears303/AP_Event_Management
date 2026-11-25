"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "../../../lib/supabase";
import { NewEventCard, ScheduleCard } from "../EventSetup";
import { page, card, h2, input, button, NAVY } from "../ui";
import type { EventRow, Message } from "../ui";

// Event set-up: 1) create the event  2) download the schedule template, fill it in, upload it.
export default function EventSetup() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventId, setEventId] = useState("");
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase.from("events").select("id,event_name,start_date,status").order("start_date", { ascending: false }).limit(50)
      .then(({ data, error }) => {
        if (error) { setMessage({ type: "error", text: "Could not load events: " + error.message }); return; }
        const rows = (Array.isArray(data) ? data : []) as EventRow[];
        setEvents(rows);
        setEventId((cur) => cur || rows[0]?.id || "");
      });
  }, [session]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
  }

  if (!supabaseConfigured) return <div style={page}><div style={card}>Supabase settings are missing (see /manager).</div></div>;
  if (!ready) return <div style={page}>Loading…</div>;
  if (!session) {
    return (
      <div style={page}>
        <form onSubmit={(e) => void signIn(e)} style={{ ...card, maxWidth: 380 }}>
          <h2 style={h2}>Timing team sign in</h2>
          <div style={{ display: "grid", gap: 10 }}>
            <input style={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input style={input} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button style={button} type="submit">Sign in</button>
            {authError && <div style={{ color: "#b91c1c" }}>{authError}</div>}
          </div>
        </form>
      </div>
    );
  }

  const ev = events.find((e) => e.id === eventId);
  return (
    <div style={page}>
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 22, color: NAVY }}>Event set-up</h1>
        <a href="/manager" style={{ color: "#0b5fff", fontWeight: 600 }}>Go to results import &rarr;</a>
      </div>

      {message && (
        <div style={{ ...card, background: message.type === "ok" ? "#f0fdf4" : "#fef2f2", borderColor: message.type === "ok" ? "#86efac" : "#fca5a5" }}>{message.text}</div>
      )}

      <h2 style={{ ...h2, maxWidth: 1100 }}>Step 1 - Event</h2>
      <NewEventCard onCreated={(e) => { setEvents((cur) => [e, ...cur]); setEventId(e.id); }} setMessage={setMessage} />
      {events.length > 0 && (
        <div style={card}>
          <label>Event to set up<br />
            <select style={input} value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Event">
              {events.map((e) => <option key={e.id} value={e.id}>{e.event_name}{e.start_date ? ` (${e.start_date})` : ""} - {e.status}</option>)}
            </select>
          </label>
        </div>
      )}

      <h2 style={{ ...h2, maxWidth: 1100 }}>Step 2 - Race schedule{ev ? ` for ${ev.event_name}` : ""}</h2>
      <div style={card}>
        <a href="/AP_Timing_Schedule_Template.xlsx" download style={{ ...button, textDecoration: "none", display: "inline-block" }}>Download schedule template (.xlsx)</a>
        <span style={{ color: "#64748b", fontSize: 14, marginLeft: 12 }}>Fill it in (or paste your own schedule into it), save it, then upload it below.</span>
      </div>
      <ScheduleCard eventId={eventId} eventDate={ev?.start_date ?? null} setMessage={setMessage} />
    </div>
  );
}
