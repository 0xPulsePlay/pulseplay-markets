//! pulseplay_escrow — PulsePlay Markets settlement program.
//!
//! One platform, three market categories, settled TRUSTLESSLY on TxLINE-anchored data by CPI into
//! the TxLINE oracle (via the `txoracle-cpi` crate). No admin oracle, no trusted resolver, no dispute
//! window: the on-chain proof IS the resolution.
//!
//!   Outcomes (single-claim)  -> `resolve_outcome`  -> CPI `validate_stat`      (V1, one read-only PDA)
//!   Combos   (same-match)     -> `resolve_ticket`   -> CPI `validate_stat_v3`   (V3 multiproof, 1 CPI)
//!   Batch    (mega / derived) -> `resolve_ticket`   -> CPI `validate_stat_v3`   (V3 multiproof, 1 CPI)
//!
//! A malformed / tampered proof makes the CPI revert, so a bad proof can never settle (fail-closed).
//! The settlement gate is: the CPI did not revert (proof authentic) AND the returned bool is true
//! (predicate holds). Occurrence markets settle BOTH sides cryptographically via the sentinel-zero
//! trick: value 0 is a provable non-membership statement ("no red card" = key==0 EqualTo).
//!
//! Escrow is in native SOL (stand-in for USDC on devnet). SAFETY: local validator + devnet only.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::{get_return_data, invoke};
use anchor_lang::system_program::{transfer, Transfer};
use txoracle_cpi::{
    cpi_validate_stat, cpi_validate_stat_v3, strategy_trailer, BinaryExpression, Comparison,
    DiscretePredicate, FixtureSummary, Multiproof, Predicate, ProofNode, StatEntry, StatTerm,
    ValidateStatArgs, ValidateStatV3Args, TXORACLE_DEVNET, TXORACLE_MAINNET,
};

declare_id!("2YbfXEyo18qDvSFhB67fxzPm73q3PxV4rRCeD29jvGin");

/// Which TxLINE oracle deployment settlement trusts. Default = mainnet (the local validator clones
/// the mainnet program); build with `--features devnet` to pin the devnet oracle instead.
#[cfg(not(feature = "devnet"))]
pub const ORACLE_PROGRAM: Pubkey = TXORACLE_MAINNET;
#[cfg(feature = "devnet")]
pub const ORACLE_PROGRAM: Pubkey = TXORACLE_DEVNET;

/// Market category (product-layer label; the on-chain settlement math is driven by `combine_op`).
pub const KIND_OUTCOME: u8 = 0;
pub const KIND_COMBO: u8 = 1;
pub const KIND_BATCH: u8 = 2;

/// `validate_stat_v2` — the INDEXED multi-leg instruction. Structurally it is `validate_stat_v3` MINUS
/// the shared `multiproof`: each proven stat carries its OWN membership path, and a `Strategy` trailer
/// covers every stat exactly once. ONE CPI settles a same-match combo ticket atomically. The vendored
/// `txoracle-cpi` crate ships V1 + V3 helpers only, so this is a thin LOCAL adapter (contract-permitted).
/// Wire format locked against the recorded `validate-stat-v2v3` golden fixture (disc d0d7c2d6f147f6b2,
/// offsets: ts · summary · subTreeProof · mainTreeProof · eventStatRoot · statsToProve · trailer).
pub const VALIDATE_STAT_V2_DISCRIMINATOR: [u8; 8] = [208, 215, 194, 214, 241, 71, 246, 178];

/// `validate_stat_v2` args = `validate_stat_v3` args without the `multiproof` field.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ValidateStatV2Args {
    pub ts: i64,
    pub summary: FixtureSummary,
    pub sub_tree_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub event_stat_root: [u8; 32],
    pub stats_to_prove: Vec<StatEntry>,
}

/// CPI `validate_stat_v2` (discriminator + Borsh args + raw `Strategy` trailer) and read the predicate
/// return-data bool. Same fail-closed guarantee as V1/V3: a tampered proof reverts the CPI.
fn cpi_validate_stat_v2<'info>(
    oracle_program: &AccountInfo<'info>,
    daily_scores_roots: &AccountInfo<'info>,
    args: &ValidateStatV2Args,
    trailer: &[u8],
) -> Result<bool> {
    let mut data = VALIDATE_STAT_V2_DISCRIMINATOR.to_vec();
    args.serialize(&mut data).expect("borsh serialize validate_stat_v2 args");
    data.extend_from_slice(trailer);
    let ix = Instruction {
        program_id: *oracle_program.key,
        accounts: vec![AccountMeta::new_readonly(*daily_scores_roots.key, false)],
        data,
    };
    invoke(&ix, &[daily_scores_roots.clone(), oracle_program.clone()])?;
    match get_return_data() {
        Some((pid, d)) if pid == *oracle_program.key => Ok(d.first().copied().unwrap_or(0) == 1),
        _ => Ok(false),
    }
}

#[program]
pub mod pulseplay_escrow {
    use super::*;

    /// Open a market for one fixture.
    /// - `stat_key`/`period`/`threshold`/`comparison` define the leg-0 predicate (the market question).
    /// - `combine_op`: 0 = single-stat / full-coverage; 1 = derived Add(leg0,leg1); 2 = derived Sub(leg0,leg1).
    /// - `market_kind`: product category (Outcome/Combo/Batch) — labels the UI, no on-chain trust weight.
    /// - `cutoff_ts`: betting closes here. `resolve_deadline`: after this, an unresolved market can be
    ///   cancelled permissionlessly so depositors can reclaim their stake (timeout path).
    #[allow(clippy::too_many_arguments)]
    pub fn create_market(
        ctx: Context<CreateMarket>,
        fixture_id: i64,
        stat_key: u32,
        period: i32,
        threshold: i32,
        comparison: u8,
        cutoff_ts: i64,
        resolve_deadline: i64,
        combine_op: u8,
        market_kind: u8,
    ) -> Result<()> {
        require!(comparison <= 2, EscrowError::BadComparison);
        require!(combine_op <= 2, EscrowError::BadComparison);
        require!(market_kind <= 2, EscrowError::BadComparison);
        require!(resolve_deadline >= cutoff_ts, EscrowError::BadDeadline);
        let m = &mut ctx.accounts.market;
        m.authority = ctx.accounts.authority.key();
        m.fixture_id = fixture_id;
        m.stat_key = stat_key;
        m.period = period;
        m.threshold = threshold;
        m.comparison = comparison;
        m.combine_op = combine_op;
        m.market_kind = market_kind;
        m.cutoff_ts = cutoff_ts;
        m.resolve_deadline = resolve_deadline;
        m.resolved = false;
        m.cancelled = false;
        m.outcome = false;
        m.total_yes = 0;
        m.total_no = 0;
        m.bump = ctx.bumps.market;
        m.vault_bump = ctx.bumps.vault;
        Ok(())
    }

    /// Stake `amount` lamports on a side (true = Yes / predicate holds). Closes at `cutoff_ts`.
    pub fn deposit(ctx: Context<Deposit>, side: bool, amount: u64) -> Result<()> {
        let m = &mut ctx.accounts.market;
        require!(!m.resolved, EscrowError::AlreadyResolved);
        require!(!m.cancelled, EscrowError::MarketCancelled);
        require!(Clock::get()?.unix_timestamp < m.cutoff_ts, EscrowError::MarketClosed);
        require!(amount > 0, EscrowError::ZeroAmount);

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.depositor.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;

        let pos = &mut ctx.accounts.position;
        pos.market = m.key();
        pos.owner = ctx.accounts.depositor.key();
        pos.side = side;
        pos.amount = pos.amount.checked_add(amount).ok_or(EscrowError::Overflow)?;
        pos.claimed = false;
        pos.bump = ctx.bumps.position;

        if side {
            m.total_yes = m.total_yes.checked_add(amount).ok_or(EscrowError::Overflow)?;
        } else {
            m.total_no = m.total_no.checked_add(amount).ok_or(EscrowError::Overflow)?;
        }
        Ok(())
    }

    /// OUTCOMES (V1). Permissionless, retriable. CPIs `validate_stat` with the market's fixed
    /// single-stat predicate; the caller supplies only the proof. Reverts (no state change) if the
    /// oracle rejects the proof. Sentinel-zero markets ("no red card") use comparison EqualTo, threshold 0.
    pub fn resolve_outcome(ctx: Context<Resolve>, args: ResolveArgs) -> Result<()> {
        let m = &mut ctx.accounts.market;
        require!(!m.resolved, EscrowError::AlreadyResolved);
        require!(!m.cancelled, EscrowError::MarketCancelled);
        // Bind the proof to THIS market's fixture and stat — else a caller could settle with an
        // unrelated (but validly-anchored) stat.
        require!(args.summary.fixture_id == m.fixture_id, EscrowError::FixtureMismatch);
        require!(
            args.stat_a.score_stat.key == m.stat_key && args.stat_a.score_stat.period == m.period,
            EscrowError::StatMismatch
        );
        let va = ValidateStatArgs {
            ts: args.ts,
            summary: args.summary,
            fixture_proof: args.fixture_proof,
            main_tree_proof: args.main_tree_proof,
            predicate: Predicate { threshold: m.threshold, comparison: m.comparison_enum() },
            stat_a: args.stat_a,
            stat_b: None,
            op: None,
        };
        // A bad proof makes this revert (Err propagates) — settlement can only proceed on a proof the
        // oracle itself verified. `predicate_holds` is the program's return-data bool.
        let predicate_holds =
            cpi_validate_stat(&ctx.accounts.txoracle_program, &ctx.accounts.daily_scores_roots, &va)?;
        m.outcome = predicate_holds;
        m.resolved = true;
        emit!(Resolved { market: m.key(), outcome: predicate_holds, kind: m.market_kind });
        Ok(())
    }

    /// COMBOS + BATCH (V3). Multi-leg settlement via `validate_stat_v3`: verifies EVERY leg of the
    /// proof (membership + value=0 absence legs) in ONE CPI, then settles on the market's designated
    /// leg-0 predicate.
    /// - `combine_op == 0`: full-coverage — one `Single EqualTo`-its-value term per leg. Proves the
    ///   whole multiproof authentic; every requested stat is covered exactly once (the "indexed
    ///   strategy" a same-match combo ticket needs). leg0 must match the market's stat_key/period.
    /// - `combine_op == 1|2`: DERIVED market — exactly 2 legs, one `Binary{0,1,Add|Subtract}` term
    ///   comparing the combined value to `threshold` (e.g. goal / corner difference). Covers both legs.
    /// One tampered leg reverts the whole CPI (fail-closed).
    pub fn resolve_ticket(ctx: Context<Resolve>, args: ResolveMultiArgs) -> Result<()> {
        let m = &mut ctx.accounts.market;
        require!(!m.resolved, EscrowError::AlreadyResolved);
        require!(!m.cancelled, EscrowError::MarketCancelled);
        require!(args.summary.fixture_id == m.fixture_id, EscrowError::FixtureMismatch);
        let leg0 = args.stats_to_prove.first().ok_or(EscrowError::StatMismatch)?;
        require!(
            leg0.stat.key == m.stat_key && leg0.stat.period == m.period,
            EscrowError::StatMismatch
        );
        let predicates: Vec<DiscretePredicate> = if m.combine_op == 0 {
            // Full coverage: assert every proven stat equals its claimed value.
            args.stats_to_prove
                .iter()
                .enumerate()
                .map(|(i, e)| DiscretePredicate::Single {
                    index: i as u8,
                    predicate: Predicate { threshold: e.stat.value, comparison: Comparison::EqualTo },
                })
                .collect()
        } else {
            require!(args.stats_to_prove.len() == 2, EscrowError::StatMismatch);
            let op = if m.combine_op == 1 { BinaryExpression::Add } else { BinaryExpression::Subtract };
            vec![DiscretePredicate::Binary {
                index_a: 0,
                index_b: 1,
                op,
                predicate: Predicate { threshold: m.threshold, comparison: m.comparison_enum() },
            }]
        };
        let v3 = ValidateStatV3Args {
            ts: args.ts,
            summary: args.summary,
            sub_tree_proof: args.sub_tree_proof,
            main_tree_proof: args.main_tree_proof,
            event_stat_root: args.event_stat_root,
            stats_to_prove: args.stats_to_prove,
            multiproof: args.multiproof,
        };
        let trailer = strategy_trailer(&predicates);
        // Verifies all legs in one call; a bad proof reverts. `predicate_holds` = the strategy's verdict.
        let predicate_holds = cpi_validate_stat_v3(
            &ctx.accounts.txoracle_program,
            &ctx.accounts.daily_scores_roots,
            &v3,
            &trailer,
        )?;
        m.outcome = predicate_holds;
        m.resolved = true;
        emit!(Resolved { market: m.key(), outcome: predicate_holds, kind: m.market_kind });
        Ok(())
    }

    /// COMBOS (V2). Indexed multi-leg settlement via `validate_stat_v2`: every requested stat is covered
    /// exactly once by a discrete predicate, and ONE CPI settles the whole same-match ticket atomically.
    /// Full-coverage strategy — each leg `Single EqualTo` its claimed value (proves every leg authentic);
    /// leg 0 must match the market's `stat_key`/`period`. Unlike V3 there is no shared multiproof: each
    /// leg carries its own membership path. Fail-closed: a tampered leg reverts the whole CPI.
    pub fn resolve_combo(ctx: Context<Resolve>, args: ValidateStatV2Args) -> Result<()> {
        let m = &mut ctx.accounts.market;
        require!(!m.resolved, EscrowError::AlreadyResolved);
        require!(!m.cancelled, EscrowError::MarketCancelled);
        require!(args.summary.fixture_id == m.fixture_id, EscrowError::FixtureMismatch);
        let leg0 = args.stats_to_prove.first().ok_or(EscrowError::StatMismatch)?;
        require!(
            leg0.stat.key == m.stat_key && leg0.stat.period == m.period,
            EscrowError::StatMismatch
        );
        // Indexed strategy: cover every proven stat with a Single EqualTo-its-value predicate.
        let predicates: Vec<DiscretePredicate> = args
            .stats_to_prove
            .iter()
            .enumerate()
            .map(|(i, e)| DiscretePredicate::Single {
                index: i as u8,
                predicate: Predicate { threshold: e.stat.value, comparison: Comparison::EqualTo },
            })
            .collect();
        let trailer = strategy_trailer(&predicates);
        let predicate_holds = cpi_validate_stat_v2(
            &ctx.accounts.txoracle_program,
            &ctx.accounts.daily_scores_roots,
            &args,
            &trailer,
        )?;
        m.outcome = predicate_holds;
        m.resolved = true;
        emit!(Resolved { market: m.key(), outcome: predicate_holds, kind: m.market_kind });
        Ok(())
    }

    /// Winners withdraw their stake + a pro-rata share of the losing pool. One claim per position.
    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        let m = &ctx.accounts.market;
        require!(m.resolved, EscrowError::NotResolved);
        let pos = &mut ctx.accounts.position;
        require!(!pos.claimed, EscrowError::AlreadyClaimed);
        require!(pos.side == m.outcome, EscrowError::NotAWinner);

        let winning_total = if m.outcome { m.total_yes } else { m.total_no };
        let pot = m.total_yes.checked_add(m.total_no).ok_or(EscrowError::Overflow)?;
        // pro-rata: stake * pot / winning_total (u128 to avoid overflow). winning_total > 0 since this
        // position is on the winning side with a nonzero amount.
        let payout = (pos.amount as u128)
            .checked_mul(pot as u128)
            .and_then(|x| x.checked_div(winning_total as u128))
            .ok_or(EscrowError::Overflow)? as u64;

        let market_key = m.key();
        let vault_seeds: &[&[u8]] = &[b"vault", market_key.as_ref(), &[m.vault_bump]];
        transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.owner.to_account_info(),
                },
                &[vault_seeds],
            ),
            payout,
        )?;
        pos.claimed = true;
        emit!(Claimed { market: market_key, owner: pos.owner, payout });
        Ok(())
    }

    /// Timeout / cancel path. The market authority may cancel any time before resolution; ANYONE may
    /// cancel a still-unresolved market once `resolve_deadline` has passed (the oracle never anchored,
    /// or the keeper never settled). A cancelled market pays no winners — every depositor reclaims
    /// their exact stake via `refund`.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let m = &mut ctx.accounts.market;
        require!(!m.resolved, EscrowError::AlreadyResolved);
        require!(!m.cancelled, EscrowError::MarketCancelled);
        let is_authority = ctx.accounts.signer.key() == m.authority;
        let past_deadline = Clock::get()?.unix_timestamp >= m.resolve_deadline;
        require!(is_authority || past_deadline, EscrowError::CancelTooEarly);
        m.cancelled = true;
        emit!(Cancelled { market: m.key() });
        Ok(())
    }

    /// Reclaim your exact stake from a cancelled market (both sides made whole; no winner/loser).
    pub fn refund(ctx: Context<Claim>) -> Result<()> {
        let m = &ctx.accounts.market;
        require!(m.cancelled, EscrowError::NotCancelled);
        let pos = &mut ctx.accounts.position;
        require!(!pos.claimed, EscrowError::AlreadyClaimed);
        let amount = pos.amount;

        let market_key = m.key();
        let vault_seeds: &[&[u8]] = &[b"vault", market_key.as_ref(), &[m.vault_bump]];
        transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.owner.to_account_info(),
                },
                &[vault_seeds],
            ),
            amount,
        )?;
        pos.claimed = true;
        emit!(Claimed { market: market_key, owner: pos.owner, payout: amount });
        Ok(())
    }
}

/// The proof half of `validate_stat` args (the predicate comes from the market, not the caller).
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ResolveArgs {
    pub ts: i64,
    pub summary: FixtureSummary,
    pub fixture_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub stat_a: StatTerm,
}

/// The proof half of `validate_stat_v3` args — a multi-leg proof (all legs share one multiproof).
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ResolveMultiArgs {
    pub ts: i64,
    pub summary: FixtureSummary,
    pub sub_tree_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub event_stat_root: [u8; 32],
    pub stats_to_prove: Vec<StatEntry>,
    pub multiproof: Multiproof,
}

#[account]
pub struct Market {
    pub authority: Pubkey,
    pub fixture_id: i64,
    pub stat_key: u32,
    pub period: i32,
    pub threshold: i32,
    pub comparison: u8,
    pub cutoff_ts: i64,
    pub resolve_deadline: i64,
    pub resolved: bool,
    pub cancelled: bool,
    pub outcome: bool,
    pub total_yes: u64,
    pub total_no: u64,
    pub bump: u8,
    pub vault_bump: u8,
    /// 0 = single-stat / full-coverage; 1/2 = derived (Add/Subtract) market settled via resolve_ticket.
    pub combine_op: u8,
    /// Product category: 0 = Outcome, 1 = Combo, 2 = Batch.
    pub market_kind: u8,
}
impl Market {
    // discriminator(8) + authority(32) + fixture_id(8) + stat_key(4) + period(4) + threshold(4)
    // + comparison(1) + cutoff_ts(8) + resolve_deadline(8) + resolved(1) + cancelled(1) + outcome(1)
    // + total_yes(8) + total_no(8) + bump(1) + vault_bump(1) + combine_op(1) + market_kind(1)
    pub const SPACE: usize = 8 + 32 + 8 + 4 + 4 + 4 + 1 + 8 + 8 + 1 + 1 + 1 + 8 + 8 + 1 + 1 + 1 + 1;

    fn comparison_enum(&self) -> Comparison {
        match self.comparison {
            0 => Comparison::GreaterThan,
            1 => Comparison::LessThan,
            _ => Comparison::EqualTo,
        }
    }
}

#[account]
pub struct Position {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub side: bool,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}
impl Position {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 8 + 1 + 1;
}

#[derive(Accounts)]
#[instruction(fixture_id: i64, stat_key: u32, period: i32)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = Market::SPACE,
        seeds = [b"market", authority.key().as_ref(), &fixture_id.to_le_bytes(), &stat_key.to_le_bytes(), &period.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,
    /// CHECK: SOL vault PDA (system-owned, no data). Signed for via seeds on payout.
    #[account(seeds = [b"vault", market.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(side: bool)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// CHECK: SOL vault PDA for this market.
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = market.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = depositor,
        space = Position::SPACE,
        seeds = [b"position", market.key().as_ref(), depositor.key().as_ref(), &[side as u8]],
        bump
    )]
    pub position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Resolve<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// CHECK: the `daily_scores_roots` PDA — the oracle validates its seeds/owner internally.
    pub daily_scores_roots: UncheckedAccount<'info>,
    /// CHECK: the TxLINE oracle program. Pinned to the real program id so a fake can't fake a result.
    #[account(address = ORACLE_PROGRAM @ EscrowError::WrongOracle)]
    pub txoracle_program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
    /// CHECK: SOL vault PDA for this market.
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump = market.vault_bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), owner.key().as_ref(), &[position.side as u8]],
        bump = position.bump,
        has_one = owner,
        has_one = market,
    )]
    pub position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    pub signer: Signer<'info>,
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[event]
pub struct Resolved {
    pub market: Pubkey,
    pub outcome: bool,
    pub kind: u8,
}
#[event]
pub struct Claimed {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub payout: u64,
}
#[event]
pub struct Cancelled {
    pub market: Pubkey,
}

#[error_code]
pub enum EscrowError {
    #[msg("comparison/combine_op/kind out of range")]
    BadComparison,
    #[msg("resolve_deadline must be >= cutoff_ts")]
    BadDeadline,
    #[msg("market already resolved")]
    AlreadyResolved,
    #[msg("market not resolved yet")]
    NotResolved,
    #[msg("market has been cancelled")]
    MarketCancelled,
    #[msg("market is not cancelled")]
    NotCancelled,
    #[msg("too early to cancel — wait for the resolve deadline")]
    CancelTooEarly,
    #[msg("betting has closed for this market")]
    MarketClosed,
    #[msg("deposit amount must be > 0")]
    ZeroAmount,
    #[msg("proof fixture does not match the market")]
    FixtureMismatch,
    #[msg("proof stat key/period does not match the market")]
    StatMismatch,
    #[msg("wrong oracle program")]
    WrongOracle,
    #[msg("position already claimed")]
    AlreadyClaimed,
    #[msg("position is not on the winning side")]
    NotAWinner,
    #[msg("arithmetic overflow")]
    Overflow,
}
