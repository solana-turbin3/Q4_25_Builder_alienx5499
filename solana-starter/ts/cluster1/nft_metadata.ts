import wallet from "../turbin3-wallet.json"
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults"
import { createGenericFile, createSignerFromKeypair, signerIdentity } from "@metaplex-foundation/umi"
import { irysUploader } from "@metaplex-foundation/umi-uploader-irys"

// Create a devnet connection
const umi = createUmi('https://api.devnet.solana.com');

let keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(wallet));
const signer = createSignerFromKeypair(umi, keypair);

umi.use(irysUploader());
umi.use(signerIdentity(signer));

(async () => {
    try {
        // Build NFT metadata JSON pointing to your uploaded image
        const imageUri = "https://gateway.irys.xyz/ATJHhd8zb3ArgZAjidVgkCp9KgNnvtXbtFP5gRHJEuYZ";

        const metadata = {
            name: "alienXrug",
            symbol: "XRUG",
            description: "A legendary pixel art rug by alienx5499 bold, iconic, and collectible.",
            image: imageUri,
            attributes: [
                { trait_type: "rarity", value: "Legendary" },
                { trait_type: "creator", value: "alienx5499" },
                { trait_type: "pattern", value: "grid" },
                { trait_type: "grid_rows", value: "6" },
                { trait_type: "grid_cols", value: "4" },
                { trait_type: "border", value: "multicolor tabs" },
                { trait_type: "dominant_colors", value: "magenta, cyan, purple, black" },
                { trait_type: "accent_colors", value: "lime, orange, blue" },
                { trait_type: "style", value: "pixel art" }
            ],
            properties: {
                files: [
                    {
                        type: "image/png",
                        uri: imageUri
                    }
                ]
            },
            creators: []
        };

        const myUri = await umi.uploader.uploadJson(metadata);
        console.log("Your metadata URI: ", myUri);
    }
    catch(error) {
        console.log("Oops.. Something went wrong", error);
    }
})();
