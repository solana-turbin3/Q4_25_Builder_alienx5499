use anchor_lang::prelude::*;
use mpl_core::{
	instructions::AddPluginV1CpiBuilder,
	types::{FreezeDelegate, Plugin},
	ID as CORE_PROGRAM_ID,
};

use crate::{
	errors::StakeError,
	state::{StakeAccount, StakeConfig, UserAccount},
};

#[derive(Accounts)]
pub struct Stake<'info> {
	#[account(mut)]
	pub user: Signer<'info>,

	/// CHECK: mpl-core asset account
	#[account(mut, owner = CORE_PROGRAM_ID)]
	pub asset: UncheckedAccount<'info>,

	/// CHECK: mpl-core collection account
	#[account(mut, owner = CORE_PROGRAM_ID)]
	pub collection: UncheckedAccount<'info>,

	#[account(
		init,
		payer = user,
		seeds = [b"stake", config.key().as_ref(), asset.key().as_ref()],
		bump,
		space = StakeAccount::DISCRIMINATOR.len() + StakeAccount::INIT_SPACE,
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

impl<'info> Stake<'info> {
	pub fn stake(&mut self, bumps: &StakeBumps) -> Result<()> {
		require!(
			self.user_account.amount_staked < self.config.max_stake,
			StakeError::MaxStakeReached
		);

		self.stake_account.set_inner(StakeAccount {
			owner: self.user.key(),
			mint: self.asset.key(),
			staked_at: Clock::get()?.unix_timestamp,
			bump: bumps.stake_account,
		});

		// Add FreezeDelegate plugin so NFT cannot be transferred while staked
		AddPluginV1CpiBuilder::new(&self.core_program.to_account_info())
			.asset(&self.asset.to_account_info())
			.collection(Some(&self.collection.to_account_info()))
			.payer(&self.user.to_account_info())
			.authority(Some(&self.user.to_account_info()))
			.system_program(&self.system_program.to_account_info())
			.plugin(Plugin::FreezeDelegate(FreezeDelegate { frozen: true }))
			.invoke()?;

		self.user_account.amount_staked = self
			.user_account
			.amount_staked
			.saturating_add(1);

		Ok(())
	}
}
