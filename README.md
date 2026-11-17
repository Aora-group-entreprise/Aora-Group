# AORA GROUP — Site officiel

Site vitrine et futur catalogue indépendant des applications AORA GROUP.

## Stack
- HTML, CSS et JavaScript vanilla
- Cloudflare Pages pour l'hébergement du site
- Cloudflare Worker pour l'accès sécurisé au stockage
- Backblaze B2 (bucket privé `aoragroup`) pour les APK, images, logos et autres fichiers

## Applications initiales
- Yuniko
- i-tafa

Les applications sont présentées comme « en préparation » tant que les liens et fichiers de téléchargement officiels ne sont pas publiés.

## Développement local
Ouvrir simplement `index.html` dans un navigateur ou lancer un serveur statique depuis la racine du projet.

## Structure
- `index.html` : pages et contenu
- `styles.css` : design responsive
- `app.js` : navigation et interactions
- `assets/aora-mark.svg` : symbole temporaire du site
- `worker/` : passerelle Cloudflare Worker vers Backblaze B2

## Stockage
Voir [worker/README.md](worker/README.md) pour ajouter les secrets Cloudflare, déployer le Worker et tester l'envoi/la récupération des fichiers.

Aucun secret Backblaze ne doit être enregistré dans ce dépôt ou dans le JavaScript public du site.
