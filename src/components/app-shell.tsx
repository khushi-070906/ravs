import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  Clock3,
  FlaskConical,
  LayoutGrid,
  LogOut,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { NotificationsBell } from "@/components/notifications-bell";

type NavItem = { to: string; label: string; icon: LucideIcon };

const ROLE_LABEL: Record<string, string> = {
  student: "Student",
  faculty: "Faculty",
  admin: "Admin",
};

export function AppShell({ children }: { children: ReactNode }) {
  const { role, profile, user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isStaff = role === "faculty" || role === "admin";

  const items: NavItem[] = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutGrid },
    { to: "/projects", label: "Events", icon: CalendarDays },
    { to: "/calendar", label: "Calendar", icon: CalendarRange },
    ...(isStaff ? [{ to: "/approvals", label: "Review", icon: ClipboardCheck }] : []),
    { to: "/attendance", label: "Attendance", icon: Clock3 },
    { to: "/profile", label: "Profile", icon: UserRound },
    ...(role === "admin" ? [{ to: "/admin", label: "Admin", icon: Building2 }] : []),
  ];
  // Mobile tab bar has room for five.
  const mobileItems = items.filter((i) => i.to !== "/profile" && i.to !== "/admin").slice(0, 5);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const displayName = profile?.full_name || user?.email || "";
  const initials = (displayName || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  return (
    <div className="min-h-screen bg-background lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <Link to="/dashboard" className="flex h-16 items-center gap-2.5 px-6">
          <span className="flex size-8 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground">
            <FlaskConical className="size-4" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">RAVS</span>
        </Link>

        <nav className="mt-4 flex flex-1 flex-col gap-0.5 px-3" aria-label="Main">
          {items.map((item) => {
            const active = isActive(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  active &&
                    "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent",
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3">
            <Avatar className="size-9">
              <AvatarFallback className="bg-sidebar-accent text-xs text-sidebar-accent-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="text-xs text-sidebar-foreground/60">
                {role ? ROLE_LABEL[role] : "Loading…"}
              </p>
            </div>
            <NotificationsBell tone="dark" />
            <button
              onClick={signOut}
              aria-label="Sign out"
              className="rounded-md p-2 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur lg:hidden">
        <Link to="/dashboard" className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <FlaskConical className="size-3.5" />
          </span>
          <span className="font-display text-base font-semibold">RAVS</span>
        </Link>
        <span className="ml-auto" />
        <NotificationsBell />
        <Link
          to="/profile"
          aria-label="Profile"
          className="rounded-md p-2 text-muted-foreground hover:bg-secondary"
        >
          <UserRound className="size-4" />
        </Link>
        {role === "admin" && (
          <Link
            to="/admin"
            aria-label="Admin"
            className="rounded-md p-2 text-muted-foreground hover:bg-secondary"
          >
            <Building2 className="size-4" />
          </Link>
        )}
        <span className="hidden rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
          {role ? ROLE_LABEL[role] : "…"}
        </span>
        <button
          onClick={signOut}
          aria-label="Sign out"
          className="rounded-md p-2 text-muted-foreground hover:bg-secondary"
        >
          <LogOut className="size-4" />
        </button>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">
        {children}
      </main>

      {/* Mobile bottom tabs */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {mobileItems.map((item) => {
          const active = isActive(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] text-muted-foreground",
                active && "font-medium text-foreground",
              )}
            >
              <item.icon className={cn("size-5", active && "text-accent")} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
