'use client';

import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import styles from './game.module.css';

const ROWS = 6;
const COLS = 7;
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

type CellValue = 0 | 1 | 2;
type Board = CellValue[][];

export default function Home() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [username, setUsername] = useState('');
  const [gameId, setGameId] = useState<string | null>(null);
  const [board, setBoard] = useState<Board>(() =>
    Array(ROWS)
      .fill(null)
      .map(() => Array(COLS).fill(0))
  );
  const [hoveredCol, setHoveredCol] = useState<number | null>(null);
  const [myPlayerNumber, setMyPlayerNumber] = useState<1 | 2 | null>(null);
  const [currentTurn, setCurrentTurn] = useState<1 | 2>(1);
  const [opponent, setOpponent] = useState('');
  const [gameStatus, setGameStatus] = useState<'menu' | 'waiting' | 'playing' | 'ended'>('menu');
  const [winner, setWinner] = useState<string | null>(null);
  const [winReason, setWinReason] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [gameMode, setGameMode] = useState<'pvp' | 'bot' | null>(null);
  const [moveCount, setMoveCount] = useState(0);
  
  // Chat states
  const [chatMessages, setChatMessages] = useState<Array<{username: string, message: string, timestamp: Date}>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  
  // Audio states
  const [bgMusicEnabled, setBgMusicEnabled] = useState(false);
  const bgMusicRef = useRef<HTMLAudioElement | null>(null);
  const dropSoundRef = useRef<HTMLAudioElement | null>(null);
  const opponentDropSoundRef = useRef<HTMLAudioElement | null>(null);
  const gameEndSoundRef = useRef<HTMLAudioElement | null>(null);
  
  // Modal states
  const [showSpectateModal, setShowSpectateModal] = useState(false);

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

    newSocket.on('game:started', (data) => {
      console.log('🎮 Game started:', data);
      setGameId(data.gameId);
      setOpponent(data.opponent);
      setGameStatus('playing');
      setMoveCount(0);
      
      // Set which player I am
      const iAmPlayer1 = data.yourTurn;
      setMyPlayerNumber(iAmPlayer1 ? 1 : 2);
      setCurrentTurn(1); // Game always starts with player 1
      
      console.log(`✅ I am player ${iAmPlayer1 ? 1 : 2}, opponent: ${data.opponent}, isBot: ${data.isBot}`);
    });

    newSocket.on('game:update', (data) => {
      console.log('📥 Game update:', data);
      if (data.board) {
        setBoard(data.board);
        setMoveCount(prev => prev + 1);
        
        // Play drop sound on every move
        if (dropSoundRef.current) {
          dropSoundRef.current.currentTime = 0;
          dropSoundRef.current.play().catch((e: any) => console.log('Drop sound failed:', e));
        }
      }
      if (data.currentTurn !== undefined) {
        setCurrentTurn(data.currentTurn);
      }
    });

    newSocket.on('game:ended', (data) => {
      console.log('🏁 Game ended:', data);
      setGameStatus('ended');
      setWinner(data.winner);
      setWinReason(data.reason);
      
      // Play game end sound
      if (gameEndSoundRef.current) {
         gameEndSoundRef.current.currentTime = 0;
         gameEndSoundRef.current.play().catch((e: any) => console.log('Sound play failed:', e));
      }
    });
    
    // Chat event
    newSocket.on('chat:message', (data: {username: string, message: string}) => {
      setChatMessages(prev => [...prev, {...data, timestamp: new Date()}]);
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

  const handleMouseEnter = (col: number) => {
    if (gameStatus === 'playing') {
      setHoveredCol(col);
    }
  };

  const handleMouseLeave = () => {
    setHoveredCol(null);
  };

  const handleJoinPvP = () => {
    if (!username.trim() || !socket) return;
    
    setGameMode('pvp');
    setGameStatus('waiting');
    socket.emit('player:join', { username });
    socket.emit('matchmaking:join', { username });
  };

  const handleJoinBot = () => {
    if (!username.trim() || !socket) return;
    
    setGameMode('bot');
    setGameStatus('waiting');
    socket.emit('player:join', { username });
    socket.emit('matchmaking:join-bot', { username });
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

  const handlePlayAgain = () => {
    setGameStatus('menu');
    setBoard(Array(ROWS).fill(null).map(() => Array(COLS).fill(0)));
    setWinner(null);
    setWinReason(null);
    setGameId(null);
    setMyPlayerNumber(null);
    setCurrentTurn(1);
    setGameMode(null);
    setMoveCount(0);
    setChatMessages([]);
  };
  
  const handleSendChat = () => {
    if (!chatInput.trim() || !socket || !gameId) return;
    
    socket.emit('chat:send', { gameId, username, message: chatInput });
    setChatInput('');
  };

  const getCellClass = (value: CellValue) => {
    if (value === 1) return styles.player1;
    if (value === 2) return styles.player2;
    return '';
  };

  const isMyTurn = myPlayerNumber === currentTurn;
  const iAmWinner = winner === username;
  const isDraw = winReason === 'draw';

  const getWinReasonText = () => {
    if (isDraw) return 'Board Full - Draw!';
    switch (winReason) {
      case 'horizontal': return '→ Horizontal Win!';
      case 'vertical': return '↓ Vertical Win!';
      case 'diagonal': return '↗ Diagonal Win!';
      case 'forfeit': return 'Opponent Forfeited';
      case 'opponent_disconnect': return 'Opponent Disconnected';
      default: return '';
    }
  };

  return (
    <div className={styles.container}>
      {/* Sidebar */}
      <div className={styles.sidebar}>
        {/* Opponent Profile (Top) */}
        <div className={styles.playerProfile}>
          <div className={styles.avatarBox}>
             <span className={styles.avatar}>💡</span>
          </div>
          <span className={styles.playerName}>{opponent || 'Waiting...'}</span>
          <div className={`${styles.miniDisc} ${styles.p2DiscPreview}`}></div>
        </div>

        {/* VS Badge */}
        <div className={styles.vsBadge}>
          <span className={styles.vsText}>VS</span>
        </div>

        {/* Player Profile (Bottom) */}
        <div className={styles.playerProfile}>
          <div className={`${styles.miniDisc} ${styles.p1DiscPreview}`}></div>
          <span className={styles.playerName}>(You) {username || 'Player'}</span>
           <div className={styles.avatarBox}>
             <span className={styles.avatar}>😎</span>
          </div>
        </div>

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
              className={styles.input}
            />
             <div className={styles.buttonGroup}>
              <button onClick={handleJoinPvP} className={styles.button}>Find Player</button>
              <button onClick={handleJoinBot} className={`${styles.button} ${styles.buttonSecondary}`}>Play Bot</button>
            </div>
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
            <div className={styles.boardWrapper}>
               {/* Turn Indicator / Game Status Banner */}
               <div className={styles.statusBanner}>
                  {gameStatus === 'ended' ? (
                    <>
                      <span className={styles.statusIcon}>🏆</span>
                      <span className={styles.statusText}>
                        {winner === username ? 'YOU WIN!' : winner ? `${winner} WINS!` : 'DRAW!'} 
                        <span className={styles.statusSubtext}> - {getWinReasonText()}</span>
                      </span>
                      <button onClick={handlePlayAgain} className={styles.playAgainBtn}>Play Again</button>
                    </>
                  ) : gameStatus === 'playing' ? (
                    <>
                      <span className={styles.statusIcon}>{isMyTurn ? '👉' : '⏳'}</span>
                      <span className={styles.statusText}>
                        {isMyTurn ? "Your Turn!" : `${opponent}'s Turn`}
                      </span>
                      <div className={`${styles.turnIndicatorDisc} ${currentTurn === 1 ? styles.p1DiscPreview : styles.p2DiscPreview}`}></div>
                    </>
                  ) : null}
               </div>

               {/* Hover Row (Floating Disc) */}
               <div className={styles.hoverRow}>
                 {Array(COLS).fill(0).map((_, colIndex) => (
                   <div 
                      key={colIndex} 
                      className={styles.hoverCell}
                      onMouseEnter={() => handleMouseEnter(colIndex)}
                      onMouseLeave={handleMouseLeave}
                      onClick={() => handleColumnClick(colIndex)}
                   >
                      {hoveredCol === colIndex && isMyTurn && !winner && (
                        <div className={`${styles.floatingDisc} ${myPlayerNumber === 1 ? styles.p1Floating : styles.p2Floating}`}></div>
                      )}
                   </div>
                 ))}
               </div>

               {/* Actual Board */}
               <div className={styles.board}>
                 {board.map((row, rowIndex) => (
                   <div key={rowIndex} className={styles.row}>
                     {row.map((cell, colIndex) => (
                       <div
                         key={colIndex}
                         className={styles.cell}
                         onMouseEnter={() => handleMouseEnter(colIndex)}
                         onClick={() => handleColumnClick(colIndex)}
                       >
                         {/* The "Hole" visual */}
                         <div className={styles.hole}>
                            {cell !== 0 && (
                              <div className={`${styles.disc} ${cell === 1 ? styles.player1 : styles.player2}`}></div>
                            )}
                         </div>
                       </div>
                     ))}
                   </div>
                 ))}
               </div>
            </div>
          </>
        )}
      </div>

      {/* Chat Panel */}
      <div className={`${styles.chatPanel} ${chatOpen ? styles.chatOpen : ''}`}>
        <button className={styles.chatToggle} onClick={() => setChatOpen(!chatOpen)}>
          {chatOpen ? 'close' : 'chat'}
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
            {gameStatus === 'playing' && gameMode !== 'bot' && (
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


    </div>
  );
}
