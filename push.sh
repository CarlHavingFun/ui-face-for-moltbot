#!/usr/bin/env bash
# ä»Ž .env è¯»å– GITHUB_TOKEN å¹¶æŽ¨é€ï¼Œæ— éœ€æ¯æ¬¡è¾“å…¥ token
set -e
cd "$(dirname "$0")"
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi
if [ -z "$GITHUB_TOKEN" ]; then
  echo "ç¼ºå°‘ GITHUB_TOKENã€‚è¯·å¤åˆ¶ .env.example ä¸º .env å¹¶å¡«å…¥ tokenã€‚"
  exit 1
fi
git push "https://${GITHUB_TOKEN}@github.com/YOUR_ORG/ui-face-for-moltbot.git" main "$@"
