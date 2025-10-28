use anchor_lang::prelude::*;
use mpl_core::{
	instructions::RemovePluginV1CpiBuilder,
	types::PluginType,
	ID as CORE_PROGRAM_ID,
};

use crate::{
	errors::StakeError,
	state::{StakeAccount, StakeConfig, UserAccount},
};

#[derive(Accounts)]
pub struct Unstake<'info> {
	#[account(mut)]
	pub user: Signer<'info>,

	/// CHECK: mpl-core asset
	#[account(mut, owner = CORE_PROGRAM_ID)]
	pub asset: UncheckedAccount<'info>,

	/// CHECK: mpl-core collection
	#[account(mut, owner = CORE_PROGRAM_ID)]
	pub collection: UncheckedAccount<'info>,

	#[account(
		mut,
		seeds = [b"stake", config.key().as_ref(), asset.key().as_ref()],
		bump = stake_account.bump,
		close = user
	)]
	pub stake_account: Account<'info, StakeAccount>,

	#[account(seeds = [b"config"], bump = config.bump)]
	pub config: Account<'info, StakeConfig>,

	#[account(
		mut,
		seeds = [b"user", user.key().as_ref()],
		bump = user_account.bump,
	)]
	pub user_account: Account<'info, UserAccount>,

	#[account(address = CORE_PROGRAM_ID)]
	/// CHECK: Verified by address
	pub core_program: UncheckedAccount<'info>,

	pub system_program: Program<'info, System>,
}

impl<'info> Unstake<'info> {
	pub fn unstake(&mut self) -> Result<()> {
		// Enforce freeze period has passed (in days)
		let now = Clock::get()?.unix_timestamp;
		let elapsed_days: u32 = if self.stake_account.staked_at <= 0 {
			0
		} else {
			let elapsed_secs = now.saturating_sub(self.stake_account.staked_at) as u64;
			(elapsed_secs / 86_400) as u32
		};
		require!(
			elapsed_days >= self.config.freeze_period,
			StakeError::FreezePeriodNotPassed
		);

		// Remove FreezeDelegate plugin to unfreeze NFT
		RemovePluginV1CpiBuilder::new(&self.core_program.to_account_info())
			.asset(&self.asset.to_account_info())
			.collection(Some(&self.collection.to_account_info()))
			.payer(&self.user.to_account_info())
			.authority(Some(&self.user.to_account_info()))
			.system_program(&self.system_program.to_account_info())
			.plugin_type(PluginType::FreezeDelegate)
			.invoke()?;

		// Award points: elapsed_days * points_per_stake
		let added_points = elapsed_days.saturating_mul(self.config.points_per_stake as u32);
		self.user_account.points = self.user_account.points.saturating_add(added_points);

		// Decrement user's staked count
		self.user_account.amount_staked = self.user_account.amount_staked.saturating_sub(1);

		Ok(())
	}
}
