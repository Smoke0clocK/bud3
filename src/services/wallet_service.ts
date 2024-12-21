import fetch from "node-fetch";
import * as elliptic from "elliptic";
import * as crypto from "crypto";

const ec = new elliptic.ec("secp256k1");

export class WalletService {
    createWallet() {
        const privateKey = crypto.randomBytes(32).toString("hex");
        const keyPair = ec.keyFromPrivate(privateKey);
        const publicKey = keyPair.getPublic("hex");
        const hash = crypto.createHash("sha256").update(publicKey, "hex").digest();
        const address = Buffer.concat([Buffer.from([0x42]), hash]).toString("hex");
        return { privateKey, publicKey, address };
    }

    async sendTransaction(wallet: { address: string; privateKey: string }, recipientAddress: string, amountToSend: string) {
        const transactionPayload = {
            fromAddress: wallet.address, // Wallet's generated address
            fromPublicKey: wallet.publicKey, // Wallet's public key
            destinations: [
                {
                    address: recipientAddress, // Recipient's address
                    attoAlphAmount: amountToSend, // Amount to send in atto ALPH
                },
            ],
            fee: "1000000000000", // Fee for the transaction
        };

        const buildResponse = await fetch("https://node.testnet.alephium.org/transactions/build", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(transactionPayload),
        });

        if (!buildResponse.ok) {
            throw new Error(`Failed to build transaction: ${await buildResponse.text()}`);
        }

        const buildData = await buildResponse.json();
        const keyPair = ec.keyFromPrivate(wallet.privateKey);
        const signature = keyPair.sign(Buffer.from(buildData.transactionHash, "hex")).toDER("hex");

        const submitPayload = {
            transaction: buildData.transaction,
            signatures: [signature],
        };

        const submitResponse = await fetch("https://node.testnet.alephium.org/transactions/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(submitPayload),
        });

        if (!submitResponse.ok) {
            throw new Error(`Failed to send transaction: ${await submitResponse.text()}`);
        }

        const submitData = await submitResponse.json();
        return submitData.transactionHash;
    }
}
