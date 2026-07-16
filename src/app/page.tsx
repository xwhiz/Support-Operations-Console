import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-cookie";
import { homeForRole } from "@/lib/rbac";

export default async function Home() {
  const session = await getSession();
  redirect(session ? homeForRole(session.role) : "/login");
}
