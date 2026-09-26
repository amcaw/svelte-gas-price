# Déclencheur SPF (Cloudflare Worker)

Les crons de GitHub Actions partent avec plusieurs heures de retard, et ce retard varie. Ce Worker lance `update-prices.yml` à 10h pile, heure de Bruxelles, par l'API `workflow_dispatch`.

Il a deux Cron Triggers, 8h et 9h UTC, et ne lance le workflow que sur celui qui tombe à 10h à Bruxelles : 8h UTC en heure d'été, 9h UTC en heure d'hiver. Le cron `0 10 * * *` de `update-prices.yml` reste en secours si le Worker échoue.

## Mise en place

1. **Créer le jeton GitHub.** Sur GitHub, Settings > Developer settings > Personal access tokens > Fine-grained tokens > Generate new token.
   - Repository access : *Only select repositories*, `amcaw/svelte-gas-price`.
   - Permissions > Repository permissions > **Actions : Read and write**. Rien d'autre.
   - Expiration : un an, et noter la date d'échéance.
2. **Déployer le Worker**, depuis ce dossier :
   ```sh
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put GITHUB_TOKEN
   ```
   La dernière commande demande le jeton : le coller.
3. **Vérifier.** Dans le tableau de bord Cloudflare, Workers & Pages > `svelte-gas-price-spf` > Settings > Trigger Events : les deux crons doivent apparaître. Le lendemain, `gh run list -R amcaw/svelte-gas-price -w update-prices.yml` doit montrer un run `workflow_dispatch` à 10h.

## Tester sans attendre 10h

Créer un fichier `.dev.vars` (ignoré par git) contenant `GITHUB_TOKEN=<le jeton>`, puis :

```sh
npx wrangler dev --test-scheduled
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"
```

Un cron autre que les deux horaires ignore le contrôle de l'heure : le workflow part aussitôt.

## Quand le jeton expire

Le Worker échoue et les journaux Cloudflare (onglet Logs du Worker) affichent une erreur 401. Les prix arrivent quand même, en retard, par le cron de secours. Régénérer le jeton sur GitHub, puis `npx wrangler secret put GITHUB_TOKEN`.
