export function OrbitLogoFull({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Orbit CRM"
    >
      <g transform="translate(0, 2)">
        <circle cx="16" cy="14" r="3" fill="currentColor" />
        <ellipse
          cx="16"
          cy="14"
          rx="12"
          ry="5"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          transform="rotate(-30 16 14)"
        />
        <ellipse
          cx="16"
          cy="14"
          rx="12"
          ry="5"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          transform="rotate(30 16 14)"
        />
      </g>
      <text
        x="38"
        y="22"
        fontFamily="Sora, system-ui, sans-serif"
        fontSize="16"
        fontWeight="700"
        fill="currentColor"
      >
        Orbit
      </text>
      <text
        x="92"
        y="22"
        fontFamily="Sora, system-ui, sans-serif"
        fontSize="16"
        fontWeight="500"
        fill="currentColor"
        opacity="0.6"
      >
        CRM
      </text>
    </svg>
  );
}

export function OrbitLogoIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Orbit"
    >
      <circle cx="16" cy="16" r="3.5" fill="currentColor" />
      <ellipse
        cx="16"
        cy="16"
        rx="13"
        ry="5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        transform="rotate(-30 16 16)"
      />
      <ellipse
        cx="16"
        cy="16"
        rx="13"
        ry="5.5"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        transform="rotate(30 16 16)"
      />
    </svg>
  );
}
