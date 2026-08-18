import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  // Touch devices emulate :hover on tap and never clear it, so every hover:
  // and group-hover: style stayed applied after a tap until you tapped
  // elsewhere. This wraps those variants in @media (hover: hover) so they
  // only apply to real pointers. Opt-in in Tailwind v3; default from v4.
  future: {
    hoverOnlyWhenSupported: true,
  },
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "nf-scan": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
        "nf-glitch": {
          "0%, 100%": {
            transform: "translate(0)",
            textShadow:
              "0.05em 0 0 rgba(0, 255, 200, 0.4), -0.04em 0 0 rgba(255, 0, 120, 0.35)",
          },
          "20%": {
            transform: "translate(-2px, 1px)",
            textShadow:
              "-0.06em 0 0 rgba(0, 255, 200, 0.5), 0.05em 0 0 rgba(255, 0, 120, 0.4)",
          },
          "40%": {
            transform: "translate(2px, -1px)",
            textShadow:
              "0.04em 0 0 rgba(255, 200, 0, 0.45), -0.05em 0 0 rgba(120, 0, 255, 0.35)",
          },
          "60%": {
            transform: "translate(-1px, -1px)",
          },
          "80%": {
            transform: "translate(1px, 2px)",
          },
        },
        "nf-drift": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "50%": { transform: "translate(2%, -1%) scale(1.02)" },
        },
        "nf-pulse-ring": {
          "0%": { opacity: "0.5", transform: "scale(0.92)" },
          "100%": { opacity: "0", transform: "scale(1.35)" },
        },
      },
      animation: {
        "nf-scan": "nf-scan 7s linear infinite",
        "nf-glitch": "nf-glitch 3.5s ease-in-out infinite",
        "nf-drift": "nf-drift 18s ease-in-out infinite",
        "nf-pulse-ring": "nf-pulse-ring 4s ease-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
