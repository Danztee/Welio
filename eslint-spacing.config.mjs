const spacingConfig = {
  rules: {
    "padding-line-between-statements": [
      "error",
      { blankLine: "always", prev: "import", next: "*" },
      { blankLine: "any", prev: "import", next: "import" },
      { blankLine: "always", prev: "function", next: "*" },
      { blankLine: "always", prev: "class", next: "*" },
      { blankLine: "always", prev: "if", next: "*" },
      { blankLine: "always", prev: "export", next: "*" },
      { blankLine: "always", prev: "block-like", next: "*" },
      { blankLine: "always", prev: "*", next: "return" },
      {
        blankLine: "always",
        prev: ["const", "let", "var"],
        next: ["function", "class"],
      },
    ],
  },
};

export default spacingConfig;
