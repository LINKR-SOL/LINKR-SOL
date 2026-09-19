"use client";

import { VaultAdmin } from "./vault-admin";

/** Protocol governance for the causa_vault program: initialisation, policy, basket allowlist, two-step admin. */
export function AdminPanel() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-sm text-muted mt-1">Read-only unless your wallet is the program admin.</p>
      </div>
      <VaultAdmin />
    </div>
  );
}
