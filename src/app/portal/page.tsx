import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-cookie";
import { AppHeader } from "@/components/AppHeader";

export default async function PortalPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/portal");

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <AppHeader session={session} area="Customer Portal" />
      <main className="mx-auto max-w-3xl p-6">
        <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
          Customer portal — submit a support request and track its outcome.
          <br />
          Coming in V6.
        </div>
      </main>
    </div>
  );
}
