import User from "models/User";
import { Server } from "socket.io";
import { IUser } from "types";
import jwt, { TokenExpiredError } from "jsonwebtoken";
import SiteTransaction from "models/SiteTransaction";
import Mine from "models/Mine";
import Transaction from "models/Transaction";

interface IGameState {
  _id: string;
  status: number;
  startedAt: Date;
  crashPoint: number;
  betAmount: number;
  map: number[];
  mines: number;
}

const GAME_STATES = {
  NotStarted: 1,
  Starting: 2,
  InProgress: 3,
  Over: 4,
  Blocking: 5,
  Refunded: 6,
};

const frequencyQuery = [
  3, 1, 2, 1, 3, 1, 1, 2.5, 1, 1, 2, 2.5, 3, 2.5, 2, 1, 1, 2.5, 1, 1, 3, 1, 2,
  1, 2,
];

const GAME_STATE: IGameState = {
  _id: "",
  status: GAME_STATES.Starting,
  startedAt: new Date(),
  crashPoint: 0,
  betAmount: 0,
  map: [],
  mines: 0,
};

let side = 0;

const createRandomMatrix = (n: number) => {
  // Create an array of indices representing positions in the freqArray
  const indices = Array.from({ length: 25 }, (_, i) => i);

  const weights = [...frequencyQuery];

  const finalArray = Array(25).fill(1);

  function weightedRandom(weights: number[]) {
    let sum = weights.reduce((a, b) => a + b, 0);
    let random = Math.random() * sum;

    for (let i = 0; i < weights.length; i++) {
      if (random < weights[i]) return i;
      random -= weights[i];
    }

    return weights.length - 1;
  }

  for (let i = 0; i < n; i++) {
    const idx = weightedRandom(weights);
    finalArray[indices[idx]] = 0;
    weights.splice(idx, 1);
    indices.splice(idx, 1);
  }

  return finalArray;
};

export const setupMineServer = (io: Server) => {
  const mineNamespace = io.of("/mines");
  let user: IUser | null = null;
  let logged: boolean = false;

  mineNamespace.on("connection", (socket) => {
    console.log("Mine game user connected");

    const growthFunc = (step: number) => {
      const cashout = Math.floor(
        100 * Math.pow(Math.E, 0.1 * Math.pow(step * side, 1.00008))
      );
      socket.emit("cashout", cashout);

      return cashout;
    };

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

    socket.on("join-game", async (target, betAmount) => {
      console.log("minegame started");
      if (!logged) {
        return socket.emit("notify-error", "Please login your account");
      }

      if (
        parseFloat(betAmount.toFixed(2)) < 0.1 ||
        parseFloat(betAmount.toFixed(2)) > 50000
      ) {
        return socket.emit(
          "game-join-error",
          `Your bet must be a minimum of ${0.1} credits and a maximum of ${50000} credits!`
        );
      }

      if (GAME_STATE.status !== GAME_STATES.Starting)
        return socket.emit("game-join-error", "Game is currently in progress!");

      GAME_STATE.betAmount = betAmount;

      if (!user) {
        return socket.emit(
          "game-join-error",
          "You didn't authenticate your account."
        );
      }

      if (user.wallet < parseFloat(betAmount.toFixed(2))) {
        return socket.emit("game-join-error", "You can't afford this bet!");
      }

      const newGame = new Mine({
        crashPoint: 0,
        player: user._id,
      });

      const currentGame = await newGame.save();

      await User.updateOne(
        { crypto: user.crypto },
        {
          $inc: {
            wallet: -Math.abs(parseFloat(betAmount.toFixed(2))),
          },
        }
      );

      const newTransaction = new Transaction({
        user: user._id,
        tranType: 3,
        walletAddress: user.crypto,
        amount: Number(betAmount),
        game: 2,
      });
      await newTransaction.save();

      mineNamespace.emit(
        "update_wallet",
        user.wallet - Math.abs(parseFloat(betAmount.toFixed(2)))
      );

      GAME_STATE._id = currentGame._id as string;
      GAME_STATE.mines = target;

      if (target === 1) {
        side = 2 / 3;
      } else if (target === 3) {
        side = 1;
      } else if (target === 5) {
        side = 2.1;
      }
      const mainArray = createRandomMatrix(target);

      GAME_STATE.map = mainArray;
      return socket.emit("started-game");
    });

    socket.on("open-box", async (id, step) => {
      if (GAME_STATE.map[id]) {
        GAME_STATE.crashPoint = growthFunc(step);

        socket.emit("open-step", step);

        if (step + GAME_STATE.mines === 24) {
          socket.emit("end-game", GAME_STATE.map);

          await User.updateOne(
            { crypto: user?.crypto },
            {
              $inc: {
                wallet: Math.abs(
                  parseFloat(
                    (
                      (GAME_STATE.crashPoint * GAME_STATE.betAmount) /
                      100
                    ).toFixed(2)
                  )
                ),
              },
            }
          );

          const newTransaction = {
            userId: user?.id,
            bet: Math.abs(GAME_STATE.betAmount),
            type: 2,
            mineGameId: GAME_STATE._id,
            payout: parseFloat(
              ((GAME_STATE.crashPoint * GAME_STATE.betAmount) / 100).toFixed(2)
            ),
            multi: GAME_STATE.crashPoint,
            reason: "Mine Win",
            game: "mines",
          };

          await SiteTransaction.create(newTransaction);

          if (user?.wallet !== undefined) {
            socket.emit(
              "update_wallet",
              user.wallet +
                Math.abs((GAME_STATE.crashPoint * GAME_STATE.betAmount) / 100)
            );
          } else {
            return socket.emit("error", "User wallet is undefined.");
          }
        }
      } else {
        socket.emit("end-game", GAME_STATE.map);
        await Mine.updateOne({ _id: GAME_STATE._id }, { state: 3 });
      }
      socket.emit("current-state", GAME_STATE.map[id]);
    });

    socket.on("over-game", async () => {
      socket.emit("end-game", GAME_STATE.map);

      await User.updateOne(
        { _id: user?.id },
        {
          $inc: {
            wallet: Math.abs(
              parseFloat(
                ((GAME_STATE.crashPoint * GAME_STATE.betAmount) / 100).toFixed(
                  2
                )
              )
            ),
            mine: Math.abs(
              parseFloat(
                ((GAME_STATE.crashPoint * GAME_STATE.betAmount) / 100).toFixed(
                  2
                )
              )
            ),
          },
        }
      );

      if (user?.wallet !== undefined) {
        socket.emit(
          "update_wallet",
          user.wallet +
            Math.abs((GAME_STATE.crashPoint * GAME_STATE.betAmount) / 100)
        );
      } else {
        return socket.emit("error", "User wallet is undefined.");
      }

      const newWalletTxData = {
        userId: user.id,
        bet: Math.abs(GAME_STATE.betAmount),
        payout: Math.abs((GAME_STATE.crashPoint * GAME_STATE.betAmount) / 100),
        reason: "Mine Win",
        game: "mines",
        type: 2,
        extraData: { mineGameId: GAME_STATE._id },
        mineGameId: GAME_STATE._id,
        multi: GAME_STATE.crashPoint,
      };

      await SiteTransaction.create(newWalletTxData);

      await Mine.updateOne(
        { _id: GAME_STATE._id },
        {
          state: 3,
          crashPoint: (GAME_STATE.crashPoint * GAME_STATE.betAmount) / 100,
        }
      );
    });
  });
};
