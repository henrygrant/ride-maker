import { useEffect, useState, type ChangeEvent } from "react";
import { css, html } from "react-strict-dom";
import { Button } from "@ride-maker/ui";
import { tokens } from "../../../packages/ui/src/tokens.css";
import { pocketBase } from "./backend";

const styles = css.create({
  panel: { backgroundColor: tokens.surface, borderBottomColor: tokens.border, borderBottomStyle: "solid", borderBottomWidth: 1, display: "flex", flexDirection: "column", gap: 10, paddingBlock: 16, paddingInline: 20, zIndex: 2 },
  title: { fontSize: 17, margin: 0 },
  copy: { color: tokens.muted, fontSize: 13, margin: 0 },
  row: { display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 8 },
  input: { backgroundColor: tokens.surface, borderColor: tokens.border, borderRadius: 8, borderStyle: "solid", borderWidth: 1, color: tokens.ink, fontFamily: tokens.font, fontSize: 14, minHeight: 40, paddingInline: 10 },
  error: { color: "#b42318", fontSize: 13, margin: 0 },
});

export function AuthPanel({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [providers, setProviders] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void pocketBase.collection("users").listAuthMethods()
      .then((methods) => setProviders(methods.oauth2?.providers.map((provider) => provider.name) ?? []))
      .catch(() => setError("Could not load sign-in methods."));
  }, []);

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    void action().then(() => onClose()).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Sign-in failed.");
    }).finally(() => setBusy(false));
  };

  const createAccount = () => {
    run(async () => {
      await pocketBase.collection("users").create({ email: email.trim(), password, passwordConfirm: password });
      await pocketBase.collection("users").authWithPassword(email.trim(), password);
    });
  };

  return (
    <html.section aria-label="Sign in" style={styles.panel}>
      <html.h2 style={styles.title}>Sign in to save your route</html.h2>
      <html.p style={styles.copy}>Your draft stays here. Anyone with the finished route link can view it.</html.p>
      <html.div style={styles.row}>
        {(["google", "apple"] as const).map((provider) => providers.includes(provider) ? (
          <Button key={provider} disabled={busy} onClick={() => run(() => pocketBase.collection("users").authWithOAuth2({ provider }))} variant="quiet">
            Continue with {provider === "google" ? "Google" : "Apple"}
          </Button>
        ) : null)}
      </html.div>
      {providers.length === 0 ? <html.p style={styles.copy}>Google and Apple sign-in will appear here once configured in PocketBase.</html.p> : null}
      <html.div style={styles.row}>
          <html.input aria-label="Email" autoComplete="email" onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.currentTarget.value)} placeholder="Email" required style={styles.input} type="email" value={email} />
          <html.input aria-label="Password" autoComplete="current-password" onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.currentTarget.value)} placeholder="Password" required style={styles.input} type="password" value={password} />
          <Button disabled={busy || !email || !password} onClick={() => run(() => pocketBase.collection("users").authWithPassword(email.trim(), password))}>Sign in</Button>
          <Button disabled={busy || !email || password.length < 8} onClick={createAccount} variant="quiet">Create account</Button>
          <Button onClick={onClose} variant="quiet">Cancel</Button>
      </html.div>
      {error === null ? null : <html.p role="alert" style={styles.error}>{error}</html.p>}
    </html.section>
  );
}
