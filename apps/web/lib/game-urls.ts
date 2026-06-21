/** Production URLs for each standalone game app (override via env in Vercel). */
export const GAME_URLS = {
  '4-in-a-row': process.env.NEXT_PUBLIC_FOUR_IN_A_ROW_URL ?? 'http://localhost:3010',
  'word-puzzle': process.env.NEXT_PUBLIC_WORD_PUZZLE_URL ?? 'http://localhost:3011',
  'dots-and-boxes': process.env.NEXT_PUBLIC_DOTS_AND_BOXES_URL ?? 'http://localhost:3012',
  bingo: process.env.NEXT_PUBLIC_BINGO_URL ?? 'http://localhost:3013',
  sudoku: process.env.NEXT_PUBLIC_SUDOKU_URL ?? 'http://localhost:3014',
} as const;
