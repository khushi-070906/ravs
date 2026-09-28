import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FlaskConical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "Set a new password — RAVS" }] }),
  component: ResetPassword,
});

type Phase = "checking" | "ready" | "invalid";

function ResetPassword() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("checking");
  const [problem, setProblem] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Supabase puts errors (e.g. an expired link) in the URL hash.
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const err = hash.get("error_description");
    if (err) {
      setProblem(err.replace(/\+/g, " "));
      setPhase("invalid");
      return;
    }

    let settled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (session && !settled)) {
        settled = true;
        setPhase("ready");
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        settled = true;
        setPhase("ready");
      }
    });
    // give the client a moment to consume the recovery token from the URL
    const t = setTimeout(() => {
      if (!settled) setPhase("invalid");
    }, 4000);
    return () => {
      clearTimeout(t);
      sub.subscription.unsubscribe();
    };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return toast.error("Use at least 6 characters");
    if (password !== confirm) return toast.error("The two passwords don't match");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setBusy(false);
      return toast.error(error.message);
    }
    // Sign out so the next sign-in goes through the portal/role check.
    await supabase.auth.signOut();
    setBusy(false);
    toast.success("Password updated. Sign in with your new password.");
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <FlaskConical className="size-4" />
          </span>
          <span className="font-display text-lg font-semibold">RAVS</span>
        </div>

        {phase === "checking" && (
          <p className="text-sm text-muted-foreground">Checking your link…</p>
        )}

        {phase === "invalid" && (
          <div className="space-y-4">
            <h1 className="font-display text-2xl">This link doesn't work</h1>
            <p className="text-sm text-muted-foreground">
              {problem ?? "It may have expired or already been used."} Request a new one from the
              sign-in page.
            </p>
            <Button asChild variant="outline">
              <Link to="/auth">Back to sign in</Link>
            </Button>
          </div>
        )}

        {phase === "ready" && (
          <form onSubmit={save} className="space-y-4">
            <h1 className="font-display text-2xl">Set a new password</h1>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            <Button type="submit" className="h-10 w-full" disabled={busy}>
              {busy ? "Saving…" : "Save password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
