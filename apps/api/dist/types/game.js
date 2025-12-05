"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WinReason = exports.GameStatus = exports.CellValue = exports.COLS = exports.ROWS = void 0;
exports.ROWS = 6;
exports.COLS = 7;
var CellValue;
(function (CellValue) {
    CellValue[CellValue["EMPTY"] = 0] = "EMPTY";
    CellValue[CellValue["PLAYER1"] = 1] = "PLAYER1";
    CellValue[CellValue["PLAYER2"] = 2] = "PLAYER2";
})(CellValue || (exports.CellValue = CellValue = {}));
var GameStatus;
(function (GameStatus) {
    GameStatus["WAITING"] = "waiting";
    GameStatus["IN_PROGRESS"] = "in_progress";
    GameStatus["COMPLETED"] = "completed";
    GameStatus["FORFEITED"] = "forfeited";
})(GameStatus || (exports.GameStatus = GameStatus = {}));
var WinReason;
(function (WinReason) {
    WinReason["HORIZONTAL"] = "horizontal";
    WinReason["VERTICAL"] = "vertical";
    WinReason["DIAGONAL"] = "diagonal";
    WinReason["DRAW"] = "draw";
    WinReason["FORFEIT"] = "forfeit";
    WinReason["OPPONENT_DISCONNECT"] = "opponent_disconnect";
})(WinReason || (exports.WinReason = WinReason = {}));
