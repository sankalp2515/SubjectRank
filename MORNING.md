# MORNING — credentials to live URL

Numbered, with timings. Everything here was blocked overnight by a missing
credential or a missing permission — nothing here is unfinished work.

**Do step 1 first.** It is 2 minutes and everything else depends on it.

---

## 1. Restore the git directory · 2 min · no credentials needed

The Cowork device bridge blocks `unlink()` inside connected folders, so git could
not remove its own `index.lock` after the first commit. Work continued against a
git dir in session scratch. The history is intact — it is just in the wrong place.

```powershell
cd "E:\Claude Code Projects\ML Model\subjectrank"
Remove-Item -Recurse -Force .git          # the jammed, lock-littered original
Remove-Item -Recurse -Force _to_delete    # scratch the agent could not delete
```

Then copy the working git dir back. The agent will have exported it to
`subjectrank-git.bundle` in the project root at end of session:

```powershell
git init
git pull subjectrank-git.bundle
git log --oneline          # confirm the full history is present
```

Sanity check before anything else: `git log` shows every commit, `git status` is
clean.

---

## 2. Confirm the data question · 5 min · read first, decide once

`OPEN_QUESTIONS.md` **Q-001** is the only open item that changes what you are
allowed to claim. The archive's exploratory subset is 4,873 tests; the full
archive is 32,487. If you trained on exploratory only, §14's opening clause must
become *"4,873 randomized headline experiments comprising 22,666 arms"*.

Delete the clause, do not soften it. Then grep the launch kit for `32,487` and fix
every instance before anything is posted.

---

## 3. GitHub · 5 min

```bash
gh repo create subjectrank --public --source=. --remote=origin
git push -u origin main
```

Check before pushing:

- [ ] `.gitignore` excludes `data/raw/*.csv` — the archive is CC BY 4.0 and
      redistributable, but committing 14 MB of someone else's dataset into a
      portfolio repo is noise, and the citation is the thing that matters.
- [ ] no `.env` file staged
- [ ] `git log --all --full-history -- .env` returns nothing

---

## 4. Supabase · 10 min

1. Create project. Region closest to you.
2. Run the migrations **in numbered order**:
   ```bash
   supabase db push          # or paste each file in the SQL editor, in order
   ```
3. Verify RLS is on for every user-scoped table:
   ```sql
   select tablename, rowsecurity from pg_tables
   where schemaname = 'public' order by tablename;
   ```
   Every row must show `rowsecurity = true`. **If any is false, stop and fix it
   before deploying** — a public anon key with RLS off is a data leak, not a
   configuration detail.
4. Enable anonymous sign-ins: Authentication → Providers → Anonymous.
5. Copy `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

---

## 5. Vercel · 10 min

1. Import the GitHub repo.
2. Environment variables:

   | name | value | scope |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | from step 4 | all |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from step 4 | all |
   | `SUPABASE_SERVICE_ROLE_KEY` | from step 4 | **server only** |
   | `CRON_SECRET` | generate a random string | server only |
   | `SESSION_SECRET` | generate a random string | server only |
   | `ADMIN_TOKEN` | generate a random string | server only |

   `SESSION_SECRET` signs the session cookie. **The app refuses to start in
   production without it** — unsigned session cookies would let anyone forge
   another visitor's identity, so failing loudly beats starting insecurely.

   `ADMIN_TOKEN` gates `/admin`. Without it that route returns 404 to everyone,
   including you. To get in, set the cookie once in the browser console on the
   deployed origin:
   ```js
   document.cookie = 'sr_admin=<the token>; path=/; secure; samesite=lax'
   ```

   The service-role key must never carry a `NEXT_PUBLIC_` prefix. That prefix
   ships it to the browser.
3. Deploy.

---

## 6. Smoke test the live URL · 5 min

Do these in the browser, not with curl — the point is what a stranger sees.

- [ ] Landing page renders a worked example **already ranked**, in under 2s,
      without typing anything
- [ ] Paste two of your own lines → ranking + attribution appear
- [ ] Paste the same two lines in the **opposite order** → same winner
      (this is the antisymmetry property; if it fails, do not launch)
- [ ] "This is wrong" writes a `feedback` row
- [ ] Footer shows the Upworthy Research Archive citation
- [ ] Limitation text is visible on the landing page, not hidden in a footer
- [ ] Works at 375px width
- [ ] Tab through the page — focus is visible on every control

---

## 7. Before posting anything · 15 min

- [ ] Reconcile every number in the launch kit against `MODEL_CARD.md`
- [ ] Q-001 resolved and the experiment count corrected everywhere
- [ ] Re-read §14's sentence clause by clause. Delete any clause that is not true.
- [ ] Check each subreddit's rules yourself — they change, and a rule-break burns
      the community permanently

**Nothing auto-posts. Every word is yours to send.**

---

## Blocked overnight, needs your click

- **Delete permission on the connected folder.** The agent requested it; it needs
  approval in the desktop app. Without it, junk in `_to_delete/` and the jammed
  `.git` could not be removed. Step 1 handles both manually.
