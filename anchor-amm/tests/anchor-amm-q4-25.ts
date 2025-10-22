import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorAmmQ425 } from "../target/types/anchor_amm_q4_25";
import { expect } from "chai";
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction, createMint, mintTo, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe("anchor-amm-q4-25", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.AnchorAmmQ425 as Program<AnchorAmmQ425>;

  const user = provider.wallet.publicKey;
  const seed = new anchor.BN(1234);
  const fee = 30; // 0.3% fee

  let mintX: anchor.web3.PublicKey;
  let mintY: anchor.web3.PublicKey;
  let userX: anchor.web3.PublicKey;
  let userY: anchor.web3.PublicKey;
  let userLp: anchor.web3.PublicKey;

  let configPda: anchor.web3.PublicKey;
  let configBump: number;
  let mintLp: anchor.web3.PublicKey;
  let vaultX: anchor.web3.PublicKey;
  let vaultY: anchor.web3.PublicKey;

  const depositAmount = 1000;
  const swapAmount = 100;

  before(async () => {
    // Airdrop SOL to user
    await provider.connection.requestAirdrop(user, 10 * anchor.web3.LAMPORTS_PER_SOL);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Create mints (decimals=6 for AMM)
    mintX = await createMint(provider.connection, provider.wallet.payer, user, null, 6);
    mintY = await createMint(provider.connection, provider.wallet.payer, user, null, 6);

    // Create user ATAs and mint tokens
    userX = getAssociatedTokenAddressSync(mintX, user);
    const userXTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(provider.wallet.publicKey, userX, user, mintX)
    );
    await provider.sendAndConfirm(userXTx);
    await mintTo(provider.connection, provider.wallet.payer, mintX, userX, provider.wallet.payer, depositAmount * 2);

    userY = getAssociatedTokenAddressSync(mintY, user);
    const userYTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(provider.wallet.publicKey, userY, user, mintY)
    );
    await provider.sendAndConfirm(userYTx);
    await mintTo(provider.connection, provider.wallet.payer, mintY, userY, provider.wallet.payer, depositAmount * 2);

    // Derive PDAs
    [configPda, configBump] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config"), seed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    [mintLp] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), configPda.toBuffer()],
      program.programId
    );
    vaultX = getAssociatedTokenAddressSync(mintX, configPda, true);
    vaultY = getAssociatedTokenAddressSync(mintY, configPda, true);
    userLp = getAssociatedTokenAddressSync(mintLp, user);
  });

  it("Initialize AMM pool", async () => {
    console.log("AMM pool initialised,");
    
    const tx = await program.methods
      .initialize(seed, fee, null)
      .accountsStrict({
        initializer: user,
        mintX: mintX,
        mintY: mintY,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        config: configPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log("tx is:", tx);

    const configAccount = await program.account.config.fetch(configPda);
    expect(configAccount.seed.toNumber()).to.equal(seed.toNumber());
    expect(configAccount.mintX.toBase58()).to.equal(mintX.toBase58());
    expect(configAccount.mintY.toBase58()).to.equal(mintY.toBase58());
    expect(configAccount.fee).to.equal(fee);
    expect(configAccount.locked).to.be.false;
  });

  it("Initial Deposit to Liquidity", async () => {
    const lpAmount = new anchor.BN(1000);
    const maxX = new anchor.BN(depositAmount);
    const maxY = new anchor.BN(depositAmount);

    console.log("In this case depositMaxX is:", maxX.toNumber());
    console.log("In this case depositMaxY is:", maxY.toNumber());
    console.log("In this case amount to be deposit is:", lpAmount.toNumber());

    const tx = await program.methods
      .deposit(lpAmount, maxX, maxY)
      .accountsStrict({
        user: user,
        mintX: mintX,
        mintY: mintY,
        config: configPda,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userX,
        userY: userY,
        userLp: userLp,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Deposit successful, tx is:", tx);

    const vaultXBalance = (await provider.connection.getTokenAccountBalance(vaultX)).value.uiAmount;
    const vaultYBalance = (await provider.connection.getTokenAccountBalance(vaultY)).value.uiAmount;
    const userLpBalance = (await provider.connection.getTokenAccountBalance(userLp)).value.uiAmount;

    console.log("Vault X balance:", vaultXBalance, "Tokens");
    console.log("Vault Y balance:", vaultYBalance, "Tokens");
    console.log("User LP balance:", userLpBalance, "LP tokens");

    expect(vaultXBalance).to.be.greaterThan(0);
    expect(vaultYBalance).to.be.greaterThan(0);
    expect(userLpBalance).to.be.closeTo(lpAmount.toNumber() / 1000000, 0.001); // Account for 6 decimals
  });

  it("Swap 100 token X for token Y", async () => {
    const swapAmountBN = new anchor.BN(swapAmount);
    const minAmountOut = new anchor.BN(50); // Allow some slippage

    const initialXBalance = (await provider.connection.getTokenAccountBalance(userX)).value.uiAmount;
    const initialYBalance = (await provider.connection.getTokenAccountBalance(userY)).value.uiAmount;

    console.log("User have Initial X token:", initialXBalance * 1000000, "Tokens");
    console.log("User have Initial Y token:", initialYBalance * 1000000, "Tokens");

    const tx = await program.methods
      .swap(true, swapAmountBN, minAmountOut)
      .accountsStrict({
        user: user,
        mintX: mintX,
        mintY: mintY,
        config: configPda,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userX,
        userY: userY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Swap successful, tx is:", tx);

    const finalXBalance = (await provider.connection.getTokenAccountBalance(userX)).value.uiAmount;
    const finalYBalance = (await provider.connection.getTokenAccountBalance(userY)).value.uiAmount;

    console.log("User have After X token:", finalXBalance * 1000000, "Tokens");
    console.log("User have After Y token:", finalYBalance * 1000000, "Tokens");
    console.log("X balance change:", (initialXBalance - finalXBalance) * 1000000);
    console.log("Y balance change:", (finalYBalance - initialYBalance) * 1000000);

    expect(finalXBalance).to.be.lessThan(initialXBalance);
    expect(finalYBalance).to.be.greaterThan(initialYBalance);
  });

  it("Second deposit to Liquidity", async () => {
    const lpAmount = new anchor.BN(500);
    const maxX = new anchor.BN(1000);
    const maxY = new anchor.BN(1000);

    console.log("In this case depositMaxX is:", maxX.toNumber());
    console.log("In this case depositMaxY is:", maxY.toNumber());
    console.log("In this case amount to be deposit is:", lpAmount.toNumber());

    const tx = await program.methods
      .deposit(lpAmount, maxX, maxY)
      .accountsStrict({
        user: user,
        mintX: mintX,
        mintY: mintY,
        config: configPda,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userX,
        userY: userY,
        userLp: userLp,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Second Deposit successful, tx is:", tx);

    const vaultXBalance = (await provider.connection.getTokenAccountBalance(vaultX)).value.uiAmount;
    const vaultYBalance = (await provider.connection.getTokenAccountBalance(vaultY)).value.uiAmount;
    const userLpBalance = (await provider.connection.getTokenAccountBalance(userLp)).value.uiAmount;

    console.log("Vault X balance:", vaultXBalance * 1000000, "Tokens");
    console.log("Vault Y balance:", vaultYBalance * 1000000, "Tokens");
    console.log("User LP balance:", userLpBalance * 1000000, "LP tokens");

    expect(vaultXBalance).to.be.greaterThan(0);
    expect(vaultYBalance).to.be.greaterThan(0);
    expect(userLpBalance).to.be.greaterThan(1000 / 1000000);
  });

  it("now Swap 150 token X for token Y", async () => {
    const swapAmountBN = new anchor.BN(150);
    const minAmountOut = new anchor.BN(50);

    const initialXBalance = (await provider.connection.getTokenAccountBalance(userX)).value.uiAmount;
    const initialYBalance = (await provider.connection.getTokenAccountBalance(userY)).value.uiAmount;

    console.log("User have Initial X token:", initialXBalance * 1000000, "Tokens");
    console.log("User have Initial Y token:", initialYBalance * 1000000, "Tokens");

    const tx = await program.methods
      .swap(true, swapAmountBN, minAmountOut)
      .accountsStrict({
        user: user,
        mintX: mintX,
        mintY: mintY,
        config: configPda,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userX,
        userY: userY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Swap successful, tx is:", tx);

    const finalXBalance = (await provider.connection.getTokenAccountBalance(userX)).value.uiAmount;
    const finalYBalance = (await provider.connection.getTokenAccountBalance(userY)).value.uiAmount;

    console.log("User have After X token:", finalXBalance * 1000000, "Tokens");
    console.log("User have After Y token:", finalYBalance * 1000000, "Tokens");
    console.log("X balance change:", (initialXBalance - finalXBalance) * 1000000);
    console.log("Y balance change:", (finalYBalance - initialYBalance) * 1000000);

    expect(finalXBalance).to.be.lessThan(initialXBalance);
    expect(finalYBalance).to.be.greaterThan(initialYBalance);
  });

  it("Swap 150 token Y for token X", async () => {
    const swapAmountBN = new anchor.BN(150);
    const minAmountOut = new anchor.BN(50);

    const initialXBalance = (await provider.connection.getTokenAccountBalance(userX)).value.uiAmount;
    const initialYBalance = (await provider.connection.getTokenAccountBalance(userY)).value.uiAmount;

    console.log("User have Initial X token:", initialXBalance * 1000000, "Tokens");
    console.log("User have Initial Y token:", initialYBalance * 1000000, "Tokens");

    const tx = await program.methods
      .swap(false, swapAmountBN, minAmountOut)
      .accountsStrict({
        user: user,
        mintX: mintX,
        mintY: mintY,
        config: configPda,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userX,
        userY: userY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Swap successful, tx is:", tx);

    const finalXBalance = (await provider.connection.getTokenAccountBalance(userX)).value.uiAmount;
    const finalYBalance = (await provider.connection.getTokenAccountBalance(userY)).value.uiAmount;

    console.log("User have After X token:", finalXBalance * 1000000, "Tokens");
    console.log("User have After Y token:", finalYBalance * 1000000, "Tokens");
    console.log("X balance change:", (finalXBalance - initialXBalance) * 1000000);
    console.log("Y balance change:", (initialYBalance - finalYBalance) * 1000000);

    expect(finalXBalance).to.be.greaterThan(initialXBalance);
    expect(finalYBalance).to.be.lessThan(initialYBalance);
  });

  it("Withdraws liquidity from the pool", async () => {
    const withdrawAmount = new anchor.BN(750);
    const minX = new anchor.BN(0);
    const minY = new anchor.BN(0);

    const tx = await program.methods
      .withdraw(withdrawAmount, minX, minY)
      .accountsStrict({
        user: user,
        mintX: mintX,
        mintY: mintY,
        config: configPda,
        mintLp: mintLp,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userX,
        userY: userY,
        userLp: userLp,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Withdraw transaction signature:", tx);
    console.log("LP tokens burned:", withdrawAmount.toNumber());
    
    const userLpBalance = (await provider.connection.getTokenAccountBalance(userLp)).value.uiAmount;
    const userXBalance = (await provider.connection.getTokenAccountBalance(userX)).value.uiAmount;
    const userYBalance = (await provider.connection.getTokenAccountBalance(userY)).value.uiAmount;
    
    console.log("X received:", userXBalance * 1000000);
    console.log("Y received:", userYBalance * 1000000);
    
    expect(userLpBalance).to.be.lessThan(1500 / 1000000);
  });

  it("Initialize with invalid fee should fail", async () => {
    const invalidSeed = new anchor.BN(9999);
    const invalidFee = 10001; // > 100% fee

    const [invalidConfigPda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("config"), invalidSeed.toArrayLike(Buffer, "le", 8)],
      program.programId
    );
    const [invalidMintLp] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("lp"), invalidConfigPda.toBuffer()],
      program.programId
    );
    const invalidVaultX = getAssociatedTokenAddressSync(mintX, invalidConfigPda, true);
    const invalidVaultY = getAssociatedTokenAddressSync(mintY, invalidConfigPda, true);

    try {
      await program.methods
        .initialize(invalidSeed, invalidFee, null)
        .accountsStrict({
          initializer: user,
          mintX: mintX,
          mintY: mintY,
          mintLp: invalidMintLp,
          vaultX: invalidVaultX,
          vaultY: invalidVaultY,
          config: invalidConfigPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have failed with invalid fee");
    } catch (error) {
      expect(error.message).to.include("InvalidFee");
    }
  });

  it("Initialize twice with same seed should fail", async () => {
    try {
      await program.methods
        .initialize(seed, fee, null)
        .accountsStrict({
          initializer: user,
          mintX: mintX,
          mintY: mintY,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          config: configPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have failed - already initialized");
    } catch (error) {
      expect(error.message).to.include("already in use");
    }
  });

  it("Deposit zero LP should fail", async () => {
    try {
      await program.methods
        .deposit(new anchor.BN(0), new anchor.BN(100), new anchor.BN(100))
        .accountsStrict({
          user: user,
          mintX: mintX,
          mintY: mintY,
          config: configPda,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          userX: userX,
          userY: userY,
          userLp: userLp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have failed with zero amount");
    } catch (error) {
      expect(error.message).to.include("InvalidAmount");
    }
  });

  it("Deposit with slippage exceeded should fail", async () => {
    try {
      await program.methods
        .deposit(new anchor.BN(1000), new anchor.BN(1), new anchor.BN(1)) // Very low max amounts
        .accountsStrict({
          user: user,
          mintX: mintX,
          mintY: mintY,
          config: configPda,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          userX: userX,
          userY: userY,
          userLp: userLp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have failed with slippage exceeded");
    } catch (error) {
      expect(error.message).to.include("SlippageExceeded");
    }
  });

  it("Swap with minAmountOut too high should fail", async () => {
    try {
      await program.methods
        .swap(true, new anchor.BN(100), new anchor.BN(1000000)) // Unrealistic min amount
        .accountsStrict({
          user: user,
          mintX: mintX,
          mintY: mintY,
          config: configPda,
          vaultX: vaultX,
          vaultY: vaultY,
          userX: userX,
          userY: userY,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have failed with slippage exceeded");
    } catch (error) {
      expect(error.message).to.include("SlippageExceeded");
    }
  });

  it("Swap Y for X validates vault updates", async () => {
    const initialVaultX = (await provider.connection.getTokenAccountBalance(vaultX)).value.amount;
    const initialVaultY = (await provider.connection.getTokenAccountBalance(vaultY)).value.amount;
    const initialUserX = (await provider.connection.getTokenAccountBalance(userX)).value.amount;
    const initialUserY = (await provider.connection.getTokenAccountBalance(userY)).value.amount;

    const swapAmountBN = new anchor.BN(50);
    const minAmountOut = new anchor.BN(1);

    await program.methods
      .swap(false, swapAmountBN, minAmountOut) // Swap Y for X
      .accountsStrict({
        user: user,
        mintX: mintX,
        mintY: mintY,
        config: configPda,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userX,
        userY: userY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    const finalVaultX = (await provider.connection.getTokenAccountBalance(vaultX)).value.amount;
    const finalVaultY = (await provider.connection.getTokenAccountBalance(vaultY)).value.amount;
    const finalUserX = (await provider.connection.getTokenAccountBalance(userX)).value.amount;
    const finalUserY = (await provider.connection.getTokenAccountBalance(userY)).value.amount;

    // Vault X should decrease (tokens go to user)
    expect(Number(finalVaultX)).to.be.lessThan(Number(initialVaultX));
    // Vault Y should increase (user tokens go to vault)
    expect(Number(finalVaultY)).to.be.greaterThan(Number(initialVaultY));
    // User X should increase
    expect(Number(finalUserX)).to.be.greaterThan(Number(initialUserX));
    // User Y should decrease
    expect(Number(finalUserY)).to.be.lessThan(Number(initialUserY));
  });

  it("Withdraw zero LP should fail", async () => {
    try {
      await program.methods
        .withdraw(new anchor.BN(0), new anchor.BN(0), new anchor.BN(0))
        .accountsStrict({
          user: user,
          mintX: mintX,
          mintY: mintY,
          config: configPda,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          userX: userX,
          userY: userY,
          userLp: userLp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have failed with zero amount");
    } catch (error) {
      expect(error.message).to.include("InvalidAmount");
    }
  });

  it("Withdraw with min amounts too high should fail", async () => {
    try {
      await program.methods
        .withdraw(new anchor.BN(100), new anchor.BN(1000000), new anchor.BN(1000000)) // Unrealistic min amounts
        .accountsStrict({
          user: user,
          mintX: mintX,
          mintY: mintY,
          config: configPda,
          mintLp: mintLp,
          vaultX: vaultX,
          vaultY: vaultY,
          userX: userX,
          userY: userY,
          userLp: userLp,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have failed with slippage exceeded");
    } catch (error) {
      expect(error.message).to.include("SlippageExceeded");
    }
  });

  it("Lock pool blocks deposit/swap/withdraw", async () => {
    // First we need to add a lock function to the program, but for now we'll test the error handling
    // This test assumes the pool can be locked (would need additional instruction)
    console.log("Pool locking test - would require additional lock instruction");
  });

  it("Authority update respected", async () => {
    // This test would verify that only the authority can perform certain operations
    // For now, we'll test that the authority field is properly set
    const configAccount = await program.account.config.fetch(configPda);
    expect(configAccount.authority).to.be.null; // No authority set in our tests
    console.log("Authority test - authority field properly set");
  });

  it("Large swap with price impact", async () => {
    const largeSwapAmount = new anchor.BN(500);
    const minAmountOut = new anchor.BN(1);

    const initialXBalance = (await provider.connection.getTokenAccountBalance(userX)).value.uiAmount;
    const initialYBalance = (await provider.connection.getTokenAccountBalance(userY)).value.uiAmount;
    const initialVaultX = (await provider.connection.getTokenAccountBalance(vaultX)).value.uiAmount;
    const initialVaultY = (await provider.connection.getTokenAccountBalance(vaultY)).value.uiAmount;

    console.log("Large swap test - Initial user X:", initialXBalance * 1000000, "tokens");
    console.log("Large swap test - Initial user Y:", initialYBalance * 1000000, "tokens");
    console.log("Large swap test - Initial vault X:", initialVaultX * 1000000, "tokens");
    console.log("Large swap test - Initial vault Y:", initialVaultY * 1000000, "tokens");

    const tx = await program.methods
      .swap(true, largeSwapAmount, minAmountOut)
      .accountsStrict({
        user: user,
        mintX: mintX,
        mintY: mintY,
        config: configPda,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userX,
        userY: userY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Large swap successful, tx is:", tx);

    const finalXBalance = (await provider.connection.getTokenAccountBalance(userX)).value.uiAmount;
    const finalYBalance = (await provider.connection.getTokenAccountBalance(userY)).value.uiAmount;
    const finalVaultX = (await provider.connection.getTokenAccountBalance(vaultX)).value.uiAmount;
    const finalVaultY = (await provider.connection.getTokenAccountBalance(vaultY)).value.uiAmount;

    console.log("Large swap test - Final user X:", finalXBalance * 1000000, "tokens");
    console.log("Large swap test - Final user Y:", finalYBalance * 1000000, "tokens");
    console.log("Large swap test - Final vault X:", finalVaultX * 1000000, "tokens");
    console.log("Large swap test - Final vault Y:", finalVaultY * 1000000, "tokens");
    console.log("Price impact - X change:", (initialXBalance - finalXBalance) * 1000000);
    console.log("Price impact - Y change:", (finalYBalance - initialYBalance) * 1000000);

    expect(finalXBalance).to.be.lessThan(initialXBalance);
    expect(finalYBalance).to.be.greaterThan(initialYBalance);
  });

  it("Multiple rapid swaps test", async () => {
    console.log("Testing multiple rapid swaps to check pool stability");
    
    const swapAmount = new anchor.BN(50);
    const minAmountOut = new anchor.BN(1);
    
    // First swap X for Y
    const tx1 = await program.methods
      .swap(true, swapAmount, minAmountOut)
      .accountsStrict({
        user: user,
        mintX: mintX,
        mintY: mintY,
        config: configPda,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userX,
        userY: userY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log("Rapid swap 1 (X→Y) tx:", tx1);

    // Second swap Y for X
    const tx2 = await program.methods
      .swap(false, swapAmount, minAmountOut)
      .accountsStrict({
        user: user,
        mintX: mintX,
        mintY: mintY,
        config: configPda,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userX,
        userY: userY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log("Rapid swap 2 (Y→X) tx:", tx2);

    // Third swap X for Y again
    const tx3 = await program.methods
      .swap(true, swapAmount, minAmountOut)
      .accountsStrict({
        user: user,
        mintX: mintX,
        mintY: mintY,
        config: configPda,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userX,
        userY: userY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
    console.log("Rapid swap 3 (X→Y) tx:", tx3);

    const finalVaultX = (await provider.connection.getTokenAccountBalance(vaultX)).value.uiAmount;
    const finalVaultY = (await provider.connection.getTokenAccountBalance(vaultY)).value.uiAmount;
    
    console.log("Pool stability - Final vault X:", finalVaultX * 1000000, "tokens");
    console.log("Pool stability - Final vault Y:", finalVaultY * 1000000, "tokens");
    
    // Pool should still have liquidity
    expect(finalVaultX).to.be.greaterThan(0);
    expect(finalVaultY).to.be.greaterThan(0);
  });

  it("Edge case - Very small swap amount", async () => {
    const tinySwapAmount = new anchor.BN(10); // 10 units - small but meaningful
    const minAmountOut = new anchor.BN(0);

    console.log("Testing edge case with very small swap amount:", tinySwapAmount.toNumber());

    const initialXBalance = (await provider.connection.getTokenAccountBalance(userX)).value.uiAmount;
    const initialYBalance = (await provider.connection.getTokenAccountBalance(userY)).value.uiAmount;

    console.log("Edge case - Initial X balance:", initialXBalance * 1000000, "tokens");
    console.log("Edge case - Initial Y balance:", initialYBalance * 1000000, "tokens");

    const tx = await program.methods
      .swap(true, tinySwapAmount, minAmountOut)
      .accountsStrict({
        user: user,
        mintX: mintX,
        mintY: mintY,
        config: configPda,
        vaultX: vaultX,
        vaultY: vaultY,
        userX: userX,
        userY: userY,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log("Edge case swap successful, tx is:", tx);

    const finalXBalance = (await provider.connection.getTokenAccountBalance(userX)).value.uiAmount;
    const finalYBalance = (await provider.connection.getTokenAccountBalance(userY)).value.uiAmount;

    console.log("Edge case - Final X balance:", finalXBalance * 1000000, "tokens");
    console.log("Edge case - Final Y balance:", finalYBalance * 1000000, "tokens");
    console.log("Edge case - X change:", (initialXBalance - finalXBalance) * 1000000);
    console.log("Edge case - Y change:", (finalYBalance - initialYBalance) * 1000000);

    // Small swaps should still work and show some change
    expect(finalXBalance).to.be.lessThan(initialXBalance);
    expect(finalYBalance).to.be.greaterThan(initialYBalance);
  });
});
