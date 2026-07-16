import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-cookie";
import { homeForRole } from "@/lib/rbac";
import { LoginForm } from "@/components/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await getSession();
  if (session) redirect(homeForRole(session.role));

  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-6 dark:bg-neutral-950">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-50">
          Support Operations Console
        </h1>
        <p className="mb-6 text-sm text-neutral-500">Sign in to continue.</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
