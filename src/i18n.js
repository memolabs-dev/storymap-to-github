// Storymap to GitHub in English and French. Texts are written in English in
// the code and translated when shown: t('Sign out') looks the English text up
// in FR and falls back to it when a translation is missing. Plain JS with no
// Figma API, so main.ts, ui.tsx, core.js and the tests share it. Types are in
// i18n.d.ts.

let lang = 'en';

export function setLang(l) {
  lang = l === 'fr' ? 'fr' : 'en';
}

export function getLang() {
  return lang;
}

// The language to show: the person's choice, or the system's when automatic.
export function resolveLang(setting, navigatorLanguage) {
  if (setting === 'en' || setting === 'fr') return setting;
  return /^fr/i.test(navigatorLanguage || '') ? 'fr' : 'en';
}

// t('Create the issue'), t('Use {repo}', { repo }). `context` tells apart two
// texts that are the same in English and not in French, such as "New".
export function t(en, vars, context) {
  const text = (lang === 'fr' && (FR[context ? `${context}:${en}` : en] || FR[en])) || en;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text;
}

// plural(3, '{n} epic', '{n} epics'): "3 epics", "3 épopées". In French, 0 and
// 1 take the singular.
export function plural(n, one, many, vars = {}) {
  const single = lang === 'fr' ? n < 2 : n === 1;
  return t(single ? one : many, { ...vars, n });
}

// French, keyed by the English text. A regular space before : ; ? ! » or
// after « is turned into a non-breaking one below, as French typography wants.
const FR = {
  // Tabs, kinds, fields
  Map: 'Carte',
  Differences: 'Écarts',
  Reading: 'Lecture',
  Epic: 'Épopée',
  Feature: 'Fonctionnalité',
  Step: 'Étape',
  Task: 'Tâche',
  Note: 'Note',
  Ignore: 'Ignorer',
  Size: 'Taille',
  Status: 'Statut',
  Milestone: 'Jalon',
  Title: 'Titre',
  Type: 'Type',
  Parent: 'Parent',
  Labels: 'Labels',
  'board:Labels': 'Étiquettes',
  Assignees: 'Assignés',
  None: 'Aucun',
  'size:None': 'Aucune',
  Open: 'Ouverte',
  Closed: 'Fermée',
  New: 'Nouvelle',
  'sticky:New': 'Nouveau',
  Reopened: 'Rouverte',
  Changed: 'Modifiée',
  'Dropped on GitHub': 'Abandonnée sur GitHub',
  'Planned too late': 'Prévue trop tard',

  // Sticky colours, after "de couleur"
  red: 'rouge',
  orange: 'orange',
  yellow: 'jaune',
  green: 'verte',
  teal: 'bleu canard',
  blue: 'bleue',
  violet: 'violette',
  pink: 'rose',
  white: 'blanche',
  gray: 'grise',

  // Figma node types, in the Reading tab
  '{n} sticky': '{n} post-it',
  '{n} stickies': '{n} post-its',
  '{n} shape with text': '{n} forme avec texte',
  '{n} shapes with text': '{n} formes avec texte',
  '{n} section': '{n} section',
  '{n} sections': '{n} sections',
  '{n} connector': '{n} connecteur',
  '{n} connectors': '{n} connecteurs',
  '{n} text': '{n} texte',
  '{n} texts': '{n} textes',
  '{n} other element': '{n} autre élément',
  '{n} other elements': '{n} autres éléments',

  // Counts
  '{n} epic': '{n} épopée',
  '{n} epics': '{n} épopées',
  '{n} feature': '{n} fonctionnalité',
  '{n} features': '{n} fonctionnalités',
  '{n} task': '{n} tâche',
  '{n} tasks': '{n} tâches',
  '{n} issue': '{n} issue',
  '{n} issues': '{n} issues',
  '{n} sticky': '{n} post-it',
  '{n} stickies': '{n} post-its',
  '{n} {hue} sticky': '{n} post-it de couleur {hue}',
  '{n} {hue} stickies': '{n} post-its de couleur {hue}',
  '{n} open issue': '{n} issue ouverte',
  '{n} open issues': '{n} issues ouvertes',
  '{n} issue moved': '{n} issue a bougé',
  '{n} issues moved': '{n} issues ont bougé',
  'just now': "à l'instant",
  '{n} min ago': 'il y a {n} min',
  '{n} h ago': 'il y a {n} h',

  // Board reading (core.js)
  'Still on the map': 'Toujours sur la carte',
  'Closed as not planned': 'Fermée comme non prévue',
  'Closed as duplicate': 'Fermée comme doublon',
  '{release}, due {date}': '{release}, échéance le {date}',
  '{sprint}, ends {end}': '{sprint}, se termine le {end}',
  'No release row': 'Aucune ligne de release',
  'No milestone': 'Aucun jalon',
  'Under {numbers}': 'Sous {numbers}',
  ' or ': ' ou ',
  'Under #{n} {title}': 'Sous #{n} {title}',
  'Under #{n}': 'Sous #{n}',
  'No parent issue': 'Aucune issue parente',
  someone: "quelqu'un",
  '{when}, {who} renamed it from "{from}" to "{to}"': "{when}, {who} l'a renommée de « {from} » en « {to} »",
  '{when}, {who} set the milestone to {milestone}': '{when}, {who} a mis le jalon {milestone}',
  '{when}, {who} removed the milestone {milestone}': '{when}, {who} a retiré le jalon {milestone}',
  '{when}, {who} set its parent issue': '{when}, {who} lui a donné une issue parente',
  '{when}, {who} removed its parent issue': '{when}, {who} a retiré son issue parente',
  '{when}, {who} closed it with commit {commit}': "{when}, {who} l'a fermée avec le commit {commit}",
  '{when}, {who} closed it': "{when}, {who} l'a fermée",
  '{when}, {who} reopened it': "{when}, {who} l'a rouverte",
  'Epic: {title}': 'Épopée : {title}',
  'Feature: {title}': 'Fonctionnalité : {title}',
  'Step: {title}': 'Étape : {title}',
  'Task: {title}': 'Tâche : {title}',
  'Sub-task: {title}': 'Sous-tâche : {title}',
  'Milestones: {list}': 'Jalons : {list}',
  '"{title}" is not on GitHub yet: publish it first to make this issue its sub-issue.':
    "« {title} » n'est pas encore sur GitHub : publiez-la d'abord pour faire de cette issue sa sous-issue.",
  'No milestone on GitHub matches the release "{release}": the issue will have none.':
    "Aucun jalon sur GitHub ne correspond à la release « {release} » : l'issue n'en aura pas.",
  'User Persona': 'Persona',
  'Who uses the product, and what they need': 'Qui utilise le produit, et ce dont il a besoin',
  Activities: 'Activités',
  'An activity: something the persona does': 'Une activité : quelque chose que fait le persona',
  Tasks: 'Tâches',
  'A task within that activity': 'Une tâche dans cette activité',
  'A first story to build': 'Une première story à construire',
  'A story for later': 'Une story pour plus tard',

  // Roles
  'Product manager': 'Product manager',
  'Tech lead': 'Tech lead',
  Everyone: 'Tout le monde',
  'This change is for the product manager.': 'Ce changement revient au product manager.',
  'This change is for the tech lead.': 'Ce changement revient au tech lead.',
  'This change is for everyone.': 'Ce changement est ouvert à tout le monde.',
  'set by the product manager': 'posée par le product manager',
  'set by the tech lead': 'posée par le tech lead',
  'set by everyone': 'posée par tout le monde',
  'Create issues': 'Créer des issues',
  'Set sizes': 'Poser les tailles',
  'Rename issues': 'Renommer les issues',
  'Set milestones': 'Poser les jalons',
  'Move under a parent': 'Ranger sous un parent',
  'On this board, that change is for the product manager. Change your role or the split in the GitHub tab.':
    "Sur ce tableau, ce changement revient au product manager. Changez votre rôle ou la répartition dans l'onglet GitHub.",
  'On this board, that change is for the tech lead. Change your role or the split in the GitHub tab.':
    "Sur ce tableau, ce changement revient au tech lead. Changez votre rôle ou la répartition dans l'onglet GitHub.",

  // Status messages (main.ts)
  'Connect a repository first.': "Connectez d'abord un dépôt.",
  'A new week starts now: changes from here on show in Differences.':
    "Une nouvelle semaine commence : les changements à partir de maintenant s'affichent dans Écarts.",
  'This difference is already settled.': 'Cet écart est déjà réglé.',
  'Keeping both…': 'On garde les deux…',
  'Changing the sticky…': 'Modification du post-it…',
  'Changing #{n} on GitHub…': 'Modification de #{n} sur GitHub…',
  'The sticky is not on this page.': "Le post-it n'est pas sur cette page.",
  'Kept as it is: #{n} will not show here again unless it changes.': "Gardé tel quel : #{n} ne s'affichera plus ici, sauf si elle change.",
  'Only a title can be taken from GitHub onto the map.': 'Seul un titre peut passer de GitHub à la carte.',
  'The sticky now reads "{title}".': 'Le post-it indique maintenant « {title} ».',
  'Changes to {repo} are not allowed. Turn them on in the GitHub tab.': "Les changements dans {repo} ne sont pas autorisés. Activez-les dans l'onglet GitHub.",
  'GitHub refused the change ({status}).': 'GitHub a refusé le changement ({status}).',
  '#{n} is now "{title}".': "#{n} s'appelle maintenant « {title} ».",
  'No milestone on GitHub matches "{release}". Create it on GitHub first.': "Aucun jalon sur GitHub ne correspond à « {release} ». Créez-le d'abord sur GitHub.",
  '#{n} is now in {milestone}.': '#{n} est maintenant dans {milestone}.',
  '#{n} has no milestone now.': "#{n} n'a plus de jalon.",
  'GitHub answered {status} for #{n}.': 'GitHub a répondu {status} pour #{n}.',
  'GitHub refused to move #{n} under #{parent} ({status}).': 'GitHub a refusé de ranger #{n} sous #{parent} ({status}).',
  '#{n} is now under #{parent}.': '#{n} est maintenant sous #{parent}.',
  'This difference is settled on GitHub by hand: open the issue.': "Cet écart se règle à la main sur GitHub : ouvrez l'issue.",
  'Enter the repository as owner/name.': 'Saisissez le dépôt sous la forme propriétaire/nom.',
  'Repository {repo} not found, or private without a token.': 'Dépôt {repo} introuvable, ou privé sans jeton.',
  'GitHub refused the token.': 'GitHub a refusé le jeton.',
  'GitHub rate limit reached. Add a token or retry later.': 'Limite de requêtes GitHub atteinte. Ajoutez un jeton ou réessayez plus tard.',
  'GitHub answered {status}.': 'GitHub a répondu {status}.',
  'Paste the project board address, like https://github.com/orgs/acme/projects/12.':
    "Collez l'adresse du tableau de projet, par exemple https://github.com/orgs/acme/projects/12.",
  'Reading sprints needs a token that can read projects (classic token: read:project).':
    'Lire les sprints demande un jeton qui peut lire les projets (jeton classique : read:project).',
  'Could not read the project board: {error}': 'Impossible de lire le tableau de projet : {error}',
  'Could not read the project board.': 'Impossible de lire le tableau de projet.',
  'Added to the board, without status: it has no "{status}" status.': "Ajoutée au tableau, sans statut : il n'a pas de statut « {status} ».",
  'Added to the board, without status: it has no Status field.': "Ajoutée au tableau, sans statut : il n'a pas de champ Status.",
  'Added to the board in {status}.': 'Ajoutée au tableau dans {status}.',
  'The project board has no size field.': "Le tableau de projet n'a pas de champ de taille.",
  'The board has no size "{size}".': "Le tableau n'a pas de taille « {size} ».",
  '#{n} is now size {size}.': '#{n} a maintenant la taille {size}.',
  '#{n} has no size now.': "#{n} n'a plus de taille.",
  'Publishing needs a token that can write issues.': 'Publier demande un jeton qui peut écrire des issues.',
  'Compare with GitHub first.': "Comparez d'abord avec GitHub.",
  'This sticky is already an issue.': 'Ce post-it est déjà une issue.',
  'Creating "{title}" in {repo}…': 'Création de « {title} » dans {repo}…',
  'GitHub refused the issue ({status}: {detail}).': "GitHub a refusé l'issue ({status} : {detail}).",
  'GitHub refused the issue ({status}).': "GitHub a refusé l'issue ({status}).",
  '#{n} created.': '#{n} créée.',
  'Sub-issue of #{n}.': 'Sous-issue de #{n}.',
  'not made a sub-issue of #{n} (GitHub answered {status})': 'pas rangée en sous-issue de #{n} (GitHub a répondu {status})',
  'not added to the board ({error})': 'pas ajoutée au tableau ({error})',
  '{note} But {problems}.': '{note} Mais {problems}.',
  'Creating {n} of {total}…': 'Création {n} sur {total}…',
  '{n} issue created ({list}), then stopped: {error}': '{n} issue créée ({list}), puis arrêt : {error}',
  '{n} issues created ({list}), then stopped: {error}': '{n} issues créées ({list}), puis arrêt : {error}',
  'Stopped: {error}': 'Arrêt : {error}',
  '{n} issue created: {list}.': '{n} issue créée : {list}.',
  '{n} issues created: {list}.': '{n} issues créées : {list}.',
  'GitHub did not start the sign-in ({error}).': "GitHub n'a pas lancé la connexion ({error}).",
  'no answer': 'pas de réponse',
  'Sign-in was cancelled on GitHub.': 'La connexion a été annulée sur GitHub.',
  'GitHub stopped the sign-in ({error}).': 'GitHub a arrêté la connexion ({error}).',
  'The code expired. Start again.': 'Le code a expiré. Recommencez.',
  'GitHub refused this token.': 'GitHub a refusé ce jeton.',
  'Reading issues of {repo}…': 'Lecture des issues de {repo}…',
  '{n} issue read from {repo}.': '{n} issue lue dans {repo}.',
  '{n} issues read from {repo}.': '{n} issues lues dans {repo}.',
  'Sprints read from "{board}" ({n}).': 'Sprints lus depuis « {board} » ({n}).',
  'Sprints not read: {error}': 'Sprints non lus : {error}',
  'Signed out. The token is forgotten on this computer.': 'Déconnecté. Le jeton est oublié sur cet ordinateur.',

  // Getting started guide
  'Get started · {n} of {total}': 'Pour commencer · {n} sur {total}',
  'Hide the guide': 'Masquer le guide',
  'Check how the board is read': 'Vérifier la lecture du tableau',
  "Read by rows, as in Figma's story map template: {counts}": 'Lu par lignes, comme dans le modèle de story map de Figma : {counts}',
  'Read by sticky colours: {counts}': 'Lu par couleurs de post-it : {counts}',
  ', releases {list}.': ', releases {list}.',
  ', no releases.': ', aucune release.',
  "That's right": "C'est bon",
  Adjust: 'Ajuster',
  'Connect GitHub': 'Connecter GitHub',
  'Connected to {repo}, updated {ago}.': 'Connecté à {repo}, mis à jour {ago}.',
  'Connected to {repo}.': 'Connecté à {repo}.',
  "Name the repository where the team's issues live. The plugin reads them again every time it opens.":
    "Indiquez le dépôt où vivent les issues de l'équipe. Le plugin les relit à chaque ouverture.",
  Connect: 'Connecter',
  'Link your stickies to their issues': 'Lier vos post-its à leurs issues',
  '{n} of {total} linked.': '{n} sur {total} liés.',
  'Click a sticky on the board: its card shows the issues it most likely is.':
    'Cliquez sur un post-it du tableau : sa fiche propose les issues qui lui correspondent le plus probablement.',
  'Show labels on the board': 'Afficher les étiquettes sur le tableau',
  'Labels on the board': 'Étiquettes sur le tableau',
  'Once connected, each linked sticky can show its issue number, sprint and status.':
    'Une fois connecté, chaque post-it lié peut afficher le numéro, le sprint et le statut de son issue.',
  Guide: 'Guide',

  // Map tab and card
  'Reading the board…': 'Lecture du tableau…',
  '{tip}. Click to change.': '{tip}. Cliquez pour changer.',
  'Linked to: {title}': 'Lié à : {title}',
  'Same title as: {title}': 'Même titre que : {title}',
  'Close to: {title}': 'Proche de : {title}',
  'Marked as not on GitHub yet': 'Marqué comme pas encore sur GitHub',
  'Marked as not on GitHub yet.': 'Marqué comme pas encore sur GitHub.',
  'No issue with a close title': 'Aucune issue au titre proche',
  'size {size}': 'taille {size}',
  '{kind}: {title}': '{kind} : {title}',
  'Steps: {list}': 'Étapes : {list}',
  'Not part of the map': 'Hors de la carte',
  Close: 'Fermer',
  'This node is a label, a legend sticky, or a colour or row the map ignores. Change that in Reading.':
    'Cet élément est une étiquette, un post-it de légende, ou une couleur ou une ligne que la carte ignore. Changez cela dans Lecture.',
  '{kind} in {parent}': '{kind} dans {parent}',
  'Steps are written in their feature, not as issues.': "Les étapes s'écrivent dans leur fonctionnalité, pas en issues.",
  'Notes stay on the board, not on GitHub.': 'Les notes restent sur le tableau, pas sur GitHub.',
  'Connect a repository in': 'Connectez un dépôt dans',
  "to see this sticky's issue.": "pour voir l'issue de ce post-it.",
  'no one assigned': "personne n'est assigné",
  'No size': 'Sans taille',
  'Not this issue': 'Pas cette issue',
  'Already on GitHub? Pick its issue': 'Déjà sur GitHub ? Choisissez son issue',
  'Same title': 'Même titre',
  'Words in common: {words}': 'Mots en commun : {words}',
  'No issue has a close title.': "Aucune issue n'a de titre proche.",
  'Search another issue': 'Chercher une autre issue',
  'None of these': 'Aucune de celles-ci',
  'Guess from the title': "Deviner d'après le titre",
  'label "{label}" (no {type} type here)': 'label « {label} » (pas de type {type} ici)',
  '{title}, not on GitHub yet': '{title}, pas encore sur GitHub',
  'On the board': 'Sur le tableau',
  'Added, without status': 'Ajoutée, sans statut',
  'Not yet? Create its issue in {repo}': 'Pas encore ? Créez son issue dans {repo}',
  'Story and acceptance criteria': "Story et critères d'acceptation",
  'Create the issue': "Créer l'issue",
  'Changes to {repo} are off. Allow them in': 'Les changements dans {repo} sont désactivés. Autorisez-les dans',
  'to publish from here.': "pour publier d'ici.",
  'No story map on this page': 'Aucune story map sur cette page',
  "Start one from a template, laid out like Figma's story map: a row for the persona, the activities, the tasks and two releases. Or open the page that holds your map; check Reading if it uses other colours or rows.":
    "Commencez-en une à partir d'un modèle, disposé comme la story map de Figma : une ligne pour le persona, les activités, les tâches et deux releases. Ou ouvrez la page qui contient votre carte ; vérifiez Lecture si elle utilise d'autres couleurs ou lignes.",
  'Add a story map template': 'Ajouter un modèle de story map',
  "Show each linked sticky's issue, sprint and status on the board": "Afficher sur le tableau l'issue, le sprint et le statut de chaque post-it lié",
  '{n} of {total} stickies linked to an issue': '{n} post-its sur {total} liés à une issue',
  '{n} of {total} linked to GitHub': '{n} sur {total} liés à GitHub',
  'All releases': 'Toute release',
  'No release': 'Sans release',
  'All sprints': 'Tous les sprints',
  '{sprint} · ends {date}': '{sprint} · fin le {date}',
  'Not in a sprint': 'Hors sprint',
  'All statuses': 'Tous les statuts',
  'No task matches these filters.': 'Aucune tâche ne correspond à ces filtres.',
  'Show everything': 'Tout afficher',
  'Not on GitHub yet': 'Pas encore sur GitHub',
  '{n} colour not read yet. Set it in': '{n} couleur pas encore lue. Réglez-la dans',
  '{n} colours not read yet. Set them in': '{n} couleurs pas encore lues. Réglez-les dans',
  '{n} item has no parent column. It is listed at the bottom.': "{n} élément n'a pas de colonne parente. Il est listé en bas.",
  '{n} items have no parent column. They are listed at the bottom.': "{n} éléments n'ont pas de colonne parente. Ils sont listés en bas.",
  'Notes, not issues': 'Notes, pas des issues',
  'Without a parent': 'Sans parent',

  // Differences tab
  'Rename the issue': "Renommer l'issue",
  'Set milestone {m}': 'Mettre le jalon {m}',
  'Remove the milestone': 'Retirer le jalon',
  'Move under #{n}': 'Ranger sous #{n}',
  'The map is right: change GitHub': 'La carte a raison : changer GitHub',
  'To change GitHub from here, choose Can write in GitHub.': "Pour changer GitHub d'ici, choisissez Peut écrire dans GitHub.",
  'GitHub is right: change the sticky': 'GitHub a raison : changer le post-it',
  'Rename the sticky': 'Renommer le post-it',
  'Both are right: stop showing this difference': 'Les deux ont raison : ne plus afficher cet écart',
  'Keep both': 'Garder les deux',
  'Looks like #{n} {title}. Open the card to link it.': 'Ressemble à #{n} {title}. Ouvrez la fiche pour le lier.',
  'To create these as issues in one go, choose Can write in GitHub.': "Pour les créer en issues d'un coup, choisissez Peut écrire dans GitHub.",
  "Tick the stickies to create as issues: they are created parents first, each with the repository's issue text. The ones marked #? look like an issue that exists: open their card to link them instead.":
    "Cochez les post-its à créer en issues : ils sont créés parents d'abord, chacun avec le texte d'issue du dépôt. Ceux marqués #? ressemblent à une issue existante : ouvrez leur fiche pour les lier à la place.",
  'Ticks every sticky that looks like no existing issue': 'Coche chaque post-it qui ne ressemble à aucune issue existante',
  'Tick the new ones': 'Cocher les nouveaux',
  'Tick none': 'Tout décocher',
  'Create {n} issue': 'Créer {n} issue',
  'Create {n} issues': 'Créer {n} issues',
  'What moved this week?': "Qu'est-ce qui a bougé cette semaine ?",
  'Mark the start of the week, at the weekly for example: from then on, the issues that are created, closed or change status, sprint, size or title show here, for the whole team.':
    "Marquez le début de la semaine, à la réunion hebdo par exemple : à partir de là, les issues créées, fermées ou qui changent de statut, de sprint, de taille ou de titre s'affichent ici, pour toute l'équipe.",
  'Start the week now': 'Démarrer la semaine',
  'Since {date}': 'Depuis le {date}',
  'nothing moved': "rien n'a bougé",
  'Show its sticky': 'Montrer son post-it',
  'Not on the map: open on GitHub': 'Pas sur la carte : ouvrir sur GitHub',
  'Compare against this moment from now on': 'Comparer désormais à ce moment',
  'Start a new week': 'Nouvelle semaine',
  'Connect a repository first': "Connectez d'abord un dépôt",
  In: 'Dans',
  ', sign in and pick the repository of this map.': ', connectez-vous et choisissez le dépôt de cette carte.',
  'One place where the map and GitHub disagree. Pick which side is right; nothing changes until you do.':
    "Un endroit où la carte et GitHub divergent. Choisissez le côté qui a raison ; rien ne change tant que vous ne l'avez pas fait.",
  '{n} places where the map and GitHub disagree. Pick which side is right; nothing changes until you do.':
    "{n} endroits où la carte et GitHub divergent. Choisissez le côté qui a raison ; rien ne change tant que vous ne l'avez pas fait.",
  'The linked stickies and their issues agree.': 'Les post-its liés et leurs issues concordent.',
  'Why?': 'Pourquoi ?',
  'Reading the history…': "Lecture de l'historique…",
  'No change recorded on GitHub: it has differed since the issue was written.':
    "Aucun changement enregistré sur GitHub : l'écart existe depuis l'écriture de l'issue.",
  'Close titles to confirm': 'Titres proches à confirmer',
  'On the map only': 'Seulement sur la carte',
  'On GitHub only': 'Seulement sur GitHub',

  // Reading tab
  Automatic: 'Automatique',
  'By rows': 'Par lignes',
  'By colours': 'Par couleurs',
  "Read by rows, as in Figma's story map template: each labelled row gives the kind of the stickies in it. Release rows become milestones.":
    "Lu par lignes, comme dans le modèle de story map de Figma : chaque ligne nommée donne le type des post-its qu'elle contient. Les lignes de release deviennent des jalons.",
  'Read by colours: each sticky colour gives one kind of item.': "Lu par couleurs : chaque couleur de post-it donne un type d'élément.",
  'Chosen automatically.': 'Choisi automatiquement.',
  ', milestone': ', jalon',
  'Read on this page: {types}.': 'Lu sur cette page : {types}.',
  nothing: 'rien',
  '{n} sticky skipped (legend, labels, empty or ignored).': '{n} post-it écarté (légende, étiquette, vide ou ignoré).',
  '{n} stickies skipped (legend, labels, empty or ignored).': '{n} post-its écartés (légende, étiquettes, vides ou ignorés).',

  // GitHub tab
  '1. Your GitHub account': '1. Votre compte GitHub',
  'Connected as': 'Connecté en tant que',
  'Sign out': 'Se déconnecter',
  'The plugin can read and change issues in the repositories your account can reach; it only writes where you choose "Can write". Signing out forgets the token here; revoke it on':
    "Le plugin peut lire et modifier les issues des dépôts que votre compte atteint ; il n'écrit que là où vous choisissez « Peut écrire ». Se déconnecter oublie le jeton ici ; révoquez-le sur",
  'Enter this code on GitHub, then authorize Storymap to GitHub.': 'Saisissez ce code sur GitHub, puis autorisez Storymap to GitHub.',
  'Code copied, opening GitHub': 'Code copié, ouverture de GitHub',
  'Copy the code and open GitHub': 'Copier le code et ouvrir GitHub',
  Cancel: 'Annuler',
  'Waiting for GitHub…': 'En attente de GitHub…',
  'Connected with a token': 'Connecté avec un jeton',
  'Forget it': "L'oublier",
  'Connect with GitHub': 'Se connecter avec GitHub',
  'Or paste a token (classic: repo, project, read:org)': 'Ou collez un jeton (classique : repo, project, read:org)',
  'Use this token': 'Utiliser ce jeton',
  'Opens GitHub to approve, nothing to copy by hand.': 'Ouvre GitHub pour approuver, rien à copier à la main.',
  'Use a token instead': 'Utiliser un jeton à la place',
  '2. Repository': '2. Dépôt',
  Change: 'Changer',
  'Search {n} repository': 'Chercher parmi {n} dépôt',
  'Search {n} repositories': 'Chercher parmi {n} dépôts',
  'Loading your repositories…': 'Chargement de vos dépôts…',
  Private: 'Privé',
  'Use {repo}': 'Utiliser {repo}',
  'Keep {repo}': 'Garder {repo}',
  '3. Project board, for sprints and status': '3. Tableau de projet, pour les sprints et le statut',
  'Looking for the boards of {repo}…': 'Recherche des tableaux de {repo}…',
  'No board': 'Aucun tableau',
  'This repository has no board': "Ce dépôt n'a pas de tableau",
  '4. Your role': '4. Votre rôle',
  "The plugin only offers the changes of your role, so nobody changes someone else's field by mistake. Who does what is under More settings.":
    "Le plugin ne propose que les changements de votre rôle, pour que personne ne modifie par erreur le champ d'un autre. Qui fait quoi se règle dans Plus de réglages.",
  '5. What the plugin may do in {repo}': '5. Ce que le plugin peut faire dans {repo}',
  'Read only': 'Lecture seule',
  'Can write': 'Peut écrire',
  'The plugin can create issues, set sizes and settle differences, each after you click, and only the changes of your role.':
    'Le plugin peut créer des issues, poser les tailles et régler les écarts, chaque fois après votre clic, et seulement les changements de votre rôle.',
  'The plugin only reads GitHub. This is the default for every repository.': "Le plugin ne fait que lire GitHub. C'est le réglage par défaut de chaque dépôt.",
  'Your account cannot write to {repo}: creating issues will fail.': 'Votre compte ne peut pas écrire dans {repo} : la création des issues échouera.',
  'More settings': 'Plus de réglages',
  Language: 'Langue',
  'Who does what, for the whole team': "Qui fait quoi, pour toute l'équipe",
  'Label of a new issue (empty for none)': "Label d'une nouvelle issue (vide pour aucun)",
  "Status of a new issue on the project board (empty: the board's first status)":
    "Statut d'une nouvelle issue sur le tableau de projet (vide : le premier statut du tableau)",
  'Text of a new issue. {title}, {parent}, {release} and {steps} are filled in.': "Texte d'une nouvelle issue. {title}, {parent}, {release} et {steps} sont remplis.",
  'Back to the default text': 'Revenir au texte par défaut',

  // Header and footer
  'Change the repository': 'Changer de dépôt',
  'Page {name}': 'Page {name}',
  'updated {ago}': 'mis à jour {ago}',
  'Read the board and GitHub again': 'Relire le tableau et GitHub',
  'What the plugin may do on GitHub': 'Ce que le plugin peut faire sur GitHub',
  Copied: 'Copié',
  'Copy failed': 'Échec de la copie',
  'Copy Markdown': 'Copier en Markdown',
};

for (const key of Object.keys(FR)) FR[key] = FR[key].replace(/ ([:;?!»])/g, ' $1').replace(/« /g, '« ');

export { FR };
