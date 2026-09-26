import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GraduationCap, BookOpen, ShieldCheck, FlaskConical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, type AppRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The server didn't respond in time. Please try again.")),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — RAVS" },
      { name: "description", content: "Sign in or create your RAVS research attendance account." },
      { property: "og:title", content: "Sign in — RAVS" },
      { property: "og:description", content: "Access your research attendance dashboard." },
    ],
  }),
  component: AuthPage,
});

const ROLE_INFO: Record<
  AppRole,
  { title: string; subtitle: string; idLabel: string; idPlaceholder: string }
> = {
  student: {
    title: "Student Portal",
    subtitle: "Log verified research hours & track your attendance records",
    idLabel: "College / Roll Number",
    idPlaceholder: "e.g. 2024CS102",
  },
  faculty: {
    title: "Faculty Portal",
    subtitle: "Review and approve student research sessions across events",
    idLabel: "Faculty / Employee ID",
    idPlaceholder: "e.g. FAC-8091",
  },
  admin: {
    title: "Admin Portal",
    subtitle: "Institutional oversight, event management & records access",
    idLabel: "Administrator / Staff ID",
    idPlaceholder: "e.g. ADM-0012",
  },
};

async function fetchDbRole(userId: string): Promise<AppRole> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  return ((data?.role as AppRole) ?? "student") as AppRole;
}

const cap = (r: string) => r.charAt(0).toUpperCase() + r.slice(1);

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading, refreshProfile } = useAuth();
  const [selectedRole, setSelectedRole] = useState<AppRole>("student");
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [collegeId, setCollegeId] = useState("");

  useEffect(() => {
    if (!loading && session && !busy) navigate({ to: "/dashboard", replace: true });
  }, [loading, session, busy, navigate]);

  // The portal picked on screen must match the role stored in the database.
  // If it doesn't, sign straight back out so a faculty/admin account can't be
  // used through the Student portal (and vice versa).
  async function enforcePortal(userId: string): Promise<boolean> {
    const dbRole = await fetchDbRole(userId);
    if (dbRole !== selectedRole) {
      await supabase.auth.signOut();
      toast.error(
        `This account is registered as ${cap(dbRole)}. Select the ${cap(dbRole)} portal to sign in.`,
      );
      return false;
    }
    return true;
  }

  const activeRole = ROLE_INFO[selectedRole];

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({ email: email.trim(), password }),
        15000,
      );
      if (error) return toast.error(error.message);
      if (!data.user || !(await enforcePortal(data.user.id))) return;
      await refreshProfile();
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  async function signUp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const cleanEmail = email.trim();
      const cleanName = fullName.trim();
      const cleanId = collegeId.trim();

      const { data, error } = await withTimeout(
        supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              full_name: cleanName,
              college_id: cleanId,
              college: cleanId,
              // Informational only — the database ignores this and assigns
              // faculty/admin solely via allowlist or admin promotion.
              requested_role: selectedRole,
            },
          },
        }),
        15000,
      );

      if (error) {
        setBusy(false);
        const errMsg = error.message.toLowerCase();
        // Only treat this as "account already exists" when Supabase actually
        // says so — matching on bare HTTP status (400/422/429) was catching
        // *every* signup error (weak password, invalid email, etc.) and
        // misreporting it as "already registered".
        const isUserExists =
          error.code === "user_already_exists" ||
          errMsg.includes("already registered") ||
          errMsg.includes("already exists");

        if (isUserExists) {
          setBusy(true); // keep the auto-redirect off until the portal is verified
          const { data: siData, error: signInErr } = await withTimeout(
            supabase.auth.signInWithPassword({ email: cleanEmail, password }),
            15000,
          );
          if (!signInErr && siData.user) {
            const ok = await enforcePortal(siData.user.id);
            setBusy(false);
            if (!ok) return;
            await refreshProfile();
            toast.success("Account already exists — signed in!");
            return navigate({ to: "/dashboard", replace: true });
          }
          setBusy(false);
          if (signInErr?.message.toLowerCase().includes("invalid login credentials")) {
            return toast.error(
              "An account with this email already exists. Please sign in with your password.",
            );
          }
          return toast.error(signInErr?.message || error.message);
        }
        return toast.error(error.message);
      }

      if (!data.session && data.user) {
        const { data: siData, error: signInErr } = await withTimeout(
          supabase.auth.signInWithPassword({ email: cleanEmail, password }),
          15000,
        );
        if (!signInErr && siData.user) {
          const dbRole = await fetchDbRole(siData.user.id);
          setBusy(false);
          await refreshProfile();
          announceCreated(dbRole);
          return navigate({ to: "/dashboard", replace: true });
        }
        setBusy(false);
        toast.info("Account created! Please check your email to confirm or sign in.");
        return;
      }

      const dbRole = data.user ? await fetchDbRole(data.user.id) : "student";
      setBusy(false);
      await refreshProfile();
      announceCreated(dbRole);
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      setBusy(false);
      toast.error(err instanceof Error ? err.message : "Sign up failed");
    }
  }

  function announceCreated(dbRole: AppRole) {
    if (dbRole === selectedRole) {
      toast.success(`Account created as ${cap(dbRole)} — signed in!`);
    } else {
      toast.info(
        `Account created as ${cap(dbRole)}. ${cap(selectedRole)} access has to be granted by an administrator.`,
      );
    }
  }

  function prefillDemo(role: AppRole) {
    setSelectedRole(role);
    setEmail(`${role}@ravs.edu`);
    setPassword("password123");
    setFullName(`${role.charAt(0).toUpperCase() + role.slice(1)} User`);
    setCollegeId(role === "student" ? "STU-2026" : role === "faculty" ? "FAC-4001" : "ADM-1001");
    toast.info(`Prefilled credentials for ${role}`);
  }

  const roles: { key: AppRole; label: string; icon: typeof GraduationCap }[] = [
    { key: "student", label: "Student", icon: GraduationCap },
    { key: "faculty", label: "Faculty", icon: BookOpen },
    { key: "admin", label: "Admin", icon: ShieldCheck },
  ];

  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Brand panel */}
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <FlaskConical className="size-4" />
          </span>
          <span className="font-display text-xl font-semibold">RAVS</span>
        </div>

        <div className="max-w-md">
          <h1 className="font-display text-4xl leading-[1.1] text-sidebar-primary">
            Research hours that faculty can actually verify.
          </h1>
          <ol className="mt-10 space-y-5 text-sm">
            {[
              ["Check in", "Start a session on the event you're working on."],
              ["Check out", "Write what you did. The server records the time."],
              ["Get verified", "Faculty approve the session and it counts toward attendance."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="tnum flex size-7 shrink-0 items-center justify-center rounded-full border border-sidebar-border text-xs">
                  {i + 1}
                </span>
                <span>
                  <span className="block font-medium text-sidebar-primary">{t}</span>
                  <span className="text-sidebar-foreground/70">{d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <p className="text-xs text-sidebar-foreground/50">
          Research Attendance &amp; Verification System
        </p>
      </aside>

      {/* Form */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <FlaskConical className="size-4" />
            </span>
            <span className="font-display text-lg font-semibold">RAVS</span>
          </div>

          <h2 className="font-display text-2xl">{activeRole.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{activeRole.subtitle}</p>

          <div
            role="radiogroup"
            aria-label="Portal"
            className="mt-6 grid grid-cols-3 gap-1 rounded-lg bg-secondary p-1"
          >
            {roles.map((r) => {
              const on = selectedRole === r.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setSelectedRole(r.key)}
                  className={`flex items-center justify-center gap-1.5 rounded-md py-2 text-sm transition-colors ${
                    on
                      ? "bg-card font-medium text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <r.icon className="size-4" />
                  {r.label}
                </button>
              );
            })}
          </div>

          <Tabs defaultValue="signin" className="mt-8">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-6">
              <form onSubmit={signIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder={`${selectedRole}@institution.edu`}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="h-10 w-full" disabled={busy}>
                  {busy ? "Signing in…" : `Sign in as ${cap(selectedRole)}`}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-6">
              <form onSubmit={signUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Full name</Label>
                  <Input
                    id="signup-name"
                    required
                    autoComplete="name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-id">{activeRole.idLabel}</Label>
                  <Input
                    id="signup-id"
                    required
                    placeholder={activeRole.idPlaceholder}
                    value={collegeId}
                    onChange={(e) => setCollegeId(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email">Institutional email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder={`${selectedRole}@institution.edu`}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">At least 6 characters.</p>
                </div>
                {selectedRole !== "student" && (
                  <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                    {cap(selectedRole)} access is granted by an administrator. Until then your
                    account works as a student account.
                  </p>
                )}
                <Button type="submit" className="h-10 w-full" disabled={busy}>
                  {busy ? "Creating account…" : `Create ${selectedRole} account`}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <div className="mt-10 border-t border-border pt-5">
            <p className="text-xs text-muted-foreground">Fill a demo account</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {roles.map((r) => (
                <Button
                  key={r.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => prefillDemo(r.key)}
                >
                  <r.icon className="size-3.5" /> {r.label}
                </Button>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
