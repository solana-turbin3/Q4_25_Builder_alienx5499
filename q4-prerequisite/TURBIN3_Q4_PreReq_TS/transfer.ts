import {
    address,
    appendTransactionMessageInstructions,
    assertIsTransactionWithinSizeLimit,
    compileTransaction,
    createKeyPairSignerFromBytes,
    createSolanaRpc,
    createSolanaRpcSubscriptions,
    createTransactionMessage,
    devnet,
    getSignatureFromTransaction,
    lamports,
    pipe,
    sendAndConfirmTransactionFactory,
    setTransactionMessageFeePayerSigner,
    setTransactionMessageLifetimeUsingBlockhash,
    signTransactionMessageWithSigners,
    type TransactionMessageBytesBase64
} from "@solana/kit";

import { getTransferSolInstruction } from "@solana-program/system";

import wallet from "./dev-wallet.json";
const LAMPORTS_PER_SOL = BigInt(1_000_000_000);
const keypair = await createKeyPairSignerFromBytes(new Uint8Array(wallet));

// Define our Turbin3 wallet to send to
const turbin3Wallet = address('6nboEL1qiAMG2kWhcUubMGREBYMeLAr7ggt9ZDojh1XR');

const rpc = createSolanaRpc(devnet("https://api.devnet.solana.com"));
const rpcSubscriptions = createSolanaRpcSubscriptions(devnet('wss://api.devnet.solana.com'));

const transferInstruction = getTransferSolInstruction({
    source: keypair,
    destination: turbin3Wallet,
    amount: lamports(1n * LAMPORTS_PER_SOL)
   });
const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    tx => setTransactionMessageFeePayerSigner(keypair, tx),
    tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    tx => appendTransactionMessageInstructions([transferInstruction], tx)
);

const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);

assertIsTransactionWithinSizeLimit(signedTransaction);
const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({rpc, rpcSubscriptions });
try {
        await sendAndConfirmTransaction(
            signedTransaction,
            { commitment: 'confirmed' }
        );
        const signature = getSignatureFromTransaction(signedTransaction);
        console.log(`Success! Check out your TX here:
        https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    } catch (e) {
        console.error('Transfer failed:', e);
}

// First get the balance from our wallet
const { value: balance } = await rpc.getBalance(keypair.address).send();

// Build a dummy transfer instruction with 0 amount to calculate the fee
const dummyTransferInstruction = getTransferSolInstruction({
    source: keypair,
    destination: turbin3Wallet,
    amount: lamports(0n)
});
const dummyTransactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    tx => setTransactionMessageFeePayerSigner(keypair, tx),
    tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash,tx),
    tx => appendTransactionMessageInstructions([dummyTransferInstruction], tx),
);

// Compile the dummy transaction message to get the message bytes
const compiledDummy = compileTransaction(dummyTransactionMessage);
const dummyMessageBase64 = Buffer.from(compiledDummy.messageBytes).toString('base64') as TransactionMessageBytesBase64;
// Calculate the transaction fee
const { value: fee } = await rpc.getFeeForMessage(dummyMessageBase64).send() || 0n;

    if (fee === null) {
       throw new Error('Unable to calculate transaction fee');
    }

    if (balance < fee ) {
        throw new Error(`Insufficient balance to cover the transaction fee. Balance: ${balance}, Fee: ${fee}`);
    }

// Calculate the exact amount to send (balance minus fee)
const sendAmount = balance - fee;
const transferInstruction2 = getTransferSolInstruction({
    source: keypair,
    destination: turbin3Wallet,
    amount: lamports(sendAmount)
});

const transactionMessage2 = pipe(
    createTransactionMessage({ version: 0 }),
    tx => setTransactionMessageFeePayerSigner(keypair, tx),
    tx => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
    tx => appendTransactionMessageInstructions([transferInstruction2], tx)
);
const signedTransaction2 = await signTransactionMessageWithSigners(transactionMessage2);
    assertIsTransactionWithinSizeLimit(signedTransaction2);

const sendAndConfirmTransaction2 = sendAndConfirmTransactionFactory({rpc, rpcSubscriptions });

try {
    await sendAndConfirmTransaction2(signedTransaction2,{ commitment: 'confirmed' });
    const signature = getSignatureFromTransaction(signedTransaction2);
    console.log(`Success! Check out your TX here: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
} catch (e) {
    console.error('Transfer failed:', e);
}