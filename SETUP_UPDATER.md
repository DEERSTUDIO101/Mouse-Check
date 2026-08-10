# Auto-Updater Setup (einmalig)

## 1. Signing Key generieren

Im Mouse Check Ordner:
```
npm run tauri signer generate -- -w .tauri-key
```
→ erstellt `.tauri-key` (privat) und `.tauri-key.pub` (öffentlich)

## 2. Public Key in tauri.conf.json eintragen

Den Inhalt von `.tauri-key.pub` kopieren und in `src-tauri/tauri.conf.json` eintragen:
```json
"pubkey": "dkgAAAAAB...dein key hier..."
```

## 3. GitHub Secrets setzen

Auf github.com → Repo → Settings → Secrets → Actions:

- `TAURI_SIGNING_PRIVATE_KEY` = Inhalt von `.tauri-key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = das Passwort das du beim Generieren eingegeben hast

## 4. .gitignore anpassen

`.tauri-key` NIEMALS committen! In `.gitignore` eintragen:
```
.tauri-key
```

## 5. Release erstellen

```bash
git tag v0.1.0
git push origin v0.1.0
```

→ GitHub Actions baut automatisch, erstellt Release mit Installer + `latest.json`
→ Beim nächsten App-Start wird das Update erkannt und ein Banner angezeigt

## Version erhöhen

In `src-tauri/tauri.conf.json` und `src-tauri/Cargo.toml` die `version` hochsetzen,
dann einen neuen Tag pushen → GitHub Actions macht den Rest.
