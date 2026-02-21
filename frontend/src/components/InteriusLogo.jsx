export default function InteriusLogo({ size = 28, gradient = false, className = '' }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 32 32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
        >
            {gradient && (
                <defs>
                    <linearGradient id="interius-grad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#10b981" />
                        <stop offset="100%" stopColor="#3b82f6" />
                    </linearGradient>
                </defs>
            )}
            {/* Connected chevrons: < at top-left, > at bottom-right */}
            <path
                d="M22 3L5 12L17 16L27 20L10 29"
                stroke={gradient ? 'url(#interius-grad)' : 'currentColor'}
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}
