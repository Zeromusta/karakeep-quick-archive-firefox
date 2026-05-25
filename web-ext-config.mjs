export default {
  ignoreFiles: [
    "tests/**",
    ".github/**",
    ".claude/**",
    "*.md",
    "SPEC.md",
    "package.json",
    "package-lock.json",
    "web-ext-config.mjs",
    "web-ext-artifacts/**",
    ".gitignore",
    "screenshot.png"
  ],
  build: {
    overwriteDest: true
  }
};
