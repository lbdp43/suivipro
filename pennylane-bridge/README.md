# Passerelle EasyBeer → Pennylane

Petit portail autonome qui fait communiquer **EasyBeer** (gestion commerciale / brasserie)
et **Pennylane** (comptabilité / facturation). Il synchronise les **clients**, les
**factures** et les **paiements** dans le sens **EasyBeer → Pennylane**, et fournit une
page de **réconciliation** pour repérer les écarts et les impayés.

> Programme **zéro dépendance** : il tourne avec Node.js seul (≥ 20), sans `npm install`.
> Serveur HTTP natif, `fetch` natif, stockage dans un fichier JSON (`data/state.json`).

## Démarrage

```bash
cd pennylane-bridge
cp .env.example .env        # (optionnel) renseigner les secrets
node src/server.js          # démarre le portail sur http://localhost:4000
```

Puis ouvre **http://localhost:4000** et va dans l'onglet **Configuration** pour saisir :

- **EasyBeer** : URL API (`https://api.easybeer.fr`), identifiant, mot de passe (Basic auth).
- **Pennylane** : URL API (`https://app.pennylane.com/api/external/v2`) et **token API** (Bearer).
- **Options** : finaliser les factures ou les laisser en brouillon, pays/devise par défaut,
  intervalle de synchro automatique, secret de webhook.

La config peut aussi venir des **variables d'environnement** (voir `.env.example`),
qui sont **prioritaires** sur la config saisie dans l'interface (pratique en production).

## Utilisation

### Interface web
- **Synchronisation** : boutons Clients / Factures / Paiements / Tout, avec filtre « depuis le ».
- **Réconciliation** : compare EasyBeer et Pennylane et liste :
  - factures absentes de Pennylane,
  - écarts de montant,
  - factures payées dans EasyBeer mais pas encore reportées dans Pennylane,
  - factures impayées en retard.
- **État & logs** : factures déjà synchronisées et journal des opérations.

### En ligne de commande
```bash
node src/cli.js test          # teste les deux connexions
node src/cli.js clients       # synchro clients
node src/cli.js invoices      # synchro factures
node src/cli.js payments      # synchro paiements
node src/cli.js all           # tout (clients → factures → paiements)
node src/cli.js reconcile     # rapport de réconciliation (JSON)
# argument optionnel : une date ISO de départ, ex : node src/cli.js invoices 2026-01-01
```

### Webhook EasyBeer (synchro temps réel, optionnel)
Configure dans EasyBeer un webhook pointant vers :
```
POST http://<ton-hote>:4000/api/webhook/easybeer/<WEBHOOK_SECRET>
```
À réception, la passerelle relance une synchro factures + paiements.

## Architecture

```
src/
  config.js     résolution config (env > fichier)
  store.js      persistance JSON (config, correspondances, logs)
  easybeer.js   client API EasyBeer + extraction défensive des champs
  pennylane.js  client API Pennylane v2
  mapper.js     ⇐ POINT UNIQUE de mapping EasyBeer → Pennylane
  sync.js       orchestration (clients, factures, paiements, réconciliation)
  server.js     serveur HTTP + API REST + webhook + poller
  cli.js        synchro en ligne de commande
public/         interface web (HTML/CSS/JS)
```

Les correspondances `EasyBeer ↔ Pennylane` sont stockées localement (par
`external_reference = easybeer:...`), ce qui évite les doublons même si l'API est
ré-interrogée.

## À vérifier / ajuster lors du premier vrai test

Les API EasyBeer et Pennylane acceptent des structures variables selon les comptes.
Tout ce qui peut nécessiter un ajustement est **centralisé dans `src/mapper.js`** :

- **Taux de TVA** (`vat_rate`) : ici envoyé en pourcentage (`"20.0"`). Selon ton compte
  Pennylane, un code (ex. `FR_200`) ou un `product_id` peut être attendu.
- **Structure de l'adresse client** Pennylane (`address`/`postal_code`/`city` vs objet imbriqué).
- **Endpoint des paiements** : `sync.js` tente `POST /customer_invoices/{id}/payments`
  puis bascule sur `PUT /customer_invoices/{id}/mark_as_paid`. Adapte si ton compte diffère.
- **Chemins de liste EasyBeer** (`easybeer.js`) : plusieurs candidats sont essayés
  (`/ventes/factures`, `/factures`, …). Ajoute le bon si nécessaire.

Lance d'abord `node src/cli.js test`, puis une synchro **avec un filtre de date récent**
pour valider sur un petit volume avant un import complet. Préfère l'option
« factures en brouillon » au départ pour pouvoir vérifier dans Pennylane avant finalisation.
```
