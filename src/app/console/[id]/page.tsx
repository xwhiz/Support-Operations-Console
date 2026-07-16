import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-cookie";
import { EscalationReview } from "@/components/EscalationReview";

export default async function EscalationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login?next=/console");
  const { id } = await params;
  return <EscalationReview id={id} viewerId={session.sub} />;
}
