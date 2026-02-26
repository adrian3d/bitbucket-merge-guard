# Bitbucket Merge Guard — Firefox Addon

Protège contre les merges accidentels vers des branches inattendues sur Bitbucket Cloud.

## Fonctionnement

Dès qu'une page de PR Bitbucket est chargée, l'extension vérifie la branche de destination :

- **Branche non autorisée** → le bouton Merge devient rouge + une bannière d'avertissement s'affiche
- **Clic sur Merge** → une popup de confirmation bloque le merge si la branche n'est pas dans la liste
- **Branche autorisée ou aucune règle configurée** → comportement normal, aucun blocage

> Fail-open : si la branche de destination ne peut pas être déterminée (DOM non reconnu + API inaccessible), le merge est laissé passer sans blocage.

## Installation (mode développeur)

1. Ouvre Firefox et va sur `about:debugging`
2. Clique sur **Ce Firefox**
3. Clique sur **Charger un module complémentaire temporaire**
4. Sélectionne le fichier `manifest.json` dans ce dossier

L'extension reste active jusqu'au prochain redémarrage de Firefox.

## Configuration

### 1. Créer un API Token Bitbucket

1. Va sur [Bitbucket → Paramètres → API tokens](https://bitbucket.org/account/settings/api-tokens/)
2. Crée un token avec les scopes suivants :
   - **Pull requests : Read** — lire la branche de destination via l'API
   - **Repositories : Read** — lister les repos et branches dans les options
   - **Account : Read** — valider la connexion (`/2.0/user`)
   - **Workspace membership : Read** — lister les workspaces dans les options

3. Dans les options de l'extension (icône dans la barre → ⚙️) :
   - Renseigne ton **email du compte Atlassian** (visible dans *Personal settings → Email aliases*)
   - Colle le **token généré**
   - Clique sur **Tester la connexion** pour valider

> L'authentification utilise un Basic Auth : `base64(email:token)`, conformément à la documentation Bitbucket Cloud.

### 2. Configurer les branches autorisées

Depuis la page d'options, deux méthodes :

**Picker dynamique (recommandé)**
1. Clique sur **Charger** pour récupérer tes workspaces depuis l'API
2. Sélectionne un workspace → les repositories se chargent automatiquement
3. Sélectionne un repository → les branches se chargent avec un champ de recherche filtrable
4. Coche les branches vers lesquelles le merge est autorisé
5. Clique sur **Ajouter le repository**

**Saisie manuelle** (repli, section repliable)
- Format : `workspace/repo-slug` + branches séparées par des virgules
- Exemple : repo `monentreprise/mon-api`, branches `main, develop`

## Architecture

```
├── manifest.json                   # Manifest MV2 Firefox
├── content_scripts/
│   └── bitbucket.js                # Interception Merge + coloration + modal
├── background/
│   └── background.js               # Appels API Bitbucket + vérification des règles
├── options/
│   ├── options.html                # Page de configuration
│   └── options.js                  # Picker dynamique workspace/repo/branches
├── popup/
│   ├── popup.html                  # Popup icône barre d'outils
│   └── popup.js                    # Statut de l'extension sur la PR courante
└── icons/
    └── icon.svg
```

### Flux de vérification (content script)

```
Bouton Merge trouvé dans le DOM (MutationObserver)
        │
        ▼
Lecture branche destination
  ├─ DOM (data-qa / anchors /branch/) → rapide, sans auth
  └─ API Bitbucket (/pullrequests/{id}) → fallback si DOM échoue
        │
        ▼
Résultat mis en cache 30 s (par prId)
        │
        ├─ Branche autorisée → bouton intact, rien à faire
        └─ Branche non autorisée → bouton rouge + bannière + modal au clic
```
