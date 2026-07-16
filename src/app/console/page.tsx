import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-cookie";
import { AppHeader } from "@/components/AppHeader";

export default async function ConsolePage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/console");

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <AppHeader session={session} area="Reviewer Console" />
      <main className="mx-auto max-w-5xl p-6">
        <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700">
          Reviewer console — escalation queue and approve / reject workflow.
          <br />
          Coming in V5.
        </div>
      </main>
    </div>
  );
}
