'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import styles from './room.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

const PLAYER_COLORS = [
  '#ffd700',
  '#00dad7',
  '#ff6b6b',
  '#a855f7',
  '#22c55e',
  '#f97316',
  '#ec4899',
  '#e5e7eb',
];

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const rawCode = params.code as string;
  /** 'new' means we should create the room; otherwise it's the 6-char code */
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
  /** Win streak chosen by host (4–8). Default 4; bumped to 6 once 3+ players join. */
  const [winStreak, setWinStreak] = useState(4);

  const shareableUrl =
    typeof window !== 'undefined' && roomCode
      ? `${window.location.origin}/room/${roomCode}`
      : '';

  /* ── resolve username — always prompt so each room join is intentional ── */
  useEffect(() => {
    const stored = sessionStorage.getItem('4inarow_username') ?? '';
    setUsernameInput(stored.trim()); // pre-fill but always ask
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

    sock.on('room:created', (data: { roomCode: string; hostUsername: string; players: string[] }) => {
      const code = data.roomCode;
      setRoomCode(code);
      setHostUsername(data.hostUsername);
      setIsHost(data.hostUsername === username);
      setPlayers(data.players);
      setStatus('waiting');
      // Replace URL so back-button works cleanly
      window.history.replaceState(null, '', `/room/${code}`);
    });

    sock.on('room:joinPending', (data: { roomCode: string; players: string[]; maxPlayers: number; hostUsername: string }) => {
      setRoomCode(data.roomCode);
      setHostUsername(data.hostUsername);
      setIsHost(data.hostUsername === username);
      setPlayers(data.players);
      setStatus('waiting');
    });

    sock.on('room:lobbyUpdate', (data: { players: string[]; maxPlayers: number; hostUsername: string }) => {
      setPlayers(data.players);
      setHostUsername(data.hostUsername);
      setIsHost(data.hostUsername === username);
      // Auto-suggest streak based on player count (host can override)
      setWinStreak((prev) => {
        const suggested = data.players.length >= 3 ? 6 : 4;
        // Only auto-update if they're still on the default for the previous count
        if (prev === 4 && suggested === 6) return 6;
        if (prev === 6 && suggested === 4) return 4;
        return prev;
      });
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

  /* ── username prompt ── */
  if (showNamePrompt) {
    return (
      <div className={styles.page}>
        <div className={styles.promptCard}>
          <div className={styles.promptIcon}>👤</div>
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
          <div className={styles.promptIcon}>❌</div>
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
          <div className={styles.promptIcon}>🚀</div>
          <h2 className={styles.promptTitle}>Game starting…</h2>
        </div>
      </div>
    );
  }

  if (status === 'connecting') {
    return (
      <div className={styles.page}>
        <div className={styles.promptCard}>
          <div className={styles.promptIcon}>⏳</div>
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

        <div className={styles.headerIcon}>🎮</div>
        <h1 className={styles.title}>Game Lobby</h1>
        <div className={styles.roomCodeBadge}>{roomCode}</div>

        <div className={styles.shareSection}>
          <p className={styles.shareLabel}>Invite friends — share this link</p>
          <div className={styles.shareLinkRow}>
            <span className={styles.shareLink}>{shareableUrl}</span>
            <button className={styles.copyBtn} onClick={handleCopy}>
              {copied ? '✓ Copied!' : '📋 Copy'}
            </button>
          </div>
        </div>

        <div className={styles.playersSection}>
          <p className={styles.playersLabel}>
            Players in lobby <span className={styles.playerCount}>{players.length} (max 8)</span>
          </p>
          <ul className={styles.playerList}>
            {players.map((p, i) => (
              <li key={p} className={styles.playerRow}>
                <span className={styles.playerSwatch} style={{ background: PLAYER_COLORS[i] ?? '#fff' }} />
                <span className={styles.playerName}>
                  {p}{p === username ? ' (you)' : ''}
                </span>
                {p === hostUsername && <span className={styles.hostBadge}>👑 host</span>}
              </li>
            ))}
          </ul>
          {players.length < 2 && (
            <p className={styles.waitingNote}>⏳ Waiting for at least one more player…</p>
          )}
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
              {players.length < 2 ? 'Need atleast 2 players to start' : `▶ Start Game (${players.length} players)`}
            </button>
          </>
        ) : (
          <p className={styles.waitingNote}>
            ⏳ Waiting for <strong>{hostUsername}</strong> to start the game…
          </p>
        )}

        {roomError && <p className={styles.errorText}>{roomError}</p>}
      </div>
    </div>
  );
}
