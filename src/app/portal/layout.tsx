import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-cookie";
import { AppHeader } from "@/components/AppHeader";
import { Providers } from "@/components/Providers";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login?next=/portal");

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900">
      <AppHeader session={session} area="Customer Portal" />
      <Providers>{children}</Providers>
    </div>
  );
}
