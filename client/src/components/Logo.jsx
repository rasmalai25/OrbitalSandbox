// components/Logo.jsx
// Frontend §3.2 — Two orbital ellipses crossing at center with a pulsing star.
// stroke="currentColor" lets the consumer recolor it via parent text color.

export default function Logo({ size = 160 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="Orbital Sandbox">
      <g fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.9">
        <ellipse cx="50" cy="50" rx="42" ry="15" transform="rotate(32 50 50)" />
        <ellipse cx="50" cy="50" rx="42" ry="15" transform="rotate(-32 50 50)" />
      </g>
      <circle cx="50" cy="50" r="6" fill="#FFD700">
        <animate attributeName="r"       values="5;7;5"     dur="3s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.8;1;0.8" dur="3s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}
