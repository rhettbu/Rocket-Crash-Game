import Chat from "models/Chat";
import User from "models/User";
import { Server } from "socket.io";
import { IUser } from "types";
import jwt, { TokenExpiredError } from "jsonwebtoken";

export const setupChatServer = (io: Server) => {
  const chatNamespace = io.of("/chat");

  let user: IUser | null = null;
  let logged: boolean = false;

  chatNamespace.on("connection", (socket) => {
    console.log("Chat user connected");

    socket.emit("online-users", chatNamespace.sockets.size);

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

    socket.on("f-t-message", async (msg) => {
      if (logged && user) {
        try {
          const chatMessage = new Chat({
            message: msg,
            user: user._id,
          });
          await chatMessage.save();
          chatNamespace.emit("chat message", msg);
        } catch (error) {
          console.error("Error saving chat message:", error);
          socket.emit("error", "Failed to send message.");
        }
      }
    });

    socket.on("get-chat-history", async () => {
      try {
        const messages = await Chat.find()
          .sort({ sentAt: 1 })
          .limit(80)
          .populate("user")
          .lean()
          .exec();

        socket.emit("chat-history", messages);
      } catch (error) {
        console.error("Error retrieving chat history:", error);
        socket.emit("error", "Failed to retrieve chat history.");
      }
    });

    socket.on("disconnect", () => {
      console.log("Chat user disconnected");
    });
  });
};
