use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use solana_program::{
	ed25519_program,
	instruction::AccountMeta,
	keccak::hash,
	program::invoke,
};

use crate::{errors::DiceError, state::Bet};

#[derive(Accounts)]
pub struct ResolveBet<'info> {
	#[account(mut)]
	pub house: Signer<'info>,

	/// CHECK: House authority
	pub house_pubkey: UncheckedAccount<'info>,

	#[account(
		mut,
		seeds = [b"vault", house.key().as_ref()],
		bump
	)]
	pub vault: SystemAccount<'info>,

	#[account(
		mut,
		seeds = [b"bet", vault.key().as_ref(), bet.seed.to_le_bytes().as_ref()],
		bump = bet.bump
	)]
	pub bet: Account<'info, Bet>,

	/// CHECK: Player account
	#[account(mut)]
	pub player: UncheckedAccount<'info>,

	pub system_program: Program<'info, System>,
}

impl<'info> ResolveBet<'info> {
	pub fn verify_ed25519_signature(&self, sig: &[u8]) -> Result<()> {
		require!(
			sig.len() >= 2,
			DiceError::Ed25519DataLength
		);

		let msg_size = u16::from_le_bytes([sig[0], sig[1]]) as usize;
		require!(
			msg_size > 0 && msg_size <= 1024,
			DiceError::Ed25519Message
		);

		require!(
			sig.len() >= 2 + msg_size + 64 + 32,
			DiceError::Ed25519DataLength
		);

		let message = &sig[2..2 + msg_size];
		let signature_bytes = &sig[2 + msg_size..2 + msg_size + 64];
		let pubkey_bytes = &sig[2 + msg_size + 64..2 + msg_size + 64 + 32];

		let _pubkey = anchor_lang::prelude::Pubkey::try_from(pubkey_bytes)
			.map_err(|_| DiceError::Ed25519Pubkey)?;

		let instruction_data = solana_program::instruction::Instruction {
			program_id: ed25519_program::ID,
			accounts: vec![
				AccountMeta::new_readonly(self.house_pubkey.key(), false),
				AccountMeta::new_readonly(self.bet.key(), false),
			],
			data: {
				let mut data = vec![0u8];
				data.extend_from_slice(&(msg_size as u16).to_le_bytes());
				data.extend_from_slice(message);
				data.extend_from_slice(signature_bytes);
				data
			},
		};

		let mut accounts = vec![];
		accounts.push(self.house_pubkey.to_account_info());
		accounts.push(self.bet.to_account_info());

		invoke(&instruction_data, &accounts).map_err(|_| DiceError::Ed25519Signature)?;

		Ok(())
	}

	pub fn resolve_bet(&mut self, _sig: &[u8], bumps: &ResolveBetBumps) -> Result<()> {
		let bet_data = self.bet.to_slice();

		let hasher = hash(&bet_data);
		let random_value = u64::from_le_bytes(hasher.to_bytes()[..8].try_into().unwrap()) % 96;
		let actual_roll = (random_value % 94 + 2) as u8;

		if actual_roll == self.bet.roll {
			let payout = self.bet.amount * 94;
			let signer_seeds: &[&[&[u8]]] = &[&[b"vault", &self.house.key().to_bytes(), &[bumps.vault]]];
			let ctx = CpiContext::new_with_signer(
				self.system_program.to_account_info(),
				Transfer {
					from: self.vault.to_account_info(),
					to: self.player.to_account_info(),
				},
				signer_seeds,
			);
			transfer(ctx, payout)?;
		}

		Ok(())
	}
}

