import { Server } from "socket.io";
import jwt, { TokenExpiredError } from "jsonwebtoken";
import User from "models/User";
import { IUser } from "types";
import SiteTransaction from "models/SiteTransaction";
import Coinflip from "models/Coinflip";
import {
  generateCoinflipRandom,
  generatePrivateSeedHashPair,
} from "utils/random";
import Transaction from "models/Transaction";

const GAME_STATES = {
  Starting: 1,
  InProgress: 2,
  Over: 3,
};

interface IGameState {
  _id: string;
  status: number;
  startedAt: Date;
  crashPoint: number;
  betAmount: number;
}

const GAME_STATE: IGameState = {
  _id: "",
  status: GAME_STATES.Starting,
  crashPoint: 0,
  startedAt: new Date(),
  betAmount: 0,
};

const getWinningSide = async (
  randomModule: number,
  heads: number,
  count: number
) => {
  return new Promise((resolve) => {
    resolve(randomModule >= (100 * heads) / count ? true : false);
  });
};

export const setupCoinflipServer = (io: Server) => {
  const coinflipNamespace = io.of("/coinflip");

  let user: IUser | null = null;
  let logged: boolean = false;

  coinflipNamespace.on("connection", (socket) => {
    console.log("Coinflip user connected");

    socket.on("auth", async (data) => {
      try {
        const decoded = jwt.verify(data.token, "540skeh2006h2kl34jzzsd23") as {
          address: string;
        };

        if (data.address !== decoded.address) {
          return socket.emit(
            "auth-error",
            "Your token isn't an approved token."
          );
        }

        user = await User.findOne({ crypto: data.address });
        logged = true;
      } catch (error) {
        if (error instanceof TokenExpiredError) {
          return socket.emit(
            "expire-error",
            "Token has expired. Please log in again."
          );
        }
        return socket.emit("error", "Authentication failed.");
      }
    });

    socket.on(
      "create-new-game",
      async (data: { amount: number; heads: number; count: number }) => {
        const { amount, heads, count } = data;

        if (isNaN(amount)) {
          return socket.emit("game-join-error", "Invalid betAmount type!");
        }

        if (!user) {
          return socket.emit(
            "game-join-error",
            "You didn't authenticate your account."
          );
        }

        if (
          parseFloat(amount.toFixed(2)) < 0.1 ||
          parseFloat(amount.toFixed(2)) > 50000
        ) {
          return socket.emit(
            "game-creation-error",
            `Your bet must be a minimum of ${0.1} credits and a maximum of ${50000} credits!`
          );
        }

        try {
          if (user.wallet < parseFloat(amount.toFixed(2))) {
            return socket.emit("game-join-error", "You can't afford this bet!");
          }

          await User.updateOne(
            { crypto: user.crypto },
            { $inc: { wallet: -Math.abs(parseFloat(amount.toFixed(2))) } }
          );

          socket.emit(
            "update-wallet",
            user.wallet - Math.abs(parseFloat(amount.toFixed(2)))
          );

          const newGame = new Coinflip({
            crashPoint: 0,
            player: user.id,
            state: GAME_STATE.status,
            betAmount: amount,
          });

          const game = await newGame.save();
          GAME_STATE._id = game.id;

          // const newTransaction = {
          //   userId: user._id,
          //   bet: -Math.abs(parseFloat(amount.toFixed(2))),
          //   reason: "Coinflip Bet",
          //   game: "coinflip",
          //   crashGameId: GAME_STATE._id,
          // };

          // await SiteTransaction.create(newTransaction);

          const newTransaction = new Transaction({
            user: user._id,
            tranType: 3,
            walletAddress: user.crypto,
            amount: Number(amount),
            game: 3,
          });
          await newTransaction.save();

          const provablyData = await generatePrivateSeedHashPair();

          const randomData: { publicSeed: string; module: number } =
            await generateCoinflipRandom(GAME_STATE._id, provablyData.seed);

          const winningSide = await getWinningSide(
            randomData.module,
            heads,
            count
          );

          if (winningSide) {
            await User.updateOne(
              { crypto: user.id },
              {
                $inc: {
                  wallet: Math.abs(amount * 2),
                  coinflip: Math.abs(amount * 2),
                },
              }
            );
          }

          socket.emit("game-end", winningSide);
        } catch (error) {}
      }
    );
  });
};
