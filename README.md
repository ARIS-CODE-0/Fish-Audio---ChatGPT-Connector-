# Fish Audio

Plugin personnel Fish Audio hébergé avec Sites. Le studio en français et le serveur MCP utilisent la même identité ChatGPT, les mêmes réglages et le même historique.

## Première utilisation

1. Ouvrir le studio avec le compte propriétaire et ajouter la clé API Fish Audio dans Réglages.
2. Chercher une voix, puis la sélectionner ou l’enregistrer par défaut.
3. Installer ou connecter le plugin depuis Plugins → Personal → Created by you.
4. Demander dans ChatGPT de générer une voix off à partir d’un texte.

Le modèle par défaut est `s2.1-pro-free`. Le propriétaire peut choisir `s2.1-pro` dans Réglages. Les limites et la facturation du compte Fish Audio s’appliquent. Le plugin n’est pas affilié à Fish Audio.

## Outils MCP

`get_status`, `list_voices`, `generate_voiceover`, `list_voiceovers`, `get_voiceover`.

HTTP stateless sur `/mcp`, compatible avec les versions MCP 2025-03-26 et 2025-06-18. Sites gère OAuth et l’authentification ; les appels de données exigent une identité de visiteur. Aucun compte n’est inféré à partir d’un token de service.

Chaque outil déclare OAuth dans `securitySchemes`. Sans identité vérifiée, le serveur renvoie HTTP 401 avec `WWW-Authenticate` et le signal `mcp/www_authenticate` attendu par ChatGPT. Après une mise à jour, actualiser la connexion si cette option est proposée, puis tester dans une nouvelle conversation avec Fish Audio sélectionné. Une publication réussie ne suffit pas à valider la connexion : vérifier d’abord un appel réel à `get_status`, puis une génération autorisée.

Le texte est limité à 1 500 caractères et le fichier à 16 Mo. Le format est MP3 192 kbps. `request_id` évite les doubles synthèses lors des relances ; une génération échouée ne repart jamais automatiquement. Les liens audio exigent l’identité du propriétaire, avec prise en charge des plages HTTP pour les lecteurs audio.

Les clés API sont chiffrées en AES-GCM, avec le compte comme données authentifiées. La clé de chiffrement est un secret Sites. Ni la clé Fish Audio ni celle de chiffrement ne sont enregistrées dans le dépôt.

## Variables de production

Configurer via Sites : `FISH_KEY_ENCRYPTION_SECRET` (secret : 32 octets en base64), `SITE_ORIGIN` (origine HTTPS du studio). Ne pas changer le secret de chiffrement sans migrer les clés existantes. Stockage : D1 `DB`, R2 `BUCKET`.

## Tester hors de ChatGPT et lire les logs

Ouvrir https://aris-voice.bushyberry1.chatgpt.site/diagnostic dans la session habituelle du studio. « Vérifier le plugin » appelle `/api/diagnostic/mcp` : `initialize`, `notifications/initialized`, `tools/list`, puis `get_status`. Cette route réutilise exactement le gestionnaire de `/mcp`, avec l’identité de visiteur vérifiée par Sites et un contrôle d’origine obligatoire. « Tester ma voix via le plugin » appelle `generate_voiceover` avec la voix et le modèle enregistrés, puis `get_voiceover`. C’est une vraie synthèse Fish Audio, soumise aux limites et au coût du modèle configuré.

L’URL externe `/mcp` utilise l’authentification OAuth des clients MCP. Une requête du navigateur avec seulement les cookies du studio peut recevoir HTTP 401 en texte brut avant d’atteindre le Worker. La page propose un test externe distinct et précise la route de chaque échange ; elle ne remplace pas la vérification de la connexion OAuth dans ChatGPT ou MCP Inspector.

La synthèse en cours est attachée à `waitUntil` pour continuer après une déconnexion du client, dans la limite Workers de 30 secondes après cette déconnexion. L’appel normal attend toujours le résultat. Si le MP3 a été stocké avant une interruption du dernier écrit D1, la lecture de l’essai récupère ce fichier sans relancer Fish Audio. Un essai interrompu sans fichier ne repart jamais automatiquement : la page permet de préparer explicitement un nouvel identifiant, puis le bouton de génération autorise la nouvelle synthèse. Le résultat audio et celui du test OAuth externe sont affichés séparément.

La page affiche les requêtes, les réponses, le statut HTTP, la durée et `X-Fish-Audio-Trace-Id`, et permet d’exporter ces échanges en JSON. Elle conserve le même `request_id` pendant la session de l’onglet pour éviter les doubles synthèses. Après un échec, lire l’erreur et vérifier l’historique avant de créer un autre essai. La page ne valide pas à elle seule l’installation du plugin dans ChatGPT : elle teste son serveur et ses outils.

Pour utiliser un client MCP indépendant sur un ordinateur avec Node.js :

```bash
npx @modelcontextprotocol/inspector@latest
```

Dans MCP Inspector, choisir le transport **Streamable HTTP** et l’URL `https://aris-voice.bushyberry1.chatgpt.site/mcp`. Lister les outils, puis appeler `get_status`. Les appels privés exigent le parcours OAuth proposé par Sites ; la clé Fish Audio enregistrée dans le studio n’est pas un jeton d’accès MCP. Si OAuth échoue, conserver le statut et l’erreur affichés. Ne pas injecter un identifiant utilisateur ou copier des cookies pour contourner la connexion.

La découverte peut aussi être testée en ligne de commande :

```bash
npx @modelcontextprotocol/inspector@latest --cli \
  https://aris-voice.bushyberry1.chatgpt.site/mcp \
  --transport http --method tools/list
```

Pour une synthèse autorisée, appeler `generate_voiceover` avec ces arguments en remplaçant `request_id` par un UUID créé une fois et conservé pour les relances :

```json
{"text":"Salut Aris. Ceci est un test de ma voix par défaut avec le plugin Fish Audio.","title":"Test du plugin Fish Audio","request_id":"UUID-DE-CET-ESSAI"}
```

Les logs serveur JSON portent `source: "fish-audio"` et les événements `mcp.request`, `mcp.response`, `fish.response` ou `fish.network_error`. Le même `trace_id` relie un appel MCP et la requête Fish Audio correspondante. Ils enregistrent uniquement l’outil ou la route, le statut, la durée et les codes d’erreur ; aucune clé, aucun cookie, aucun identifiant de compte et aucun texte à prononcer. Ils vont vers la sortie console du Worker : la page présente les échanges client, pas un accès aux logs internes de la plateforme.

## Vérification

`node --test tests/*.test.mjs` vérifie le chiffrement, l’isolation des comptes, les doublons, la gestion des refus Fish Audio, les plages audio et le protocole MCP avec SQLite réel et une API simulée. Les tests Workers utilisent workerd, D1 et R2 pour vérifier les réglages et les cinq outils MCP jusqu’au stockage MP3, ainsi que la corrélation des logs sans données sensibles. `node node_modules/typescript/bin/tsc --noEmit` vérifie les types. Le test d’une vraie voix off nécessite une clé Fish Audio du propriétaire.

## Références

- https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
- https://docs.fish.audio/api-reference/endpoint/model/list-models
- https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- https://github.com/modelcontextprotocol/inspector
- https://github.com/modelcontextprotocol/inspector/blob/main/clients/cli/README.md
