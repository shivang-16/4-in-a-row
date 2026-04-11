'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import styles from './room.module.css';
import {
  User, XCircle, Rocket, Clock, Gamepad2,
  Copy, Check, Crown, CheckCircle2, X,
  Play, Users,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

/** The 10 choosable ball colours shown in the lobby */
export const BALL_COLORS = [
  {
    id: 'yellow', label: 'Gold',
    bg: 'repeating-linear-gradient(-45deg,#ffd700,#ffd700 8px,#ffaa00 8px,#ffaa00 16px)',
    border: '#b8860b', preview: '#ffd700',
  },
  {
    id: 'cyan', label: 'Marble',
    bg: 'radial-gradient(ellipse at 25% 25%,rgba(255,255,255,0.45) 0%,transparent 45%),conic-gradient(from 40deg,#40e0d0,#00ced1,#008b8b,#00bcd4,#40e0d0)',
    border: '#00dad7', preview: '#40e0d0',
  },
  {
    id: 'red', label: 'Lava',
    bg: 'radial-gradient(circle at 38% 32%,rgba(255,210,0,0.55) 0%,transparent 38%),conic-gradient(from 0deg,#ff6b6b,#ff0000,#c92a2a,#ff4500,#ff8c00,#ff6b6b)',
    border: '#ff4444', preview: '#ff6b6b',
  },
  {
    id: 'purple', label: 'Galaxy',
    bg: 'radial-gradient(circle at 28% 28%,rgba(255,255,255,0.28) 0%,transparent 28%),radial-gradient(circle at 72% 65%,rgba(200,80,255,0.35) 0%,transparent 40%),radial-gradient(circle at 55% 50%,#a855f7,#4c1d95)',
    border: '#c084fc', preview: '#a855f7',
  },
  {
    id: 'green', label: 'Forest',
    bg: 'repeating-linear-gradient(120deg,#22c55e,#22c55e 6px,#16a34a 6px,#16a34a 12px,#166534 12px,#166534 18px)',
    border: '#4ade80', preview: '#22c55e',
  },
  {
    id: 'orange', label: 'Citrus',
    bg: 'radial-gradient(circle at 50% 50%,rgba(255,255,255,0.22) 0%,transparent 22%),conic-gradient(from 0deg,#f97316 0deg,#ea580c 30deg,#f97316 60deg,#ea580c 90deg,#f97316 120deg,#ea580c 150deg,#f97316 180deg,#ea580c 210deg,#f97316 240deg,#ea580c 270deg,#f97316 300deg,#ea580c 330deg,#f97316 360deg)',
    border: '#fb923c', preview: '#f97316',
  },
  {
    id: 'pink', label: 'Candy',
    bg: 'repeating-linear-gradient(45deg,transparent,transparent 7px,rgba(249,168,212,0.55) 7px,rgba(249,168,212,0.55) 8px),repeating-linear-gradient(-45deg,transparent,transparent 7px,rgba(249,168,212,0.55) 7px,rgba(249,168,212,0.55) 8px),linear-gradient(145deg,#ec4899,#9d174d)',
    border: '#f472b6', preview: '#ec4899',
  },
  {
    id: 'gray', label: 'Chrome',
    bg: 'repeating-linear-gradient(-12deg,#6b7280,#d1d5db 3px,#f3f4f6 6px,#9ca3af 10px,#6b7280 13px)',
    border: '#e5e7eb', preview: '#d1d5db',
  },
  {
    id: 'blue', label: 'Ocean',
    bg: 'repeating-linear-gradient(0deg,#1d4ed8,#1d4ed8 5px,#3b82f6 5px,#3b82f6 10px)',
    border: '#60a5fa', preview: '#3b82f6',
  },
  {
    id: 'lime', label: 'Neon',
    bg: 'radial-gradient(circle at 50% 50%,rgba(255,255,255,0.3) 0%,transparent 28%),conic-gradient(from 0deg,#a3e635,#84cc16,#a3e635,#84cc16,#a3e635,#84cc16,#a3e635,#84cc16)',
    border: '#bef264', preview: '#a3e635',
  },
] as const;

export type BallColorId = typeof BALL_COLORS[number]['id'];

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const rawCode = params.code as string;
  const isCreateMode = rawCode === 'new';

  const [username, setUsername] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [nameError, setNameError] = useState('');
  const [showNamePrompt, setShowNamePrompt] = useState(false);

  const [socket, setSocket] = useState<Socket | null>(null);
  const [roomCode, setRoomCode] = useState(isCreateMode ? '' : rawCode.toUpperCase());
  const [players, setPlayers] = useState<string[]>([]);
  const [hostUsername, setHostUsername] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [roomError, setRoomError] = useState('');
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'waiting' | 'starting' | 'closed'>('connecting');
  const [winStreak, setWinStreak] = useState(4);

  /** username → colorId chosen by that player */
  const [colorChoices, setColorChoices] = useState<Record<string, string>>({});
  /** colorId this local player has selected */
  const [myColorId, setMyColorId] = useState<string>('');

  const shareableUrl =
    typeof window !== 'undefined' && roomCode
      ? `${window.location.origin}/room/${roomCode}`
      : '';

  useEffect(() => {
    const stored = sessionStorage.getItem('4inarow_username') ?? '';
    setUsernameInput(stored.trim());
    setShowNamePrompt(true);
  }, []);

  const confirmUsername = () => {
    const u = usernameInput.trim();
    if (!u) { setNameError('Enter a username first'); return; }
    sessionStorage.setItem('4inarow_username', u);
    setUsername(u);
    setShowNamePrompt(false);
    setNameError('');
  };

  /* ── connect socket once username is known ── */
  useEffect(() => {
    if (!username) return;

    const sock = io(API_URL, { transports: ['websocket', 'polling'] });
    setSocket(sock);

    const shouldCreate = isCreateMode || sessionStorage.getItem('4inarow_createRoom') === '1';
    sessionStorage.removeItem('4inarow_createRoom');

    sock.on('connect', () => {
      sock.emit('player:join', { username });
      if (shouldCreate) {
        sock.emit('room:create', { username });
      } else {
        sock.emit('room:join', { username, roomCode: rawCode.toUpperCase() });
      }
    });

    sock.on('room:created', (data: { roomCode: string; hostUsername: string; players: string[]; colorChoices?: Record<string, string> }) => {
      const code = data.roomCode;
      setRoomCode(code);
      setHostUsername(data.hostUsername);
      setIsHost(data.hostUsername === username);
      setPlayers(data.players);
      setColorChoices(data.colorChoices ?? {});
      setStatus('waiting');
      window.history.replaceState(null, '', `/room/${code}`);
    });

    sock.on('room:joinPending', (data: { roomCode: string; players: string[]; maxPlayers: number; hostUsername: string; colorChoices?: Record<string, string> }) => {
      setRoomCode(data.roomCode);
      setHostUsername(data.hostUsername);
      setIsHost(data.hostUsername === username);
      setPlayers(data.players);
      setColorChoices(data.colorChoices ?? {});
      setStatus('waiting');
    });

    sock.on('room:lobbyUpdate', (data: { players: string[]; maxPlayers: number; hostUsername: string; colorChoices?: Record<string, string> }) => {
      setPlayers(data.players);
      setHostUsername(data.hostUsername);
      setIsHost(data.hostUsername === username);
      setColorChoices(data.colorChoices ?? {});
    });

    sock.on('room:error', (data: { message: string }) => {
      setRoomError(data.message);
      setStatus('closed');
    });

    sock.on('room:closed', (data: { reason?: string }) => {
      setRoomError(data.reason ?? 'Room was closed');
      setStatus('closed');
    });

    sock.on('game:started', (data: any) => {
      sessionStorage.setItem('4inarow_pendingGame', JSON.stringify({ ...data, username }));
      setStatus('starting');
      router.push('/');
    });

    return () => { sock.close(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  /** Pick / un-pick a ball color. Emits to server so other players see it locked. */
  const handleColorPick = useCallback((colorId: string) => {
    if (!socket) return;
    const next = myColorId === colorId ? '' : colorId;
    setMyColorId(next);
    socket.emit('room:colorPick', { colorId: next });
  }, [socket, myColorId]);

  const handleStartGame = useCallback(() => {
    socket?.emit('room:start', { winStreak });
  }, [socket, winStreak]);

  const handleCopy = () => {
    navigator.clipboard.writeText(shareableUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleLeave = () => {
    socket?.emit('room:leave');
    router.push('/');
  };

  /** Returns the ball color data for a given username (fallback: first slot-based default not taken by another player) */
  const getPlayerBallColor = (player: string, slotIndex: number) => {
    const chosenId = colorChoices[player];
    if (chosenId) {
      const found = BALL_COLORS.find((c) => c.id === chosenId);
      if (found) return found;
    }
    // Find a default color that no other player has explicitly chosen
    const takenByOthers = new Set(
      Object.entries(colorChoices)
        .filter(([u]) => u !== player)
        .map(([, id]) => id)
    );
    // Try slot-based index first, then walk forward to find a free one
    for (let offset = 0; offset < BALL_COLORS.length; offset++) {
      const candidate = BALL_COLORS[(slotIndex + offset) % BALL_COLORS.length]!;
      if (!takenByOthers.has(candidate.id)) return candidate;
    }
    return BALL_COLORS[slotIndex % BALL_COLORS.length] ?? BALL_COLORS[0]!;
  };

  /** colorIds currently locked by OTHER players */
  const takenColorIds = Object.entries(colorChoices)
    .filter(([u]) => u !== username)
    .map(([, c]) => c);

  /* ── username prompt ── */
  if (showNamePrompt) {
    return (
      <div className={styles.page}>
        <div className={styles.promptCard}>
          <div className={styles.promptIcon}><User size={40} /></div>
          <h2 className={styles.promptTitle}>Enter your name</h2>
          <p className={styles.promptSub}>
            {isCreateMode ? 'Creating a new room…' : <>You&apos;re joining room <strong>{rawCode.toUpperCase()}</strong></>}
          </p>
          <input
            className={styles.promptInput}
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && confirmUsername()}
            placeholder="Your username"
            maxLength={20}
            autoFocus
          />
          {nameError && <p className={styles.errorText}>{nameError}</p>}
          <button className={styles.btnPrimary} onClick={confirmUsername}>
            {isCreateMode ? 'Create Room →' : 'Join Room →'}
          </button>
        </div>
      </div>
    );
  }

  if (status === 'closed') {
    return (
      <div className={styles.page}>
        <div className={styles.promptCard}>
          <div className={styles.promptIcon}><XCircle size={40} /></div>
          <h2 className={styles.promptTitle}>Room unavailable</h2>
          <p className={styles.promptSub}>{roomError}</p>
          <button className={styles.btnPrimary} onClick={() => router.push('/')}>
            Back to home
          </button>
        </div>
      </div>
    );
  }

  if (status === 'starting') {
    return (
      <div className={styles.page}>
        <div className={styles.promptCard}>
          <div className={styles.promptIcon}><Rocket size={40} /></div>
          <h2 className={styles.promptTitle}>Game starting…</h2>
        </div>
      </div>
    );
  }

  if (status === 'connecting') {
    return (
      <div className={styles.page}>
        <div className={styles.promptCard}>
          <div className={styles.promptIcon}><Clock size={40} /></div>
          <h2 className={styles.promptTitle}>{isCreateMode ? 'Creating room…' : 'Joining room…'}</h2>
        </div>
      </div>
    );
  }

  /* ── main lobby ── */
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <button className={styles.leaveBtn} onClick={handleLeave} title="Leave room">
          ← Leave
        </button>

        <div className={styles.headerIcon}><Gamepad2 size={32} /></div>
        <h1 className={styles.title}>Game Lobby</h1>
        <div className={styles.roomCodeBadge}>{roomCode}</div>

        <div className={styles.shareSection}>
          <p className={styles.shareLabel}>Invite friends — share this link</p>
          <div className={styles.shareLinkRow}>
            <span className={styles.shareLink}>{shareableUrl}</span>
            <button className={styles.copyBtn} onClick={handleCopy}>
              {copied ? <><Check size={13} style={{verticalAlign:'middle',marginRight:4}}/>Copied!</> : <><Copy size={13} style={{verticalAlign:'middle',marginRight:4}}/>Copy</>}
            </button>
          </div>
        </div>

        {/* ── Players list ── */}
        <div className={styles.playersSection}>
          <p className={styles.playersLabel}>
            Players in lobby <span className={styles.playerCount}>{players.length} (max 8)</span>
          </p>
          <ul className={styles.playerList}>
            {players.map((p, i) => {
              const ballColor = getPlayerBallColor(p, i);
              return (
                <li key={p} className={styles.playerRow}>
                  <span
                    className={styles.playerSwatch}
                    style={{ background: ballColor.bg, borderColor: ballColor.border }}
                  />
                  <span className={styles.playerName}>
                    {p}{p === username ? ' (you)' : ''}
                  </span>
                  {colorChoices[p] && (
                    <span className={styles.colorLabel}>{BALL_COLORS.find(c => c.id === colorChoices[p])?.label}</span>
                  )}
                  {p === hostUsername && <span className={styles.hostBadge}><Crown size={11} style={{verticalAlign:'middle',marginRight:3}}/>host</span>}
                </li>
              );
            })}
          </ul>
          {players.length < 2 && (
            <p className={styles.waitingNote}><Clock size={13} style={{verticalAlign:'middle',marginRight:5}}/>Waiting for at least one more player…</p>
          )}
        </div>

        {/* ── Ball colour picker ── */}
        <div className={styles.colorPickerSection}>
          <p className={styles.colorPickerLabel}>Choose your ball colour</p>
          <div className={styles.colorGrid}>
            {BALL_COLORS.map((color) => {
              const isMine = myColorId === color.id;
              const isTaken = takenColorIds.includes(color.id);
              return (
                <button
                  key={color.id}
                  className={`${styles.colorOption} ${isMine ? styles.colorOptionSelected : ''} ${isTaken ? styles.colorOptionTaken : ''}`}
                  onClick={() => !isTaken && handleColorPick(color.id)}
                  disabled={isTaken}
                  title={isTaken ? 'Taken by another player' : color.label}
                  aria-label={color.label}
                >
                  <span
                    className={styles.colorBall}
                    style={{ background: color.bg, borderColor: color.border }}
                  />
                  <span className={styles.colorName}>{color.label}</span>
                  {isTaken && <span className={styles.takenBadge}><X size={10} /></span>}
                  {isMine && <span className={styles.checkBadge}><CheckCircle2 size={10} /></span>}
                </button>
              );
            })}
          </div>
        </div>

        {isHost ? (
          <>
            <div className={styles.winStreakRow}>
              <span className={styles.winStreakLabel}>Win condition</span>
              <div className={styles.winStreakOptions}>
                {[4, 5, 6, 7, 8].map((n) => (
                  <button
                    key={n}
                    className={`${styles.winStreakBtn} ${winStreak === n ? styles.winStreakBtnActive : ''}`}
                    onClick={() => setWinStreak(n)}
                  >
                    {n}-in-a-row
                  </button>
                ))}
              </div>
            </div>
            <button className={styles.btnStart} onClick={handleStartGame} disabled={players.length < 2}>
              {players.length < 2 ? 'Need at least 2 players to start' : <><Play size={14} style={{verticalAlign:'middle',marginRight:6}}/>Start Game ({players.length} players)</>}
            </button>
          </>
        ) : (
          <p className={styles.waitingNote}>
            <Clock size={13} style={{verticalAlign:'middle',marginRight:5}}/>Waiting for <strong>{hostUsername}</strong> to start the game…
          </p>
        )}

        {roomError && <p className={styles.errorText}>{roomError}</p>}
      </div>
    </div>
  );
}
