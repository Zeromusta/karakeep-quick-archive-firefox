export default {
  ignoreFiles: [
    "tests/**",
    "scripts/**",
    "node_modules/**",
    "content/page-capture.js",
    "release-source.zip",
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
