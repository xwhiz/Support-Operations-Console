import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-cookie";
import { AppShell } from "@/components/AppShell";
import { Providers } from "@/components/Providers";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login?next=/console");

  return (
    <AppShell session={session} area="Reviewer Console">
      <Providers>{children}</Providers>
    </AppShell>
  );
}
