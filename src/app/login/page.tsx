import { redirect } from "next/navigation";
import { Headset } from "lucide-react";
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
    <main className="flex min-h-screen items-center justify-center bg-gray-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-400 text-gray-900 shadow-sm">
            <Headset className="h-6 w-6" strokeWidth={2.2} />
          </span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-gray-900">
            Sign in to SupportOps
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Support Operations Console
          </p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
