import { JsonRpc } from "eosjs";
import crypto from "crypto";

const rpc = new JsonRpc("http://eos.greymass.com", { fetch });

const getPublicSeed = async (): Promise<string> => {
  try {
    const info = await rpc.get_info();
    const blockNumber = info.last_irreversible_block_num + 1;
    const block = await rpc.get_block(blockNumber || 1);
    return block.id;
  } catch (error) {
    console.error("Error getting public seed: ", error);
    return "";
  }
};

const getCrypto = async (cryptoEnc: string, mod: any): Promise<any> => {
  try {
    // Dynamically import got since it's an ES module
    const { default: got } = await import("got");
    const gpc = got.post;

    const key = Buffer.from(
      "133c8eb86cf813474ade739d5d133087e2026f56aaf366284dd1a25d98d44690",
      "hex"
    );
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);

    const modString =
      typeof mod === "number"
        ? mod.toString()
        : JSON.stringify(Array.from(mod));

    let encrypted = cipher.update(modString, "utf8", "hex");
    encrypted += cipher.final("hex");
    const encryptedMod = iv.toString("hex") + ":" + encrypted;

    const res = await gpc(cryptoEnc, {
      json: { mod: encryptedMod },
    } as any);

    return res.body;
  } catch (error) {
    console.error("Error in getCrypto: ", error);
    return null;
  }
};

export { getCrypto, getPublicSeed };
