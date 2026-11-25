"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "../../lib/supabase";
import { page, card, h2, input, button } from "./ui";

// Shows the timing-team sign-in until someone is signed in, then renders the page.
export default function StaffGate({ children }: { children: (session: Session) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

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
  return <>{children(session)}</>;
}
