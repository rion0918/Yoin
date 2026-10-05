#!/usr/bin/env bash
set -euo pipefail

npm ci
npm --prefix backend ci
npm --prefix backend/media ci
npm run check
npm run typecheck
npm test
npm run backend:typecheck
npm run backend:test

FFMPEG_BIN="$(command -v ffmpeg)"
FFPROBE_BIN="$(command -v ffprobe)"
export FFMPEG_BIN FFPROBE_BIN
npm --prefix backend run test:media
npm run export
npm --prefix backend run dry-run

media_image="yoin-audio:${GITHUB_SHA:-local}"
docker buildx build --load --platform linux/amd64 --file backend/media/Dockerfile --tag "$media_image" .
container_id="$(docker run --detach --platform linux/amd64 --publish 127.0.0.1:18080:8080 --env MEDIA_SERVICE_TOKEN=ci-test-token-ci-test-token-ci-test-token-ci-test-token --env MEDIA_ORIGIN=https://yoin.test "$media_image")"
trap 'docker rm --force "$container_id" >/dev/null 2>&1 || true' EXIT

health_url=http://127.0.0.1:18080/health
for attempt in $(seq 1 30); do
  if curl --silent --fail "$health_url" --output /dev/null; then
    break
  fi
  if [[ "$attempt" -eq 30 ]]; then
    echo "Audio service did not become healthy within 30 seconds." >&2
    exit 1
  fi
  sleep 1
done
test "$(curl --silent --show-error --fail "$health_url")" = ok

for route in inspect probe transcribe lyrics music; do
  status="$(curl --silent --output /dev/null --write-out '%{http_code}' --request POST "http://127.0.0.1:18080/$route" --data '{}')"
  test "$status" = 401
done

if [[ "${GITHUB_REF:-}" == refs/heads/main && "${GITHUB_EVENT_NAME:-}" =~ ^(push|workflow_dispatch)$ && -n "${GITHUB_ACTIONS:-}" ]]; then
  docker save --output "$RUNNER_TEMP/yoin-audio.tar" "$media_image"
fi
