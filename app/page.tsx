import { redirect } from "next/navigation";

/**
 * Root entry point. Forwards into the dashboard, where the Proxy + layout guard
 * either route the user to their workspace or bounce them to `/login`.
 */
export default function Home() {
  redirect("/dashboard");
}
