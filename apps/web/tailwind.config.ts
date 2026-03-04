import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#daeaff",
          500: "#2f6fed",
          700: "#1f4fb0",
          900: "#16357a",
        },
      },
    },
  },
  plugins: [],
};

export default config;
