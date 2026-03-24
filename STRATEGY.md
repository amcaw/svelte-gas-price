# Stratégie — Série de widgets prix carburants Belgique

## Contexte

Widgets embarqués dans un article via **pym.js** (iframe auto-redimensionné).
Chaque widget = une URL autonome déployée sur GitHub Pages, intégrée ainsi :

```html
<div data-pym-src="https://amcaw.github.io/svelte-gas-price/calculator/index.html" data-pym-id="calculator"></div>
```

Stack : **Svelte 5 + D3 + pym.js**, build Vite, déploiement GitHub Pages.

---

## Source de données

### SPF Économie — Prix maximum quotidiens

Le SPF Économie publie chaque jour ouvrable les **prix maximum** officiels (€/L ou €/1000L pour le mazout) :

| Carburant | Identifiant |
|---|---|
| Essence 95 RON E10 | `essence95` |
| Diesel B7 (EN590) | `diesel` |
| Mazout de chauffage (≤ 2000L) | `mazout` |

**Accès aux données historiques :** via le portail **Statbel / be.STAT** (API REST, format CSV/JSON/XLSX, licence CC BY 4.0).
URL pattern : `https://bestat.statbel.fgov.be/bestat/api/views/{VIEW_ID}/result/JSON`

**Stratégie d'intégration retenue : données statiques + mise à jour automatique**

Pas de fetch direct depuis le navigateur (CORS). À la place :
1. Un script Node (ou Python) scrape/télécharge les données Statbel périodiquement.
2. Il génère un fichier `public/data/prices.json` versionné dans le repo.
3. Une **GitHub Action** tourne chaque nuit (cron) pour mettre à jour ce fichier.
4. Les widgets lisent `prices.json` en local — pas de dépendance réseau runtime.

Avantage : zéro dépendance API en production, chargement immédiat, données maîtrisées.

---

## Architecture multi-widgets

### Option retenue : monorepo avec un widget par dossier `src/widgets/`

```
svelte-gas-price/
├── public/
│   └── data/
│       └── prices.json          ← données consolidées (tous carburants, quotidien)
├── src/
│   ├── widgets/
│   │   ├── calculator/          ← widget calculateur (v1)
│   │   │   ├── index.html
│   │   │   ├── main.js
│   │   │   └── Calculator.svelte
│   │   ├── chart/               ← widget courbe historique (existant, à refactoriser)
│   │   │   └── …
│   │   └── today/               ← widget prix du jour (futur)
│   │       └── …
│   └── lib/
│       ├── pym.js               ← wrapper Svelte pour pym.Child (partagé)
│       ├── data.js              ← loader/parser de prices.json (partagé)
│       └── theme.js             ← couleurs dark/light (partagé)
├── scripts/
│   └── fetch-prices.js          ← script de mise à jour des données
├── .github/workflows/
│   └── update-prices.yml        ← cron GitHub Action
└── vite.config.js               ← multi-entry, un build par widget
```

**Build multi-entry Vite** : chaque widget génère son propre `dist/widget-name/index.html`, déployé sous :
- `https://rtbfmedia.be/…/calculator/index.html`
- `https://rtbfmedia.be/…/chart/index.html`
- etc.

---

## Widget 1 — Calculateur de plein (priorité)

### Concept

> « En X mois, votre plein de Y litres d'essence 95 est passé de Z€ à W€, soit +Δ€ (+X%). »

Personnalisation maximale avec une interface minimaliste, une seule phrase de résultat percutante.

### UX / Formulaire

```
[ Type de carburant ▾ ]   [ Capacité du réservoir __ L ]
[ Comparer avec ▾ ]  → preset : il y a 1 an / 2 ans / 5 ans  ou  date personnalisée

→ bouton : Calculer
```

**Inputs :**
| Champ | Type | Valeurs possibles |
|---|---|---|
| `fuelType` | select | Essence 95, Diesel, Mazout (1000L) |
| `tankSize` | number | 1–200 L (mazout : 500–5000 L) |
| `compareDate` | preset + date picker | 1 an, 2 ans, 5 ans, date libre |

**Calcul :**
- Prix à `compareDate` = prix max SPF ce jour-là (ou jour ouvrable précédent)
- Prix aujourd'hui = dernier prix max disponible dans `prices.json`
- `delta = (prixAujourd'hui - prixComparé) × capacity`
- Afficher aussi la variation en % et le prix au litre des deux dates

**Résultat affiché (exemple) :**
> Votre plein de 50 litres d'Essence 95 coûtait **82,40 €** en mars 2023.
> Aujourd'hui, il vous revient à **86,05 €** — soit **+3,65 € (+4,4%)**.

Pour le mazout, adapter à 1000 litres comme unité de référence SPF.

### Gestion des cas limites
- Date antérieure aux données disponibles → message d'erreur explicite
- Jour non ouvrable → prendre le prix du dernier jour ouvrable précédent
- Données manquantes pour un carburant à une date → interpolation ou message

### Visualisation complémentaire (optionnelle)
Sous le résultat, un mini sparkline D3 montrant l'évolution du prix sur la période sélectionnée, avec les deux dates marquées.

---

## Widgets futurs (backlog)

| Widget | Description | Complexité |
|---|---|---|
| `chart` | Courbe historique interactive (existant, à connecter aux vraies données) | faible |
| `today` | Prix du jour en gros chiffre + variation J-1 | faible |
| `comparison` | Comparaison entre carburants sur une période choisie | moyenne |
| `mazout-tracker` | Suivi spécifique mazout avec alertes seuil (prix bas pour commander) | moyenne |

---

## Feuille de route

### Phase 0 — Infrastructure (faire en premier)
1. Trouver l'URL exacte du jeu de données Statbel pour les prix quotidiens
2. Écrire `scripts/fetch-prices.js` → génère `public/data/prices.json`
3. Valider la structure JSON et la couverture historique (idéalement 2019–aujourd'hui)
4. Mettre en place la GitHub Action de mise à jour nocturne
5. Refactoriser `vite.config.js` pour le multi-entry

### Phase 1 — Widget calculateur
1. Créer `src/widgets/calculator/` avec le formulaire et le calcul
2. Brancher sur `prices.json`
3. Soigner le rendu du résultat (typographie, couleur selon hausse/baisse)
4. Tester l'intégration pym.js (hauteur dynamique selon état du formulaire)
5. Déployer et tester en iframe

### Phase 2 — Widget courbe (refonte)
1. Brancher le widget existant sur les vraies données
2. Ajouter le mazout
3. Permettre le zoom/sélection de période

---

## Format de `prices.json`

```json
{
  "lastUpdated": "2025-03-23",
  "fuels": {
    "essence95": [
      { "date": "2019-01-02", "price": 1.523 },
      { "date": "2019-01-03", "price": 1.519 },
      …
    ],
    "diesel": [ … ],
    "mazout": [
      { "date": "2019-01-02", "price": 748.50 },
      …
    ]
  }
}
```

Prix en **€/L** pour essence et diesel, **€/1000L** pour le mazout (convention SPF Économie).

---

## Contraintes d'intégration pym.js

- Chaque widget appelle `pymChild.sendHeight()` après tout changement de contenu (formulaire soumis, résultat affiché).
- Le widget ne doit pas avoir de hauteur fixe — la hauteur doit être dictée par le contenu.
- Éviter `overflow: hidden` sur le conteneur racine (bloque le redimensionnement).
- Tester sur mobile : la largeur de l'iframe est contrainte par la colonne d'article (~320–700px).

---

## Notes sur le RGPD / tracking

- Aucun cookie, aucun tracking côté widget.
- Les données sont locales (JSON statique servi depuis GitHub Pages).
- Pas de formulaire avec envoi de données personnelles.

---

## Stratégie d'affichage — Gasoil de chauffage (mazout)

### Les deux tarifs affichés

Le gasoil de chauffage (mazout) belge est soumis à un **prix maximum légal** fixé par le SPF Économie. Ce prix dépend du volume livré :

| Intitulé dans l'interface | Condition             | Code interne  |
|---------------------------|-----------------------|---------------|
| `< 2000 L`                | Livraison < 2 000 L  | `mazout`      |
| `≥ 2000 L`                | Livraison ≥ 2 000 L  | `mazout_plus` |

La livraison en plus grande quantité bénéficie toujours d'un tarif légèrement inférieur (typiquement **0,03 à 0,04 €/L** d'écart).

### Deux dénominations dans les données Statbel

L'API Statbel a changé sa nomenclature produit **en avril 2024**, suite à l'entrée en vigueur de la norme belge **NBN T52-716** (harmonisation européenne) :

- **Avant avril 2024** — appellation *legacy* :
  - `Gasoil Diesel Heating/Chauffage < 2000 L`
  - `Gasoil Diesel Heating/Chauffage >= 2000 L`

- **Depuis avril 2024** — nouvelle appellation normative :
  - `H0 Domestic Heating … < 2000 L`
  - `H7 Domestic Heating … >= 2000 L`

L'API publie les deux appellations **en parallèle** depuis le changement — une même date peut donc avoir des entrées legacy *et* H0/H7.

### Choix retenu : toujours l'appellation legacy

Pour garantir une **continuité sur toute la plage historique** (2019 – aujourd'hui), `scripts/fetch-prices.js` utilise systématiquement l'appellation legacy et exclut explicitement `H0` :

```js
// Gasoil Diesel Heating/Chauffage (appellation legacy, cohérente sur toutes les dates)
if ((name.includes('Heating') || name.includes('Chauffage'))
    && !name.includes('H0') && !name.includes('Agriculture') && !name.includes('I&C')
    && (name.includes('>=2000') || name.includes('partir'))) return 'mazout_plus';
if ((name.includes('Heating') || name.includes('Chauffage'))
    && !name.includes('H0') && !name.includes('Agriculture') && !name.includes('I&C')
    && (name.includes('<2000') || name.includes('moins de 2000'))) return 'mazout';
```

Le filtre `!name.includes('H0')` ignore volontairement la nouvelle nomenclature.

Pour les données historiques issues d'un CSV (`scripts/build-historical.js`), la préférence est :

```js
mazout_legacy ?? mazout   // legacy d'abord, H0 en fallback si legacy absent
```

### Exemples de prix historiques

Prix maximum TTC (€/L), livraison résidentielle standard :

| Date       | `< 2000 L` | `≥ 2000 L` | Contexte                                        |
|------------|------------|------------|-------------------------------------------------|
| 2021-06-01 | 0,655      | 0,625      | Post-COVID, prix bas                            |
| 2022-06-01 | 1,342      | 1,310      | Pic de la crise énergétique (guerre en Ukraine) |
| 2023-03-01 | 1,016      | 0,980      | Détente progressive des marchés                 |
| 2024-03-01 | 1,005      | 0,967      | Veille du changement de norme (H0/H7)           |
| 2024-06-01 | 0,918      | 0,879      | Premier été post-norme — données legacy encore présentes |
| 2025-01-01 | 0,897      | 0,857      | Légère baisse hivernale                         |

### Résumé

| Aspect                       | Choix retenu                                         |
|------------------------------|------------------------------------------------------|
| Intitulé affiché             | `< 2000 L` / `≥ 2000 L` (neutre, sans référence à la norme) |
| Dénomination interne         | Legacy « Gasoil Diesel Chauffage »                   |
| Norme H0/H7 (post-avril 2024)| Ignorée volontairement pour cohérence historique     |
| Source                       | API Statbel (CC BY 4.0)                              |
