'use client';

import {
  useEffect, useState, useRef, useCallback,
} from 'react';
import { useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import {
  Home as HomeIcon, MessageSquare, Phone, Mic, MicOff,
} from 'lucide-react';
import styles from './sudoku.module.css';
import GameGuide from '@repo/game-ui/GameGuide';
import WinCelebration from '@repo/game-ui/WinCelebration';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

const PLAYER_COLORS = [
  '#f87171', '#60a5fa', '#4ade80', '#fbbf24',
  '#a78bfa', '#f472b6', '#34d399', '#fb923c',
];

const RANK_MEDAL = ['🥇', '🥈', '🥉'];

type Phase = 'menu' | 'matchmaking' | 'solo-setup' | 'solo' | 'playing' | 'ended';
type GameMode = 'bot' | 'quick' | 'friend' | 'solo';
type Difficulty = 'easy' | 'medium' | 'hard';

interface PlayerInfo {
  username: string;
  colorIndex: number;
  filledCount: number;
  rank: number | null;
  hintsUsed: number;
}

interface GameData {
  gameId: string;
  puzzle: number[][];
  difficulty: Difficulty;
  players: PlayerInfo[];
  yourUsername: string;
  yourColorIndex: number;
  isBot: boolean;
  botUsername: string | null;
}

interface RankEntry {
  username: string;
  rank: number;
  completedAt: number | null;
  hintsUsed: number;
}

interface ChatMessage {
  username: string;
  message: string;
  timestamp: number;
}

const DIFFICULTY_LABELS: Record<Difficulty, { label: string; desc: string; color: string }> = {
  easy:   { label: 'Easy',   desc: '~45 given cells',  color: '#4ade80' },
  medium: { label: 'Medium', desc: '~35 given cells',  color: '#fbbf24' },
  hard:   { label: 'Hard',   desc: '~25 given cells',  color: '#f87171' },
};

const TOTAL_BLANKS: Record<Difficulty, number> = {
  easy: 36,
  medium: 46,
  hard: 56,
};

export default function SudokuPage() {
  const router = useRouter();

  const [phase, setPhase]                 = useState<Phase>('menu');
  const [gameMode, setGameMode]           = useState<GameMode>('bot');
  const [difficulty, setDifficulty]       = useState<Difficulty>('medium');
  const [username, setUsername]           = useState('');
  const [nameInput, setNameInput]         = useState('');
  const [nameShake, setNameShake]         = useState(false);
  const [nameLocked, setNameLocked]       = useState(false);
  const [errorMsg, setErrorMsg]           = useState('');

  // Game state
  const [gameData, setGameData]           = useState<GameData | null>(null);
  const [puzzle, setPuzzle]               = useState<number[][]>([]);
  const [grid, setGrid]                   = useState<number[][]>([]); // player's current view (given + player moves)
  const [players, setPlayers]             = useState<PlayerInfo[]>([]);
  const [selectedCell, setSelectedCell]   = useState<[number, number] | null>(null);
  const [wrongCells, setWrongCells]       = useState<Set<string>>(new Set());
  const [hintCells, setHintCells]         = useState<Set<string>>(new Set());
  const [hintsUsed, setHintsUsed]         = useState(0);
  const [rankings, setRankings]           = useState<RankEntry[]>([]);
  const [winner, setWinner]               = useState<string | null>(null);
  const [completedUsers, setCompletedUsers] = useState<Set<string>>(new Set());

  const [showEndModal, setShowEndModal]   = useState(false);
  const [showGuide, setShowGuide]         = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const celebrationShownRef               = useRef(false);

  // Rematch
  const [rematchVotes, setRematchVotes]   = useState(0);
  const [rematchNeeded, setRematchNeeded] = useState(0);
  const [rematchVoted, setRematchVoted]   = useState(false);

  // Solo mode
  const [soloDifficulty, setSoloDifficulty] = useState<Difficulty>('medium');
  const [soloElapsed, setSoloElapsed]       = useState(0);
  const [soloCompleted, setSoloCompleted]   = useState(false);
  const [soloHintsUsed, setSoloHintsUsed]   = useState(0);
  const soloTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const soloSolutionRef = useRef<number[][] | null>(null);

  // Chat
  const [chatMessages, setChatMessages]   = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]         = useState('');
  const [chatOpen, setChatOpen]           = useState(false);
  const [unreadCount, setUnreadCount]     = useState(0);

  // Voice call
  const [callRoomActive, setCallRoomActive]     = useState(false);
  const [callMembers, setCallMembers]           = useState<string[]>([]);
  const [amInCall, setAmInCall]                 = useState(false);
  const [isMuted, setIsMuted]                   = useState(false);
  const [mutedUsers, setMutedUsers]             = useState<Set<string>>(new Set());
  const [speakingUsers, setSpeakingUsers]       = useState<Set<string>>(new Set());
  const [callTimerDisplay, setCallTimerDisplay] = useState('0:00');
  const [callStartedAt, setCallStartedAt]       = useState<number | null>(null);

  const socketRef             = useRef<Socket | null>(null);
  const gameDataRef           = useRef<GameData | null>(null);
  const chatEndRef            = useRef<HTMLDivElement>(null);
  const usernameRef           = useRef(username);
  const chatOpenRef           = useRef(chatOpen);
  const pendingHandled        = useRef(false);

  const localStreamRef        = useRef<MediaStream | null>(null);
  const peerConnectionsRef    = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingCandidatesRef  = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const callGameIdRef         = useRef<string | null>(null);
  const speakingStopFnsRef    = useRef<Map<string, () => void>>(new Map());

  useEffect(() => { gameDataRef.current = gameData; }, [gameData]);
  useEffect(() => { usernameRef.current = username; }, [username]);
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);

  useEffect(() => {
    const saved = sessionStorage.getItem('4inarow_username') || '';
    if (saved) setNameInput(saved);
  }, []);

  // ── Call timer ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!callStartedAt) return;
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - callStartedAt) / 1000);
      setCallTimerDisplay(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(id);
  }, [callStartedAt]);

  useEffect(() => {
    if (chatOpen) chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatOpen]);

  // ── Client-side puzzle generator (mirrors backend) ────────────────────────
  const generateClientPuzzle = useCallback((diff: Difficulty): { puzzle: number[][]; solution: number[][] } => {
    const HOLES_MAP: Record<Difficulty, number> = { easy: 36, medium: 46, hard: 56 };

    function isValid(g: number[][], r: number, c: number, n: number) {
      if (g[r]!.includes(n)) return false;
      for (let i = 0; i < 9; i++) if (g[i]![c] === n) return false;
      const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
      for (let i = br; i < br + 3; i++) for (let j = bc; j < bc + 3; j++) if (g[i]![j] === n) return false;
      return true;
    }
    function fill(g: number[][]): boolean {
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        if (g[r]![c] === 0) {
          const nums = [1,2,3,4,5,6,7,8,9].sort(() => Math.random() - 0.5);
          for (const n of nums) {
            if (isValid(g, r, c, n)) { g[r]![c] = n; if (fill(g)) return true; g[r]![c] = 0; }
          }
          return false;
        }
      }
      return true;
    }
    function countSols(g: number[][], lim = 2): number {
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
        if (g[r]![c] === 0) {
          let cnt = 0;
          for (let n = 1; n <= 9; n++) {
            if (isValid(g, r, c, n)) { g[r]![c] = n; cnt += countSols(g, lim - cnt); g[r]![c] = 0; if (cnt >= lim) return cnt; }
          }
          return cnt;
        }
      }
      return 1;
    }

    const sol = Array.from({ length: 9 }, () => new Array(9).fill(0) as number[]);
    fill(sol);
    const puz = sol.map((r) => [...r]);
    const positions = Array.from({ length: 81 }, (_, i) => i).sort(() => Math.random() - 0.5);
    let holes = HOLES_MAP[diff];
    for (const pos of positions) {
      if (holes === 0) break;
      const r = Math.floor(pos / 9), c = pos % 9;
      const bk = puz[r]![c]!;
      puz[r]![c] = 0;
      const cp = puz.map((row) => [...row]);
      if (countSols(cp) !== 1) puz[r]![c] = bk;
      else holes--;
    }
    return { puzzle: puz, solution: sol };
  }, []);

  // ── Initialize game state ──────────────────────────────────────────────────
  const applyGameStart = useCallback((data: GameData) => {
    setGameData(data);
    setPuzzle(data.puzzle.map((r) => [...r]));
    setGrid(data.puzzle.map((r) => [...r]));
    setPlayers(data.players);
    setSelectedCell(null);
    setWrongCells(new Set());
    setHintCells(new Set());
    setHintsUsed(0);
    setRankings([]);
    setWinner(null);
    setCompletedUsers(new Set());
    celebrationShownRef.current = false;
    setPhase('playing');
  }, []);

  // ── WebRTC helpers ─────────────────────────────────────────────────────────
  const stopSpeakingDetection = useCallback((peerId: string) => {
    const stop = speakingStopFnsRef.current.get(peerId);
    if (stop) { stop(); speakingStopFnsRef.current.delete(peerId); }
  }, []);

  const startSpeakingDetection = useCallback((peerId: string, stream: MediaStream) => {
    stopSpeakingDetection(peerId);
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      let speaking = false;
      const interval = setInterval(() => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        if (avg > 15 && !speaking) { speaking = true; setSpeakingUsers((p) => new Set([...p, peerId])); }
        else if (avg <= 15 && speaking) { speaking = false; setSpeakingUsers((p) => { const n = new Set(p); n.delete(peerId); return n; }); }
      }, 150);
      speakingStopFnsRef.current.set(peerId, () => { clearInterval(interval); ctx.close(); });
    } catch { /* ignore */ }
  }, [stopSpeakingDetection]);

  const createPeerConnection = useCallback((peerId: string, sock: Socket, gameId: string) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!));
    pc.onicecandidate = (e) => { if (e.candidate) sock.emit('call:ice', { gameId, to: peerId, candidate: e.candidate }); };
    pc.ontrack = (e) => {
      const stream = e.streams[0]; if (!stream) return;
      startSpeakingDetection(peerId, stream);
      let audio = document.getElementById(`audio-${peerId}`) as HTMLAudioElement | null;
      if (!audio) { audio = document.createElement('audio'); audio.id = `audio-${peerId}`; audio.autoplay = true; document.body.appendChild(audio); }
      audio.srcObject = stream;
    };
    peerConnectionsRef.current.set(peerId, pc);
    return pc;
  }, [startSpeakingDetection]);

  const cleanupCall = useCallback(() => {
    peerConnectionsRef.current.forEach((pc, id) => { stopSpeakingDetection(id); pc.close(); });
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    document.querySelectorAll('audio[id^="audio-"]').forEach((el) => el.remove());
    setAmInCall(false); setIsMuted(false); setCallStartedAt(null);
    setSpeakingUsers(new Set()); callGameIdRef.current = null;
  }, [stopSpeakingDetection]);

  // ── Socket listeners ───────────────────────────────────────────────────────
  const setupSocketListeners = useCallback((sock: Socket) => {
    sock.on('sudoku:placed', (data: { username: string; row: number; col: number; digit: number; correct: boolean; players: PlayerInfo[] }) => {
      setPlayers(data.players);
      if (data.username === usernameRef.current) {
        setGrid((prev) => {
          const next = prev.map((r) => [...r]);
          next[data.row]![data.col] = data.digit;
          return next;
        });
        if (!data.correct && data.digit !== 0) {
          setWrongCells((p) => new Set([...p, `${data.row},${data.col}`]));
          setTimeout(() => {
            setWrongCells((p) => { const n = new Set(p); n.delete(`${data.row},${data.col}`); return n; });
          }, 1200);
        } else {
          setWrongCells((p) => { const n = new Set(p); n.delete(`${data.row},${data.col}`); return n; });
        }
      }
    });

    sock.on('sudoku:hint:given', (data: { row: number; col: number; value: number; hintsUsed: number }) => {
      setHintsUsed(data.hintsUsed);
      setHintCells((p) => new Set([...p, `${data.row},${data.col}`]));
      setGrid((prev) => {
        const next = prev.map((r) => [...r]);
        next[data.row]![data.col] = data.value;
        return next;
      });
    });

    sock.on('sudoku:player:completed', (data: { username: string; rank: number; rankings: RankEntry[] }) => {
      setRankings(data.rankings);
      setCompletedUsers((p) => new Set([...p, data.username]));
      if (data.username === usernameRef.current && !celebrationShownRef.current) {
        celebrationShownRef.current = true;
        setShowCelebration(true);
      }
    });

    sock.on('sudoku:game:ended', (data: { winner: string | null; rankings: RankEntry[] }) => {
      setWinner(data.winner);
      setRankings(data.rankings);
      setShowEndModal(true);
      if (data.winner === usernameRef.current && !celebrationShownRef.current) {
        celebrationShownRef.current = true;
        setShowCelebration(true);
      }
    });

    sock.on('sudoku:game:started', (data: GameData) => {
      celebrationShownRef.current = false;
      setRematchVoted(false);
      setRematchVotes(0);
      setShowEndModal(false);
      setWinner(null);
      setRankings([]);
      setChatMessages([]);
      applyGameStart(data);
    });

    sock.on('sudoku:rematch:progress', (data: { votes: number; needed: number }) => {
      setRematchVotes(data.votes);
      setRematchNeeded(data.needed);
    });

    sock.on('sudoku:chat:message', (msg: ChatMessage) => {
      setChatMessages((p) => [...p, msg]);
      if (!chatOpenRef.current) setUnreadCount((n) => n + 1);
    });

    sock.on('sudoku:error', (data: { message: string }) => {
      setErrorMsg(data.message);
      setTimeout(() => setErrorMsg(''), 3000);
    });

    // Voice call (same as bingo)
    sock.on('call:started', (data: { gameId: string; initiator: string; members: string[] }) => {
      setCallRoomActive(true); setCallMembers(data.members); callGameIdRef.current = data.gameId;
    });
    sock.on('call:peer_joined', (data: { username: string; members: string[] }) => { setCallMembers(data.members); });
    sock.on('call:peer_left', (data: { username: string; members: string[] }) => {
      setCallMembers(data.members);
      const pc = peerConnectionsRef.current.get(data.username);
      if (pc) { pc.close(); peerConnectionsRef.current.delete(data.username); }
      stopSpeakingDetection(data.username);
      document.getElementById(`audio-${data.username}`)?.remove();
      if (data.members.length <= 1) { setCallRoomActive(false); cleanupCall(); }
    });
    sock.on('call:ended', () => { setCallRoomActive(false); cleanupCall(); });
    sock.on('call:offer', async (data: { from: string; offer: RTCSessionDescriptionInit; gameId: string }) => {
      if (!localStreamRef.current) return;
      const pc = createPeerConnection(data.from, sock, data.gameId);
      await pc.setRemoteDescription(data.offer);
      const pending = pendingCandidatesRef.current.get(data.from) ?? [];
      for (const c of pending) await pc.addIceCandidate(c);
      pendingCandidatesRef.current.delete(data.from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sock.emit('call:answer', { gameId: data.gameId, to: data.from, answer });
    });
    sock.on('call:answer', async (data: { from: string; answer: RTCSessionDescriptionInit }) => {
      const pc = peerConnectionsRef.current.get(data.from);
      if (pc) await pc.setRemoteDescription(data.answer);
    });
    sock.on('call:ice', async (data: { from: string; candidate: RTCIceCandidateInit }) => {
      const pc = peerConnectionsRef.current.get(data.from);
      if (pc && pc.remoteDescription) await pc.addIceCandidate(data.candidate);
      else {
        const arr = pendingCandidatesRef.current.get(data.from) ?? [];
        arr.push(data.candidate);
        pendingCandidatesRef.current.set(data.from, arr);
      }
    });
    sock.on('call:mute', (data: { username: string; muted: boolean }) => {
      setMutedUsers((p) => { const n = new Set(p); if (data.muted) n.add(data.username); else n.delete(data.username); return n; });
    });
  }, [applyGameStart, cleanupCall, createPeerConnection, stopSpeakingDetection]);

  // ── Name confirm ───────────────────────────────────────────────────────────
  const confirmName = useCallback(() => {
    const trimmed = nameInput.trim();
    if (!trimmed) { setNameShake(true); setTimeout(() => setNameShake(false), 600); return; }
    sessionStorage.setItem('4inarow_username', trimmed);
    setUsername(trimmed);
    setNameLocked(true);
  }, [nameInput]);

  // ── Mode select ────────────────────────────────────────────────────────────
  const handleModeSelect = useCallback((mode: GameMode) => {
    const name = (nameInput || username).trim();
    if (!name) { setNameShake(true); setTimeout(() => setNameShake(false), 600); return; }
    if (!nameLocked) { sessionStorage.setItem('4inarow_username', name); setUsername(name); setNameLocked(true); }
    setGameMode(mode);

    if (mode === 'friend') {
      router.push('/room/new');
      return;
    }

    const sock = io(API_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = sock;
    setupSocketListeners(sock);

    sock.on('connect', () => {
      sock.emit('player:join', { username: name });
      if (mode === 'bot') {
        sock.emit('sudoku:bot:start', { username: name, difficulty });
      } else {
        sock.emit('sudoku:queue:join', { username: name, difficulty });
      }
    });

    sock.on('sudoku:game:started', (data: GameData) => {
      applyGameStart(data);
    });

    sock.on('sudoku:queue:queued', () => {
      setPhase('matchmaking');
    });

    sock.on('connect_error', () => {
      setErrorMsg('Could not connect to server. Please try again.');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameInput, username, nameLocked, difficulty, router, setupSocketListeners, applyGameStart]);

  // ── Solo start ────────────────────────────────────────────────────────────
  const handleStartSolo = useCallback(() => {
    const name = (nameInput || username).trim();
    if (!name) { setNameShake(true); setTimeout(() => setNameShake(false), 600); return; }
    if (!nameLocked) { sessionStorage.setItem('4inarow_username', name); setUsername(name); setNameLocked(true); }

    const { puzzle: puz, solution: sol } = generateClientPuzzle(soloDifficulty);
    soloSolutionRef.current = sol;
    setPuzzle(puz.map((r) => [...r]));
    setGrid(puz.map((r) => [...r]));
    setSelectedCell(null);
    setWrongCells(new Set());
    setHintCells(new Set());
    setHintsUsed(0);
    setSoloElapsed(0);
    setSoloCompleted(false);
    setSoloHintsUsed(0);
    setGameData({
      gameId: 'solo',
      puzzle: puz,
      difficulty: soloDifficulty,
      players: [{ username: name, colorIndex: 0, filledCount: 0, rank: null, hintsUsed: 0 }],
      yourUsername: name,
      yourColorIndex: 0,
      isBot: false,
      botUsername: null,
    });
    setPlayers([{ username: name, colorIndex: 0, filledCount: 0, rank: null, hintsUsed: 0 }]);

    if (soloTimerRef.current) clearInterval(soloTimerRef.current);
    soloTimerRef.current = setInterval(() => setSoloElapsed((n) => n + 1), 1000);
    setGameMode('solo');
    setPhase('solo');
  }, [nameInput, username, nameLocked, soloDifficulty, generateClientPuzzle]);

  // ── Pending game from room lobby ───────────────────────────────────────────
  useEffect(() => {
    if (pendingHandled.current) return;
    const pending = sessionStorage.getItem('sudoku_pending_game');
    if (!pending) return;
    pendingHandled.current = true;
    sessionStorage.removeItem('sudoku_pending_game');

    try {
      const data: GameData = JSON.parse(pending);
      const savedName = data.yourUsername;
      setUsername(savedName);
      setNameInput(savedName);
      setNameLocked(true);
      setGameMode('friend');

      const sock = io(API_URL, { transports: ['websocket', 'polling'] });
      socketRef.current = sock;
      setupSocketListeners(sock);

      sock.on('connect', () => {
        sock.emit('player:join', { username: savedName });
        sock.emit('sudoku:rejoin', { gameId: data.gameId, username: savedName });
      });

      sock.on('sudoku:rejoined', (state: {
        puzzle: number[][]; playerGrid: number[][];
        difficulty: Difficulty; players: PlayerInfo[];
        status: string; winner: string | null; rankings: RankEntry[];
        hintsUsed: number;
      }) => {
        setPuzzle(state.puzzle.map((r) => [...r]));
        setGrid(state.playerGrid?.map((r) => [...r]) ?? state.puzzle.map((r) => [...r]));
        setPlayers(state.players ?? []);
        if (state.status === 'completed' || state.winner) {
          setWinner(state.winner);
          setRankings(state.rankings ?? []);
          setShowEndModal(true);
          setPhase('playing');
        } else {
          setPhase('playing');
        }
        setHintsUsed(state.hintsUsed ?? 0);
      });

      applyGameStart(data);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Game actions ───────────────────────────────────────────────────────────
  const handleCellClick = useCallback((r: number, c: number) => {
    if (puzzle[r]?.[c] !== 0) return; // given cell — not selectable
    setSelectedCell([r, c]);
  }, [puzzle]);

  const handleDigitInput = useCallback((digit: number) => {
    if (!selectedCell) return;
    const [r, c] = selectedCell;
    if (puzzle[r]?.[c] !== 0) return; // guard given cell

    const gameId = gameDataRef.current?.gameId;
    if (!gameId || !socketRef.current) return;

    socketRef.current.emit('sudoku:place', { gameId, row: r, col: c, digit });
  }, [selectedCell, puzzle]);

  const handleHint = useCallback(() => {
    const gameId = gameDataRef.current?.gameId;
    if (!gameId || !socketRef.current) return;
    socketRef.current.emit('sudoku:hint', { gameId });
  }, []);

  const handleSoloDigit = useCallback((digit: number) => {
    if (!selectedCell || soloCompleted) return;
    const [r, c] = selectedCell;
    if (puzzle[r]?.[c] !== 0) return;
    const sol = soloSolutionRef.current;
    if (!sol) return;

    if (digit === 0) {
      setGrid((prev) => { const next = prev.map((row) => [...row]); next[r]![c] = 0; return next; });
      setWrongCells((p) => { const n = new Set(p); n.delete(`${r},${c}`); return n; });
      setHintCells((p) => { const n = new Set(p); n.delete(`${r},${c}`); return n; });
      return;
    }

    const correct = sol[r]![c] === digit;
    setGrid((prev) => { const next = prev.map((row) => [...row]); next[r]![c] = digit; return next; });
    setHintCells((p) => { const n = new Set(p); n.delete(`${r},${c}`); return n; });

    if (!correct) {
      setWrongCells((p) => new Set([...p, `${r},${c}`]));
      setTimeout(() => setWrongCells((p) => { const n = new Set(p); n.delete(`${r},${c}`); return n; }), 1200);
      return;
    }
    setWrongCells((p) => { const n = new Set(p); n.delete(`${r},${c}`); return n; });

    // Check completion
    setGrid((prev) => {
      const totalBlanksCount = prev.flat().filter((_, idx) => {
        const row = Math.floor(idx / 9), col = idx % 9;
        return puzzle[row]?.[col] === 0;
      }).length;
      let filled = 0;
      for (let rr = 0; rr < 9; rr++) {
        for (let cc = 0; cc < 9; cc++) {
          if (puzzle[rr]?.[cc] !== 0) continue;
          const v = rr === r && cc === c ? digit : prev[rr]?.[cc] ?? 0;
          if (v === sol[rr]![cc]) filled++;
        }
      }
      if (filled === totalBlanksCount) {
        if (soloTimerRef.current) { clearInterval(soloTimerRef.current); soloTimerRef.current = null; }
        setSoloCompleted(true);
        setShowCelebration(true);
      }
      return prev;
    });
  }, [selectedCell, soloCompleted, puzzle]);

  const handleSoloHint = useCallback(() => {
    if (soloHintsUsed >= 3 || soloCompleted) return;
    const sol = soloSolutionRef.current;
    if (!sol) return;

    // Find a blank cell that's wrong or empty
    const blanks: [number, number][] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (puzzle[r]?.[c] !== 0) continue;
        const curr = grid[r]?.[c] ?? 0;
        if (curr !== sol[r]![c]) blanks.push([r, c]);
      }
    }
    if (blanks.length === 0) return;
    const [r, c] = blanks[Math.floor(Math.random() * blanks.length)]!;
    const val = sol[r]![c]!;
    setGrid((prev) => { const next = prev.map((row) => [...row]); next[r]![c] = val; return next; });
    setHintCells((p) => new Set([...p, `${r},${c}`]));
    setWrongCells((p) => { const n = new Set(p); n.delete(`${r},${c}`); return n; });
    setSoloHintsUsed((h) => h + 1);
    setHintsUsed((h) => h + 1);
  }, [soloHintsUsed, soloCompleted, puzzle, grid]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!selectedCell) return;
    const [r, c] = selectedCell;
    const isSolo = gameMode === 'solo';

    if (e.key >= '1' && e.key <= '9') {
      if (isSolo) handleSoloDigit(parseInt(e.key)); else handleDigitInput(parseInt(e.key));
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      if (isSolo) handleSoloDigit(0); else handleDigitInput(0);
    } else if (e.key === 'ArrowUp' && r > 0) setSelectedCell([r - 1, c]);
    else if (e.key === 'ArrowDown' && r < 8) setSelectedCell([r + 1, c]);
    else if (e.key === 'ArrowLeft' && c > 0) setSelectedCell([r, c - 1]);
    else if (e.key === 'ArrowRight' && c < 8) setSelectedCell([r, c + 1]);
  }, [selectedCell, gameMode, handleDigitInput, handleSoloDigit]);

  const handleRematch = useCallback(() => {
    const gameId = gameDataRef.current?.gameId;
    if (!gameId || !socketRef.current) return;
    socketRef.current.emit('sudoku:rematch:vote', { gameId });
    setRematchVoted(true);
  }, []);

  const handleSendChat = useCallback(() => {
    const msg = chatInput.trim();
    const gameId = gameDataRef.current?.gameId;
    if (!msg || !gameId || !socketRef.current) return;
    socketRef.current.emit('sudoku:chat', { gameId, message: msg });
    setChatInput('');
  }, [chatInput]);

  const handleChatOpen = useCallback(() => {
    setChatOpen((o) => { if (!o) setUnreadCount(0); return !o; });
  }, []);

  const handleStartCall = useCallback(async () => {
    const gameId = gameDataRef.current?.gameId;
    if (!gameId || !socketRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      startSpeakingDetection(usernameRef.current, stream);
      setAmInCall(true); setCallStartedAt(Date.now());
      socketRef.current.emit('call:start', { gameId });
    } catch { setErrorMsg('Could not access microphone.'); }
  }, [startSpeakingDetection]);

  const handleJoinCall = useCallback(async () => {
    const gameId = callGameIdRef.current ?? gameDataRef.current?.gameId;
    const sock = socketRef.current;
    if (!gameId || !sock) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      startSpeakingDetection(usernameRef.current, stream);
      setAmInCall(true); setCallStartedAt(Date.now());
      sock.emit('call:join', { gameId });
      sock.once('call:join_ack', async (data: { peers: string[] }) => {
        for (const peer of data.peers) {
          const pc = createPeerConnection(peer, sock, gameId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sock.emit('call:offer', { gameId, to: peer, offer });
        }
      });
    } catch { setErrorMsg('Could not access microphone.'); }
  }, [createPeerConnection, startSpeakingDetection]);

  const handleLeaveCall = useCallback(() => {
    const gameId = gameDataRef.current?.gameId;
    if (gameId) socketRef.current?.emit('call:leave', { gameId });
    cleanupCall(); setCallRoomActive(false);
  }, [cleanupCall]);

  const handleToggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled; setIsMuted(!track.enabled);
    const gameId = gameDataRef.current?.gameId;
    if (gameId) socketRef.current?.emit('call:mute', { gameId, muted: !track.enabled });
  }, []);

  // ── Computed ───────────────────────────────────────────────────────────────
  const isSoloMode = gameMode === 'solo';
  const myPlayerInfo = players.find((p) => p.username === usernameRef.current);
  const opponents = players.filter((p) => p.username !== usernameRef.current);
  const totalBlanks = gameData ? TOTAL_BLANKS[gameData.difficulty] : 0;
  const myProgress = isSoloMode
    ? (() => { let n = 0; const sol = soloSolutionRef.current; if (!sol) return 0; for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) { if (puzzle[r]?.[c] !== 0) continue; if ((grid[r]?.[c] ?? 0) === sol[r]![c]) n++; } return n; })()
    : (myPlayerInfo?.filledCount ?? 0);
  const soloElapsedFmt = `${Math.floor(soloElapsed / 60)}:${String(soloElapsed % 60).padStart(2, '0')}`;

  // ── Menu ───────────────────────────────────────────────────────────────────
  if (phase === 'menu') {
    return (
      <div className={styles.page}>
        <div className={styles.menuCard}>
          <button className={styles.homeBtn} onClick={() => router.push('/')}>
            <HomeIcon size={18} />
          </button>

          <div className={styles.menuEmoji}>🔢</div>
          <h1 className={styles.menuTitle}>SUDOKU</h1>
          <p className={styles.menuDesc}>Fill the 9×9 grid — each row, column &amp; box must contain 1–9. Race your friends!</p>

          <div className={`${styles.nameRow} ${nameShake ? styles.shake : ''}`}>
            <input
              className={styles.nameInput}
              type="text"
              placeholder="Enter your name..."
              value={nameInput}
              maxLength={20}
              disabled={nameLocked}
              onChange={(e) => { setNameInput(e.target.value); setNameLocked(false); setUsername(''); }}
              onKeyDown={(e) => e.key === 'Enter' && confirmName()}
            />
          </div>

          {/* Difficulty */}
          <div className={styles.diffSection}>
            <p className={styles.diffLabel}>Difficulty</p>
            <div className={styles.diffRow}>
              {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
                <button
                  key={d}
                  className={`${styles.diffBtn} ${difficulty === d ? styles.diffBtnActive : ''}`}
                  style={difficulty === d ? { '--diff-color': DIFFICULTY_LABELS[d].color } as React.CSSProperties : undefined}
                  onClick={() => setDifficulty(d)}
                >
                  <span className={styles.diffBtnName}>{DIFFICULTY_LABELS[d].label}</span>
                  <span className={styles.diffBtnDesc}>{DIFFICULTY_LABELS[d].desc}</span>
                </button>
              ))}
            </div>
          </div>

          {errorMsg && <p className={styles.errorMsg}>{errorMsg}</p>}

          <div className={styles.modeGrid}>
            <button className={styles.modeCard} onClick={() => handleModeSelect('bot')}>
              <span className={styles.modeIcon}>🤖</span>
              <span className={styles.modeLabel}>vs Bot</span>
              <span className={styles.modeHint}>Play against AI</span>
            </button>
            <button className={styles.modeCard} onClick={() => handleModeSelect('quick')}>
              <span className={styles.modeIcon}>⚡</span>
              <span className={styles.modeLabel}>Quick Match</span>
              <span className={styles.modeHint}>Random opponent</span>
            </button>
            <button className={styles.modeCard} onClick={() => handleModeSelect('friend')}>
              <span className={styles.modeIcon}>👥</span>
              <span className={styles.modeLabel}>With Friends</span>
              <span className={styles.modeHint}>Up to 8 players</span>
            </button>
          </div>

          {/* Solo play card — same style as word-puzzle */}
          <button className={styles.soloCard} onClick={() => {
            const name = nameInput.trim();
            if (!name) { setNameShake(true); setTimeout(() => setNameShake(false), 600); return; }
            if (!nameLocked) { sessionStorage.setItem('4inarow_username', name); setUsername(name); setNameLocked(true); }
            setPhase('solo-setup');
          }}>
            <span className={styles.soloCardEmoji}>🧩</span>
            <span className={styles.soloCardLabel}>Solo Play</span>
            <span className={styles.soloCardHint}>Beat the clock, no opponents</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Solo setup phase ───────────────────────────────────────────────────────
  if (phase === 'solo-setup') {
    return (
      <div className={styles.page}>
        <div className={styles.menuCard}>
          <div className={styles.menuEmoji}>🧩</div>
          <h2 className={styles.menuTitle}>Solo Play</h2>
          <p className={styles.menuDesc}>Solve the puzzle as fast as you can.<br />Timer starts when the board loads.</p>

          <div className={styles.difficultySection}>
            <p className={styles.difficultyTitle}>🎯 Choose Difficulty</p>
            <div className={styles.difficultyRow}>
              {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
                <button
                  key={d}
                  className={`${styles.diffChip} ${soloDifficulty === d ? styles.diffChipActive : ''}`}
                  onClick={() => setSoloDifficulty(d)}
                >
                  <span>{d === 'easy' ? '🟢' : d === 'medium' ? '🟡' : '🔴'}</span>
                  <span>{DIFFICULTY_LABELS[d].label}</span>
                  <span className={styles.diffChipGrid}>{DIFFICULTY_LABELS[d].desc}</span>
                </button>
              ))}
            </div>
          </div>

          <button className={styles.soloStartBtn} onClick={handleStartSolo}>
            🧩 Start Solo Game
          </button>
          <button className={styles.ghostBtn} onClick={() => setPhase('menu')}>← Back</button>
        </div>
      </div>
    );
  }

  if (phase === 'matchmaking') {
    return (
      <div className={styles.page}>
        <div className={styles.menuCard}>
          <div className={styles.spinner} />
          <p className={styles.matchmakingText}>Finding a player...</p>
          <button className={styles.cancelBtn} onClick={() => {
            socketRef.current?.emit('sudoku:queue:leave');
            socketRef.current?.disconnect();
            setPhase('menu');
          }}>Cancel</button>
        </div>
      </div>
    );
  }

  // ── Solo completed modal ───────────────────────────────────────────────────
  if (phase === 'solo' && soloCompleted) {
    return (
      <div className={styles.page}>
        <div className={styles.menuCard}>
          <div className={styles.endModalIcon}>🎉</div>
          <h2 className={styles.menuTitle}>Puzzle Solved!</h2>
          <p className={styles.menuDesc}>
            {DIFFICULTY_LABELS[soloDifficulty].label} · Time: <strong style={{ color: '#ffd080' }}>{soloElapsedFmt}</strong>
            {soloHintsUsed > 0 && <> · Hints: <strong style={{ color: '#fbbf24' }}>💡×{soloHintsUsed}</strong></>}
          </p>
          <button className={styles.soloStartBtn} onClick={handleStartSolo}>🔁 Play Again</button>
          <button className={styles.ghostBtn} onClick={() => { if (soloTimerRef.current) clearInterval(soloTimerRef.current); setPhase('menu'); setSoloCompleted(false); }}>← Back to Menu</button>
        </div>
      </div>
    );
  }

  // ── Playing phase ──────────────────────────────────────────────────────────
  return (
    <div
      className={styles.gamePage}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ outline: 'none' }}
    >
      {showGuide && <GameGuide gameKey="sudoku" onDone={() => setShowGuide(false)} />}
      {showCelebration && (
        <WinCelebration
          gameKey="sudoku"
          winnerName={winner ?? ''}
          currentUser={usernameRef.current}
          onClose={() => setShowCelebration(false)}
        />
      )}

      {/* End Game Modal */}
      {showEndModal && (
        <div className={styles.endModalOverlay}>
          <div className={styles.endModal}>
            <div className={styles.endModalIcon}>🔢</div>
            <h2 className={styles.endTitle}>
              {winner === usernameRef.current ? '🎉 You Solved It!' : winner ? `🏆 ${winner} wins!` : 'Game Over!'}
            </h2>
            <div className={styles.rankList}>
              {rankings.map((r) => (
                <div key={r.username} className={`${styles.rankRow} ${r.username === usernameRef.current ? styles.rankRowMe : ''}`}>
                  <span className={styles.rankMedal}>{RANK_MEDAL[r.rank - 1] ?? `#${r.rank}`}</span>
                  <span className={styles.rankName}>{r.username}</span>
                  {r.hintsUsed > 0 && <span className={styles.rankHints}>💡×{r.hintsUsed}</span>}
                </div>
              ))}
            </div>
            <div className={styles.rematchSection}>
              {!rematchVoted ? (
                <button className={styles.rematchBtn} onClick={handleRematch}>🔁 Play Again</button>
              ) : (
                <p className={styles.rematchProgress}>Waiting... ({rematchVotes}/{rematchNeeded})</p>
              )}
            </div>
            <button className={styles.menuBackBtn} onClick={() => router.push('/')}>Back to Menu</button>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className={styles.topBar}>
        <button className={styles.topHomeBtn} onClick={() => {
          if (isSoloMode && soloTimerRef.current) clearInterval(soloTimerRef.current);
          router.push(isSoloMode ? '/' : '/');
        }}>
          <HomeIcon size={16} />
        </button>

        <div className={styles.topCenter}>
          <span className={styles.topDiff} style={{ color: DIFFICULTY_LABELS[gameData?.difficulty ?? 'medium'].color }}>
            {DIFFICULTY_LABELS[gameData?.difficulty ?? 'medium'].label}
          </span>
          {isSoloMode
            ? <span className={styles.soloTimer}>{soloElapsedFmt}</span>
            : <span className={styles.topProgress}>{myProgress}/{totalBlanks}</span>
          }
        </div>

        <div className={styles.topActions}>
          <button
            className={styles.hintBtn}
            onClick={isSoloMode ? handleSoloHint : handleHint}
            disabled={(isSoloMode ? soloHintsUsed : hintsUsed) >= 3}
            title={`Hints: ${isSoloMode ? soloHintsUsed : hintsUsed}/3`}
          >
            💡 {3 - (isSoloMode ? soloHintsUsed : hintsUsed)}
          </button>
          <button className={styles.guideBtn} onClick={() => setShowGuide(true)}>?</button>
          {!isSoloMode && (
            <>
              <button className={styles.chatToggleBtn} onClick={handleChatOpen}>
                <MessageSquare size={16} />
                {unreadCount > 0 && <span className={styles.unreadBadge}>{unreadCount}</span>}
              </button>
              {!callRoomActive && gameMode !== 'bot' && (
                <button className={styles.callStartBtn} onClick={handleStartCall}>
                  <Phone size={16} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className={styles.mainArea}>
        {/* Left sidebar: opponents (hidden in solo) */}
        {!isSoloMode && <div className={styles.sidebar}>
          <p className={styles.sidebarTitle}>Players</p>
          {opponents.map((p) => (
            <div key={p.username} className={styles.opponentCard} style={{ '--player-color': PLAYER_COLORS[p.colorIndex % 8] } as React.CSSProperties}>
              <div className={styles.opponentAvatar} style={{ background: PLAYER_COLORS[p.colorIndex % 8] }}>
                {p.username[0]?.toUpperCase()}
                {speakingUsers.has(p.username) && <span className={styles.speakingDot} />}
              </div>
              <div className={styles.opponentInfo}>
                <span className={styles.opponentName}>{p.username}</span>
                {p.rank !== null
                  ? <span className={styles.opponentRank}>{RANK_MEDAL[p.rank - 1] ?? `#${p.rank}`} Done!</span>
                  : <span className={styles.opponentFill}>{p.filledCount}/{totalBlanks}</span>
                }
                {mutedUsers.has(p.username) && <MicOff size={10} />}
              </div>
              <div className={styles.opponentProgressBar}>
                <div
                  className={styles.opponentProgressFill}
                  style={{ width: `${totalBlanks > 0 ? Math.round((p.filledCount / totalBlanks) * 100) : 0}%`, background: PLAYER_COLORS[p.colorIndex % 8] }}
                />
              </div>
            </div>
          ))}
        </div>}

        {/* Center: Sudoku board */}
        <div className={styles.boardArea}>
          {errorMsg && <div className={styles.errorBanner}>{errorMsg}</div>}

          <div className={styles.sudokuBoard}>
            {grid.map((row, r) =>
              row.map((val, c) => {
                const isGiven = puzzle[r]?.[c] !== 0;
                const isSelected = selectedCell?.[0] === r && selectedCell?.[1] === c;
                const isSameRow = selectedCell?.[0] === r;
                const isSameCol = selectedCell?.[1] === c;
                const isSameBox = selectedCell && Math.floor(selectedCell[0] / 3) === Math.floor(r / 3) && Math.floor(selectedCell[1] / 3) === Math.floor(c / 3);
                const isWrong = wrongCells.has(`${r},${c}`);
                const isHint = hintCells.has(`${r},${c}`);
                const sameVal = selectedCell && !isSelected && val !== 0 && val === grid[selectedCell[0]]?.[selectedCell[1]];
                const isCompleted = completedUsers.has(usernameRef.current);

                return (
                  <div
                    key={`${r}-${c}`}
                    className={[
                      styles.sudokuCell,
                      isGiven ? styles.cellGiven : styles.cellEditable,
                      isSelected ? styles.cellSelected : '',
                      (isSameRow || isSameCol || isSameBox) && !isSelected ? styles.cellHighlight : '',
                      isWrong ? styles.cellWrong : '',
                      isHint ? styles.cellHint : '',
                      sameVal ? styles.cellSameVal : '',
                      c % 3 === 2 && c < 8 ? styles.cellBorderRight : '',
                      r % 3 === 2 && r < 8 ? styles.cellBorderBottom : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => !isCompleted && handleCellClick(r, c)}
                  >
                    {val !== 0 ? val : ''}
                  </div>
                );
              })
            )}
          </div>

          {/* Number pad */}
          <div className={styles.numPad}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button
                key={n}
                className={styles.numBtn}
                onClick={() => isSoloMode ? handleSoloDigit(n) : handleDigitInput(n)}
              >
                {n}
              </button>
            ))}
            <button className={styles.numEraseBtn} onClick={() => isSoloMode ? handleSoloDigit(0) : handleDigitInput(0)}>⌫</button>
          </div>

          {/* My progress */}
          <div className={styles.myProgress}>
            <div className={styles.myProgressBar}>
              <div
                className={styles.myProgressFill}
                style={{ width: `${totalBlanks > 0 ? Math.round((myProgress / totalBlanks) * 100) : 0}%` }}
              />
            </div>
            <span className={styles.myProgressLabel}>
              {isSoloMode
                ? (soloCompleted ? `🎉 Solved in ${soloElapsedFmt}!` : `${myProgress} / ${totalBlanks} cells filled`)
                : myPlayerInfo?.rank !== null && myPlayerInfo?.rank !== undefined
                  ? `${RANK_MEDAL[(myPlayerInfo.rank - 1)] ?? `#${myPlayerInfo.rank}`} Completed!`
                  : `${myProgress} / ${totalBlanks} cells filled`
              }
            </span>
          </div>
        </div>

        {/* Right sidebar: call + stats (hidden in solo) */}
        {!isSoloMode && <div className={styles.rightSidebar}>
          {callRoomActive && gameMode !== 'bot' && (
            <div className={styles.callBar}>
              <span className={styles.callBarLabel}>
                <Phone size={12} /> {amInCall ? callTimerDisplay : 'Call active'}
              </span>
              <div className={styles.callBarMembers}>
                {callMembers.map((m) => (
                  <div key={m} className={`${styles.callMember} ${speakingUsers.has(m) ? styles.callMemberSpeaking : ''}`}>
                    {m[0]?.toUpperCase()}
                  </div>
                ))}
              </div>
              {!amInCall ? (
                <button className={styles.joinCallBtn} onClick={handleJoinCall}>Join</button>
              ) : (
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button className={styles.muteBtn} onClick={handleToggleMute}>
                    {isMuted ? <MicOff size={14} /> : <Mic size={14} />}
                  </button>
                  <button className={styles.leaveCallBtn} onClick={handleLeaveCall}>Leave</button>
                </div>
              )}
            </div>
          )}

          <div className={styles.statsPanel}>
            <p className={styles.statsPanelTitle}>Leaderboard</p>
            {players.map((p) => (
              <div key={p.username} className={styles.statsRow}>
                <div className={styles.statsAvatar} style={{ background: PLAYER_COLORS[p.colorIndex % 8] }}>
                  {p.username[0]?.toUpperCase()}
                </div>
                <div className={styles.statsInfo}>
                  <span className={styles.statsName}>{p.username === usernameRef.current ? 'You' : p.username}</span>
                  {p.rank !== null
                    ? <span className={styles.statsRank}>{RANK_MEDAL[p.rank - 1] ?? `#${p.rank}`}</span>
                    : <span className={styles.statsPct}>{totalBlanks > 0 ? Math.round((p.filledCount / totalBlanks) * 100) : 0}%</span>
                  }
                </div>
              </div>
            ))}
          </div>
        </div>}
      </div>

      {/* Chat panel */}
      {!isSoloMode && chatOpen && (
        <div className={styles.chatPanel}>
          <div className={styles.chatHeader}>
            <span>Chat</span>
            <button className={styles.chatClose} onClick={handleChatOpen}>✕</button>
          </div>
          <div className={styles.chatMessages}>
            {chatMessages.map((m, i) => (
              <div key={i} className={`${styles.chatMsg} ${m.username === usernameRef.current ? styles.chatMsgMe : ''}`}>
                <span className={styles.chatMsgUser}>{m.username}</span>
                <span className={styles.chatMsgText}>{m.message}</span>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <div className={styles.chatInput}>
            <input
              type="text"
              value={chatInput}
              maxLength={200}
              placeholder="Type a message..."
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
            />
            <button onClick={handleSendChat}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}
