# Venband Realtime on your own VPS

This moves Venband's live traffic off Supabase Realtime and onto a server you
control: typing indicators, who's online, call signalling, and games like
Stackdown. Messages, database change feeds, sign-in and files stay on Supabase
for now (see `docs/AUDIT.md` §19, stage J4).

The server holds **no secrets**. It checks each user with their own sign-in
token and asks Supabase whether they may join each topic, using the same rule
Supabase Realtime uses (`realtime_topic_allowed`). If the VPS is hacked, the
attacker gets no database or admin access.

## What you need

* A small Linux VPS: 1 vCPU and 1 GB RAM handles thousands of connections.
  Any provider works (Hetzner, DigitalOcean, Vultr, Linode, OVH…), at about
  $5–10 a month.
* A subdomain for it, such as `rt.venband.com`.

## 1. Point the subdomain at the VPS

At your DNS provider, add an **A record** `rt` → the VPS's IPv4 address. Add an
**AAAA record** too if the VPS has IPv6.

## 2. Install Docker on the VPS

```bash
ssh root@YOUR_VPS_IP
curl -fsSL https://get.docker.com | sh
```

Open only the ports the server needs:

```bash
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
```

## 3. Get the code and configure it

```bash
git clone https://github.com/youragoober999-sketch/venband.git
cd venband/deploy/realtime
cp .env.example .env
nano .env
```

In `.env`, set these:

* `REALTIME_DOMAIN`: your subdomain.
* `SUPABASE_URL`: the same value as the website's `VITE_SUPABASE_URL`.
* `SUPABASE_ANON_KEY`: the same value as the website's `VITE_SUPABASE_ANON_KEY`.

## 4. Start it

```bash
docker compose up -d --build
curl https://rt.venband.com/health
```

You should get `{"ok":true,...}` back. Caddy gets the HTTPS certificate on its
own and renews it.

## 5. Switch the website over

In Vercel → Project → Settings → Environment Variables, add
`VITE_REALTIME_URL` = `wss://rt.venband.com`, then redeploy. The desktop app
loads the website, so it switches at the same time. Phone apps switch on their
next build.

**To roll back,** delete `VITE_REALTIME_URL` and redeploy. Everything goes back
to Supabase Realtime.

Everyone moves together on a deploy. Two people on different realtime servers
can't see each other typing, so don't run half the site on each.

## Updating

```bash
cd venband && git pull && cd deploy/realtime && docker compose up -d --build
```

## Checking on it

* `docker compose logs -f realtime`: warnings, such as Supabase being
  unreachable.
* `https://rt.venband.com/health`: the number of connections and topics.

## Limits built in

* Frames up to 64 KB.
* 40 frames a second per connection, with bursts up to 120.
* 200 topics per connection.
* 30 connections per user and 60 per IP address.
* Presence data up to 4 KB.
* Sign-in within 10 seconds of connecting.
* Expired tokens are disconnected.
* Joins are re-checked every 4 minutes, so someone kicked from a server drops
  out.
* The sender's user id on broadcasts and presence is set by the server, so a
  modified client can't pretend to be someone else.
