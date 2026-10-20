#!/bin/sh
# Checks the templates for a reverse proxy in proxy/ the way the two servers
# read them, for the CI and for anybody who changes one: nginx -t and
# httpd -t, each with the oldest release a supported distribution still ships
# and with the newest, with the modules the template asks for and a
# certificate made here at the path certbot puts it under. Another application
# runs it against its own templates: sh test-proxy.sh <folder>.
#
# Prints what it checks and stops at the first thing that is wrong.
set -eu

source_dir=$(cd "$(dirname "$0")" && pwd)
templates=$(cd "${1:-$source_dir/proxy}" && pwd)

# The oldest are those of Ubuntu 22.04, the newest the current releases.
nginx_images='nginx:1.18.0-alpine nginx:1.31.7-alpine'
httpd_images='httpd:2.4.52-alpine httpd:2.4.69-alpine'

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

check() {
  printf 'check: %s\n' "$1"
}

fail() {
  printf 'FEHLER: %s\n' "$1" >&2
  exit 1
}

for template in nginx.conf apache.conf; do
  test -f "$templates/$template" || fail "$templates/$template fehlt"
done

# The name comes out of the templates, so that the certificate stands where
# they look for it, and both have to look in the same place.
names=$(sed -n 's#.*/etc/letsencrypt/live/\([^/]*\)/.*#\1#p' \
  "$templates/nginx.conf" "$templates/apache.conf" | sort -u)
[ -n "$names" ] || fail 'keine Vorlage nennt ein Zertifikat unter /etc/letsencrypt/live/'
[ "$(printf '%s\n' "$names" | wc -l)" -eq 1 ] ||
  fail "die Vorlagen nennen verschiedene Zertifikate: $(printf '%s ' $names)"
name=$names

# The application sets its security headers itself; a second one from the
# proxy is wrong, not stricter (README, Reverse Proxy).
if grep -n 'add_header' "$templates/nginx.conf"; then
  fail 'nginx.conf setzt einen Header in der Antwort'
fi
if grep -nE '^[[:space:]]*Header[[:space:]]' "$templates/apache.conf"; then
  fail 'apache.conf setzt einen Header in der Antwort'
fi
check 'keine Vorlage setzt einen Header in der Antwort'

mkdir -p "$work/letsencrypt/live/$name"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=$name" \
  -keyout "$work/letsencrypt/live/$name/privkey.pem" \
  -out "$work/letsencrypt/live/$name/fullchain.pem" 2> /dev/null
cp "$templates/nginx.conf" "$templates/apache.conf" "$work/"

# Everything goes into the container on its standard input, as a tar stream,
# so that nothing depends on how a folder of the host is mounted.
run() {
  image=$1
  script=$2
  tar -C "$work" -cf - . | docker run -i --rm "$image" sh -c "$script" 2>&1
}

for image in $nginx_images; do
  out=$(run "$image" '
    set -e
    mkdir -p /tmp/in /etc/letsencrypt /var/www/html
    tar -x -C /tmp/in
    cp -R /tmp/in/letsencrypt/live /etc/letsencrypt/
    cp /tmp/in/nginx.conf /etc/nginx/conf.d/proxy.conf
    nginx -t
  ') || {
    printf '%s\n' "$out"
    fail "nginx -t mit $image"
  }
  printf '%s\n' "$out"
  # A warning, a deprecated directive among them, fails as well: the next
  # release may refuse what this one only warns about.
  if printf '%s\n' "$out" | grep -q '\[warn\]'; then
    fail "nginx -t mit $image warnt"
  fi
  check "nginx -t mit $image"
done

for image in $httpd_images; do
  out=$(run "$image" '
    set -e
    mkdir -p /tmp/in /etc/letsencrypt /var/www/html
    tar -x -C /tmp/in
    cp -R /tmp/in/letsencrypt/live /etc/letsencrypt/
    cp /tmp/in/apache.conf conf/extra/proxy.conf
    for module in ssl proxy proxy_http headers rewrite; do
      sed -i "s|^#\(LoadModule ${module}_module \)|\1|" conf/httpd.conf
    done
    printf "%s\n" "ServerName localhost" "Listen 443" "Include conf/extra/proxy.conf" >> conf/httpd.conf
    httpd -t
  ') || {
    printf '%s\n' "$out"
    fail "httpd -t mit $image"
  }
  printf '%s\n' "$out"
  # Anything besides the verdict is a warning about the template: the base
  # configuration above is quiet on its own.
  if [ "$out" != 'Syntax OK' ]; then
    fail "httpd -t mit $image meldet mehr als Syntax OK"
  fi
  check "httpd -t mit $image"
done
