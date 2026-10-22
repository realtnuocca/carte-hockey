# Cartes QC

App web installable (PWA) pour scanner tes cartes de hockey, les faire identifier par l'IA, valider la fiche et bâtir ta collection.

**Phase 1 : outil perso.** Objectif : scanner tes 300 cartes, avec au moins 80 % de fiches justes et 15 secondes ou moins par carte.

## Comment ça marche

```
Téléphone (app web)                 Supabase                          Claude
───────────────────                 ────────                          ──────
1. Photo recto + verso
   (réduite à 1024 px)  ──────────▶ fonction identify-card ─────────▶ lit la carte,
                                                            ◀──────── propose une fiche
2. Tu corriges et valides
3. Enregistrer          ──────────▶ photos → stockage « cartes »
                                    fiche  → table « cartes »
4. Ma collection        ◀────────── tes cartes seulement (sécurité par utilisateur)
5. Bouton eBay          ──────────▶ ventes complétées sur eBay.ca
```

- **GitHub** garde le code et héberge l'app gratuitement (GitHub Pages).
- **Supabase** garde tes photos, tes fiches et ton compte.
- **Claude** identifie la carte. Ta clé API reste cachée dans Supabase, jamais dans le téléphone.

## Structure

```
docs/                        l'app (HTML, CSS, JS) publiée sur GitHub Pages
  config.js                  ← à remplir avec tes clés Supabase
  app.js                     logique de l'app
  lib.js                     fonctions pures (testées)
supabase/
  migrations/001_init.sql    table, sécurité et stockage des photos
  functions/identify-card/   fonction qui appelle Claude
tests/lib.test.mjs           tests des fonctions pures
```

## Mise en route (environ 30 minutes, une seule fois)

### 1. Supabase

1. Crée un compte sur [supabase.com](https://supabase.com) et un nouveau projet (région : Canada si offerte, sinon la plus proche).
2. **SQL Editor** → colle le contenu de `supabase/migrations/001_init.sql` → **Run**.
3. **Project Settings → API** : note l'**URL du projet** et la clé **anon public**.

### 2. Clé API Claude

1. Crée une clé sur [console.anthropic.com](https://console.anthropic.com).
2. **Mets une limite de dépenses mensuelle** (par exemple 10 $). Avec le modèle Haiku, 300 cartes coûtent quelques cents.

### 3. Fonction d'identification

**Option simple (sans rien installer)** : dans Supabase, **Edge Functions → Deploy a new function → Via Editor**, nomme-la `identify-card`, colle le contenu de `supabase/functions/identify-card/index.ts`, puis déploie.

**Option ligne de commande** :

```bash
npm install -g supabase
supabase login
supabase link --project-ref TON-PROJET
supabase functions deploy identify-card
```

Dans les réglages de la fonction, mets **Verify JWT with legacy secret** à **OFF** : la fonction vérifie elle-même que la personne est connectée et autorisée.

Ensuite, **Edge Functions → Secrets** :
- `ANTHROPIC_API_KEY` = ta clé Claude
- `ALLOWED_EMAILS` = les courriels autorisés à scanner, séparés par des virgules. Sans ça, n'importe qui pourrait se créer un compte et dépenser tes crédits.
Optionnel : `CLAUDE_MODEL` = `claude-sonnet-5-5` si Haiku se trompe trop souvent (environ 20 fois plus cher).

### 4. GitHub

1. Crée un dépôt **public** nommé `carte-hockey` (GitHub Pages est gratuit pour un dépôt public).
2. **Add file → Upload files** : glisse le contenu du dossier décompressé (les dossiers `docs`, `supabase`, `tests` et les fichiers `README.md`, `package.json`). **Commit changes**.
3. **Settings → Pages → Build and deployment** : Source = **Deploy from a branch**, Branch = **main**, dossier = **/docs**. **Save**.
4. Après 1-2 minutes, ton app est à `https://TON-COMPTE.github.io/carte-hockey/`.

`docs/config.js` contient l'URL du projet et la clé **publishable** de Supabase. Elle est faite pour être publique : la sécurité vient des règles de la base et de la liste `ALLOWED_EMAILS`.

### 5. Connexion par courriel

Dans Supabase, **Authentication → URL Configuration** :
- **Site URL** : `https://TON-COMPTE.github.io/carte-hockey/`
- **Redirect URLs** : ajoute la même adresse.

### 6. Installer sur ton téléphone

- **iPhone (Safari)** : ouvre l'adresse → bouton Partager → **Sur l'écran d'accueil**.
- **Android (Chrome)** : ouvre l'adresse → menu ⋮ → **Installer l'application**.

Ouvre le lien de connexion reçu par courriel **sur le téléphone**, puis scanne ta première carte.

## Tester localement

```bash
cd docs && python3 -m http.server 8080
# puis http://localhost:8080 (la caméra demande https ou localhost)
node tests/lib.test.mjs
```

## Mesurer la phase 1

L'onglet **Ma collection** affiche le pourcentage de **fiches justes** : les cartes enregistrées sans aucune correction.
Le détail est aussi dans la vue SQL `stats_ia`. Chaque correction est conservée (`champs_corriges`), ce qui montre quels champs l'IA rate le plus.

## Conseils de scan

- Carte à plat, sur fond uni et foncé, sans reflet (évite la lumière directe sur les cartes brillantes).
- Toujours le verso : c'est là que sont l'année, la série et le numéro.
- Cartes en toploader : sors-les si le plastique fait des reflets.

## Prochaines phases

Voir le document « Étude de marché et feuille de route ». Ne pas commencer la phase 2 (prix automatiques) avant d'avoir passé la porte de la phase 1.
