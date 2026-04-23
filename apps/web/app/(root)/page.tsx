'use client';

import Link from 'next/link';
import styles from './hub.module.css';

const GAMES = [
  {
    href: '/4-in-a-row',
    title: '4 in a Row',
    emoji: '🔴',
    description: 'Drop discs and connect four — or challenge up to 8 players in a single match.',
    tags: ['Multiplayer', 'Strategy', 'VS Bot'],
    color: '#a044ff',
    glow: 'rgba(160, 68, 255, 0.35)',
  },
  {
    href: '/word-puzzle',
    title: 'Word Puzzle',
    emoji: '📝',
    description: 'Race to unscramble hidden words before the clock runs out. Beat your best score!',
    tags: ['Solo', 'Word', 'Timed'],
    color: '#00d4aa',
    glow: 'rgba(0, 212, 170, 0.35)',
  },
];

export default function HubPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.logo}>🎮</div>
        <h1 className={styles.title}>Game Hub</h1>
        <p className={styles.subtitle}>Pick a game and start playing</p>
      </header>

      <main className={styles.grid}>
        {GAMES.map((game) => (
          <Link
            key={game.href}
            href={game.href}
            className={styles.card}
            style={{ '--card-color': game.color, '--card-glow': game.glow } as React.CSSProperties}
          >
            <div className={styles.cardGlow} />
            <div className={styles.cardEmoji}>{game.emoji}</div>
            <h2 className={styles.cardTitle}>{game.title}</h2>
            <p className={styles.cardDesc}>{game.description}</p>
            <div className={styles.cardTags}>
              {game.tags.map((tag) => (
                <span key={tag} className={styles.tag}>{tag}</span>
              ))}
            </div>
            <div className={styles.cardCta}>Play now →</div>
          </Link>
        ))}
      </main>
    </div>
  );
}
