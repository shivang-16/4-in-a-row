import { LineOwner } from '../types/dots-and-boxes';

export interface DABMoveResult {
  hLines: LineOwner[][];
  vLines: LineOwner[][];
  boxes: LineOwner[][];
  scores: number[];
  currentTurn: number;
  boxesCompleted: number;
  gameOver: boolean;
  winner: string | null;
  rankings: { username: string; score: number; rank: number }[];
}

class DotsAndBoxesService {
  // ── Core game logic ────────────────────────────────────────────────────────

  makeMove(
    hLines: LineOwner[][],
    vLines: LineOwner[][],
    boxes: LineOwner[][],
    scores: number[],
    numPlayers: number,
    currentTurn: number,
    players: string[],
    moveType: 'h' | 'v',
    row: number,
    col: number
  ): DABMoveResult {
    const rows = boxes.length;
    const cols = boxes[0]!.length;

    // Deep-clone state
    const newH = hLines.map((r) => [...r]);
    const newV = vLines.map((r) => [...r]);
    const newBoxes = boxes.map((r) => [...r]);
    const newScores = [...scores];

    // Apply the move
    if (moveType === 'h') {
      newH[row]![col] = currentTurn;
    } else {
      newV[row]![col] = currentTurn;
    }

    // Which boxes might now be complete?
    const toCheck: [number, number][] = [];
    if (moveType === 'h') {
      if (row < rows) toCheck.push([row, col]);
      if (row > 0) toCheck.push([row - 1, col]);
    } else {
      if (col < cols) toCheck.push([row, col]);
      if (col > 0) toCheck.push([row, col - 1]);
    }

    let boxesCompleted = 0;
    for (const [br, bc] of toCheck) {
      if (newBoxes[br]![bc] === null && this.isBoxComplete(newH, newV, br, bc)) {
        newBoxes[br]![bc] = currentTurn;
        newScores[currentTurn]++;
        boxesCompleted++;
      }
    }

    // Same player goes again if they completed at least one box
    const nextTurn =
      boxesCompleted > 0 ? currentTurn : (currentTurn + 1) % numPlayers;

    // Game-over check: all boxes claimed
    const totalBoxes = rows * cols;
    const claimedBoxes = newBoxes.flat().filter((b) => b !== null).length;
    const gameOver = claimedBoxes === totalBoxes;

    let winner: string | null = null;
    let rankings: { username: string; score: number; rank: number }[] = [];

    if (gameOver) {
      const sorted = players
        .map((username, idx) => ({ username, score: newScores[idx] ?? 0 }))
        .sort((a, b) => b.score - a.score);

      const topScore = sorted[0]!.score;
      const tiedPlayers = sorted.filter((p) => p.score === topScore);
      winner = tiedPlayers.length > 1 ? 'tie' : tiedPlayers[0]!.username;

      let rank = 1;
      rankings = sorted.map((p, i) => {
        if (i > 0 && p.score < sorted[i - 1]!.score) rank = i + 1;
        return { ...p, rank };
      });
    }

    return {
      hLines: newH,
      vLines: newV,
      boxes: newBoxes,
      scores: newScores,
      currentTurn: gameOver ? currentTurn : nextTurn,
      boxesCompleted,
      gameOver,
      winner,
      rankings,
    };
  }

  isBoxComplete(
    hLines: LineOwner[][],
    vLines: LineOwner[][],
    r: number,
    c: number
  ): boolean {
    return (
      hLines[r]![c] !== null &&
      hLines[r + 1]![c] !== null &&
      vLines[r]![c] !== null &&
      vLines[r]![c + 1] !== null
    );
  }

  countSides(
    hLines: LineOwner[][],
    vLines: LineOwner[][],
    r: number,
    c: number
  ): number {
    let s = 0;
    if (hLines[r]![c] !== null) s++;
    if (hLines[r + 1]![c] !== null) s++;
    if (vLines[r]![c] !== null) s++;
    if (vLines[r]![c + 1] !== null) s++;
    return s;
  }

  getValidMoves(
    hLines: LineOwner[][],
    vLines: LineOwner[][]
  ): { type: 'h' | 'v'; r: number; c: number }[] {
    const moves: { type: 'h' | 'v'; r: number; c: number }[] = [];
    for (let r = 0; r < hLines.length; r++) {
      for (let c = 0; c < hLines[r]!.length; c++) {
        if (hLines[r]![c] === null) moves.push({ type: 'h', r, c });
      }
    }
    for (let r = 0; r < vLines.length; r++) {
      for (let c = 0; c < vLines[r]!.length; c++) {
        if (vLines[r]![c] === null) moves.push({ type: 'v', r, c });
      }
    }
    return moves;
  }
}

export const dotsAndBoxesService = new DotsAndBoxesService();
