# Direct upload to TikTok drafts — setup

**What this gives you:** the optimised file goes straight from this PC into the
TikTok app's drafts on your phone. No cable, no WhatsApp, no lossy transfer.
You finish and post it in the app.

**What it does NOT give you:** better quality. TikTok transcodes uploads exactly
the same however they arrive. This is convenience, not a bypass.

---

## Why drafts and not direct posting

TikTok's Content Posting API has two modes:

| Mode | Scope | Reality |
|---|---|---|
| Direct Post | `video.publish` | Unaudited apps are **forced to private (SELF_ONLY)** no matter what they request |
| Upload to inbox | `video.upload` | **Works without an audit** — lands in your drafts |

The audit that unlocks public direct posting requires a deployed product with a
landing page, privacy policy, live signup and a demo video. A personal tool will
not pass, so drafts is the honest path.

Limits on an unaudited client: **5 drafts per 24 hours**.

---

## 1. Create a TikTok developer app  (~10 min, once)

1. Go to **https://developers.tiktok.com** and log in with your TikTok account
2. **Manage apps → Connect an app** — give it any name, e.g. "Vague Personal"
3. Under **Products**, add **Login Kit** and **Content Posting API**
4. Under **Scopes**, enable:
   - `user.info.basic`
   - `video.upload`      ← the important one
   - *(leave `video.publish` off — it needs the audit)*
5. Under **Redirect URI**, add exactly:
   ```
   http://localhost:4788/callback
   ```
6. Copy your **Client key** and **Client secret**

> TikTok may ask what the app does. It is a personal tool that uploads your own
> videos to your own drafts. That is exactly what `video.upload` is for.

---

## 2. Save the credentials

```bash
mkdir -p ~/.vague
cat > ~/.vague/tiktok-app.json <<'JSON'
{
  "client_key": "awxxxxxxxxxxxxxx",
  "client_secret": "xxxxxxxxxxxxxxxxxxxxxxxx"
}
JSON
chmod 600 ~/.vague/tiktok-app.json
```

---

## 3. Authorise once

```bash
./vague.sh --tiktok-login
```

A browser opens, you approve, the tab says **✅ Connected**. The token is saved
to `~/.vague/tiktok.json` (mode 600).

TikTok rotates the refresh token on every use — the tool persists the new one
automatically, so you should not need to log in again.

---

## 4. Use it

```bash
# lossless container fix, then straight to drafts
./vague.sh video.MP4 --remux-only --upload

# full transcode, then to drafts
./vague.sh video.MP4 --upload
```

Then on your phone: **TikTok → Profile → Drafts → finish and post.**

⚠️ **Do not re-edit the draft in the app.** Adding a sound, trimming, or applying
a filter makes TikTok re-process the file and undoes the optimisation. Caption
and hashtags are fine.

---

## Troubleshooting

| Error | Cause |
|---|---|
| `No TikTok app credentials` | `~/.vague/tiktok-app.json` missing or malformed |
| `redirect_uri` mismatch | The URI in the portal must be exactly `http://localhost:4788/callback` |
| `scope_not_authorized` | `video.upload` not enabled on the app |
| `unaudited_client_can_only_post_to_private_accounts` | Something asked for Direct Post — this tool only uses inbox drafts |
| `Refresh failed` | Run `./vague.sh --tiktok-login` again |

Files created:
```
~/.vague/tiktok-app.json   your app key + secret  (you create this)
~/.vague/tiktok.json       access + refresh token (created on login)
```
Both are mode 600. Never commit or share them.
