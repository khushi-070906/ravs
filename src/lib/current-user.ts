import { isAuthRetryableFetchError, type User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * The signed-in user for route guards. Verifies with the server when online;
 * when the network is down (e.g. the installed app opened offline) it falls
 * back to the locally stored session instead of bouncing the user to sign-in.
 * Anything done offline still fails at the API, so this grants nothing.
 */
export async function currentUser(): Promise<User | null> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    const { data } = await supabase.auth.getSession();
    return data.session?.user ?? null;
  }
  const { data, error } = await supabase.auth.getUser();
  if (error && isAuthRetryableFetchError(error)) {
    const { data: s } = await supabase.auth.getSession();
    return s.session?.user ?? null;
  }
  return error ? null : data.user;
}
