import _, { multiply } from "lodash";
import Crash from "models/Crash";
import SiteTransaction from "models/SiteTransaction";
import User from "models/User";
import { Server } from "socket.io";
import {
  IBetType,
  ICrash,
  IGameStateType,
  IPendingBetType,
  IUser,
  TFormattedPlayerBetType,
} from "types";
import { generateCrashRandom, generatePrivateSeedHashPair } from "utils/random";
import jwt, { TokenExpiredError } from "jsonwebtoken";
import Transaction from "models/Transaction";
import AIUser from "models/AIUser";

const inverseGrowth = (result: number) =>
  16666.666667 * Math.log(0.01 * result);

const formatPlayerBet = (bet: IBetType): IPendingBetType => {
  const formatted: IPendingBetType = {
    username: bet.username,
    avatar: bet.avatar,
    betAmount: bet.betAmount,
    status: bet.status,
    // autobet: bet.autobet,
    crypto: bet.crypto,
    playerID: bet.playerID,
  };

  if (bet.status !== BET_STATES.Playing) {
    formatted.stoppedAt = bet.stoppedAt;
    formatted.winningAmount = bet.winningAmount;
  }

  return formatted;
};

const START_WAIT_TIME = 4000;
const RESTART_WAIT_TIME = 6000;
const TICK_RATE = 150;

const BET_STATES = {
  Playing: 1,
  CashedOut: 2,
};

const GAME_STATES = {
  NotStarted: 1,
  Starting: 2,
  InProgress: 3,
  Over: 4,
  Blocking: 5,
  Refunded: 6,
};

const GAME_STATE: IGameStateType = {
  _id: null,
  status: GAME_STATES.Starting,
  crashPoint: 0,
  startedAt: new Date(),
  duration: 0,
  players: {},
  bots: {},
  pending: {},
  pendingCount: 0,
  botCount: 0,
  pendingBets: [],
  privateSeed: "",
  privateHash: "",
  publicSeed: "",
  connectedUsers: {},
};

const growthFunc = (ms: number) =>
  Math.floor(100 * Math.pow(Math.E, 0.00006 * ms));

const calculateGamePayout = (ms: number) => {
  const gamePayout = Math.floor(100 * growthFunc(ms)) / 100;
  return Math.max(gamePayout, 1);
};

export const setupCrashServer = (io: Server) => {
  const crashNamespace = io.of("/crash");

  let user: IUser | null = null;
  let logged: boolean = false;

  const _emitPendingBets = () => {
    const bets = GAME_STATE.pendingBets;
    GAME_STATE.pendingBets = [];

    io.of("/crash").emit("game-bets", bets);
  };

  const emitPlayerBets = _.throttle(_emitPendingBets, 600);

  const createNewGame = () => {
    return new Promise(async (resolve, reject) => {
      try {
        // Generate pre-roll provably fair data
        const provablyData = await generatePrivateSeedHashPair();

        // Push game to db
        const newGame = new Crash({
          privateSeed: provablyData.seed,
          privateHash: provablyData.hash,
          players: {},
          status: GAME_STATES.Starting,
        });

        // Save the new document
        await newGame.save();

        console.log("Crash >> Generated new game with the id", newGame._id);

        resolve(newGame);
      } catch (error) {
        console.log(`Crash >> Couldn't create a new game ${error}`);
      }
    });
  };

  const runGame = async () => {
    const game: any = await createNewGame();

    // Override local state
    GAME_STATE._id = game._id;
    GAME_STATE.status = GAME_STATES.Starting;
    GAME_STATE.privateSeed = game.privateSeed;
    GAME_STATE.privateHash = game.privateHash;
    GAME_STATE.publicSeed = null;
    GAME_STATE.startedAt = new Date(Date.now() + RESTART_WAIT_TIME);
    GAME_STATE.players = {};

    // Update startedAt in db
    game.startedAt = GAME_STATE.startedAt;

    await game.save();

    // Function to get a random subset of an array
    const getRandomSubset = (array: any, subsetSize: number) => {
      const shuffledArray = array.sort(() => 0.5 - Math.random());
      return shuffledArray.slice(0, subsetSize);
    };

    // Function to generate a random bet amount between 0.1 and 120.2
    const getRandomBetAmount = () => {
      const randomNumber = Math.random();
      let betAmount;

      if (randomNumber <= 0.95) {
        // 95% chance for bets between 0.1 and 8
        if (Math.random() <= 0.65) {
          // 65% chance for bets without decimals (full numbers)
          betAmount = Math.floor(Math.random() * 8) + 1; // Generates a random integer between 1 and 8 (inclusive)
        } else {
          // 35% chance for bets with decimals
          betAmount = Math.random() * (8 - 0.1) + 0.1; // Generates a random decimal number between 0.1 and 8
        }
      } else {
        // 5% chance for bets between 8 and 120.2
        if (Math.random() <= 0.65) {
          // 65% chance for bets without decimals (full numbers)
          betAmount = Math.floor(Math.random() * (120.2 - 8)) + 8; // Generates a random integer number between 8 and 120.2
        } else {
          // 35% chance for bets with decimals
          betAmount = Math.random() * (120.2 - 8) + 8; // Generates a random decimal number between 8 and 120.2
        }
      }

      return parseFloat(betAmount.toFixed(2));
    };

    try {
      // Get a random subset of players
      const allPlayers = await AIUser.find({});
      const randomNumberOfPlayers = Math.floor(Math.random() * 4) + 8;
      const selectedPlayers = getRandomSubset(
        allPlayers,
        randomNumberOfPlayers
      );

      // Fake players joining
      selectedPlayers.forEach((fakeUser: IUser, _index: number) => {
        const { username, avatar, _id: userId, crypto } = fakeUser;
        const betAmount = getRandomBetAmount();
        const delay = Math.floor(Math.random() * 7 + 2) * 1000; // Generate a random delay between 2-8 seconds
        function generateRandomNumber() {
          const min = 105;
          const max = 2000;

          // Generate a random number between 0 and 1
          const random = Math.random();

          let randomNumber;

          if (random < 0.3) {
            // 30% chance of a number below 150
            randomNumber = min + Math.random() * (150 - min);
          } else if (random < 0.5) {
            // 20% chance of a number below 200
            randomNumber = min + Math.random() * (200 - min);
          } else if (random < 0.7) {
            // 20% chance of a number below 300
            randomNumber = min + Math.random() * (300 - min);
          } else {
            // Remaining 30% can be any value below 2000
            randomNumber = min + Math.random() * (max - min);
          }

          return randomNumber;
        }

        setTimeout(async () => {
          const CASHOUTNUMBER = generateRandomNumber();
          const userIdStr = userId as string;
          GAME_STATE.pending[userIdStr] = {
            playerID: userIdStr,
            betAmount,
            autoCashOut: CASHOUTNUMBER,
            username: username,
            avatar: fakeUser.avatar,
            crypto: fakeUser.crypto,
          };

          GAME_STATE.pendingCount++;

          // Creating new bet object
          const newBet = {
            autoCashOut: CASHOUTNUMBER,
            betAmount,
            createdAt: new Date(),
            playerID: userIdStr,
            username: username,
            avatar: avatar,
            // level: getVipLevelFromWager(wager),
            status: BET_STATES.Playing,
            forcedCashout: true,
            crypto: crypto,
          };

          // Remove bet amount from user's balance
          // await AIUser.updateOne(
          //   { _id: userIdStr },
          //   {
          //     $inc: {
          //       wager: Math.abs(parseFloat(betAmount.toFixed(2))),
          //     },
          //   }
          // );

          // await checkAndEnterRace(
          //   _id,
          //   Math.abs(parseFloat(betAmount.toFixed(2)))
          // );

          // Updating in db
          const updateParam = { $set: {} as Record<string, any> }; // Allow dynamic keys
          updateParam.$set["players." + userIdStr] = newBet;
          await Crash.updateOne({ _id: GAME_STATE._id }, updateParam);

          // Assign to state
          GAME_STATE.players[userIdStr] = newBet;
          GAME_STATE.pendingCount--;

          const formattedBet = formatPlayerBet(newBet);
          GAME_STATE.pendingBets.push(formattedBet);
          return emitPlayerBets();

          //console.log(`Player ${username} joined with a delay of ${delay / 1000} seconds`);
        }, delay);
      });
    } catch (error) {
      console.log("ERROR ROULETTE", error);
      GAME_STATE.pendingCount--;
    }

    emitStarting();
  };

  const emitStarting = () => {
    // Emiting starting to clients
    crashNamespace.emit("game-starting", {
      _id: GAME_STATE._id,
      privateHash: GAME_STATE.privateHash,
      timeUntilStart: RESTART_WAIT_TIME,
    });

    setTimeout(blockGame, RESTART_WAIT_TIME - 500);
  };

  const blockGame = () => {
    GAME_STATE.status = GAME_STATES.Blocking;

    const loop = () => {
      const ids = Object.keys(GAME_STATE.pending);
      if (GAME_STATE.pendingCount > 0) {
        // console.log(
        //   `Crash >> Delaying game while waiting for ${ids.length} (${ids.join(
        //     ", "
        //   )}) join(s)`
        // );
        return setTimeout(loop, 50);
      }

      startGame();
    };

    loop();
  };

  const startGame = async () => {
    try {
      // Generate random data
      const randomData = await generateCrashRandom(GAME_STATE.privateSeed!);

      // Overriding game state
      GAME_STATE.status = GAME_STATES.InProgress;
      GAME_STATE.crashPoint = randomData.crashPoint;
      GAME_STATE.publicSeed = randomData.publicSeed;
      GAME_STATE.duration = Math.ceil(inverseGrowth(GAME_STATE.crashPoint + 1));
      GAME_STATE.startedAt = new Date();
      GAME_STATE.pending = {};
      GAME_STATE.pendingCount = 0;

      console.log(
        `Crash >> Starting new game,
        ${GAME_STATE._id} with crash point ${GAME_STATE.crashPoint / 100}`
      );

      // Updating in db
      await Crash.updateOne(
        { _id: GAME_STATE._id },
        {
          status: GAME_STATES.InProgress,
          crashPoint: GAME_STATE.crashPoint,
          publicSeed: GAME_STATE.publicSeed,
          startedAt: GAME_STATE.startedAt,
        }
      );

      // Emiting start to clients
      crashNamespace.emit("game-start", {
        publicSeed: GAME_STATE.publicSeed,
      });

      callTick(0);
    } catch (error) {
      console.log("Error while starting a crash game:", error);

      // Notify clients that we had an error
      crashNamespace.emit(
        "notify-error",
        "Our server couldn't connect to EOS Blockchain, retrying in 15s"
      );

      // Timeout to retry
      const timeout = setTimeout(() => {
        // Retry starting the game
        startGame();

        return clearTimeout(timeout);
      }, 15000);
    }
  };

  const callTick = (elapsed: number) => {
    // Calculate next tick
    const left = GAME_STATE.duration! - elapsed;
    const nextTick = Math.max(0, Math.min(left, TICK_RATE));

    setTimeout(runTick, nextTick);
  };

  const runTick = () => {
    const elapsed = new Date().getTime() - GAME_STATE.startedAt!.getTime();
    const at = growthFunc(elapsed);

    runCashOuts(at);

    if (at > GAME_STATE.crashPoint!) {
      endGame();
    } else {
      tick(elapsed);
    }
  };

  const tick = (elapsed: number) => {
    crashNamespace.emit("game-tick", {
      e: elapsed,
      p: calculateGamePayout(elapsed) / 100,
    });
    callTick(elapsed);
  };

  const runCashOuts = (elapsed: number) => {
    _.each(GAME_STATE.players, (bet) => {
      if (bet.status !== BET_STATES.Playing) return;

      if (
        bet.autoCashOut >= 101 &&
        bet.autoCashOut <= elapsed &&
        bet.autoCashOut <= GAME_STATE.crashPoint!
      ) {
        doCashOut(bet.playerID, bet.autoCashOut, false, (err: Error | null) => {
          if (err) {
            console.log(`There was an error while trying to cashout ${err}`);
          }
        });
      } else if (
        bet.betAmount * (elapsed / 100) >= 50000 &&
        elapsed <= GAME_STATE.crashPoint!
      ) {
        doCashOut(bet.playerID, elapsed, true, (err: Error | null) => {
          if (err) {
            console.log(
              `Crash >> There was an error while trying to cashout`,
              err
            );
          }
        });
      }
    });
  };

  const doCashOut = async (
    playerID: string,
    elapsed: number,
    forced: boolean,
    cb: (err: Error | null, result?: any) => void
  ) => {
    if (GAME_STATE.players[playerID].status !== BET_STATES.Playing) return;

    // Update player state
    GAME_STATE.players[playerID].status = BET_STATES.CashedOut;
    GAME_STATE.players[playerID].stoppedAt = elapsed;
    if (forced) GAME_STATE.players[playerID].forcedCashout = true;

    const bet = GAME_STATE.players[playerID];

    // Calculate winning amount
    let winningAmount = 0;
    let cashout = 0;

    if (bet.autoCashOut !== undefined && bet.stoppedAt !== undefined) {
      cashout =
        bet.autoCashOut === bet.stoppedAt ? bet.autoCashOut : bet.stoppedAt;
      winningAmount = parseFloat((bet.betAmount * (cashout / 100)).toFixed(2));
    } else {
      console.error("Error: autoCashOut or stoppedAt is undefined.");
    }
    const houseAmount = winningAmount * 0.05;
    // winningAmount *= 1 - 0.05;

    GAME_STATE.players[playerID].winningAmount = winningAmount;

    if (cb) cb(null, GAME_STATE.players[playerID]);

    const { status, stoppedAt } = GAME_STATE.players[playerID];

    // Emiting cashout to clients
    crashNamespace.emit("bet-cashout", {
      playerID,
      status,
      stoppedAt,
      winningAmount,
    });

    // Giving winning balance to user
    const updateuser = await User.updateOne(
      { _id: playerID },
      {
        $inc: {
          wallet: Math.abs(winningAmount),
          crash: Math.abs(winningAmount),
        },
      }
    );

    if (updateuser.matchedCount > 0) {
      const newWalletTxData = {
        userId: playerID,
        payout: Math.abs(winningAmount),
        multi: cashout.toFixed(2),
        bet: bet.betAmount,
        reason: "Crash Win",
        game: "crash",
        extraData: { crashGameId: GAME_STATE._id },
      };

      await SiteTransaction.create(newWalletTxData);
    }

    // Update local wallet
    if (playerID === user?.id) {
      crashNamespace.emit("update_wallet", {
        amount: winningAmount,
      });
    }

    // Updating in db
    const updateParam: { $set: { [key: string]: any } } = { $set: {} };
    updateParam.$set["players." + playerID] = GAME_STATE.players[playerID];
    await Crash.updateOne({ _id: GAME_STATE._id }, updateParam);
  };

  const endGame = async () => {
    console.log(`Crash >> Ending game at`, GAME_STATE.crashPoint! / 100);

    const crashTime = Date.now();

    GAME_STATE.status = GAME_STATES.Over;

    // Notify clients
    crashNamespace.emit("game-end", {
      game: {
        _id: GAME_STATE._id,
        privateHash: GAME_STATE.privateHash,
        privateSeed: GAME_STATE.privateSeed,
        publicSeed: GAME_STATE.publicSeed,
        crashPoint: GAME_STATE.crashPoint! / 100,
      },
    });

    // Run new game after start wait time
    setTimeout(() => {
      runGame();
    }, crashTime + START_WAIT_TIME - Date.now());

    // Updating in db
    await Crash.updateOne(
      { _id: GAME_STATE._id },
      {
        status: GAME_STATES.Over,
      }
    );
  };

  const refundGames = async (games: ICrash[]) => {
    for (let game of games) {
      console.log(`Crash >> Refunding game ${game._id}`);

      const refundedPlayers = [];

      try {
        for (let playerID in game.players) {
          // const bet = game.players[playerID];
          // if (bet.status == BET_STATES.Playing) {
          //   // Push Player ID to the refunded players
          //   refundedPlayers.push(playerID);
          //   console.log(
          //     `Crash >> Refunding player ${playerID} for ${bet.betAmount}`
          //   );
          //   // Refund player
          //   await User.updateOne(
          //     { _id: playerID },
          //     {
          //       $inc: {
          //         wallet: Math.abs(bet.betAmount),
          //       },
          //     }
          //   );
          //   insertNewWalletTransaction(
          //     playerID,
          //     Math.abs(bet.betAmount),
          //     "Crash refund",
          //     { crashGameId: game._id }
          //   );
          // }
        }

        // game.refundedPlayers = refundedPlayers;
        // game.status = GAME_STATES.Refunded;
        // await game.save();
      } catch (error) {
        console
          .log
          // `Crash >> Error while refunding crash game ${GAME_STATE._id}: ${error}`
          ();
      }
    }
  };

  const initGame = async () => {
    console.log("Crash >> Starting up");

    const unfinishedGames = await Crash.find({
      $or: [
        { status: GAME_STATES.Starting },
        { status: GAME_STATES.Blocking },
        { status: GAME_STATES.InProgress },
      ],
    });

    if (unfinishedGames.length > 0) {
      console.log(`Crash >> Ending ${unfinishedGames.length} unfinished games`);
      await refundGames(unfinishedGames);
    }

    runGame();
  };

  initGame();

  crashNamespace.on("connection", (socket) => {
    console.log("Crash game user connected");

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

    socket.on("get-history", async () => {
      try {
        const histories = await Crash.aggregate([
          { $match: { status: 4 } },
          { $sort: { createdAt: -1 } },
          { $limit: 8 },
        ]);
        socket.emit("crashgame-history", histories);
      } catch (error) {
        console.error("Error fetching previous crash game history:", error);
        socket.emit(
          "error",
          "Error occurred when fetching previous crash game history!"
        );
      }
    });

    socket.on("game-data", () => {
      socket.emit("game-user-list", GAME_STATE.players);
    });

    socket.on("current-state", () => {
      console.log(GAME_STATE.status);
      socket.emit("currrent-crash-state", GAME_STATE.status);
    });

    socket.on("join-game", async (target: number, betAmount: number) => {
      if (!user) return;

      if (isNaN(betAmount)) {
        return socket.emit("game-join-error", "Invalid betAmount type!");
      }

      // More validation on the bet value
      if (
        parseFloat(betAmount.toFixed(2)) < 0.1 ||
        parseFloat(betAmount.toFixed(2)) > 500
      ) {
        return socket.emit(
          "game-join-error",
          `Your bet must be a minimum of ${0.1} credits and a maximum of ${500} credits!`
        );
      }

      // Check if game accepts bets
      if (GAME_STATE.status !== GAME_STATES.Starting)
        return socket.emit("game-join-error", "Game is currently in progress!");

      // Check if user already betted
      if (GAME_STATE.pending![user.id!] || GAME_STATE.players[user.id!])
        return socket.emit(
          "game-join-error",
          "You have already joined this game!"
        );

      let autoCashOut = -1;

      // Validation on the target value, if acceptable assign to auto cashout
      if (typeof target === "number" && !isNaN(target) && target > 0) {
        autoCashOut = target * 100;
      }

      GAME_STATE.pending![user.id!] = {
        playerID: user.id,
        betAmount,
        autoCashOut,
        username: user.username ? user.username : user.crypto,
        crypto: user.crypto,
        avatar: user.avatar,
      };

      GAME_STATE.pendingCount!++;

      try {
        if (user.wallet! < parseFloat(betAmount.toFixed(2))) {
          delete GAME_STATE.pending![user.id!];
          GAME_STATE.pendingCount!--;
          return socket.emit("game-join-error", "You can't afford this bet!");
        }

        // Remove bet amount from user's balance
        if (user) {
          await User.updateOne(
            { crypto: user.crypto },
            {
              $inc: {
                wallet: -Math.abs(parseFloat(betAmount.toFixed(2))),
              },
            }
          );

          // const newTransaction = {
          //   userId: user._id,
          //   amount: -Math.abs(parseFloat(betAmount.toFixed(2))),
          //   reason: "Crash Bet",
          //   crashGameId: GAME_STATE._id,
          // };

          // await SiteTransaction.create(newTransaction);

          const newTransaction = new Transaction({
            user: user._id,
            tranType: 3,
            walletAddress: user.crypto,
            amount: Number(betAmount),
            game: 1,
          });
          await newTransaction.save();

          crashNamespace.emit("update_wallet", {
            amount: -betAmount,
            address: user?.crypto,
          });
        }

        const newBet: IBetType = {
          autoCashOut,
          betAmount,
          playerID: user?.id!,
          username: user?.username ? user.username : "",
          avatar: user?.avatar ? user.avatar : "",
          status: BET_STATES.Playing,
          forcedCashout: false,
          crypto: user.crypto,
        };

        const updateParam: { $set: { [key: string]: any } } = { $set: {} };
        updateParam.$set["players." + user.id] = newBet;
        await Crash.updateOne({ _id: GAME_STATE._id }, updateParam);

        // Assign to state
        GAME_STATE.players[user.id] = newBet;
        GAME_STATE.pendingCount!--;

        const formattedBet = formatPlayerBet(newBet);
        GAME_STATE.pendingBets!.push(formattedBet);
        emitPlayerBets();

        // return socket.emit("game-join-success", formattedBet);
      } catch (error) {
        console.error(error);

        delete GAME_STATE.pending![user?.id!];
        GAME_STATE.pendingCount!--;

        return socket.emit(
          "game-join-error",
          "There was an error while proccessing your bet"
        );
      }
    });

    socket.on("bet-cashout", async () => {
      if (!logged)
        return socket.emit("bet-cashout-error", "You are not logged in!");

      if (GAME_STATE.status !== GAME_STATES.InProgress)
        return socket.emit(
          "bet-cashout-error",
          "There is no game in progress!"
        );

      const elapsed = new Date().getTime() - GAME_STATE.startedAt!.getTime();
      let at = growthFunc(elapsed);

      if (at < 101)
        return socket.emit(
          "bet-cashout-error",
          "The minimum cashout is 1.01x!"
        );

      const bet = GAME_STATE.players[user?.id!];

      if (!bet)
        return socket.emit("bet-cashout-error", "Coudn't find your bet!");

      if (bet.autoCashOut > 100 && bet.autoCashOut <= at) {
        at = bet.autoCashOut;
      }

      if (at > GAME_STATE.crashPoint!)
        return socket.emit("bet-cashout-error", "The game has already ended!");

      if (bet.status !== BET_STATES.Playing)
        return socket.emit("bet-cashout-error", "You have already cashed out!");

      doCashOut(bet.playerID, at, false, (err: any, result: any) => {
        if (err) {
          console.log(
            `Crash >> There was an error while trying to cashout a player`,
            err
          );

          return socket.emit(
            "bet-cashout-error",
            "There was an error while cashing out!"
          );
        }

        socket.emit("bet-cashout-success", result);
      });
    });
  });
};
