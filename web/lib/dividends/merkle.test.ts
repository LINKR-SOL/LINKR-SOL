import { describe, expect, it } from "vitest";
import { buildTree, hex, leafHash, verifyLeaf } from "./merkle";

const A = "6x2AGwqSWkRMzBMptDQ6eCJLgniPN8g2bf9miPUHYzng";
const B = "6TmtWEqZsUJPQeVGdH1mfgeTz3SzYYtjnJaDaQp1GE5B";
const C = "99n7VGd6132b4UUwhSezLm9xXssdnJFiSPrEKkCuMHPF";

describe("dividend merkle tree", () => {
  it("is deterministic regardless of input order", () => {
    const a = buildTree(1n, [
      { account: A, amounts: [1n, 2n] },
      { account: B, amounts: [3n, 0n] },
      { account: C, amounts: [0n, 5n] },
    ]);
    const b = buildTree(1n, [
      { account: C, amounts: [0n, 5n] },
      { account: A, amounts: [1n, 2n] },
      { account: B, amounts: [3n, 0n] },
    ]);
    expect(a.root).toBe(b.root);
  });

  it("proofs verify and tampered amounts do not", () => {
    const leaves = [
      { account: A, amounts: [600_000n, 300_000n] },
      { account: B, amounts: [400_000n, 200_000n] },
    ];
    const t = buildTree(7n, leaves);
    for (const l of leaves) {
      expect(verifyLeaf(t.root, 7n, l, t.proofs.get(l.account)!)).toBe(true);
      expect(verifyLeaf(t.root, 7n, { ...l, amounts: [l.amounts[0] + 1n, l.amounts[1]] }, t.proofs.get(l.account)!)).toBe(false);
      expect(verifyLeaf(t.root, 8n, l, t.proofs.get(l.account)!)).toBe(false);
    }
  });

  it("single-leaf root equals the leaf hash (matches the on-chain verifier with an empty proof)", () => {
    const t = buildTree(3n, [{ account: A, amounts: [10n, 0n, 5n] }]);
    expect(t.root).toBe(hex(leafHash(3n, A, [10n, 0n, 5n])));
    expect(t.proofs.get(A)).toEqual([]);
  });

  it("handles an odd number of leaves by promoting the last node", () => {
    const leaves = Array.from({ length: 5 }, (_, i) => ({ account: [A, B, C, "So11111111111111111111111111111111111111112", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"][i], amounts: [BigInt(i + 1)] }));
    const t = buildTree(2n, leaves);
    for (const l of leaves) expect(verifyLeaf(t.root, 2n, l, t.proofs.get(l.account)!)).toBe(true);
  });
});
