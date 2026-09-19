import { AdminPanel } from "@/components/admin/admin-panel";
import { CustodialAdmin } from "@/components/admin/custodial-admin";
import { isCustodial } from "@/lib/solana/cluster";

export const metadata = { title: "Admin" };

/** Program governance: initialise the config, allowlist basket mints, adjust policy. Read-only for anyone but the admin. */
export default function AdminPage() {
  return isCustodial ? <CustodialAdmin /> : <AdminPanel />;
}
