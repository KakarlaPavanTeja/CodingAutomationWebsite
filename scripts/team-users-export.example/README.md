# Team users export

Team lead on Replit — use **production** DB (not Shell default dev):

```bash
PRODUCTION_DATABASE_URL='<from Publishing → Production → Secrets>' npm run export:team-users:prod
```

Zip `scripts/team-users-export/` and share with team.

Team members: extract to `scripts/team-users-export/` before running setup.
