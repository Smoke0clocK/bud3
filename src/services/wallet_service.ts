import * as crypto from "crypto";
import bs58 from "bs58";
import elliptic from "elliptic";

// Initialize elliptic for SecP256K1
const ec = new elliptic.ec("secp256k1");

export class WalletService {
  /**
   * Creates a new wallet with a private key, public key, and address.
   * @returns An object containing the private key, public key, and address.
   */
  createWallet(): { address: string; privateKey: string; publicKey: string } {
    const privateKey = crypto.randomBytes(32).toString("hex");
    const keyPair = ec.keyFromPrivate(privateKey, "hex");

    // Generate compressed public key
    const publicKey = keyPair.getPublic().encodeCompressed("hex");

    // Derive Alephium-compatible address
    const publicKeyBuffer = Buffer.from(publicKey, "hex");
    const hash = crypto.createHash("sha256").update(publicKeyBuffer).digest();
    const checksum = crypto.createHash("sha256").update(hash).digest().slice(0, 4);
    const addressBuffer = Buffer.concat([hash, checksum]);
    const address = bs58.encode(addressBuffer);

    console.log("Generated Address:", address);
    console.log("Public Key:", publicKey);
    console.log("Private Key:", privateKey);

    if (!this.isValidAlephiumAddress(address)) {
      throw new Error("Generated address does not conform to Alephium address standards.");
    }

    return { address, privateKey, publicKey };
  }

  /**
   * Sends a transaction from the wallet to a recipient.
   * @param wallet The wallet object containing private key, public key, and address.
   * @param recipientAddress The recipient's wallet address.
   * @param amount The amount to send in attoALPH.
   * @returns The transaction hash if successful.
   */
  async sendTransaction(
    wallet: { privateKey: string; publicKey: string; address: string },
    recipientAddress: string,
    amount: string
  ): Promise<string> {
    const transactionPayload = {
      fromAddress: wallet.address,
      fromPublicKey: wallet.publicKey,
      destinations: [
        {
          address: recipientAddress,
          attoAlphAmount: amount,
        },
      ],
      fee: "10000000", // Fee in attoALPH
    };

    // Build the transaction
    const buildResponse = await fetch(
      "https://node.testnet.alephium.org/transactions/build",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transactionPayload),
      }
    );

    if (!buildResponse.ok) {
      throw new Error(
        `Failed to build transaction: ${await buildResponse.text()}`
      );
    }

    const buildData = await buildResponse.json();

    // Sign the transaction
    const keyPair = ec.keyFromPrivate(wallet.privateKey, "hex");
    const signature = keyPair.sign(
      Buffer.from(buildData.transactionHash, "hex")
    );

    const submitPayload = {
      transaction: buildData.transaction,
      signatures: [signature.toDER("hex")],
    };

    // Submit the transaction
    const submitResponse = await fetch(
      "https://node.testnet.alephium.org/transactions/send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitPayload),
      }
    );

    if (!submitResponse.ok) {
      throw new Error(
        `Failed to send transaction: ${await submitResponse.text()}`
      );
    }

    const submitData = await submitResponse.json();
    return submitData.transactionHash;
  }

  /**
   * Validates if an address conforms to Alephium standards.
   * @param address The address to validate.
   * @returns True if the address is valid, false otherwise.
   */
  private isValidAlephiumAddress(address: string): boolean {
    return address.startsWith("1") && address.length >= 26 && address.length <= 35;
  }
}
