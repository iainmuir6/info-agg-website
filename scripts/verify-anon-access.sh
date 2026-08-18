#!/usr/bin/env bash
# Verify what an unauthenticated caller can do with nothing but the public
# project URL and publishable key. Run before and after 09_security_hardening.sql.
#
#   ./scripts/verify-anon-access.sh
#
# Write probes deliberately use payloads that cannot commit (bogus PK/FK), so
# a 4xx from RLS and a 4xx from a constraint are distinguishable and nothing
# is ever actually written. EXPECT lines describe the POST-FIX expectation.
set -uo pipefail

URL="${NEXT_PUBLIC_SUPABASE_URL:-https://ifutusvhgxglmpzsjuuu.supabase.co}"
KEY="${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or source .env.local)}"

pass=0; fail=0
probe() { # probe <expect-regex> <label> <curl args...>
  local expect="$1" label="$2"; shift 2
  local body code
  body=$(curl -s -w '\n%{http_code}' "$@")
  code=$(tail -n1 <<<"$body"); body=$(sed '$d' <<<"$body" | head -c 110 | tr -d '\n')
  if [[ "$code" =~ $expect ]]; then pass=$((pass+1)); printf '  ok   '; else fail=$((fail+1)); printf '  FAIL '; fi
  printf '%-52s %s  %s\n' "$label" "$code" "$body"
}
anon() { curl_args=(-H "apikey: $KEY" -H "Content-Type: application/json"); }
anon

echo
echo "1. Public data — MUST stay readable (regression check)"
for t in stocks stock_quotes news_articles sports_scores market_news youtube_videos leagues; do
  probe '^200$' "GET info_agg.$t" "${curl_args[@]}" -H 'Accept-Profile: info_agg' "$URL/rest/v1/$t?select=*&limit=1"
done

echo
echo "2. etl_runs — health columns readable, payload columns not"
probe '^200$' "GET etl_runs (status,started_at,finished_at)" "${curl_args[@]}" -H 'Accept-Profile: info_agg' \
  "$URL/rest/v1/etl_runs?select=status,started_at,finished_at&limit=1"
probe '^40[0-9]$' "GET etl_runs select=* (expect denied)" "${curl_args[@]}" -H 'Accept-Profile: info_agg' \
  "$URL/rest/v1/etl_runs?select=*&limit=1"
probe '^40[0-9]$' "GET etl_runs.errors (expect denied)" "${curl_args[@]}" -H 'Accept-Profile: info_agg' \
  "$URL/rest/v1/etl_runs?select=errors&limit=1"
probe '^40[0-9]$' "GET etl_runs.stats (expect denied)" "${curl_args[@]}" -H 'Accept-Profile: info_agg' \
  "$URL/rest/v1/etl_runs?select=stats&limit=1"

echo
echo "3. No API key is readable anywhere anon can reach"
leak=$(curl -s "${curl_args[@]}" -H 'Accept-Profile: info_agg' \
  "$URL/rest/v1/etl_runs?select=status,started_at,finished_at&limit=500" \
  | grep -ciE '(token|apikey|api_key|api-key|key)=[A-Za-z0-9_-]{8,}' || true)
if [[ "$leak" == "0" ]]; then pass=$((pass+1)); echo "  ok   no key= pattern in anon-visible etl_runs"
else fail=$((fail+1)); echo "  FAIL key= pattern still visible to anon"; fi

echo
echo "4. User-owned tables — anon must be denied outright, not merely empty"
for t in watchlist_stocks watchlist_leagues watchlist_teams watchlist_podcasts user_home_prefs; do
  probe '^40[0-9]$' "GET info_agg.$t" "${curl_args[@]}" -H 'Accept-Profile: info_agg' "$URL/rest/v1/$t?select=*&limit=1"
done

echo
echo "5. Anonymous writes — all must be rejected"
probe '^40[0-9]$' "POST info_agg.stocks"   "${curl_args[@]}" -H 'Content-Profile: info_agg' -X POST   "$URL/rest/v1/stocks" -d '{"ticker":"__PROBE__"}'
probe '^40[0-9]$' "PATCH info_agg.stocks"  "${curl_args[@]}" -H 'Content-Profile: info_agg' -X PATCH  "$URL/rest/v1/stocks?ticker=eq.__nomatch__" -d '{"name":"x"}'
probe '^40[0-9]$' "DELETE info_agg.stocks" "${curl_args[@]}" -H 'Content-Profile: info_agg' -X DELETE "$URL/rest/v1/stocks?ticker=eq.__nomatch__"
probe '^40[0-9]$' "DELETE info_agg.etl_runs" "${curl_args[@]}" -H 'Content-Profile: info_agg' -X DELETE "$URL/rest/v1/etl_runs?status=eq.__nomatch__"
probe '^40[0-9]$' "POST info_agg.watchlist_stocks" "${curl_args[@]}" -H 'Content-Profile: info_agg' -X POST "$URL/rest/v1/watchlist_stocks" \
  -d '{"user_id":"00000000-0000-0000-0000-000000000000","stock_id":"00000000-0000-0000-0000-000000000000"}'

echo
echo "6. Privileged info_agg RPC"
probe '^40[0-9]$' "RPC info_agg.cleanup_daily" "${curl_args[@]}" -H 'Content-Profile: info_agg' -X POST "$URL/rest/v1/rpc/cleanup_daily" -d '{}'

echo
echo "7. Neighbouring schemas — INFORMATIONAL ONLY, not owned by this project."
echo "   Reported for awareness; this project's migration does not change them."
echo "   ffootball grants anon full DML: writes are stopped by RLS, not by privilege."
echo "   (A 204 on DELETE means 'RLS matched 0 rows', not 'rows were deleted'.)"
for pair in "ffootball:user_platform_credentials" "golf_trip:profiles" "apartments:listings" "public:projects"; do
  s="${pair%%:*}"; t="${pair##*:}"
  code=$(curl -s -o /dev/null -w '%{http_code}' "${curl_args[@]}" -H "Accept-Profile: $s" "$URL/rest/v1/$t?select=*&limit=1")
  printf '  --   %-52s %s\n' "GET $s.$t" "$code"
done
for m in POST DELETE; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "${curl_args[@]}" -H 'Content-Profile: ffootball' -X "$m" \
    "$URL/rest/v1/players?player_id=eq.__nomatch__" -d '{"player_id":"__PROBE__"}')
  printf '  --   %-52s %s\n' "$m ffootball.players" "$code"
done

echo
printf '\n%d passed, %d failed\n' "$pass" "$fail"
[[ "$fail" -eq 0 ]]
