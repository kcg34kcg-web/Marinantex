import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef7ff",
          100: "#d9ecff",
          200: "#b3d8ff",
          300: "#83bbff",
          400: "#4f95ff",
          500: "#256dff",
          600: "#174be2",
          700: "#163cbc",
          800: "#1a3696",
          900: "#1b3276"
        }
      }
    }
  },
  plugins: []
};

export default config;
