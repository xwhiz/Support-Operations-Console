import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-cookie";
import { AppShell } from "@/components/AppShell";
import { Providers } from "@/components/Providers";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login?next=/portal");

  return (
    <AppShell session={session} area="Customer Portal">
      <Providers>{children}</Providers>
    </AppShell>
  );
}
