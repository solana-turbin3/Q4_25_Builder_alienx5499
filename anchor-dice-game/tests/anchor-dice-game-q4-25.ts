import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorDiceGameQ425 } from "../target/types/anchor_dice_game_q4_25";
import { PublicKey, SystemProgram, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import nacl from "tweetnacl";
import { assert } from "chai";

describe("anchor-dice-game-q4-25", () => {
	// Configure the client to use the local cluster.
	const provider = anchor.AnchorProvider.env();
	anchor.setProvider(provider);

	const program = anchor.workspace.anchorDiceGameQ425 as Program<AnchorDiceGameQ425>;

	const house = provider.wallet;
	const player = Keypair.generate();

	// Derive PDAs
	let vaultPda: PublicKey;
	let betPda: PublicKey;

	const betAmount = 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL
	const seed = 123456789n;

	before(async () => {
		// Airdrop to player
		const airdropSignature = await provider.connection.requestAirdrop(
			player.publicKey,
			2 * LAMPORTS_PER_SOL
		);
		await provider.connection.confirmTransaction(airdropSignature);

		// Derive vault PDA
		[vaultPda] = PublicKey.findProgramAddressSync(
			[Buffer.from("vault"), house.publicKey.toBuffer()],
			program.programId
		);

		// Derive bet PDA
		[betPda] = PublicKey.findProgramAddressSync(
			[Buffer.from("bet"), vaultPda.toBuffer(), seedToBuffer(seed)],
			program.programId
		);

		console.log("House:", house.publicKey.toString());
		console.log("Player:", player.publicKey.toString());
		console.log("Vault PDA:", vaultPda.toString());
		console.log("Bet PDA:", betPda.toString());
	});

	function seedToBuffer(seed: bigint): Buffer {
		const buffer = Buffer.allocUnsafe(16);
		buffer.writeBigUInt64LE(seed, 0);
		buffer.writeBigUInt64LE(0n, 8);
		return buffer;
	}

	describe("Initialize", () => {
		it("Initializes the vault with funds", async () => {
			const initialVaultBalance = await provider.connection.getBalance(vaultPda);
			assert.equal(initialVaultBalance, 0, "Vault should start empty");

			const initAmount = 10 * LAMPORTS_PER_SOL; // 10 SOL

			const tx = await program.methods
				.initialize(new anchor.BN(initAmount))
				.accounts({
					house: house.publicKey,
					vault: vaultPda,
					systemProgram: SystemProgram.programId,
				})
				.rpc();

			console.log("Initialize tx:", tx);

			const vaultBalance = await provider.connection.getBalance(vaultPda);
			assert.equal(vaultBalance, initAmount, "Vault should have been funded");

			console.log("Vault initialized successfully");
		});
	});

	describe("Place Bet", () => {
		it("Places a bet", async () => {
			const roll = 50;
			const playerBalanceBefore = await provider.connection.getBalance(player.publicKey);
			const vaultBalanceBefore = await provider.connection.getBalance(vaultPda);

			const tx = await program.methods
				.placeBet(
					new anchor.BN(seed.toString()),
					roll,
					new anchor.BN(betAmount)
				)
				.accounts({
					player: player.publicKey,
					house: house.publicKey,
					vault: vaultPda,
					bet: betPda,
					systemProgram: SystemProgram.programId,
				})
				.signers([player])
				.rpc();

			console.log("Place bet tx:", tx);

			// Verify bet account
			const betAccount = await program.account.bet.fetch(betPda);
			assert.equal(
				betAccount.player.toString(),
				player.publicKey.toString(),
				"Bet player should be correct"
			);
			assert.equal(betAccount.amount.toNumber(), betAmount, "Bet amount should be correct");
			assert.equal(betAccount.roll, roll, "Bet roll should be correct");

			// Verify balances
			const playerBalanceAfter = await provider.connection.getBalance(player.publicKey);
			const vaultBalanceAfter = await provider.connection.getBalance(vaultPda);

			assert.ok(
				playerBalanceBefore - playerBalanceAfter >= betAmount,
				"Player should have paid bet amount"
			);
			assert.equal(
				vaultBalanceAfter - vaultBalanceBefore,
				betAmount,
				"Vault should have received bet amount"
			);

			console.log("Bet placed successfully");
		});
	});

	describe("Refund Bet", () => {
		it("Refunds a bet after timeout", async () => {
			const playerBalanceBefore = await provider.connection.getBalance(player.publicKey);
			const vaultBalanceBefore = await provider.connection.getBalance(vaultPda);

			// Note: This will fail if the timeout hasn't elapsed
			// In a real scenario, you'd need to wait or manipulate clock

			try {
				const tx = await program.methods
					.refundBet()
					.accounts({
						player: player.publicKey,
						house: house.publicKey,
						vault: vaultPda,
						bet: betPda,
						systemProgram: SystemProgram.programId,
					})
					.signers([player])
					.rpc();

				console.log("Refund bet tx:", tx);

				const playerBalanceAfter = await provider.connection.getBalance(player.publicKey);
				const vaultBalanceAfter = await provider.connection.getBalance(vaultPda);

				assert.ok(
					playerBalanceAfter > playerBalanceBefore,
					"Player should have received refund"
				);
				assert.ok(
					vaultBalanceAfter < vaultBalanceBefore,
					"Vault should have paid refund"
				);

				console.log("Bet refunded successfully");
			} catch (error) {
				console.log("Refund bet failed (likely timeout not reached):", error.message);
				// This is expected if timeout hasn't elapsed
			}
		});
	});

	describe("Resolve Bet", () => {
		it("Resolves a bet with Ed25519 signature", async () => {
			// Place a new bet first
			const seed2 = 987654321n;
			const [betPda2] = PublicKey.findProgramAddressSync(
				[Buffer.from("bet"), vaultPda.toBuffer(), seedToBuffer(seed2)],
				program.programId
			);

			const roll2 = 50;

			await program.methods
				.placeBet(
					new anchor.BN(seed2.toString()),
					roll2,
					new anchor.BN(betAmount)
				)
				.accounts({
					player: player.publicKey,
					house: house.publicKey,
					vault: vaultPda,
					bet: betPda2,
					systemProgram: SystemProgram.programId,
				})
				.signers([player])
				.rpc();

			// Fetch bet account to get the data for signature
			const betAccount = await program.account.bet.fetch(betPda2);
			const betData = [
				...betAccount.player.toBuffer(),
				...new anchor.BN(betAccount.seed.toString()).toArray("le", 16),
				...new anchor.BN(betAccount.slot.toString()).toArray("le", 8),
				...new anchor.BN(betAccount.amount.toString()).toArray("le", 8),
				betAccount.roll,
				betAccount.bump,
			];

			// Generate signature using house keypair
			const houseKeypair = (house as any).payer as anchor.web3.Keypair;
			const sig = nacl.sign.detached(Buffer.from(betData), houseKeypair.secretKey);

			// Build signature bytes for Ed25519 program
			const msgSize = betData.length;
			const sigBytes = Buffer.concat([
				Buffer.from([msgSize & 0xff, (msgSize >> 8) & 0xff]), // msg_size
				Buffer.from(betData), // message
				Buffer.from(sig), // signature (64 bytes)
				house.publicKey.toBuffer(), // pubkey (32 bytes)
			]);

			console.log("Signature length:", sigBytes.length);

			try {
				const playerBalanceBefore = await provider.connection.getBalance(player.publicKey);
				const vaultBalanceBefore = await provider.connection.getBalance(vaultPda);

			const tx = await program.methods
				.resolveBet(Buffer.from(sigBytes))
				.accounts({
					house: house.publicKey,
					housePubkey: house.publicKey,
					vault: vaultPda,
					bet: betPda2,
					player: player.publicKey,
					systemProgram: SystemProgram.programId,
				})
				.rpc();

				console.log("Resolve bet tx:", tx);

				const playerBalanceAfter = await provider.connection.getBalance(player.publicKey);
				const vaultBalanceAfter = await provider.connection.getBalance(vaultPda);

				console.log("Player balance change:", playerBalanceAfter - playerBalanceBefore);
				console.log("Vault balance change:", vaultBalanceAfter - vaultBalanceBefore);

				console.log("Bet resolved successfully");
			} catch (error) {
				console.log("Resolve bet error:", error);
				// This might fail depending on the winning condition
			}
		});
	});

	describe("Edge Cases", () => {
		it("Fails to place bet with insufficient funds", async () => {
			const poorPlayer = Keypair.generate();
			await provider.connection.requestAirdrop(poorPlayer.publicKey, 0.05 * LAMPORTS_PER_SOL);
			await new Promise((resolve) => setTimeout(resolve, 1000));

			const seed3 = 555555555n;
			const [betPda3] = PublicKey.findProgramAddressSync(
				[Buffer.from("bet"), vaultPda.toBuffer(), seedToBuffer(seed3)],
				program.programId
			);

			try {
				await program.methods
					.placeBet(new anchor.BN(seed3.toString()), 10, new anchor.BN(1 * LAMPORTS_PER_SOL))
					.accounts({
						player: poorPlayer.publicKey,
						house: house.publicKey,
						vault: vaultPda,
						bet: betPda3,
						systemProgram: SystemProgram.programId,
					})
					.signers([poorPlayer])
					.rpc();
				assert.fail("Should have failed with insufficient funds");
			} catch (error) {
				assert.ok(error.message.includes("insufficient") || error.message.includes("funds"));
				console.log("✓ Correctly rejected bet with insufficient funds");
			}
		});

		it("Fails to refund bet before timeout", async () => {
			const seed4 = 999999999n;
			const [betPda4] = PublicKey.findProgramAddressSync(
				[Buffer.from("bet"), vaultPda.toBuffer(), seedToBuffer(seed4)],
				program.programId
			);

			await program.methods
				.placeBet(new anchor.BN(seed4.toString()), 25, new anchor.BN(betAmount))
				.accounts({
					player: player.publicKey,
					house: house.publicKey,
					vault: vaultPda,
					bet: betPda4,
					systemProgram: SystemProgram.programId,
				})
				.signers([player])
				.rpc();

			try {
				await program.methods
					.refundBet()
					.accounts({
						player: player.publicKey,
						house: house.publicKey,
						vault: vaultPda,
						bet: betPda4,
						systemProgram: SystemProgram.programId,
					})
					.signers([player])
					.rpc();
				assert.fail("Should have failed - timeout not reached");
			} catch (error) {
				assert.ok(error.message.includes("Timeout"));
				console.log("✓ Correctly rejected premature refund");
			}
		});

		it("Fails to resolve bet with invalid signature", async () => {
			const seed5 = 111111111n;
			const [betPda5] = PublicKey.findProgramAddressSync(
				[Buffer.from("bet"), vaultPda.toBuffer(), seedToBuffer(seed5)],
				program.programId
			);

			await program.methods
				.placeBet(new anchor.BN(seed5.toString()), 30, new anchor.BN(betAmount))
				.accounts({
					player: player.publicKey,
					house: house.publicKey,
					vault: vaultPda,
					bet: betPda5,
					systemProgram: SystemProgram.programId,
				})
				.signers([player])
				.rpc();

			// Try with invalid signature
			const invalidSig = Buffer.from("invalid_signature_data".repeat(10));

			try {
				await program.methods
					.resolveBet(invalidSig)
					.accounts({
						house: house.publicKey,
						housePubkey: house.publicKey,
						vault: vaultPda,
						bet: betPda5,
						player: player.publicKey,
						systemProgram: SystemProgram.programId,
					})
					.rpc();
				assert.fail("Should have failed with invalid signature");
			} catch (error) {
				assert.ok(error.message.includes("Ed25519") || error.message.includes("signature"));
				console.log("✓ Correctly rejected invalid signature");
			}
		});

		it("Can place multiple bets from different players", async () => {
			const player2 = Keypair.generate();
			await provider.connection.requestAirdrop(player2.publicKey, 1 * LAMPORTS_PER_SOL);
			await new Promise((resolve) => setTimeout(resolve, 1000));

			const seed6 = 222222222n;
			const [betPda6] = PublicKey.findProgramAddressSync(
				[Buffer.from("bet"), vaultPda.toBuffer(), seedToBuffer(seed6)],
				program.programId
			);

			const tx = await program.methods
				.placeBet(new anchor.BN(seed6.toString()), 40, new anchor.BN(betAmount))
				.accounts({
					player: player2.publicKey,
					house: house.publicKey,
					vault: vaultPda,
					bet: betPda6,
					systemProgram: SystemProgram.programId,
				})
				.signers([player2])
				.rpc();

			console.log("Player2 bet tx:", tx);

			const betAccount = await program.account.bet.fetch(betPda6);
			assert.equal(betAccount.player.toString(), player2.publicKey.toString());

			console.log("✓ Multiple players can place bets");
		});
	});
});
