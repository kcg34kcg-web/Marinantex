import path from "node:path";

export default {
  test: {
    environment: "node",
    include: [
      "tests/udf-*.test.ts",
      "tests/editor-clipboard*.test.ts",
      "tests/uyap-html-renderer.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve("."),
    },
  },
};
