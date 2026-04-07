'use client';

import { useEffect, useState, useRef, useMemo, useCallback, type CSSProperties } from 'react';
import { io, Socket } from 'socket.io-client';
import styles from './game.module.css';

const DEFAULT_ROWS = 6;
const DEFAULT_COLS = 7;
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

type Board = number[][];

function emptyBoard(rows: number, cols: number): Board {
  return Array(rows)
    .fill(null)
    .map(() => Array(cols).fill(0));
}

/** Fits cell size + gaps inside width/height so large boards stay on screen (especially phones). */
function computeBoardLayout(
  cols: number,
  rows: number,
  viewportWidth: number,
  viewportHeight: number
): { cellSize: number; gap: number } {
  const c = Math.max(1, cols);
  const r = Math.max(1, rows);
  const narrow = viewportWidth < 720;
  /* Reserve space for fixed chat tab on the right (~65px + margin) */
  const chatStrip = 78;
  const outerPad = narrow ? 8 : 16;
  const boardPadding = narrow ? 10 : 20;
  const maxBoardWidth = Math.max(140, viewportWidth - chatStrip - outerPad * 2);
  const innerW = maxBoardWidth - boardPadding * 2;

  let gap = 4;
  let cellSize = Math.floor((innerW - (c - 1) * gap) / c);
  gap = Math.max(2, Math.min(10, Math.round(cellSize * 0.12)));
  cellSize = Math.floor((innerW - (c - 1) * gap) / c);
  cellSize = Math.max(12, Math.min(88, cellSize));
  gap = Math.max(2, Math.min(10, Math.round(cellSize * 0.12)));

  const statusReserve = narrow ? 120 : 100;
  const hoverReserve = Math.min(72, Math.round(cellSize * 1.1) + 16);
  const maxBoardHeight = Math.max(
    160,
    Math.min(viewportHeight * 0.58, viewportHeight - statusReserve - hoverReserve)
  );
  const innerH = maxBoardHeight - boardPadding * 2 - (r - 1) * gap;
  const byHeight = Math.floor(innerH / r);
  if (byHeight > 0 && byHeight < cellSize) {
    cellSize = Math.max(12, byHeight);
    gap = Math.max(2, Math.min(10, Math.round(cellSize * 0.12)));
  }

  return { cellSize, gap };
}

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [username, setUsername] = useState('');
  const [gameId, setGameId] = useState<string | null>(null);
  const [board, setBoard] = useState<Board>(() => emptyBoard(DEFAULT_ROWS, DEFAULT_COLS));
  const [myPlayerNumber, setMyPlayerNumber] = useState<number | null>(null);
  const [currentTurn, setCurrentTurn] = useState(1);
  const [opponent, setOpponent] = useState('');
  const [playerUsernames, setPlayerUsernames] = useState<string[]>([]);
  const [gameStatus, setGameStatus] = useState<'menu' | 'waiting' | 'playing' | 'ended'>('menu');
  const [winner, setWinner] = useState<string | null>(null);
  const [winReason, setWinReason] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [gameMode, setGameMode] = useState<'pvp' | 'bot' | 'friend' | null>(null);
  const [moveCount, setMoveCount] = useState(0);
  /** 3+ players: count 4-in-a-rows until board is full */
  const [scoringMode, setScoringMode] = useState(false);
  const [scores, setScores] = useState<number[]>([]);
  
  // Chat states
  const [chatMessages, setChatMessages] = useState<Array<{username: string, message: string, timestamp: Date}>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  
  // Audio states
  const [bgMusicEnabled, setBgMusicEnabled] = useState(false);
  const bgMusicRef = useRef<HTMLAudioElement | null>(null);
  const dropSoundRef = useRef<HTMLAudioElement | null>(null);
  const opponentDropSoundRef = useRef<HTMLAudioElement | null>(null);
  const gameEndSoundRef = useRef<HTMLAudioElement | null>(null);
  
  // Refs for tracking state in socket event handlers
  const chatOpenRef = useRef(chatOpen);
  const usernameRef = useRef(username);
  const boardRef = useRef<HTMLDivElement>(null);
  const hoverStripRef = useRef<HTMLDivElement>(null);
  /** Preview disc position in the strip above the board (tracks pointer X, clamped to columns). */
  const [pointerPreview, setPointerPreview] = useState<{ x: number; y: number } | null>(null);
  
  // Keep refs in sync with state
  useEffect(() => { chatOpenRef.current = chatOpen; }, [chatOpen]);
  useEffect(() => { usernameRef.current = username; }, [username]);
  
  // Modal states
  const [showSpectateModal, setShowSpectateModal] = useState(false);
  const [showFriendModal, setShowFriendModal] = useState(false);
  
  // Play with Friend states
  const [myRoomCode, setMyRoomCode] = useState<string | null>(null);
  const [friendRoomCode, setFriendRoomCode] = useState('');
  const [roomError, setRoomError] = useState<string | null>(null);
  const [isWaitingInRoom, setIsWaitingInRoom] = useState(false);
  const [friendJoinWaiting, setFriendJoinWaiting] = useState(false);
  const [roomMaxPlayers, setRoomMaxPlayers] = useState(2);
  const [friendMaxPlayers, setFriendMaxPlayers] = useState(2);
  const [lobbyPlayers, setLobbyPlayers] = useState<string[]>([]);
  const [codeCopied, setCodeCopied] = useState(false);

  /** Invite / friend games: rematch with same players without a new room code */
  const [invitePartyId, setInvitePartyId] = useState<string | null>(null);
  const [rematchVotes, setRematchVotes] = useState(0);
  const [rematchNeeded, setRematchNeeded] = useState(0);
  const [hasVotedRematch, setHasVotedRematch] = useState(false);
  
  // UI feedback states
  const [usernameShake, setUsernameShake] = useState(false);
  
  // Winning cells state
  const [winningCells, setWinningCells] = useState<Array<{row: number, col: number}>>([]);

  const [viewport, setViewport] = useState({ width: 390, height: 740 });

  useEffect(() => {
    const read = () => {
      const vv = window.visualViewport;
      setViewport({
        width: vv?.width ?? window.innerWidth,
        height: vv?.height ?? window.innerHeight,
      });
    };
    read();
    window.addEventListener('resize', read);
    window.visualViewport?.addEventListener('resize', read);
    window.visualViewport?.addEventListener('scroll', read);
    return () => {
      window.removeEventListener('resize', read);
      window.visualViewport?.removeEventListener('resize', read);
      window.visualViewport?.removeEventListener('scroll', read);
    };
  }, []);

  const boardCols = board[0]?.length ?? DEFAULT_COLS;
  const boardRows = board.length;
  const boardLayout = useMemo(
    () => computeBoardLayout(boardCols, boardRows, viewport.width, viewport.height),
    [boardCols, boardRows, viewport.width, viewport.height]
  );

  const discClasses = useMemo(
    () => [
      styles.player1,
      styles.player2,
      styles.player3,
      styles.player4,
      styles.player5,
      styles.player6,
      styles.player7,
      styles.player8,
    ],
    []
  );

  const floatingClasses = useMemo(
    () => [
      styles.p1Floating,
      styles.p2Floating,
      styles.p3Floating,
      styles.p4Floating,
      styles.p5Floating,
      styles.p6Floating,
      styles.p7Floating,
      styles.p8Floating,
    ],
    []
  );

  useEffect(() => {
    const newSocket = io(API_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('✅ Connected to server');
      setIsConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('❌ Disconnected from server');
      setIsConnected(false);
    });

    newSocket.on('game:started', (data: {
      gameId: string;
      board?: Board;
      opponent?: string;
      players?: string[];
      playerUsernames?: string[];
      yourPlayerNumber: number;
      yourTurn: boolean;
      isBot: boolean;
      isInviteGame?: boolean;
      partyId?: string;
      scoringMode?: boolean;
      scores?: number[];
    }) => {
      console.log('🎮 Game started:', data);
      setGameId(data.gameId);
      const names = data.playerUsernames ?? data.players ?? [];
      setPlayerUsernames(names);
      if (data.board?.length && data.board[0]?.length) {
        setBoard(data.board);
      }
      if (names.length === 2) {
        setOpponent(data.opponent ?? names.find((u) => u !== usernameRef.current) ?? '');
      } else {
        setOpponent('');
      }
      setGameStatus('playing');
      setMoveCount(0);
      setShowFriendModal(false);
      setMyRoomCode(null);
      setIsWaitingInRoom(false);
      setFriendJoinWaiting(false);
      setFriendRoomCode('');
      setLobbyPlayers([]);
      setMyPlayerNumber(data.yourPlayerNumber);
      setCurrentTurn(1);
      if (data.isBot) setGameMode('bot');
      else if (data.isInviteGame) setGameMode('friend');
      else setGameMode('pvp');
      if (data.partyId) setInvitePartyId(data.partyId);
      setHasVotedRematch(false);
      setRematchVotes(0);
      setRematchNeeded(0);
      setScoringMode(Boolean(data.scoringMode));
      setScores(Array.isArray(data.scores) ? data.scores : []);
      console.log(`✅ Seat ${data.yourPlayerNumber}, isBot: ${data.isBot}`);
    });

    newSocket.on(
      'game:update',
      (data: {
        board?: Board;
        currentTurn?: number;
        scores?: number[];
        scoringMode?: boolean;
        playerUsernames?: string[];
        playerLeft?: string;
        lastMove?: { player: string; column: number; row: number };
      }) => {
      console.log('📥 Game update:', data);
      if (data.board) {
        setBoard(data.board);
        if (data.lastMove) {
          setMoveCount((prev) => prev + 1);
          if (dropSoundRef.current) {
            dropSoundRef.current.currentTime = 0;
            dropSoundRef.current.play().catch((e: any) => console.log('Drop sound failed:', e));
          }
        }
      }
      if (data.playerUsernames && data.playerUsernames.length > 0) {
        setPlayerUsernames(data.playerUsernames);
        const u = usernameRef.current;
        if (u) {
          const idx = data.playerUsernames.indexOf(u);
          if (idx >= 0) setMyPlayerNumber(idx + 1);
        }
        if (data.playerUsernames.length === 2) {
          setOpponent(data.playerUsernames.find((x) => x !== usernameRef.current) ?? '');
        } else {
          setOpponent('');
        }
      }
      if (data.currentTurn !== undefined) {
        setCurrentTurn(data.currentTurn);
      }
      if (data.scoringMode !== undefined) {
        setScoringMode(data.scoringMode);
      }
      if (data.scores && Array.isArray(data.scores)) {
        setScores(data.scores);
      }
    });

    newSocket.on(
      'game:ended',
      (data: {
        winner: string | null;
        reason: string;
        winningCells?: Array<{ row: number; col: number }>;
        partyId?: string;
        canRematch?: boolean;
        rematchPlayers?: string[];
        scores?: number[];
        scoringMode?: boolean;
      }) => {
        console.log('🏁 Game ended:', data);
        setGameStatus('ended');
        setWinner(data.winner);
        setWinReason(data.reason);
        if (data.scoringMode !== undefined) setScoringMode(data.scoringMode);
        if (data.scores && Array.isArray(data.scores)) setScores(data.scores);

        if (data.winningCells) {
          setWinningCells(data.winningCells);
        }

        if (data.canRematch && data.partyId) {
          setInvitePartyId(data.partyId);
          setRematchNeeded(data.rematchPlayers?.length ?? 0);
          setRematchVotes(0);
          setHasVotedRematch(false);
        } else {
          setInvitePartyId(null);
          setRematchNeeded(0);
          setRematchVotes(0);
          setHasVotedRematch(false);
        }

        if (gameEndSoundRef.current) {
          gameEndSoundRef.current.currentTime = 0;
          gameEndSoundRef.current.play().catch((e: any) => console.log('Sound play failed:', e));
        }
      }
    );

    newSocket.on(
      'rematch:progress',
      (data: { votes: number; needed: number; voted?: string[] }) => {
        setRematchVotes(data.votes);
        setRematchNeeded(data.needed);
        const me = usernameRef.current;
        if (me && data.voted?.includes(me)) {
          setHasVotedRematch(true);
        }
      }
    );

    newSocket.on('rematch:error', (data: { message?: string }) => {
      setHasVotedRematch(false);
      alert(data.message ?? 'Rematch failed.');
    });
    
    // Chat event
    newSocket.on('chat:message', (data: {username: string, message: string}) => {
      setChatMessages(prev => [...prev, {...data, timestamp: new Date()}]);
      // Increment unread count only if chat is closed and message is from opponent
      if (!chatOpenRef.current && data.username !== usernameRef.current) {
        setUnreadCount(prev => prev + 1);
      }
    });

    // Private room events
    newSocket.on('room:created', (data: { roomCode: string; maxPlayers?: number; players?: string[] }) => {
      console.log('🏠 Room created:', data.roomCode);
      setMyRoomCode(data.roomCode);
      setRoomMaxPlayers(data.maxPlayers ?? 2);
      setLobbyPlayers(data.players ?? []);
      setIsWaitingInRoom(true);
      setRoomError(null);
    });

    newSocket.on('room:lobbyUpdate', (data: { players: string[]; maxPlayers: number }) => {
      setLobbyPlayers(data.players);
      setRoomMaxPlayers(data.maxPlayers);
    });

    newSocket.on(
      'room:joinPending',
      (data: { roomCode: string; players: string[]; maxPlayers: number }) => {
        setFriendJoinWaiting(true);
        setLobbyPlayers(data.players);
        setRoomMaxPlayers(data.maxPlayers);
        setShowFriendModal(true);
        setIsWaitingInRoom(false);
        setFriendRoomCode(data.roomCode);
        setRoomError(null);
      }
    );

    newSocket.on('room:closed', (data: { reason?: string }) => {
      setRoomError(data.reason ?? 'Lobby closed');
      setIsWaitingInRoom(false);
      setFriendJoinWaiting(false);
      setMyRoomCode(null);
      setLobbyPlayers([]);
      setShowFriendModal(false);
    });

    newSocket.on('room:error', (data: { message: string }) => {
      console.error('❌ Room error:', data.message);
      setRoomError(data.message);
    });

    newSocket.on('game:error', (data) => {
      console.error('❌ Game error:', data.message);
      alert(data.message);
    });

    return () => {
      newSocket.close();
    };
  }, []);
  
  // Initialize audio
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const bgMusic = new Audio('/best_outro.mp3');
      bgMusic.loop = true;
      bgMusic.volume = 0.1;
      bgMusicRef.current = bgMusic;
      
      // Updated drop sound (using reliable local files)
      const dropSound = new Audio('/drop.mp3');
      dropSound.volume = 0.5;
      dropSoundRef.current = dropSound;

      const opponentDropSound = new Audio('/opponent_drop.mp3'); 
      opponentDropSound.volume = 0.5;
      opponentDropSoundRef.current = opponentDropSound;
      
      const gameEndSound = new Audio('/game_end.mp3'); 
      gameEndSound.volume = 0.6;
      gameEndSoundRef.current = gameEndSound;
    }
  }, []);
  
  // Control background music
  useEffect(() => {
    if (bgMusicRef.current) {
      if (bgMusicEnabled) {
        bgMusicRef.current.play().catch((e: any) => console.log('Music play failed:', e));
      } else {
        bgMusicRef.current.pause();
      }
    }
  }, [bgMusicEnabled]);

  const handleJoinPvP = () => {
    if (!username.trim()) {
      setUsernameShake(true);
      setTimeout(() => setUsernameShake(false), 500);
      return;
    }
    if (!socket) return;
    
    setGameMode('pvp');
    setGameStatus('waiting');
    socket.emit('player:join', { username });
    socket.emit('matchmaking:join', { username });
  };

  const handleJoinBot = () => {
    if (!username.trim()) {
      setUsernameShake(true);
      setTimeout(() => setUsernameShake(false), 500);
      return;
    }
    if (!socket) return;
    
    setGameMode('bot');
    setGameStatus('waiting');
    socket.emit('player:join', { username });
    socket.emit('matchmaking:join-bot', { username });
  };

  // Play with Friend handlers
  const handlePlayWithFriend = () => {
    if (!username.trim()) {
      setUsernameShake(true);
      setTimeout(() => setUsernameShake(false), 500);
      return;
    }
    setShowFriendModal(true);
    setRoomError(null);
    setFriendRoomCode('');
    setFriendJoinWaiting(false);
    setLobbyPlayers([]);
  };

  const handleCreateRoom = () => {
    if (!socket) return;
    socket.emit('player:join', { username });
    socket.emit('room:create', { username, maxPlayers: friendMaxPlayers });
  };

  const handleJoinRoom = () => {
    if (!socket || !friendRoomCode.trim()) return;
    setRoomError(null);
    setGameMode('friend');
    socket.emit('player:join', { username });
    socket.emit('room:join', { username, roomCode: friendRoomCode });
  };

  const handleCancelRoom = () => {
    if (!socket) return;
    socket.emit('room:leave');
    setMyRoomCode(null);
    setIsWaitingInRoom(false);
    setShowFriendModal(false);
    setFriendRoomCode('');
    setRoomError(null);
    setLobbyPlayers([]);
    setFriendJoinWaiting(false);
  };

  const handleCloseFriendModal = () => {
    if ((isWaitingInRoom || friendJoinWaiting) && socket) {
      socket.emit('room:leave');
    }
    setShowFriendModal(false);
    setMyRoomCode(null);
    setIsWaitingInRoom(false);
    setFriendRoomCode('');
    setRoomError(null);
    setLobbyPlayers([]);
    setFriendJoinWaiting(false);
  };

  const handleColumnClick = (col: number) => {
    if (!gameId || !socket || !myPlayerNumber) return;
    
    // Check if it's my turn
    if (currentTurn !== myPlayerNumber) {
      console.log('⏳ Not your turn');
      return;
    }

    // Check if column is full
    if (board[0]?.[col] !== 0) {
      console.log('❌ Column is full');
      return;
    }

    console.log(`🎯 Making move: column ${col}`);
    socket.emit('game:move', { gameId, column: col });
  };

  const resetToMainMenu = () => {
    setGameStatus('menu');
    setBoard(emptyBoard(DEFAULT_ROWS, DEFAULT_COLS));
    setWinner(null);
    setWinReason(null);
    setGameId(null);
    setMyPlayerNumber(null);
    setCurrentTurn(1);
    setGameMode(null);
    setMoveCount(0);
    setChatMessages([]);
    setUnreadCount(0);
    setWinningCells([]);
    setPlayerUsernames([]);
    setOpponent('');
    setLobbyPlayers([]);
    setFriendJoinWaiting(false);
    setRoomMaxPlayers(2);
    setInvitePartyId(null);
    setRematchVotes(0);
    setRematchNeeded(0);
    setHasVotedRematch(false);
    setScoringMode(false);
    setScores([]);
  };

  const handlePlayAgain = () => {
    if (invitePartyId && socket && gameMode === 'friend') {
      socket.emit('party:rematch', { partyId: invitePartyId });
      setHasVotedRematch(true);
      return;
    }
    resetToMainMenu();
  };

  const handleLeaveToMenu = () => {
    resetToMainMenu();
  };
  
  const handleSendChat = () => {
    if (!chatInput.trim() || !socket || !gameId) return;
    
    socket.emit('chat:send', { gameId, username, message: chatInput });
    setChatInput('');
  };

  const getCellClass = (value: number) => {
    if (value >= 1 && value <= 8) return discClasses[value - 1];
    return '';
  };

  const getFloatingClass = () => {
    if (myPlayerNumber !== null && myPlayerNumber >= 1 && myPlayerNumber <= 8) {
      return floatingClasses[myPlayerNumber - 1];
    }
    return styles.p1Floating;
  };

  const turnPlayerName =
    playerUsernames.length > 0 && currentTurn >= 1 && currentTurn <= playerUsernames.length
      ? playerUsernames[currentTurn - 1]
      : '…';

  const isMyTurn = myPlayerNumber !== null && myPlayerNumber === currentTurn;
  const iAmWinner = winner === username;
  const isDraw = winReason === 'draw';

  const columnFromClientX = useCallback((clientX: number): number | null => {
    const board = boardRef.current;
    if (!board) return null;
    const firstRow = board.querySelector('[data-board-row="0"]');
    if (!firstRow) return null;
    const cells = Array.from(firstRow.querySelectorAll<HTMLElement>('[data-col]'));
    if (!cells.length) return null;
    for (const cell of cells) {
      const r = cell.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) {
        return Number(cell.dataset.col);
      }
    }
    let best = 0;
    let bestD = Infinity;
    for (const cell of cells) {
      const r = cell.getBoundingClientRect();
      const cx = (r.left + r.right) / 2;
      const d = Math.abs(clientX - cx);
      if (d < bestD) {
        bestD = d;
        best = Number(cell.dataset.col);
      }
    }
    return best;
  }, []);

  const handleBoardPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (gameStatus !== 'playing' || !isMyTurn || winner) {
        setPointerPreview(null);
        return;
      }
      const board = boardRef.current;
      const strip = hoverStripRef.current;
      if (!board) return;
      const br = board.getBoundingClientRect();
      const sr = strip?.getBoundingClientRect();
      const left = sr ? Math.min(sr.left, br.left) : br.left;
      const right = sr ? Math.max(sr.right, br.right) : br.right;
      const top = sr ? sr.top : br.top;
      const bottom = br.bottom;
      if (
        e.clientX < left ||
        e.clientX > right ||
        e.clientY < top ||
        e.clientY > bottom
      ) {
        setPointerPreview(null);
        return;
      }
      if (!strip) return;
      const stripR = strip.getBoundingClientRect();
      const firstRow = board.querySelector('[data-board-row="0"]');
      if (!firstRow) return;
      const cells = Array.from(firstRow.querySelectorAll<HTMLElement>('[data-col]'));
      const firstEl = cells[0];
      const lastEl = cells[cells.length - 1];
      if (!firstEl || !lastEl) return;
      const first = firstEl.getBoundingClientRect();
      const last = lastEl.getBoundingClientRect();
      const discPx = Math.min(72, boardLayout.cellSize * 0.85);
      let x = e.clientX - stripR.left;
      x = Math.max(first.left - stripR.left, Math.min(last.right - stripR.left, x));
      const y = stripR.height / 2 - discPx / 2;
      setPointerPreview({ x, y });
    },
    [gameStatus, isMyTurn, winner, boardLayout.cellSize]
  );

  const handleBoardPointerLeave = useCallback(() => {
    setPointerPreview(null);
  }, []);

  useEffect(() => {
    if (gameStatus !== 'playing') {
      setPointerPreview(null);
    }
  }, [gameStatus]);

  const getWinReasonText = () => {
    if (isDraw) return 'Board Full - Draw!';
    if (winReason === 'most_points') return 'Most 4-in-a-rows when board filled!';
    if (winReason === 'score_tie') return 'Tied on 4-in-a-rows!';
    switch (winReason) {
      case 'horizontal': return '→ Horizontal Win!';
      case 'vertical': return '↓ Vertical Win!';
      case 'diagonal': return '↗ Diagonal Win!';
      case 'forfeit': return 'Opponent Forfeited';
      case 'opponent_disconnect': return 'Opponent Disconnected';
      default: return '';
    }
  };

  const endGameHeadline = () => {
    if (scoringMode && (winReason === 'most_points' || winReason === 'score_tie')) {
      if (winReason === 'score_tie' || !winner) {
        return 'TIE GAME!';
      }
      if (winner === username) return 'YOU WIN!';
      return `${winner} WINS!`;
    }
    if (winner === username) return 'YOU WIN!';
    if (winner) return `${winner} WINS!`;
    return 'DRAW!';
  };

  return (
    <div className={styles.container}>
      {/* Sidebar */}
      <div
        className={`${styles.sidebar} ${playerUsernames.length > 2 ? styles.sidebarWide : ''}`}
      >
        {playerUsernames.length > 2 ? (
          <>
            <p className={styles.friendSectionTitle} style={{ marginBottom: 8 }}>
              Players{scoringMode ? ' · points' : ''}
            </p>
            <div className={styles.playersRoster}>
              {playerUsernames.map((name, i) => (
                <div key={`${name}-${i}`} className={styles.rosterRow}>
                  <span className={`${styles.rosterSwatch} ${discClasses[i] ?? ''}`} />
                  <span
                    className={`${styles.playerName} ${
                      currentTurn === i + 1 ? styles.rosterCurrent : ''
                    }`}
                  >
                    {name}
                    {name === username ? ' (you)' : ''}
                    {scoringMode && (
                      <span style={{ opacity: 0.85, marginLeft: 6 }}>· {scores[i] ?? 0} pts</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className={styles.playerProfile}>
              <div className={styles.avatarBox}>
                <span className={styles.avatar}>💡</span>
              </div>
              <span className={styles.playerName}>{opponent || 'Waiting...'}</span>
              <div className={`${styles.miniDisc} ${styles.p2DiscPreview}`}></div>
            </div>
            <div className={styles.vsBadge}>
              <span className={styles.vsText}>VS</span>
            </div>
            <div className={styles.playerProfile}>
              <div className={`${styles.miniDisc} ${styles.p1DiscPreview}`}></div>
              <span className={styles.playerName}>(You) {username || 'Player'}</span>
              <div className={styles.avatarBox}>
                <span className={styles.avatar}>😎</span>
              </div>
            </div>
          </>
        )}

        <div className={styles.sidebarFooter}>
          <button 
            className={styles.spectateButton} 
            onClick={() => setBgMusicEnabled(!bgMusicEnabled)}
            title={bgMusicEnabled ? 'Mute Music' : 'Play Music'}
          >
             {bgMusicEnabled ? '🔊 Sound On' : '🔇 Sound Off'}
          </button>
        </div>
      </div>

      {/* Main Game Area */}
      <div className={styles.mainArea}>
        {gameStatus === 'menu' ? (
           <div className={styles.menuOverlay}>
            <h1 className={styles.title}>4 in a Row</h1>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter Username"
              className={`${styles.input} ${usernameShake ? styles.inputShake : ''}`}
            />
             <div className={styles.buttonGroup}>
              <button onClick={handleJoinPvP} className={styles.button}>Find Player</button>
              <button onClick={handleJoinBot} className={`${styles.button} ${styles.buttonSecondary}`}>Play Bot</button>
            </div>
            <button onClick={handlePlayWithFriend} className={`${styles.button} ${styles.buttonFriend}`}>👥 Play with Friend</button>
           </div>
        ) : (
          <>
            {/* Status / Move Info */}
            
            {/* Joining Overlay */}
            {gameStatus === 'waiting' && (
               <div className={styles.modalOverlay}>
                 <div className={styles.modalContent}>
                    <div className={styles.modalIcon}>⏳</div>
                    <h2 className={styles.modalTitle}>Joining...</h2>
                    <p className={styles.modalSubtitle}>Looking for {gameMode === 'bot' ? 'a bot opponent' : 'another player'}</p>
                 </div>
               </div>
            )}

            {/* Game Board Wrapper */}
            <div
              className={`${styles.boardWrapper} ${gameStatus === 'playing' || gameStatus === 'ended' ? styles.boardScale : ''}`}
              style={
                {
                  ['--cell-size']: `${boardLayout.cellSize}px`,
                  ['--board-gap']: `${boardLayout.gap}px`,
                } as CSSProperties
              }
            >
               {gameStatus === 'playing' && (
                 <div className={styles.turnLineSimple}>
                   <span className={styles.turnLineText}>
                     {turnPlayerName === '…' ? '…' : `${turnPlayerName}'s turn`}
                   </span>
                   <div
                     className={`${styles.turnIndicatorDisc} ${
                       currentTurn >= 1 && currentTurn <= 8
                         ? discClasses[currentTurn - 1]
                         : styles.p1DiscPreview
                     }`}
                     aria-hidden
                   />
                 </div>
               )}

               {gameStatus === 'ended' && (
                 <div className={styles.statusBanner}>
                    <span className={styles.statusIcon}>🏆</span>
                    <span className={styles.statusText}>
                      {endGameHeadline()}
                      <span className={styles.statusSubtext}> - {getWinReasonText()}</span>
                    </span>
                    {scoringMode && scores.length > 0 && (
                      <div className={styles.statusSubtext} style={{ width: '100%', textAlign: 'center' }}>
                        Final:{' '}
                        {playerUsernames.map((n, i) => (
                          <span key={n + i} style={{ marginRight: 10 }}>
                            {n} {scores[i] ?? 0}
                          </span>
                        ))}
                      </div>
                    )}
                    {invitePartyId && gameMode === 'friend' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                        <button
                          type="button"
                          onClick={handlePlayAgain}
                          className={styles.playAgainBtn}
                          disabled={hasVotedRematch}
                        >
                          {hasVotedRematch ? 'Waiting for others…' : 'Play again (same players)'}
                        </button>
                        {rematchNeeded > 0 && (
                          <span className={styles.statusSubtext}>
                            {rematchVotes} / {rematchNeeded} ready for rematch
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={handleLeaveToMenu}
                          className={styles.playAgainBtn}
                          style={{
                            background: 'linear-gradient(180deg, #64748b 0%, #475569 100%)',
                            boxShadow: '0 4px 0 #334155',
                          }}
                        >
                          Leave to menu
                        </button>
                      </div>
                    ) : (
                      <button type="button" onClick={handlePlayAgain} className={styles.playAgainBtn}>
                        Play Again
                      </button>
                    )}
                 </div>
               )}

               {/* Preview strip sits above the wood frame; disc is not inside .board */}
               <div
                 className={styles.boardPlayArea}
                 onPointerMove={handleBoardPointerMove}
                 onPointerLeave={handleBoardPointerLeave}
               >
                 {gameStatus === 'playing' && (
                   <div
                     ref={hoverStripRef}
                     className={styles.hoverStripOutside}
                     onPointerDown={(e) => {
                       e.preventDefault();
                       if (gameStatus !== 'playing' || !isMyTurn || winner) return;
                       const col = columnFromClientX(e.clientX);
                       if (col !== null) handleColumnClick(col);
                     }}
                     aria-hidden
                   >
                     {pointerPreview && isMyTurn && !winner && (
                       <div
                         className={`${styles.floatingDisc} ${styles.floatingDiscFollow} ${getFloatingClass()}`}
                         style={{
                           left: pointerPreview.x,
                           top: pointerPreview.y,
                         }}
                       />
                     )}
                   </div>
                 )}
                 <div ref={boardRef} className={styles.board}>
                   {board.map((row, rowIndex) => (
                     <div key={rowIndex} className={styles.row} data-board-row={rowIndex}>
                       {row.map((cell, colIndex) => {
                         const isWinningCell = winningCells.some(
                           (wc) => wc.row === rowIndex && wc.col === colIndex
                         );
                         return (
                           <div
                             key={colIndex}
                             className={styles.cell}
                             data-col={colIndex}
                             onClick={() => handleColumnClick(colIndex)}
                           >
                             <div className={styles.hole}>
                               {cell !== 0 && (
                                 <div
                                   className={`${styles.disc} ${getCellClass(cell)} ${isWinningCell ? styles.winningDisc : ''}`}
                                 />
                               )}
                             </div>
                           </div>
                         );
                       })}
                     </div>
                   ))}
                 </div>
               </div>
            </div>
          </>
        )}
      </div>

      {/* Chat Panel */}
      <div className={`${styles.chatPanel} ${chatOpen ? styles.chatOpen : ''}`}>
        <button className={styles.chatToggle} onClick={() => {
          if (!chatOpen) {
            setUnreadCount(0); // Reset unread count when opening chat
          }
          setChatOpen(!chatOpen);
        }}>
          {chatOpen ? 'close' : 'chat'}
          {!chatOpen && unreadCount > 0 && (
            <span className={styles.unreadBadge}>{unreadCount > 9 ? '9+' : unreadCount}</span>
          )}
        </button>
        
        {chatOpen && (
          <>
            <div className={styles.chatHeader}>Chat</div>
            <div className={styles.chatMessages}>
              {gameMode === 'bot' ? (
                <div className={styles.chatMessage} style={{ textAlign: 'center', opacity: 0.7, marginTop: '50%' }}>
                  💬 Chat is available when playing with real players!
                </div>
              ) : (
                chatMessages.map((msg, idx) => (
                  <div key={idx} className={styles.chatMessage}>
                    <strong>{msg.username}:</strong> {msg.message}
                  </div>
                ))
              )}
            </div>
            {gameStatus === 'playing' && gameMode !== 'bot' && gameMode !== null && (
              <div className={styles.chatInput}>
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendChat()}
                  placeholder="Type a message..."
                />
                <button onClick={handleSendChat}>Send</button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Spectate Confirmation Modal */}
      {showSpectateModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
             <button className={styles.closeButton} onClick={() => setShowSpectateModal(false)}>×</button>
             <div className={styles.modalIcon}>💣</div>
             <p className={styles.modalText}>Do you wish to leave the game and become a spectator?</p>
             <div className={styles.modalActions}>
                <button className={`${styles.modalButton} ${styles.confirmBtn}`} onClick={() => {
                   // Implement spectate logic (essentially verify strict spectator mode or just close modal for now as placeholder unless strictly required logic)
                   // For now, simple close as specific logic wasn't fully detailed beyond UI
                   setShowSpectateModal(false);
                   alert('Spectator mode coming soon!');
                }}>Spectate</button>
                <button className={`${styles.modalButton} ${styles.cancelBtn}`} onClick={() => setShowSpectateModal(false)}>Cancel</button>
             </div>
          </div>
        </div>
      )}

      {/* Play with Friend Modal */}
      {showFriendModal && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <button className={styles.closeButton} onClick={handleCloseFriendModal}>×</button>
            <div className={styles.modalIcon}>👥</div>
            <h2 className={styles.modalTitle}>Play with Friends</h2>
            
            {!isWaitingInRoom && !friendJoinWaiting ? (
              <>
                <div className={styles.friendSection}>
                  <p className={styles.friendSectionTitle}>Create a room</p>
                  <div className={styles.maxPlayersRow}>
                    <label className={styles.maxPlayersLabel} htmlFor="max-players">
                      Total players in this game (2–8)
                    </label>
                    <select
                      id="max-players"
                      className={styles.maxPlayersSelect}
                      value={friendMaxPlayers}
                      onChange={(e) => setFriendMaxPlayers(Number(e.target.value))}
                    >
                      {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                        <option key={n} value={n}>
                          {n} players
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className={styles.waitingText} style={{ fontSize: '0.85rem', marginTop: 0 }}>
                    Invite {friendMaxPlayers - 1} friend{friendMaxPlayers > 2 ? 's' : ''} with the room code.
                    3+ players: bigger board, unique colors, and score mode — most 4-in-a-rows when the board fills wins.
                  </p>
                  <button className={`${styles.button} ${styles.buttonFriend}`} onClick={handleCreateRoom}>
                    🏠 Create room
                  </button>
                </div>
                
                <div className={styles.friendDivider}>
                  <span>OR</span>
                </div>
                
                <div className={styles.friendSection}>
                  <p className={styles.friendSectionTitle}>Join a room</p>
                  <input
                    type="text"
                    value={friendRoomCode}
                    onChange={(e) => setFriendRoomCode(e.target.value.toUpperCase())}
                    placeholder="Enter Room Code"
                    className={styles.roomCodeInput}
                    maxLength={6}
                  />
                  <button 
                    className={`${styles.button} ${styles.buttonSecondary}`} 
                    onClick={handleJoinRoom}
                    disabled={!friendRoomCode.trim()}
                  >
                    🚀 Join room
                  </button>
                </div>
                
                {roomError && (
                  <p className={styles.roomError}>{roomError}</p>
                )}
              </>
            ) : (
              <>
                <div className={styles.friendSection}>
                  {isWaitingInRoom ? (
                    <>
                      <p className={styles.friendSectionTitle}>Your room code</p>
                      <div className={styles.roomCodeDisplay}>
                        <span className={styles.roomCode}>{myRoomCode}</span>
                        <button 
                          className={styles.copyButton}
                          onClick={() => {
                            navigator.clipboard.writeText(myRoomCode || '');
                            setCodeCopied(true);
                            setTimeout(() => setCodeCopied(false), 2000);
                          }}
                        >
                          {codeCopied ? '✓ Copied!' : '📋 Copy'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className={styles.friendSectionTitle}>Room {friendRoomCode}</p>
                      <p className={styles.waitingText}>You&apos;re in the lobby.</p>
                    </>
                  )}
                  <p className={styles.waitingText}>
                    {lobbyPlayers.length} / {roomMaxPlayers} players joined
                  </p>
                  <ul className={styles.lobbyPlayerList}>
                    {lobbyPlayers.map((p, i) => (
                      <li key={`${p}-${i}`}>
                        <span className={`${styles.rosterSwatch} ${discClasses[i] ?? ''}`} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 8 }} />
                        {p}
                        {p === username ? ' (you)' : ''}
                      </li>
                    ))}
                  </ul>
                  <p className={styles.waitingText}>
                    ⏳ Waiting for more players…
                  </p>
                  <button className={`${styles.button} ${styles.cancelBtn}`} onClick={handleCancelRoom}>
                    {isWaitingInRoom ? 'Cancel room' : 'Leave lobby'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}


    </div>
  );
}
