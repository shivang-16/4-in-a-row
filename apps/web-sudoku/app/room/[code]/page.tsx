'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { Copy, Check, Crown, Play, Users, Home } from 'lucide-react';
import styles from './sudoku-room.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const MAX_PLAYERS = 8;

const PLAYER_COLORS = [
  '#f87171', '#60a5fa', '#4ade80', '#fbbf24',
  '#a78bfa', '#f472b6', '#34d399', '#fb923c',
];

type Difficulty = 'easy' | 'medium' | 'hard';
type Status = 'name' | 'connecting' | 'lobby' | 'starting' | 'error';

const DIFF_INFO: Record<Difficulty, { label: string; color: string; desc: string }> = {
  easy:   { label: 'Easy',   color: '#4ade80', desc: '~45 given cells' },
  medium: { label: 'Medium', color: '#fbbf24', desc: '~35 given cells' },
  hard:   { label: 'Hard',   color: '#f87171', desc: '~25 given cells' },
};

export default function SudokuRoomPage() {
  const { code: rawCode } = useParams<{ code: string }>();
  const router = useRouter();

  const isCreateMode = rawCode === 'new';

  const [status, setStatus]         = useState<Status>('name');
  const [username, setUsername]     = useState('');
  const [nameInput, setNameInput]   = useState('');
  const [nameError, setNameError]   = useState(false);
  const [roomCode, setRoomCode]     = useState('');
  const [players, setPlayers]       = useState<string[]>([]);
  const [hostUsername, setHost]     = useState('');
  const [roomError, setRoomError]   = useState('');
  const [copied, setCopied]         = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');

  const socketRef  = useRef<Socket | null>(null);
  const didConnect = useRef(false);

  const isHost = username !== '' && username === hostUsername;

  const shareableUrl =
    typeof window !== 'undefined' && roomCode
      ? `${window.location.origin}/room/${roomCode}`
      : '';

  useEffect(() => {
    const saved = sessionStorage.getItem('4inarow_username') || '';
    if (saved) setNameInput(saved);
  }, []);

  const handleNameSubmit = useCallback(() => {
    const trimmed = nameInput.trim();
    if (!trimmed) { setNameError(true); setTimeout(() => setNameError(false), 600); return; }
    sessionStorage.setItem('4inarow_username', trimmed);
    setUsername(trimmed);
    setStatus('connecting');
  }, [nameInput]);

  useEffect(() => {
    if (!username || didConnect.current) return;
    didConnect.current = true;

    const sock = io(API_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = sock;

    sock.on('connect', () => {
      sock.emit('player:join', { username });
      if (isCreateMode) {
        sock.emit('sudoku:room:create', { username, difficulty });
      } else {
        const code = String(rawCode).toUpperCase().trim();
        sock.emit('sudoku:room:join', { username, roomCode: code });
      }
    });

    sock.on('sudoku:room:created', (data: { roomCode: string; hostUsername: string; difficulty: Difficulty }) => {
      setRoomCode(data.roomCode);
      setHost(data.hostUsername);
      setPlayers([data.hostUsername]);
      setDifficulty(data.difficulty);
      setStatus('lobby');
    });

    sock.on('sudoku:room:joinPending', (data: { roomCode: string; players: string[]; hostUsername: string; difficulty: Difficulty }) => {
      setRoomCode(data.roomCode);
      setHost(data.hostUsername);
      setPlayers(data.players);
      setDifficulty(data.difficulty ?? 'medium');
      setStatus('lobby');
    });

    sock.on('sudoku:room:lobbyUpdate', (data: { players: string[]; hostUsername: string; difficulty?: Difficulty }) => {
      setPlayers(data.players);
      setHost(data.hostUsername);
      if (data.difficulty) setDifficulty(data.difficulty);
    });

    sock.on('sudoku:game:started', (data: unknown) => {
      setStatus('starting');
      sessionStorage.setItem('sudoku_pending_game', JSON.stringify(data));
      router.push('/');
    });

    sock.on('sudoku:room:error', (data: { message: string }) => {
      setRoomError(data.message);
      setStatus('error');
    });

    sock.on('sudoku:room:closed', () => {
      setRoomError('The host closed the room.');
      setStatus('error');
    });

    sock.on('connect_error', () => {
      setRoomError('Could not connect to server.');
      setStatus('error');
    });

    return () => { sock.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const handleStart = useCallback(() => {
    socketRef.current?.emit('sudoku:room:start');
  }, []);

  const handleDifficultyChange = useCallback((d: Difficulty) => {
    setDifficulty(d);
    socketRef.current?.emit('sudoku:room:setDifficulty', { difficulty: d });
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(shareableUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [shareableUrl]);

  const handleLeave = useCallback(() => {
    socketRef.current?.emit('sudoku:room:leave');
    router.push('/');
  }, [router]);

  if (status === 'name') {
    return (
      <div className={styles.namePage}>
        <div className={styles.nameCard}>
          <div className={styles.nameIcon}>🔢</div>
          <h1 className={styles.nameTitle}>Sudoku</h1>
          <p className={styles.nameSubtitle}>
            {isCreateMode ? 'Create a room and invite friends' : `Join room ${String(rawCode).toUpperCase()}`}
          </p>
          <div className={`${styles.nameInputWrap} ${nameError ? styles.shake : ''}`}>
            <input
              className={styles.nameInput}
              type="text"
              placeholder="Enter your name..."
              value={nameInput}
              maxLength={20}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNameSubmit()}
              autoFocus
            />
          </div>
          <button className={styles.nameBtn} onClick={handleNameSubmit}>
            {isCreateMode ? 'Create Room' : 'Join Room'}
          </button>
        </div>
      </div>
    );
  }

  if (status === 'connecting') {
    return (
      <div className={styles.namePage}>
        <div className={styles.nameCard}>
          <div className={styles.spinner} />
          <p className={styles.connectingText}>Connecting...</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className={styles.namePage}>
        <div className={styles.nameCard}>
          <div className={styles.errorIcon}>⚠️</div>
          <p className={styles.errorText}>{roomError}</p>
          <button className={styles.nameBtn} onClick={() => router.push('/')}>
            Back to Sudoku
          </button>
        </div>
      </div>
    );
  }

  if (status === 'starting') {
    return (
      <div className={styles.namePage}>
        <div className={styles.nameCard}>
          <div className={styles.spinner} />
          <p className={styles.connectingText}>Starting game...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.lobby}>
        {/* Header */}
        <div className={styles.header}>
          <button className={styles.homeBtn} onClick={() => router.push('/')}>
            <Home size={16} />
          </button>
          <h1 className={styles.title}>🔢 Sudoku Room</h1>
          <button className={styles.leaveBtn} onClick={handleLeave}>Leave</button>
        </div>

        {/* Room code */}
        <div className={styles.codeSection}>
          <p className={styles.codeLabel}>Room Code</p>
          <div className={styles.codeRow}>
            <span className={styles.code}>{roomCode}</span>
            <button className={styles.copyBtn} onClick={handleCopy}>
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
          <p className={styles.codeHint}>Share this code with friends to invite them</p>
        </div>

        {/* Difficulty */}
        {isHost && (
          <div className={styles.diffSection}>
            <div className={styles.sectionHeader}>
              <span>🎯</span>
              <span>Difficulty (host sets)</span>
            </div>
            <div className={styles.diffControls}>
              {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
                <button
                  key={d}
                  className={`${styles.diffBtn} ${difficulty === d ? styles.diffBtnActive : ''}`}
                  style={difficulty === d ? { '--diff-color': DIFF_INFO[d].color } as React.CSSProperties : undefined}
                  onClick={() => handleDifficultyChange(d)}
                >
                  <span className={styles.diffBtnName}>{DIFF_INFO[d].label}</span>
                  <span className={styles.diffBtnDesc}>{DIFF_INFO[d].desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {!isHost && (
          <div className={styles.diffSection}>
            <p className={styles.diffInfo}>
              Difficulty: <strong style={{ color: DIFF_INFO[difficulty].color }}>{DIFF_INFO[difficulty].label}</strong>
              <span className={styles.diffInfoDesc}> — {DIFF_INFO[difficulty].desc}</span>
            </p>
          </div>
        )}

        {/* Players */}
        <div className={styles.playersSection}>
          <div className={styles.sectionHeader}>
            <Users size={16} />
            <span>Players ({players.length}/{MAX_PLAYERS})</span>
          </div>
          <div className={styles.playerList}>
            {players.map((p, i) => (
              <div key={p} className={styles.playerRow}>
                <div className={styles.playerAvatar} style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }}>
                  {p[0]?.toUpperCase()}
                </div>
                <span className={styles.playerName}>{p}</span>
                {p === hostUsername && (
                  <span className={styles.hostBadge}>
                    <Crown size={12} /> Host
                  </span>
                )}
              </div>
            ))}
            {players.length < MAX_PLAYERS && (
              <div className={styles.waitingRow}>
                <div className={styles.waitingDots}><span /><span /><span /></div>
                <span className={styles.waitingLabel}>Waiting for players… (up to {MAX_PLAYERS})</span>
              </div>
            )}
          </div>
        </div>

        {/* Start button */}
        {isHost && (
          <button
            className={styles.startBtn}
            onClick={handleStart}
            disabled={players.length < 2}
          >
            <Play size={18} />
            Start Game ({players.length} players)
          </button>
        )}
        {!isHost && (
          <p className={styles.waitingText}>Waiting for the host to start the game...</p>
        )}
      </div>
    </div>
  );
}
