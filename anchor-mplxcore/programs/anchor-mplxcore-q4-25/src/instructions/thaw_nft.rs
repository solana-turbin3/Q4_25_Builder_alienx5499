use anchor_lang::prelude::*;
use mpl_core::{
    instructions::UpdatePluginV1CpiBuilder,
    types::{FreezeDelegate, Plugin},
    ID as CORE_PROGRAM_ID,
};

use crate::{error::MPLXCoreError, state::CollectionAuthority};

#[derive(Accounts)]
pub struct ThawNft<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    
    #[account(mut)]
    pub asset: SystemAccount<'info>,
    
    #[account(mut)]
    pub collection: SystemAccount<'info>,
    
    #[account(
        mut,
        seeds = [b"collection_authority", collection.key().as_ref()],
        bump = collection_authority.bump
    )]
    pub collection_authority: Account<'info, CollectionAuthority>,
    
    /// CHECK: This is the MPL Core program
    #[account(address = CORE_PROGRAM_ID)]
    pub core_program: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
}

impl<'info> ThawNft<'info> {
    pub fn thaw_nft(&mut self) -> Result<()> {
        // Verify the authority is the creator of the collection
        require!(
            self.authority.key() == self.collection_authority.creator,
            MPLXCoreError::NotAuthorized
        );

        // Create thaw delegate plugin (frozen = false)
        let freeze_delegate = FreezeDelegate {
            frozen: false,
        };

        // Update the asset with thaw plugin
        UpdatePluginV1CpiBuilder::new(&self.core_program)
            .asset(&self.asset.to_account_info())
            .collection(Some(&self.collection.to_account_info()))
            .authority(Some(&self.collection_authority.to_account_info()))
            .plugin(Plugin::FreezeDelegate(freeze_delegate))
            .system_program(&self.system_program.to_account_info())
            .invoke_signed(&[&[
                b"collection_authority",
                self.collection.key().as_ref(),
                &[self.collection_authority.bump],
            ]])?;

        Ok(())
    }
}
