//! Merkle leaves and proofs for dividend epochs (the Jito distributor scheme, keccak-based):
//!   leaf = keccak256(0x00 ‖ epoch_id LE ‖ account ‖ n ‖ amounts[i] LE …)
//!   node = keccak256(0x01 ‖ min(a, b) ‖ max(a, b))
//! The TypeScript builder in web/lib/dividends/merkle.ts must produce identical bytes.
use solana_keccak_hasher::hashv;

pub const LEAF_PREFIX: &[u8] = &[0u8];
pub const NODE_PREFIX: &[u8] = &[1u8];

pub fn leaf_hash(epoch_id: u64, account: &[u8; 32], amounts: &[u64]) -> [u8; 32] {
    let epoch = epoch_id.to_le_bytes();
    let n = [amounts.len() as u8];
    let amount_bytes: Vec<u8> = amounts.iter().flat_map(|a| a.to_le_bytes()).collect();
    hashv(&[LEAF_PREFIX, &epoch, account, &n, &amount_bytes]).to_bytes()
}

pub fn verify(proof: &[[u8; 32]], root: &[u8; 32], leaf: [u8; 32]) -> bool {
    let mut node = leaf;
    for sibling in proof {
        node = if node <= *sibling {
            hashv(&[NODE_PREFIX, &node, sibling]).to_bytes()
        } else {
            hashv(&[NODE_PREFIX, sibling, &node]).to_bytes()
        };
    }
    node == *root
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_leaf_tree_root_is_leaf() {
        let leaf = leaf_hash(1, &[7u8; 32], &[10, 0, 5]);
        assert!(verify(&[], &leaf, leaf));
    }

    #[test]
    fn two_leaf_tree() {
        let a = leaf_hash(1, &[1u8; 32], &[1]);
        let b = leaf_hash(1, &[2u8; 32], &[2]);
        let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
        let root = hashv(&[NODE_PREFIX, &lo, &hi]).to_bytes();
        assert!(verify(&[b], &root, a));
        assert!(verify(&[a], &root, b));
        assert!(!verify(&[a], &root, a));
    }
}
