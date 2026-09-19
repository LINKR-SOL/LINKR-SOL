// Merkle tree for dividend epochs, byte-compatible with programs/causa_vault/src/merkle.rs (Jito distributor scheme):
//   leaf = keccak256(0x00 ‖ epochId LE u64 ‖ account (32) ‖ n (u8) ‖ amounts[i] LE u64 …)
//   node = keccak256(0x01 ‖ min(a, b) ‖ max(a, b))
// Leaves are ordered by account so the same input always yields the same root; an odd node is promoted unchanged.
import { keccak_256 } from "@noble/hashes/sha3.js";
import { PublicKey } from "@solana/web3.js";

export interface TreeLeaf {
  account: string;
  amounts: bigint[];
}

export interface TreeDump {
  epochId: string;
  root: string;
  leaves: { account: string; amounts: string[] }[];
}

export interface BuiltTree {
  root: `0x${string}`;
  /** account -> proof (hex nodes) */
  proofs: Map<string, `0x${string}`[]>;
  /** account -> leaf hash */
  leafHashes: Map<string, `0x${string}`>;
  dump: TreeDump;
}

// DataView rather than Buffer.writeBigUInt64LE so the same code runs under the browser Buffer polyfill.
const u64le = (v: bigint) => {
  const b = Buffer.alloc(8);
  new DataView(b.buffer, b.byteOffset, 8).setBigUint64(0, v, true);
  return b;
};

export const hex = (b: Uint8Array): `0x${string}` => `0x${Buffer.from(b).toString("hex")}`;
export const unhex = (h: string): Buffer => Buffer.from(h.replace(/^0x/, ""), "hex");

export function leafHash(epochId: bigint, account: string, amounts: bigint[]): Uint8Array {
  return keccak_256(
    Buffer.concat([
      Buffer.from([0]),
      u64le(epochId),
      new PublicKey(account).toBuffer(),
      Buffer.from([amounts.length]),
      ...amounts.map(u64le),
    ]),
  );
}

function nodeHash(a: Uint8Array, b: Uint8Array): Uint8Array {
  const [lo, hi] = Buffer.compare(Buffer.from(a), Buffer.from(b)) <= 0 ? [a, b] : [b, a];
  return keccak_256(Buffer.concat([Buffer.from([1]), Buffer.from(lo), Buffer.from(hi)]));
}

export function buildTree(epochId: bigint, input: TreeLeaf[]): BuiltTree {
  if (input.length === 0) throw new Error("merkle: no leaves");
  const leaves = [...input].sort((a, b) => a.account.localeCompare(b.account));
  const levels: Uint8Array[][] = [leaves.map((l) => leafHash(epochId, l.account, l.amounts))];
  while (levels[levels.length - 1].length > 1) {
    const prev = levels[levels.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? nodeHash(prev[i], prev[i + 1]) : prev[i]);
    levels.push(next);
  }
  const root = levels[levels.length - 1][0];
  const proofs = new Map<string, `0x${string}`[]>();
  const leafHashes = new Map<string, `0x${string}`>();
  leaves.forEach((leaf, index) => {
    const proof: `0x${string}`[] = [];
    let i = index;
    for (let lvl = 0; lvl < levels.length - 1; lvl++) {
      const sibling = i ^ 1;
      if (sibling < levels[lvl].length) proof.push(hex(levels[lvl][sibling]));
      i = Math.floor(i / 2);
    }
    proofs.set(leaf.account, proof);
    leafHashes.set(leaf.account, hex(levels[0][index]));
  });
  return {
    root: hex(root),
    proofs,
    leafHashes,
    dump: { epochId: epochId.toString(), root: hex(root), leaves: leaves.map((l) => ({ account: l.account, amounts: l.amounts.map(String) })) },
  };
}

export function verifyLeaf(root: string, epochId: bigint, leaf: TreeLeaf, proof: string[]): boolean {
  let node = leafHash(epochId, leaf.account, leaf.amounts);
  for (const p of proof) node = nodeHash(node, unhex(p));
  return Buffer.from(node).equals(unhex(root));
}
