import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { GraduationCap, BookOpen, ShieldCheck } from "lucide-react";
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
    if (!loading && session) navigate({ to: "/dashboard", replace: true });
  }, [loading, session, navigate]);

  const activeRole = ROLE_INFO[selectedRole];

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
        15000,
      );
      if (error) return toast.error(error.message);
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
              role: selectedRole,
            },
          },
        }),
        15000,
      );

      if (error) {
        setBusy(false);
        const errMsg = error.message.toLowerCase();
        const isUserExists =
          error.status === 400 ||
          error.status === 422 ||
          error.status === 429 ||
          errMsg.includes("already registered") ||
          errMsg.includes("already exists") ||
          errMsg.includes("rate limit") ||
          errMsg.includes("too many");

        if (isUserExists) {
          const { error: signInErr } = await withTimeout(
            supabase.auth.signInWithPassword({ email: cleanEmail, password }),
            15000,
          );
          if (!signInErr) {
            await refreshProfile();
            toast.success("Account already exists — signed in!");
            return navigate({ to: "/dashboard", replace: true });
          }
          if (signInErr.message.toLowerCase().includes("invalid login credentials")) {
            return toast.error(
              "An account with this email already exists. Please sign in with your password.",
            );
          }
          return toast.error(signInErr.message || error.message);
        }
        return toast.error(error.message);
      }

      if (!data.session && data.user) {
        const { error: signInErr } = await withTimeout(
          supabase.auth.signInWithPassword({ email: cleanEmail, password }),
          15000,
        );
        setBusy(false);
        if (!signInErr) {
          await refreshProfile();
          toast.success("Account created — signed in!");
          return navigate({ to: "/dashboard", replace: true });
        }
        toast.info("Account created! Please check your email to confirm or sign in.");
        return;
      }

      setBusy(false);
      await refreshProfile();
      toast.success(`Account created as ${selectedRole} — signed in!`);
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      setBusy(false);
      toast.error(err instanceof Error ? err.message : "Sign up failed");
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">RAVS</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Research Attendance &amp; Verification System
          </p>
        </div>

        {/* Top Role Selector */}
        <div className="rounded-xl border border-border bg-card p-2 shadow-xs">
          <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Select Your Role
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => setSelectedRole("student")}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                selectedRole === "student"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <GraduationCap className="size-4" />
              <span>Student</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedRole("faculty")}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                selectedRole === "faculty"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <BookOpen className="size-4" />
              <span>Faculty</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedRole("admin")}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                selectedRole === "admin"
                  ? "bg-primary text-primary-foreground shadow-xs"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <ShieldCheck className="size-4" />
              <span>Admin</span>
            </button>
          </div>
        </div>

        {/* Main Auth Card */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-6 rounded-lg bg-muted/60 p-3 text-center">
            <h2 className="text-base font-semibold text-foreground">{activeRole.title}</h2>
            <p className="text-xs text-muted-foreground">{activeRole.subtitle}</p>
          </div>

          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            <TabsContent value="signin" className="mt-5">
              <form onSubmit={signIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <Input
                    id="signin-email"
                    type="email"
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
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  Sign in as {selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1)}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup" className="mt-5">
              <form onSubmit={signUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Full name</Label>
                  <Input
                    id="signup-name"
                    required
                    placeholder="Prof. / Dr. / Student Name"
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
                  <Label htmlFor="signup-email">Institutional Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
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
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  Register as {selectedRole.charAt(0).toUpperCase() + selectedRole.slice(1)}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </div>

        {/* Quick Demo Pre-fills */}
        <div className="rounded-lg border border-dashed border-border p-3 text-center">
          <p className="mb-2 text-xs text-muted-foreground">Quick Test Fill Credentials:</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => prefillDemo("student")}
            >
              <GraduationCap className="mr-1 size-3" /> Student
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => prefillDemo("faculty")}
            >
              <BookOpen className="mr-1 size-3" /> Faculty
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => prefillDemo("admin")}
            >
              <ShieldCheck className="mr-1 size-3" /> Admin
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
