import styles from "./login.module.css";

const CLIENTS = [
  { x: 110, y: 90 },
  { x: 300, y: 54 },
  { x: 462, y: 118 },
  { x: 506, y: 300 },
  { x: 430, y: 470 },
  { x: 250, y: 512 },
  { x: 84, y: 430 },
  { x: 48, y: 262 },
];
const HUB = { x: 280, y: 280 };

export function FederationArt() {
  return (
    <svg className={styles.network} viewBox="0 0 560 560" aria-hidden="true">
      <defs>
        <radialGradient id="hub-glow">
          <stop offset="0" stopColor="#2dd4bf" stopOpacity="0.55" />
          <stop offset="1" stopColor="#2dd4bf" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="spoke" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5eead4" />
          <stop offset="1" stopColor="#818cf8" />
        </linearGradient>
      </defs>
      <circle cx={HUB.x} cy={HUB.y} r="150" className={styles.orbit} />
      <circle cx={HUB.x} cy={HUB.y} r="235" className={styles.orbit} />
      {CLIENTS.map((c, i) => (
        <g key={i}>
          <path id={`spoke-${i}`} d={`M${c.x} ${c.y} L${HUB.x} ${HUB.y}`} className={styles.spoke} stroke="url(#spoke)" />
          <circle r="3.5" className={styles.packet}>
            <animateMotion dur={`${2.6 + (i % 4) * 0.55}s`} begin={`${i * 0.42}s`} repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
              <mpath href={`#spoke-${i}`} />
            </animateMotion>
          </circle>
          <circle r="3" className={styles.packetBack}>
            <animateMotion dur={`${3.4 + (i % 3) * 0.5}s`} begin={`${1.2 + i * 0.37}s`} repeatCount="indefinite" keyPoints="1;0" keyTimes="0;1" calcMode="linear">
              <mpath href={`#spoke-${i}`} />
            </animateMotion>
          </circle>
          <g className={styles.client} style={{ animationDelay: `${i * 0.35}s` }}>
            <circle cx={c.x} cy={c.y} r="22" className={styles.clientHalo} />
            <rect x={c.x - 15} y={c.y - 15} width="30" height="30" rx="9" className={styles.clientBox} />
            <rect x={c.x - 7} y={c.y - 6} width="14" height="2.5" rx="1.25" className={styles.clientBar} />
            <rect x={c.x - 7} y={c.y - 1} width="10" height="2.5" rx="1.25" className={styles.clientBar} />
            <rect x={c.x - 7} y={c.y + 4} width="12" height="2.5" rx="1.25" className={styles.clientBar} />
          </g>
        </g>
      ))}
      <circle cx={HUB.x} cy={HUB.y} r="110" fill="url(#hub-glow)" className={styles.hubGlow} />
      <circle cx={HUB.x} cy={HUB.y} r="44" className={styles.hubRing} />
      <circle cx={HUB.x} cy={HUB.y} r="32" className={styles.hub} />
      <path d={`M${HUB.x - 12} ${HUB.y + 8} L${HUB.x - 4} ${HUB.y - 2} L${HUB.x + 3} ${HUB.y + 4} L${HUB.x + 13} ${HUB.y - 10}`} className={styles.hubIcon} />
    </svg>
  );
}
