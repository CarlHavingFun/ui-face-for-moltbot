#!/usr/bin/env bash
# 从 .env 读取 GITHUB_TOKEN 并推送，无需每次输入 token
set -e
cd "$(dirname "$0")"
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi
if [ -z "$GITHUB_TOKEN" ]; then
  echo "缺少 GITHUB_TOKEN。请复制 .env.example 为 .env 并填入 token。"
  exit 1
fi
git push "https://${GITHUB_TOKEN}@github.com/CarlHavingFun/ui-face-for-moltbot.git" main "$@"
