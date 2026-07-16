"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const QUICK_ACCOUNTS = [
  { label: "Alice (customer)", email: "alice@example.com" },
  { label: "Bob (customer)", email: "bob@example.com" },
  { label: "Rae (reviewer)", email: "rae@support.example.com" },
  { label: "Sam (reviewer)", email: "sam@support.example.com" },
];

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(emailValue: string, passwordValue: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: emailValue, password: passwordValue }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data?.error === "invalid_credentials"
            ? "Incorrect email or password."
            : "Login failed.",
        );
        return;
      }
      router.replace(next || data.home || "/");
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(email, password);
        }}
        className="space-y-4"
      >
        <div className="space-y-1">
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-200">
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            required
          />
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-200">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-neutral-500">
          Demo accounts (password: password123)
        </p>
        <div className="grid grid-cols-2 gap-2">
          {QUICK_ACCOUNTS.map((a) => (
            <button
              key={a.email}
              onClick={() => {
                setEmail(a.email);
                setPassword("password123");
                void submit(a.email, "password123");
              }}
              disabled={loading}
              className="rounded-md border border-neutral-300 px-2 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
