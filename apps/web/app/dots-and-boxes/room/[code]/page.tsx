'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { io, Socket } from 'socket.io-client';
import { Copy, Check, Crown, Play, Users, Home } from 'lucide-react';
import styles from './dab-room.module.css';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';
const MAX_PLAYERS = 8;

const PLAYER_COLORS = [
  '#f87171', '#60a5fa', '#4ade80', '#fbbf24',
  '#a78bfa', '#f472b6', '#34d399', '#fb923c',
];

const GRID_PRESETS = [
  { label: '3×8',   rows: 3,  cols: 8  },
  { label: '4×4',   rows: 4,  cols: 4  },
  { label: '6×6',   rows: 6,  cols: 6  },
  { label: '8×8',   rows: 8,  cols: 8  },
  { label: '10×10', rows: 10, cols: 10 },
];

type Status = 'name' | 'connecting' | 'lobby' | 'starting' | 'error';

export default function DABRoomPage() {
  const { code: rawCode } = useParams<{ code: string }>();
  const router = useRouter();

  const isCreateMode = rawCode === 'new';

  const [status, setStatus]           = useState<Status>('name');
  const [username, setUsername]       = useState('');
  const [nameInput, setNameInput]     = useState('');
  const [nameError, setNameError]     = useState(false);
  const [roomCode, setRoomCode]       = useState('');
  const [players, setPlayers]         = useState<string[]>([]);
  const [hostUsername, setHost]       = useState('');
  const [gridRows, setGridRows]       = useState(5);
  const [gridCols, setGridCols]       = useState(5);
  const [roomError, setRoomError]     = useState('');
  const [copied, setCopied]           = useState(false);
  // Custom grid UI state (host only)
  const [customMode, setCustomMode]   = useState(false);
  const [customRows, setCustomRows]   = useState(5);
  const [customCols, setCustomCols]   = useState(5);

  // Socket is created once — never torn down until unmount or error/start
  const socketRef  = useRef<Socket | null>(null);
  // Guard so the socket setup effect only runs once per username
  const didConnect = useRef(false);

  const isHost = username !== '' && username === hostUsername;

  const shareableUrl =
    typeof window !== 'undefined' && roomCode
      ? `${window.location.origin}/dots-and-boxes/room/${roomCode}`
      : '';

  // ── Pre-fill saved name ────────────────────────────────────────────────────
  useEffect(() => {
    const saved = sessionStorage.getItem('4inarow_username') || '';
    if (saved) setNameInput(saved);
  }, []);

  // ── Name submit ──────────────────────────────────────────────────────────
  const handleNameSubmit = useCallback(() => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      setNameError(true);
      setTimeout(() => setNameError(false), 600);
      return;
    }
    sessionStorage.setItem('4inarow_username', trimmed);
    setUsername(trimmed);
    setStatus('connecting');
  }, [nameInput]);

  // ── Connect once — runs only when username is first set ─────────────────
  useEffect(() => {
    if (!username || didConnect.current) return;
    didConnect.current = true;

    const sock = io(API_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = sock;

    sock.on('connect', () => {
      if (isCreateMode) {
        sock.emit('dab:room:create', { username });
      } else {
        const code = String(rawCode).toUpperCase().trim();
        sock.emit('dab:room:join', { username, roomCode: code });
      }
    });

    // ── Host: room created ─────────────────────────────────────────────────
    sock.on('dab:room:created', (data: { roomCode: string; hostUsername: string }) => {
      setRoomCode(data.roomCode);
      setHost(data.hostUsername);
      // Host is the first player — populate immediately so list shows "you"
      setPlayers([data.hostUsername]);
      window.history.replaceState(null, '', `/dots-and-boxes/room/${data.roomCode}`);
      setStatus('lobby');
    });

    // ── Joiner: lobby state when joining ──────────────────────────────────
    sock.on('dab:room:joinPending', (data: {
      roomCode: string;
      players: string[];
      hostUsername: string;
      gridRows: number;
      gridCols: number;
    }) => {
      setRoomCode(data.roomCode);
      setPlayers(data.players);
      setHost(data.hostUsername);
      setGridRows(data.gridRows);
      setGridCols(data.gridCols);
      setStatus('lobby');
    });

    // ── Anyone: incremental lobby update (player join/leave, grid change) ──
    sock.on('dab:room:lobbyUpdate', (data: {
      players: string[];
      hostUsername: string;
      gridRows: number;
      gridCols: number;
    }) => {
      setPlayers(data.players);
      setHost(data.hostUsername);
      setGridRows(data.gridRows);
      setGridCols(data.gridCols);
    });

    sock.on('dab:room:error', ({ message }: { message: string }) => {
      setRoomError(message);
      setStatus('error');
    });

    // ── Game started — store state and navigate ───────────────────────────
    sock.on('dab:game:started', (data: {
      gameId: string;
      players: string[];
      gridRows: number;
      gridCols: number;
      hLines: (number | null)[][];
      vLines: (number | null)[][];
      boxes: (number | null)[][];
      scores: number[];
      currentTurn: number;
      currentPlayer: string;
      yourIndex: number;
      yourUsername: string;
    }) => {
      setStatus('starting');
      sessionStorage.setItem('dab_pending_game', JSON.stringify(data));
      setTimeout(() => router.push('/dots-and-boxes'), 250);
    });

    sock.on('connect_error', () => {
      setRoomError('Could not connect to the server. Please try again.');
      setStatus('error');
    });

    return () => {
      sock.disconnect();
    };
  // rawCode and isCreateMode are stable — intentionally excluded from deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  // ── Host: apply grid preset ───────────────────────────────────────────────
  const handlePresetGrid = useCallback(
    (rows: number, cols: number) => {
      setCustomMode(false);
      setGridRows(rows);
      setGridCols(cols);
      socketRef.current?.emit('dab:room:setGrid', { gridRows: rows, gridCols: cols });
    },
    []
  );

  // ── Host: apply custom grid ───────────────────────────────────────────────
  const handleCustomGrid = useCallback(() => {
    const r = Math.max(2, Math.min(15, customRows));
    const c = Math.max(2, Math.min(15, customCols));
    setCustomRows(r);
    setCustomCols(c);
    setGridRows(r);
    setGridCols(c);
    socketRef.current?.emit('dab:room:setGrid', { gridRows: r, gridCols: c });
  }, [customRows, customCols]);

  // ── Host: start game ──────────────────────────────────────────────────────
  const handleStart = useCallback(() => {
    socketRef.current?.emit('dab:room:start');
  }, []);

  // ── Copy URL ──────────────────────────────────────────────────────────────
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareableUrl || roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* noop */ }
  }, [shareableUrl, roomCode]);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  // ── Name phase ────────────────────────────────────────────────────────────
  if (status === 'name') {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.gameTitle}>⬜ Dots &amp; Boxes</h1>
          <p className={styles.gameSubtitle}>{isCreateMode ? 'Create a Room' : 'Join a Room'}</p>
          <div className={styles.nameSection}>
            <label className={styles.label}>Your Name</label>
            <input
              className={`${styles.input} ${nameError ? styles.inputShake : ''}`}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleNameSubmit()}
              placeholder="Enter your name…"
              maxLength={18}
              autoFocus
            />
            <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleNameSubmit}>
              {isCreateMode ? 'Create Room' : 'Join Room'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Connecting ────────────────────────────────────────────────────────────
  if (status === 'connecting') {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.gameTitle}>⬜ Dots &amp; Boxes</h1>
          <div className={styles.connectingBox}>
            <div className={styles.spinner} />
            <p className={styles.connectingText}>Connecting…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.gameTitle}>⬜ Dots &amp; Boxes</h1>
          <p className={styles.errorText}>{roomError}</p>
          <button className={`${styles.btn} ${styles.btnGhost}`} onClick={() => router.push('/dots-and-boxes')}>
            <Home size={16} /> Back to Menu
          </button>
        </div>
      </div>
    );
  }

  // ── Starting ──────────────────────────────────────────────────────────────
  if (status === 'starting') {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1 className={styles.gameTitle}>⬜ Dots &amp; Boxes</h1>
          <div className={styles.connectingBox}>
            <div className={styles.spinner} />
            <p className={styles.connectingText}>Game starting…</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Lobby ─────────────────────────────────────────────────────────────────
  const isPresetActive = (r: number, c: number) =>
    !customMode && gridRows === r && gridCols === c;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.gameTitle}>⬜ Dots &amp; Boxes</h1>
        <p className={styles.gameSubtitle}>Waiting Room</p>

        <div className={styles.lobbySection}>

          {/* ── Room code ───────────────────────────────────────── */}
          <p className={styles.sectionTitle}>Room Code</p>
          <div className={styles.codeBox}>
            <span className={styles.codeText}>{roomCode}</span>
            <button className={styles.copyBtn} onClick={handleCopy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>

          <div className={styles.divider} />

          {/* ── Players ─────────────────────────────────────────── */}
          <p className={styles.sectionTitle}>
            <Users size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} />
            Players ({players.length} / {MAX_PLAYERS})
          </p>
          <ul className={styles.playerList}>
            {players.map((p, i) => (
              <li key={p} className={styles.playerRow}>
                <span
                  className={styles.playerSwatch}
                  style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }}
                />
                <span className={styles.playerName}>{p}</span>
                {p === hostUsername && (
                  <span className={styles.hostBadge}>
                    <Crown size={10} /> Host
                  </span>
                )}
                {p === username && <span className={styles.youBadge}>You</span>}
              </li>
            ))}
          </ul>

          {players.length < 2 && (
            <p className={styles.waitingText}>Waiting for more players to join…</p>
          )}

          <div className={styles.divider} />

          {/* ── Grid settings: HOST sees controls ───────────────── */}
          {isHost ? (
            <div className={styles.gridSection}>
              <p className={styles.sectionTitle}>Grid Size (box rows × cols)</p>
              <div className={styles.gridRow}>
                {GRID_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    className={`${styles.gridChip} ${isPresetActive(preset.rows, preset.cols) ? styles.gridChipActive : ''}`}
                    onClick={() => handlePresetGrid(preset.rows, preset.cols)}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  className={`${styles.gridChip} ${customMode ? styles.gridChipActive : ''}`}
                  onClick={() => setCustomMode(true)}
                >
                  Custom
                </button>
              </div>

              {customMode && (
                <div className={styles.customRow}>
                  <input
                    type="number"
                    className={styles.customInput}
                    value={customRows}
                    min={2}
                    max={15}
                    onChange={(e) => setCustomRows(Number(e.target.value))}
                    placeholder="Rows"
                  />
                  <span className={styles.customSep}>×</span>
                  <input
                    type="number"
                    className={styles.customInput}
                    value={customCols}
                    min={2}
                    max={15}
                    onChange={(e) => setCustomCols(Number(e.target.value))}
                    placeholder="Cols"
                  />
                  <button className={`${styles.btn} ${styles.btnApply}`} onClick={handleCustomGrid}>
                    Apply
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* ── Non-host just sees what the host picked ──────── */
            <div className={styles.gridInfoBox}>
              <p className={styles.sectionTitle}>Grid Size</p>
              <p className={styles.gridInfoText}>
                <span
                  className={styles.gridBadge}
                  style={{ fontSize: '1.3rem', letterSpacing: 2 }}
                >
                  {gridRows} × {gridCols}
                </span>
                <span style={{ color: '#9a8abf', fontSize: '0.8rem', marginLeft: 8 }}>
                  (host is choosing)
                </span>
              </p>
            </div>
          )}

          <div className={styles.divider} />

          {/* ── Action buttons ──────────────────────────────────── */}
          <div className={styles.actionRow}>
            <button
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() => {
                socketRef.current?.emit('dab:room:leave');
                router.push('/dots-and-boxes');
              }}
            >
              <Home size={16} /> Leave
            </button>

            {isHost && (
              <button
                className={`${styles.btn} ${styles.btnGreen}`}
                onClick={handleStart}
                disabled={players.length < 2}
                title={players.length < 2 ? 'Need at least 2 players' : undefined}
              >
                <Play size={16} /> Start Game
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
