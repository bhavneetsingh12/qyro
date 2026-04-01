import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm modern palette
        canvas: "#FAFAF8",       // off-white page background
        surface: "#F5F4F1",      // card / sidebar background
        border: "#E8E6E1",       // subtle dividers
        muted: "#9C9890",        // secondary text
        ink: "#1C1917",          // primary text (warm black)
        accent: {
          DEFAULT: "#F59E0B",    // amber-500
          hover:   "#D97706",    // amber-600
          light:   "#FEF3C7",    // amber-100
          coral:   "#FB7185",    // rose-400 secondary accent
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "12px",
      },
    },
  },
  plugins: [],
};

export default config;
