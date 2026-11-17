# AORA GROUP — Site officiel

Catalogue indépendant des applications AORA GROUP et site de présentation du studio.

## Stack
- Site public : HTML, CSS et JavaScript vanilla, hébergé sur Cloudflare Pages.
- API : Cloudflare Worker `aora-group`.
- Catalogue : table `public.apps` dans Supabase.
- Fichiers : bucket public Supabase Storage `aoragroup` (50 MiB maximum par fichier).

## Catalogue et téléchargements
Les visiteurs consultent uniquement les applications dont le statut est `published` sur la page d'accueil. Les boutons de téléchargement utilisent les fichiers publiés dans le bucket `aoragroup`.

Pour publier une application :
1. Ouvrir l'URL privée du tableau de bord : `/aora-control-7f3c9.html`.
2. Se connecter avec le secret Cloudflare `ADMIN_TOKEN`.
3. Renseigner le nom, l'identifiant (slug), la version, la plateforme et la description.
4. Ajouter le fichier APK/ZIP (50 MiB maximum) et, facultativement, l'URL de l'icône.
5. Choisir « Publier sur le site », puis enregistrer. Un brouillon reste invisible au public.

Le chemin du tableau de bord n'est pas un mécanisme d'authentification : l'API exige toujours un mot de passe secret puis une session signée valable 8 heures. Le jeton de session est conservé dans `sessionStorage` et expire automatiquement.

## Secrets Cloudflare Worker
Configurer dans **Workers & Pages → aora-group → Settings → Variables and Secrets** :
- `SUPABASE_SERVICE_ROLE_KEY` : secret serveur Supabase (ne jamais l'exposer au navigateur).
- `ADMIN_TOKEN` : mot de passe administrateur long et aléatoire.

Variables non secrètes :
- `SUPABASE_URL` : URL du projet Supabase.
- `ALLOWED_ORIGIN` : idéalement l'origine exacte du site public au lieu de `*`.

Le fichier `worker/wrangler.toml` conserve les variables du tableau de bord avec `keep_vars = true`. Les valeurs secrètes ne sont jamais enregistrées dans Git.

## Base de données
La table `public.apps` a été créée dans le projet Supabase. RLS est activé et les privilèges directs `anon` et `authenticated` sont révoqués. Les opérations de catalogue passent par le Worker avec la clé serveur.

Champs principaux : `slug`, `name`, `description`, `version`, `platform`, `category`, `status`, `storage_path`, `icon_url`, `file_size`, `published_at`.

## Routes API
- `GET /api/health` : contrôle de connexion au bucket Storage.
- `GET /api/apps` : catalogue public publié.
- `POST /api/admin/login` : ouverture d'une session administrateur.
- `GET /api/admin/apps` : liste privée.
- `POST /api/admin/apps` : création.
- `PUT /api/admin/apps/:id` : modification.
- `DELETE /api/admin/apps/:id` : suppression de l'entrée du catalogue.
- `POST /api/upload?slug=<slug>&name=<filename>` : téléversement protégé.

## Développement local
Ouvrir `index.html` avec un serveur statique. Le site public appelle l'API Worker hébergée ; le tableau de bord privé est exclu de la navigation publique et des moteurs de recherche.
