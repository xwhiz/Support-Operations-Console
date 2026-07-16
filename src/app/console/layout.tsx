import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-cookie";
import { AppHeader } from "@/components/AppHeader";
import { Providers } from "@/components/Providers";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login?next=/console");

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <AppHeader session={session} area="Reviewer Console" />
      <Providers>{children}</Providers>
    </div>
  );
}
