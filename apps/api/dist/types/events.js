"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameEventType = void 0;
var GameEventType;
(function (GameEventType) {
    GameEventType["GAME_STARTED"] = "game_started";
    GameEventType["MOVE_MADE"] = "move_made";
    GameEventType["GAME_ENDED"] = "game_ended";
    GameEventType["PLAYER_JOINED"] = "player_joined";
    GameEventType["PLAYER_DISCONNECTED"] = "player_disconnected";
    GameEventType["PLAYER_RECONNECTED"] = "player_reconnected";
    GameEventType["BOT_JOINED"] = "bot_joined";
})(GameEventType || (exports.GameEventType = GameEventType = {}));
