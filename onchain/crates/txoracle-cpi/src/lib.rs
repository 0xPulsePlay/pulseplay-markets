//! Program-side CPI helper for the TxLINE oracle's `validate_stat` instruction.
//!
//! Lets any Anchor program settle on TxLINE-verified sports data without hand-rolling the Borsh
//! args, discriminator, account metas, or PDA seeds. The Borsh layouts mirror the on-chain program
//! byte-for-byte (reverse-engineered + live-confirmed; see
//! `packages/verify/docs/oracle-wire-formats.md`).
//!
//! Trust model: `cpi_validate_stat` CPIs the oracle and returns the predicate result from the
//! program's **return data** (a 1-byte bool). A malformed/tampered proof makes the oracle revert, so
//! the Err propagates and the caller's whole transaction fails — a bad proof can never settle. The
//! program does NOT revert on a false-but-valid predicate; it returns `false`. So the settlement gate
//! is "the CPI did not revert (proof authentic) AND the returned bool is true (predicate holds)".

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::{get_return_data, invoke};

/// TxLINE oracle program (mainnet).
pub const TXORACLE_MAINNET: Pubkey = pubkey!("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA");
/// TxLINE oracle program (devnet).
pub const TXORACLE_DEVNET: Pubkey = pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");

/// Anchor discriminator for `validate_stat` = `sha256("global:validate_stat")[..8]`.
pub const VALIDATE_STAT_DISCRIMINATOR: [u8; 8] = [107, 197, 232, 90, 191, 136, 105, 185];

/// The Merkle reconstruction is compute-heavy — the caller must raise the limit on the outer tx.
pub const VALIDATE_STAT_COMPUTE_UNITS: u32 = 10_000_000;

/// Seed for the `daily_scores_roots` PDA (the single account `validate_stat` reads).
pub const DAILY_SCORES_ROOTS_SEED: &[u8] = b"daily_scores_roots";

/// One sibling on a Merkle proof path.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}

/// The inner-most leaf: a single provable statistic.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}

/// The fixture summary that anchors on-chain (`ts`/PDA seed must use `update_stats.min_timestamp`).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct FixtureSummary {
    pub fixture_id: i64,
    pub update_stats: UpdateStats,
    pub events_sub_tree_root: [u8; 32],
}

/// Predicate comparison — Borsh serializes as its variant index (matches the on-chain enum).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    EqualTo,
}

/// A numeric predicate over a stat's value.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct Predicate {
    pub threshold: i32,
    pub comparison: Comparison,
}

/// Combine two stats before comparing (for two-stat predicates).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub enum BinaryExpression {
    Add,
    Subtract,
}

/// A stat + the proof that reconstructs the event stat root.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StatTerm {
    pub score_stat: ScoreStat,
    pub event_stat_root: [u8; 32],
    pub stat_proof: Vec<ProofNode>,
}

/// The full `validate_stat` (V1) argument tree — field order is the on-chain Borsh order.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ValidateStatArgs {
    pub ts: i64,
    pub summary: FixtureSummary,
    pub fixture_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub predicate: Predicate,
    pub stat_a: StatTerm,
    pub stat_b: Option<StatTerm>,
    pub op: Option<BinaryExpression>,
}

/// Derive the `daily_scores_roots` PDA for an epochDay (u16 LE seed).
pub fn daily_scores_roots_pda(epoch_day: u16, oracle_program: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[DAILY_SCORES_ROOTS_SEED, &epoch_day.to_le_bytes()], oracle_program)
}

/// Build the `validate_stat` instruction (one read-only `daily_scores_roots` account).
pub fn validate_stat_instruction(
    oracle_program: Pubkey,
    daily_scores_roots: Pubkey,
    args: &ValidateStatArgs,
) -> Instruction {
    let mut data = VALIDATE_STAT_DISCRIMINATOR.to_vec();
    args.serialize(&mut data).expect("borsh serialize validate_stat args");
    Instruction {
        program_id: oracle_program,
        accounts: vec![AccountMeta::new_readonly(daily_scores_roots, false)],
        data,
    }
}

/// CPI `validate_stat` and return the predicate result (the program's 1-byte return-data bool).
///
/// A revert (invalid proof, wrong PDA, timestamp mismatch, …) propagates as `Err`, failing the
/// caller's transaction — so an invalid proof can never settle. `Ok(true)`/`Ok(false)` distinguishes
/// only the *predicate* outcome on a proof the oracle accepted.
pub fn cpi_validate_stat<'info>(
    oracle_program: &AccountInfo<'info>,
    daily_scores_roots: &AccountInfo<'info>,
    args: &ValidateStatArgs,
) -> Result<bool> {
    let ix = validate_stat_instruction(*oracle_program.key, *daily_scores_roots.key, args);
    invoke(&ix, &[daily_scores_roots.clone(), oracle_program.clone()])?;
    read_return_bool(oracle_program.key)
}

fn read_return_bool(oracle: &Pubkey) -> Result<bool> {
    match get_return_data() {
        Some((program_id, data)) if program_id == *oracle => Ok(data.first().copied().unwrap_or(0) == 1),
        _ => Ok(false),
    }
}

// ── V3 (validate_stat_v3): multi-leg proofs, one shared multiproof, one CPI ──────────────────────

/// Anchor discriminator for `validate_stat_v3` = `sha256("global:validate_stat_v3")[..8]`.
pub const VALIDATE_STAT_V3_DISCRIMINATOR: [u8; 8] = [150, 37, 155, 89, 141, 190, 77, 203];

/// A proven stat + its membership path (EMPTY for nonzero legs proven via the multiproof; the 2-node
/// sentinel path for value=0 non-membership / absence legs).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StatEntry {
    pub stat: ScoreStat,
    pub stat_proof: Vec<ProofNode>,
}

/// The V3 shared multiproof: deduplicated sibling hashes + the packed leaf-slot indices of the legs.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Multiproof {
    pub hashes: Vec<ProofNode>,
    pub indices: Vec<u32>,
}

/// `validate_stat_v3` args THROUGH the multiproof (locked byte-exact). The predicate trailer is appended
/// separately as raw bytes — see {@link single_stat_trailer} — because it is not a Borsh Vec.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ValidateStatV3Args {
    pub ts: i64,
    pub summary: FixtureSummary,
    pub sub_tree_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub event_stat_root: [u8; 32],
    pub stats_to_prove: Vec<StatEntry>,
    pub multiproof: Multiproof,
}

/// One discrete predicate of a `Strategy` (docs `examples/onchain-validation`). Indexes are POSITIONS
/// in `statsToProve` (0..N-1), NOT stat-key values. Borsh enum: tag 0 = Single, tag 1 = Binary.
/// (Reuses the V1 {@link Predicate} — `{ threshold: i32, comparison: Comparison }`.)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub enum DiscretePredicate {
    Single { index: u8, predicate: Predicate },
    Binary { index_a: u8, index_b: u8, op: BinaryExpression, predicate: Predicate },
}

/// Encode the predicate trailer — the Anchor `Strategy`: empty `geometricTargets` (u32 len 0), no
/// `distancePredicate` (Option None), then the `discretePredicates` vec. Byte-exact vs live trailers.
/// The oracle requires the strategy to COVER every proven stat (else `IncompleteStatCoverage`).
pub fn strategy_trailer(predicates: &[DiscretePredicate]) -> Vec<u8> {
    let mut t = Vec::new();
    t.extend_from_slice(&0u32.to_le_bytes()); // geometricTargets: Vec len 0
    t.push(0); // distancePredicate: Option None
    t.extend_from_slice(&(predicates.len() as u32).to_le_bytes()); // discretePredicates: Vec len
    for p in predicates {
        p.serialize(&mut t).expect("borsh serialize discrete predicate");
    }
    t
}

/// Build the `validate_stat_v3` instruction (args + a raw predicate `trailer`).
pub fn validate_stat_v3_instruction(
    oracle_program: Pubkey,
    daily_scores_roots: Pubkey,
    args: &ValidateStatV3Args,
    trailer: &[u8],
) -> Instruction {
    let mut data = VALIDATE_STAT_V3_DISCRIMINATOR.to_vec();
    args.serialize(&mut data).expect("borsh serialize validate_stat_v3 args");
    data.extend_from_slice(trailer);
    Instruction {
        program_id: oracle_program,
        accounts: vec![AccountMeta::new_readonly(daily_scores_roots, false)],
        data,
    }
}

/// CPI `validate_stat_v3` — verifies EVERY leg (membership + value=0 absence) in ONE call — and returns
/// the predicate result (the program's 1-byte return-data bool). Same fail-closed guarantee: a bad
/// proof reverts the CPI, so it can never settle.
pub fn cpi_validate_stat_v3<'info>(
    oracle_program: &AccountInfo<'info>,
    daily_scores_roots: &AccountInfo<'info>,
    args: &ValidateStatV3Args,
    trailer: &[u8],
) -> Result<bool> {
    let ix = validate_stat_v3_instruction(*oracle_program.key, *daily_scores_roots.key, args, trailer);
    invoke(&ix, &[daily_scores_roots.clone(), oracle_program.clone()])?;
    read_return_bool(oracle_program.key)
}
