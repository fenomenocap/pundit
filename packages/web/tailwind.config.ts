import type { Config } from "tailwindcss";
import tailwindAnimate from "tailwindcss-animate";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/desk/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "#3eff8a",
          foreground: "#06140c",
          fg: "#06140c",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        "card-rim": "hsl(var(--card-rim))",
        bg: "#07090d",
        surface: "#0e1218",
        elevated: "#151a22",
        panel: "#1b212c",
        fg: "#eef2f6",
        subtle: "#5c6472",
        "border-strong": "#323a48",
        live: "#ff4b4b",
        up: "#3eff8a",
        down: "#ff5c6a",
        warn: "#c5c8ce",
        quiet: "#8b93a1",
        // Sportsbook palette: swap the stock neon cyan/pink for calmer,
        // higher-contrast tones (Tailwind's own sky/rose) without touching
        // any component — every `cyan-400`/`pink-500` etc. class updates.
        cyan: {
          50: "#EFF9FF", 100: "#DEF1FF", 200: "#B6E6FE", 300: "#75D3FE",
          400: "#38BDF8", 500: "#0EA5E9", 600: "#0284C7", 700: "#0369A1",
          800: "#075985", 900: "#0C4A6E",
        },
        pink: {
          50: "#FFF1F2", 100: "#FFE4E6", 200: "#FECDD3", 300: "#FDA4AF",
          400: "#FB7185", 500: "#F43F5E", 600: "#E11D48", 700: "#BE123C",
          800: "#9F1239", 900: "#881337",
        },
      },
      borderRadius: {
        xs: "4px",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "8px",
        card: "var(--radius)",
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      boxShadow: {
        card: "inset 0 1px 0 0 rgba(255,255,255,0.04), 0 1px 0 0 rgba(0,0,0,0.4)",
      },
      fontFamily: {
        heading: ["'Barlow Condensed'", "'Barlow'", "system-ui", "sans-serif"],
        body: ["'Barlow'", "system-ui", "sans-serif"],
        sans: ["'Barlow'", "system-ui", "sans-serif"],
        mono: ["'Barlow'", "system-ui", "sans-serif"],
        display: ["'Barlow Condensed'", "'Barlow'", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [tailwindAnimate],
};
export default config;
