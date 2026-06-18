#!/usr/bin/env bash
# Test ClearSky spec API endpoints.
# Usage: ./scripts/test-clearsky-api.sh [base_url]
# Set EMAIL and PASSWORD to login first and save cookie; or run login once with -c cookies.txt.
set -e
BASE="${1:-http://localhost:3005}"
COOKIES="${COOKIE_FILE:-cookies.txt}"

# Optional: login and save cookie so subsequent requests use it
if [[ -n "$EMAIL" && -n "$PASSWORD" ]]; then
  echo "Logging in as $EMAIL ..."
  curl -s -c "$COOKIES" -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" > /dev/null
  echo "Cookie saved to $COOKIES"
fi

if [[ ! -f "$COOKIES" ]] || ! grep -q "app_session" "$COOKIES" 2>/dev/null; then
  echo "No session cookie. Either:"
  echo "  1. Set EMAIL and PASSWORD then run again: EMAIL=you@example.com PASSWORD=secret $0 $BASE"
  echo "  2. Login once and save cookie: curl -s -c $COOKIES -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{\"email\":\"YOUR_EMAIL\",\"password\":\"YOUR_PASSWORD\"}'"
  exit 1
fi

echo "Using BASE=$BASE and $COOKIES"
echo "---"

run() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  echo ">>> $method $path"
  if [[ -n "$data" ]]; then
    curl -s -b "$COOKIES" -X "$method" "$BASE$path" -H "Content-Type: application/json" -d "$data" | head -c 500
  else
    curl -s -b "$COOKIES" "$BASE$path" | head -c 500
  fi
  echo -e "\n---"
}

# Contacts
run GET "/api/contacts?page=1&limit=5"
run POST "/api/contacts" '{"name":"ClearSky Test","phone":"+17051234567","email":"test@example.com"}'

# SMS
run GET "/api/sms/history?limit=5"

# Email
run GET "/api/email/history?limit=5"

# Call log
run POST "/api/calls/log" '{"contactNumber":"+17051234567","direction":"outbound","duration":60,"status":"completed","startedAt":"2026-02-15T12:00:00Z","endedAt":"2026-02-15T12:01:00Z"}'
run GET "/api/calls/history?limit=5"

# Communication logs (spec)
run GET "/api/communication-logs?page=1&limit=5"

# Profiles
run GET "/api/profiles?page=1&limit=5"
run POST "/api/profiles" '{"name":"Profile Test","phone":"+17059876543","company":"Test Co"}'

# Representatives
run GET "/api/representatives"

# Schedule
run GET "/api/schedule/events"
run POST "/api/schedule/events" '{"title":"Test Event","startTime":"2026-02-20T14:00:00Z","endTime":"2026-02-20T14:30:00Z","color":"blue"}'

# Notifications
run GET "/api/notifications/unread-count"

# Shortcuts
run GET "/api/shortcuts/team"
run GET "/api/shortcuts/personal"
run POST "/api/shortcuts/personal" '{"message":"I will follow up shortly."}'

# Dashboard
run GET "/api/dashboard/summary"
run GET "/api/dashboard/recent-notifications?limit=5"

# FCM (store token)
run POST "/api/fcm/store-token" '{"token":"test-fcm-token","platform":"ios","deviceId":"test-device-1"}'

echo "Done."
