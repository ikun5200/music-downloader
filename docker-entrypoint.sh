#!/bin/sh
set -eu

# 每次容器启动唯一；用于让队列只恢复一次中断任务，避免多个路由上下文重复重置。
export QUEUE_BOOT_ID="${QUEUE_BOOT_ID:-$(date +%s)-$$}"

if [ -z "${ADMIN_USERNAME:-}" ]; then
  echo "[entrypoint] 缺少 ADMIN_USERNAME 环境变量" >&2
  exit 1
fi
if [ -z "${ADMIN_PASSWORD:-}" ]; then
  echo "[entrypoint] 缺少 ADMIN_PASSWORD 环境变量" >&2
  exit 1
fi
if [ -z "${AUTH_SECRET:-}" ] || [ "${#AUTH_SECRET}" -lt 32 ]; then
  echo "[entrypoint] AUTH_SECRET 必须至少 32 个字符（可用 openssl rand -hex 32 生成）" >&2
  exit 1
fi
case "${ADMIN_PASSWORD}" in
  admin123|change-me-please)
    echo "[entrypoint] ADMIN_PASSWORD 仍是默认值，请改成强密码后重启" >&2
    exit 1
    ;;
esac
case "${AUTH_SECRET}" in
  CHANGE_ME|change-me-to-a-long-random-string|dev-secret-please-change-this-to-a-long-random-string)
    echo "[entrypoint] AUTH_SECRET 仍是示例值，请执行 openssl rand -hex 32 重新生成" >&2
    exit 1
    ;;
esac

if [ "$(id -u)" = "0" ]; then
  if [ -n "${PUID:-}" ] && [ "${PUID}" != "$(id -u node)" ]; then
    usermod -u "${PUID}" node 2>/dev/null || true
  fi
  if [ -n "${PGID:-}" ] && [ "${PGID}" != "$(id -g node)" ]; then
    groupmod -g "${PGID}" node 2>/dev/null || true
  fi

  mkdir -p /app/data /downloads
  chown node:node /app/data /downloads 2>/dev/null || true

  if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
    echo "[entrypoint] applying database migrations..."
    gosu node node node_modules/prisma/build/index.js migrate deploy
  fi

  exec gosu node "$@"
fi

if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  echo "[entrypoint] applying database migrations..."
  node node_modules/prisma/build/index.js migrate deploy
fi

exec "$@"
