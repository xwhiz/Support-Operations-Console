import { EscalationReview } from "@/components/EscalationReview";

export default async function EscalationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto max-w-4xl p-6">
      <EscalationReview id={id} />
    </main>
  );
}
