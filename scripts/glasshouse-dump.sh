#!/usr/bin/env bash
# Dump every read endpoint of a Glasshouse TV into a .tar.gz, for test fixtures.
#
#   glasshouse-dump.sh <host[:port]> [token] [--ssh | --telnet]
#
# Only GET requests: nothing here changes the TV. Needs curl and jq. With
# --ssh (root@host, key or password) or --telnet (the Homebrew Channel's root
# shell on port 23, no login) it also reads what the API cannot give: the raw
# HDMI receiver status files under /proc/lg/hdmi20, the configd input map, the
# video output and input services' raw replies, and the TV's own version
# strings. Those run read-only commands on the TV and write nothing there. The raw
# dump holds identifiers (SSID, MACs, addresses, serials, the postcode in the
# system log); scrub before anything leaves the laptop. A scrubbed copy of the
# stats answer is written beside the raw one as a starting point, following the
# repo's fixture rules (MACs 00:00:5e:00:53:xx, SSID Home-5G, device lg_tv,
# tcon_module zeroed); check the string fields by eye before committing.
set -uo pipefail

host="" tok="" shell=""
for a in "$@"; do
  case "$a" in
    --ssh) shell=ssh ;;
    --telnet) shell=telnet ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    -*) echo "unknown option $a" >&2; exit 2 ;;
    *) if [ -z "$host" ]; then host=$a; elif [ -z "$tok" ]; then tok=$a; else echo "too many arguments" >&2; exit 2; fi ;;
  esac
done
[ -n "$host" ] || { echo "usage: glasshouse-dump.sh <host[:port]> [token] [--ssh | --telnet]" >&2; exit 2; }
case "$host" in *:*) tv=${host%%:*} ;; *) tv=$host; host="$host:8080" ;; esac
base="http://$host"
auth=()
[ -n "$tok" ] && auth=(-H "Authorization: Bearer $tok")

stamp=$(date -u +%Y%m%dT%H%M%SZ)
out="glasshouse-dump-$stamp"
mkdir -p "$out"
echo "collecting into $out/ (archived as $out.tar.gz at the end)"

get() { # get <name> <path> [raw]
  local name=$1 path=$2 raw=${3:-}
  local file="$out/$name"
  if [ -n "$raw" ]; then file="$file.txt"; else file="$file.json"; fi
  local code
  code=$(curl -sS -m 40 "${auth[@]}" -o "$file.tmp" -w '%{http_code}' "$base$path" 2>"$out/.err") || true
  if [ "$code" != "200" ]; then
    printf '%-28s HTTP %s %s\n' "$name" "$code" "$(head -c 120 "$out/.err" 2>/dev/null)"
    rm -f "$file.tmp"; return
  fi
  if [ -n "$raw" ]; then mv "$file.tmp" "$file"
  elif jq . "$file.tmp" > "$file" 2>/dev/null; then rm -f "$file.tmp"
  else mv "$file.tmp" "$file"; printf '%-28s not JSON, kept as is\n' "$name"; return
  fi
  printf '%-28s ok (%s bytes)\n' "$name" "$(wc -c < "$file")"
}

get caps              /api/caps
get update            /api/update
get stats             /api/stats
get stats-settings    '/api/stats?with=settings'
get prometheus        /api/prometheus/metrics raw
get oledcare          /api/oledcare
get hdmi              /api/hdmi
get game              /api/game
get game-fps          /api/game/fps
get cpu               /api/cpu
get processes         /api/processes
get processes-all     '/api/processes?all=1'
get apps              /api/apps
get services          /api/services
get privacy           /api/privacy
get tvapp             /api/tvapp
get screensaver       /api/screensaver
get servicemenu       /api/servicemenu
get settings          /api/settings
get lgsettings-all    '/api/lgsettings?section=sound,hdmi,devices,game,promotions'
for s in sound hdmi devices game promotions; do get "lgsettings-$s" "/api/lgsettings?section=$s"; done
# Logs redacted on the TV: addresses, MACs, serials, SSIDs and postcodes out.
get logs              '/api/logs?sources=system,glasshouse,kernel&limit=1000&redact=1'
get logs-system       '/api/logs?sources=system&limit=1000&redact=1'
get logs-kernel       '/api/logs?sources=kernel&limit=1000&redact=1'
get logs-glasshouse   '/api/logs?sources=glasshouse&limit=1000&redact=1'

# Second stats read a few seconds on, for rates and anything that changes.
sleep 5
get stats-again       /api/stats

# A scrubbed copy of stats as a fixture starting point.
if [ -f "$out/stats.json" ]; then
  jq '
    def mac($n): "00:00:5e:00:53:0" + ($n|tostring);
    .device.id = "lg_tv"
    | (if .device.name? then .device.name = ("LG " + (.device.model // "TV" | split(".")[0])) else . end)
    | (if .ssid? then .ssid = "Home-5G" else . end)
    | (if .panel_silicon?.tcon_module? then .panel_silicon.tcon_module = "0000000000000000" else . end)
    | (if .remote?.mac? then .remote.mac = mac(1) else . end)
    | walk(if type == "string" and test("^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$") then mac(2) else . end)
  ' "$out/stats.json" > "$out/stats-scrubbed.json" 2>/dev/null && echo "stats-scrubbed.json written; check serials, addresses and names by eye"
fi

# ---------------------------------------------------------------- on the TV
# Read-only commands, run as root over SSH or the Homebrew Channel's telnet.
# Every section is fenced so the output can be split into files afterwards.
probe_script() {
  cat <<'EOF'
mark() { echo "__GH_SECTION__ $1"; }
for p in 0 1 2 3; do
  f=/proc/lg/hdmi20/port$p/status
  [ -r "$f" ] || continue
  mark "hdmi20/port$p.status"; cat "$f"; echo
done
mark configd-input-map.json
luna-send -n 1 -w 5000 -f luna://com.webos.service.config/getConfigs '{"configNames":["inputMap.videoInputMapIndexInfo0"]}' </dev/null
mark videooutput-status.json
luna-send -n 1 -w 5000 -f luna://com.webos.service.videooutput/getStatus '{}' </dev/null
mark eim-inputs.json
luna-send -n 1 -w 5000 -f luna://com.webos.service.eim/getAllInputStatus '{}' </dev/null
mark system-properties.json
luna-send -n 1 -w 5000 -f luna://com.webos.service.tv.systemproperty/getSystemProperties '{"keys":["modelName","firmwareVersion","boardType","sdkVersion","UHD"]}' </dev/null
mark sound-outputs-offered.json
luna-send -n 1 -w 5000 -f luna://com.webos.service.settings/getSystemSettingValues '{"category":"sound","key":"soundOutput"}' </dev/null
mark versions.txt
uname -a; echo "node: $(node -v 2>&1)"; cat /etc/starfish-release 2>/dev/null; cat /var/run/nyx/os_info.json 2>/dev/null; echo
mark end
EOF
}

split_sections() { # split_sections <raw> : one file per fenced section
  mkdir -p "$out/tv/hdmi20"
  awk -v dir="$out/tv" '
    /^__GH_SECTION__ / { if (f) close(f); name=$2; if (name=="end") { f=""; next }
      f=dir "/" name; printf "" > f; next }
    f { print > f }' "$1"
  find "$out/tv" -type f | sort | sed "s|^$out/|  |"
}

probe_ssh() {
  echo "reading the TV over SSH as root@$tv (may ask for a password or a key touch) ..."
  if ssh -o ConnectTimeout=10 "root@$tv" 'sh -s' < <(probe_script) > "$out/tv-raw.txt" 2>"$out/.err"; then
    split_sections "$out/tv-raw.txt"
  else
    echo "SSH failed: $(head -c 200 "$out/.err")"
  fi
}

# Bash opens the socket itself through /dev/tcp, so no telnet program is needed.
probe_telnet() {
  echo "reading the TV over telnet (Homebrew Channel root shell) ..."
  if ! ( exec 3<>"/dev/tcp/$tv/23" ) 2>/dev/null; then
    echo "nothing answers on $tv port 23: switch telnet on in the Homebrew Channel, or use --ssh"
    return
  fi
  exec 3<>"/dev/tcp/$tv/23"
  cat <&3 > "$out/tv-telnet.raw" &
  reader=$!
  sleep 1
  {
    printf 'PS1=; PS2=; stty -echo; echo __GH_START__\n'
    sleep 1
    printf "sh <<'__GH_SH__'\n"
    probe_script
    printf '__GH_SH__\n'
    printf 'echo __GH_DONE__; exit\n'
  } >&3
  for _ in $(seq 1 60); do
    grep -q '__GH_DONE__' "$out/tv-telnet.raw" 2>/dev/null && break
    sleep 1
  done
  exec 3>&-
  kill "$reader" 2>/dev/null || true
  wait "$reader" 2>/dev/null || true
  # Only what the TV printed once the probe began: before that come telnet's
  # control bytes, the login banner and the commands echoed back.
  LC_ALL=C tr -cd '\11\12\40-\176' < "$out/tv-telnet.raw" |
    sed -n '/__GH_START__/,$p' | grep -Ev '__GH_(START|DONE)__' > "$out/tv-raw.txt" || true
  grep -q '__GH_SECTION__' "$out/tv-raw.txt" && split_sections "$out/tv-raw.txt" || echo "no sections came back; see $out/tv-telnet.raw"
}

case "$shell" in
  ssh) probe_ssh ;;
  telnet) probe_telnet ;;
esac

rm -f "$out/.err"
echo "model: $(jq -r '.device.model // "?"' "$out/stats.json" 2>/dev/null)  webos: $(jq -r '.system.webos // "?"' "$out/stats.json" 2>/dev/null)  glasshouse: $(jq -r '.version // "?"' "$out/caps.json" 2>/dev/null)"
tar -czf "$out.tar.gz" "$out" && rm -rf "$out"
echo "done: $out.tar.gz"
