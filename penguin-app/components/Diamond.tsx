export const Diamond = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M20 2L38 20L20 38L2 20L20 2Z" fill="#0e8c8c" opacity="0.3" />
    <path d="M20 6L34 20L20 34L6 20L20 6Z" fill="#0e8c8c" opacity="0.5" />
    <path d="M20 10L30 20L20 30L10 20L20 10Z" fill="#0e8c8c" />
    <path d="M20 10L30 20L20 20L10 20L20 10Z" fill="#0fb3b3" />
  </svg>
);
