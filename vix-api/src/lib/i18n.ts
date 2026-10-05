// Interface translations. English is the source; any missing string falls back to it.

const en = {
  'nav.dashboard': 'Dashboard',
  'nav.keys': 'API Keys',
  'nav.friends': 'Friends',
  'nav.extensions': 'Extensions',
  'nav.docs': 'Guides & Docs',
  'nav.settings': 'Settings',
  'nav.signout': 'Sign out',
  'nav.skip': 'Skip to main content',
  'nav.menu': 'Menu',
  'nav.search': 'Search or run a command',
  'landing.tagline': 'Build APIs in any language. Keep them online forever.',
  'landing.sub': 'Write endpoints in JavaScript, Python, Rust, Batch, Java, C# and 50+ more languages, test them in a built-in sandbox, and plug them into AI agents, Unity, Unreal, Godot, Roblox and every other engine.',
  'landing.start': 'Create a free account',
  'landing.signin': 'I already have an account',
  'auth.signin': 'Sign in',
  'auth.signup': 'Create account',
  'auth.username': 'Username',
  'auth.password': 'Password',
  'auth.confirm': 'Confirm password',
  'auth.noEmail': 'No email needed - just a username and password.',
  'auth.switchToSignup': "New here? Create an account",
  'auth.switchToSignin': 'Already have an account? Sign in',
  'auth.mismatch': 'The passwords do not match',
  'auth.show': 'Show password',
  'auth.hide': 'Hide password',
  'auth.remember': 'Your APIs, files and keys are saved to your account and stay online even when you sign out.',
  'dash.title': 'Your APIs',
  'dash.new': 'New API',
  'dash.empty': 'You have no APIs yet. Create one from a template to get started.',
  'dash.shared': 'Shared with you',
  'dash.live': 'Live',
  'dash.paused': 'Paused',
  'dash.endpoints': 'endpoints',
  'dash.filter': 'Filter APIs',
  'new.title': 'Create an API',
  'new.name': 'Name',
  'new.slug': 'URL name',
  'new.template': 'Start from',
  'new.create': 'Create API',
  'ws.files': 'Files',
  'ws.newFile': 'New file',
  'ws.newFolder': 'New folder',
  'ws.upload': 'Upload files',
  'ws.save': 'Save',
  'ws.saveAll': 'Save all',
  'ws.saved': 'Saved',
  'ws.unsaved': 'Unsaved changes',
  'ws.run': 'Run',
  'ws.running': 'Running...',
  'ws.stdin': 'Input (stdin)',
  'ws.args': 'Arguments',
  'ws.output': 'Output',
  'ws.clear': 'Clear',
  'ws.noFile': 'Pick a file on the left or create a new one.',
  'ws.rename': 'Rename',
  'ws.delete': 'Delete',
  'ws.duplicate': 'Duplicate',
  'ws.download': 'Download',
  'ws.exportZip': 'Export as .zip',
  'ws.importZip': 'Import .zip',
  'tab.code': 'Code',
  'tab.endpoints': 'Endpoints',
  'tab.test': 'Test',
  'tab.integrate': 'Integrate',
  'tab.extensions': 'Extensions',
  'tab.sharing': 'Sharing',
  'tab.logs': 'Logs',
  'tab.data': 'Data',
  'tab.versions': 'Versions',
  'tab.settings': 'Settings',
  'ep.add': 'Add endpoint',
  'ep.method': 'Method',
  'ep.route': 'Route',
  'ep.file': 'File',
  'ep.public': 'Public (no key needed)',
  'ep.enabled': 'Enabled',
  'ep.none': 'No endpoints yet. Add one to give a file a URL.',
  'keys.title': 'API Keys',
  'keys.create': 'Create key',
  'keys.copyNow': 'Copy this key now - for your safety it will never be shown again.',
  'keys.revoke': 'Revoke',
  'keys.none': 'No keys yet.',
  'friends.title': 'Friends',
  'friends.add': 'Add friend',
  'friends.accept': 'Accept',
  'friends.decline': 'Decline',
  'friends.remove': 'Remove',
  'friends.incoming': 'Requests for you',
  'friends.outgoing': 'Sent requests',
  'friends.none': 'No friends yet. Add someone by their username.',
  'share.add': 'Share with a friend',
  'share.editor': 'Can edit',
  'share.viewer': 'Can view',
  'ext.title': 'Extensions',
  'ext.install': 'Enable',
  'ext.uninstall': 'Disable',
  'ext.configure': 'Configure',
  'settings.title': 'Settings',
  'settings.account': 'Account',
  'settings.appearance': 'Appearance',
  'settings.accessibility': 'Accessibility',
  'settings.editor': 'Editor',
  'settings.language': 'Language',
  'settings.security': 'Security',
  'settings.data': 'Your data',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.copy': 'Copy',
  'common.copied': 'Copied!',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.loading': 'Loading...',
  'common.search': 'Search',
  'common.confirm': 'Are you sure?',
  'common.retry': 'Try again',
  'common.error': 'Something went wrong',
} as const

export type I18nKey = keyof typeof en
type Dict = Partial<Record<I18nKey, string>>

const es: Dict = {
  'nav.dashboard': 'Panel', 'nav.keys': 'Claves API', 'nav.friends': 'Amigos', 'nav.extensions': 'Extensiones', 'nav.docs': 'Guías y documentación', 'nav.settings': 'Ajustes', 'nav.signout': 'Cerrar sesión', 'nav.skip': 'Saltar al contenido', 'nav.menu': 'Menú', 'nav.search': 'Buscar o ejecutar un comando',
  'landing.tagline': 'Crea APIs en cualquier lenguaje. Mantenlas en línea para siempre.',
  'landing.sub': 'Escribe endpoints en JavaScript, Python, Rust, Batch, Java, C# y más de 50 lenguajes, pruébalos en un sandbox integrado y conéctalos a agentes de IA, Unity, Unreal, Godot, Roblox y cualquier motor.',
  'landing.start': 'Crear cuenta gratis', 'landing.signin': 'Ya tengo una cuenta',
  'auth.signin': 'Iniciar sesión', 'auth.signup': 'Crear cuenta', 'auth.username': 'Usuario', 'auth.password': 'Contraseña', 'auth.confirm': 'Confirmar contraseña', 'auth.noEmail': 'No necesitas correo: solo usuario y contraseña.', 'auth.switchToSignup': '¿Nuevo? Crea una cuenta', 'auth.switchToSignin': '¿Ya tienes cuenta? Inicia sesión', 'auth.mismatch': 'Las contraseñas no coinciden', 'auth.show': 'Mostrar contraseña', 'auth.hide': 'Ocultar contraseña',
  'auth.remember': 'Tus APIs, archivos y claves se guardan en tu cuenta y siguen en línea aunque cierres sesión.',
  'dash.title': 'Tus APIs', 'dash.new': 'Nueva API', 'dash.empty': 'Aún no tienes APIs. Crea una desde una plantilla.', 'dash.shared': 'Compartidas contigo', 'dash.live': 'En línea', 'dash.paused': 'Pausada', 'dash.endpoints': 'endpoints', 'dash.filter': 'Filtrar APIs',
  'new.title': 'Crear una API', 'new.name': 'Nombre', 'new.slug': 'Nombre en la URL', 'new.template': 'Empezar desde', 'new.create': 'Crear API',
  'ws.files': 'Archivos', 'ws.newFile': 'Nuevo archivo', 'ws.newFolder': 'Nueva carpeta', 'ws.upload': 'Subir archivos', 'ws.save': 'Guardar', 'ws.saveAll': 'Guardar todo', 'ws.saved': 'Guardado', 'ws.unsaved': 'Cambios sin guardar', 'ws.run': 'Ejecutar', 'ws.running': 'Ejecutando...', 'ws.stdin': 'Entrada (stdin)', 'ws.args': 'Argumentos', 'ws.output': 'Salida', 'ws.clear': 'Limpiar', 'ws.noFile': 'Elige un archivo a la izquierda o crea uno nuevo.', 'ws.rename': 'Renombrar', 'ws.delete': 'Eliminar', 'ws.duplicate': 'Duplicar', 'ws.download': 'Descargar', 'ws.exportZip': 'Exportar .zip', 'ws.importZip': 'Importar .zip',
  'tab.code': 'Código', 'tab.endpoints': 'Endpoints', 'tab.test': 'Probar', 'tab.integrate': 'Integrar', 'tab.extensions': 'Extensiones', 'tab.sharing': 'Compartir', 'tab.logs': 'Registros', 'tab.data': 'Datos', 'tab.versions': 'Versiones', 'tab.settings': 'Ajustes',
  'ep.add': 'Añadir endpoint', 'ep.method': 'Método', 'ep.route': 'Ruta', 'ep.file': 'Archivo', 'ep.public': 'Público (sin clave)', 'ep.enabled': 'Activo', 'ep.none': 'Sin endpoints. Añade uno para dar una URL a un archivo.',
  'keys.title': 'Claves API', 'keys.create': 'Crear clave', 'keys.copyNow': 'Copia esta clave ahora: por seguridad no se volverá a mostrar.', 'keys.revoke': 'Revocar', 'keys.none': 'Aún no hay claves.',
  'friends.title': 'Amigos', 'friends.add': 'Añadir amigo', 'friends.accept': 'Aceptar', 'friends.decline': 'Rechazar', 'friends.remove': 'Quitar', 'friends.incoming': 'Solicitudes para ti', 'friends.outgoing': 'Solicitudes enviadas', 'friends.none': 'Aún no tienes amigos. Añade a alguien por su usuario.',
  'share.add': 'Compartir con un amigo', 'share.editor': 'Puede editar', 'share.viewer': 'Puede ver',
  'ext.title': 'Extensiones', 'ext.install': 'Activar', 'ext.uninstall': 'Desactivar', 'ext.configure': 'Configurar',
  'settings.title': 'Ajustes', 'settings.account': 'Cuenta', 'settings.appearance': 'Apariencia', 'settings.accessibility': 'Accesibilidad', 'settings.editor': 'Editor', 'settings.language': 'Idioma', 'settings.security': 'Seguridad', 'settings.data': 'Tus datos',
  'common.cancel': 'Cancelar', 'common.close': 'Cerrar', 'common.copy': 'Copiar', 'common.copied': '¡Copiado!', 'common.save': 'Guardar', 'common.delete': 'Eliminar', 'common.loading': 'Cargando...', 'common.search': 'Buscar', 'common.confirm': '¿Seguro?', 'common.retry': 'Reintentar', 'common.error': 'Algo salió mal',
}

const fr: Dict = {
  'nav.dashboard': 'Tableau de bord', 'nav.keys': 'Clés API', 'nav.friends': 'Amis', 'nav.extensions': 'Extensions', 'nav.docs': 'Guides et docs', 'nav.settings': 'Paramètres', 'nav.signout': 'Se déconnecter', 'nav.skip': 'Aller au contenu', 'nav.menu': 'Menu', 'nav.search': 'Rechercher ou lancer une commande',
  'landing.tagline': "Créez des API dans n'importe quel langage. Gardez-les en ligne pour toujours.",
  'landing.sub': 'Écrivez des endpoints en JavaScript, Python, Rust, Batch, Java, C# et plus de 50 langages, testez-les dans un bac à sable intégré et branchez-les sur des agents IA, Unity, Unreal, Godot, Roblox et tous les moteurs.',
  'landing.start': 'Créer un compte gratuit', 'landing.signin': "J'ai déjà un compte",
  'auth.signin': 'Se connecter', 'auth.signup': 'Créer un compte', 'auth.username': "Nom d'utilisateur", 'auth.password': 'Mot de passe', 'auth.confirm': 'Confirmer le mot de passe', 'auth.noEmail': "Pas besoin d'e-mail : juste un nom et un mot de passe.", 'auth.switchToSignup': 'Nouveau ? Créez un compte', 'auth.switchToSignin': 'Déjà un compte ? Connectez-vous', 'auth.mismatch': 'Les mots de passe ne correspondent pas', 'auth.show': 'Afficher le mot de passe', 'auth.hide': 'Masquer le mot de passe',
  'dash.title': 'Vos API', 'dash.new': 'Nouvelle API', 'dash.empty': "Vous n'avez pas encore d'API. Créez-en une à partir d'un modèle.", 'dash.shared': 'Partagées avec vous', 'dash.live': 'En ligne', 'dash.paused': 'En pause', 'dash.filter': 'Filtrer les API',
  'new.title': 'Créer une API', 'new.name': 'Nom', 'new.slug': "Nom dans l'URL", 'new.template': 'Partir de', 'new.create': "Créer l'API",
  'ws.files': 'Fichiers', 'ws.newFile': 'Nouveau fichier', 'ws.newFolder': 'Nouveau dossier', 'ws.upload': 'Importer des fichiers', 'ws.save': 'Enregistrer', 'ws.saveAll': 'Tout enregistrer', 'ws.saved': 'Enregistré', 'ws.unsaved': 'Modifications non enregistrées', 'ws.run': 'Exécuter', 'ws.running': 'Exécution...', 'ws.stdin': 'Entrée (stdin)', 'ws.args': 'Arguments', 'ws.output': 'Sortie', 'ws.clear': 'Effacer', 'ws.noFile': 'Choisissez un fichier à gauche ou créez-en un.', 'ws.rename': 'Renommer', 'ws.delete': 'Supprimer', 'ws.duplicate': 'Dupliquer', 'ws.download': 'Télécharger', 'ws.exportZip': 'Exporter en .zip', 'ws.importZip': 'Importer un .zip',
  'tab.code': 'Code', 'tab.test': 'Tester', 'tab.integrate': 'Intégrer', 'tab.sharing': 'Partage', 'tab.logs': 'Journaux', 'tab.data': 'Données', 'tab.settings': 'Paramètres',
  'ep.add': 'Ajouter un endpoint', 'ep.method': 'Méthode', 'ep.route': 'Route', 'ep.file': 'Fichier', 'ep.public': 'Public (sans clé)', 'ep.enabled': 'Actif',
  'keys.title': 'Clés API', 'keys.create': 'Créer une clé', 'keys.copyNow': 'Copiez cette clé maintenant : elle ne sera plus jamais affichée.', 'keys.revoke': 'Révoquer', 'keys.none': 'Aucune clé.',
  'friends.title': 'Amis', 'friends.add': 'Ajouter un ami', 'friends.accept': 'Accepter', 'friends.decline': 'Refuser', 'friends.remove': 'Retirer', 'friends.incoming': 'Demandes reçues', 'friends.outgoing': 'Demandes envoyées',
  'share.add': 'Partager avec un ami', 'share.editor': 'Peut modifier', 'share.viewer': 'Peut voir',
  'ext.install': 'Activer', 'ext.uninstall': 'Désactiver', 'ext.configure': 'Configurer',
  'settings.title': 'Paramètres', 'settings.account': 'Compte', 'settings.appearance': 'Apparence', 'settings.accessibility': 'Accessibilité', 'settings.language': 'Langue', 'settings.security': 'Sécurité', 'settings.data': 'Vos données',
  'common.cancel': 'Annuler', 'common.close': 'Fermer', 'common.copy': 'Copier', 'common.copied': 'Copié !', 'common.save': 'Enregistrer', 'common.delete': 'Supprimer', 'common.loading': 'Chargement...', 'common.search': 'Rechercher', 'common.confirm': 'Êtes-vous sûr ?', 'common.retry': 'Réessayer', 'common.error': "Une erreur s'est produite",
}

const de: Dict = {
  'nav.dashboard': 'Übersicht', 'nav.keys': 'API-Schlüssel', 'nav.friends': 'Freunde', 'nav.extensions': 'Erweiterungen', 'nav.docs': 'Anleitungen & Doku', 'nav.settings': 'Einstellungen', 'nav.signout': 'Abmelden', 'nav.skip': 'Zum Inhalt springen', 'nav.menu': 'Menü', 'nav.search': 'Suchen oder Befehl ausführen',
  'landing.tagline': 'Baue APIs in jeder Sprache. Für immer online.',
  'landing.sub': 'Schreibe Endpunkte in JavaScript, Python, Rust, Batch, Java, C# und über 50 weiteren Sprachen, teste sie in der eingebauten Sandbox und verbinde sie mit KI-Agenten, Unity, Unreal, Godot, Roblox und jeder Engine.',
  'landing.start': 'Kostenloses Konto erstellen', 'landing.signin': 'Ich habe schon ein Konto',
  'auth.signin': 'Anmelden', 'auth.signup': 'Konto erstellen', 'auth.username': 'Benutzername', 'auth.password': 'Passwort', 'auth.confirm': 'Passwort bestätigen', 'auth.noEmail': 'Keine E-Mail nötig – nur Benutzername und Passwort.', 'auth.switchToSignup': 'Neu hier? Konto erstellen', 'auth.switchToSignin': 'Schon ein Konto? Anmelden', 'auth.mismatch': 'Die Passwörter stimmen nicht überein', 'auth.show': 'Passwort anzeigen', 'auth.hide': 'Passwort verbergen',
  'dash.title': 'Deine APIs', 'dash.new': 'Neue API', 'dash.empty': 'Du hast noch keine APIs. Erstelle eine aus einer Vorlage.', 'dash.shared': 'Mit dir geteilt', 'dash.live': 'Online', 'dash.paused': 'Pausiert', 'dash.endpoints': 'Endpunkte', 'dash.filter': 'APIs filtern',
  'new.title': 'API erstellen', 'new.create': 'API erstellen', 'new.template': 'Vorlage',
  'ws.files': 'Dateien', 'ws.newFile': 'Neue Datei', 'ws.newFolder': 'Neuer Ordner', 'ws.upload': 'Dateien hochladen', 'ws.save': 'Speichern', 'ws.saveAll': 'Alle speichern', 'ws.saved': 'Gespeichert', 'ws.unsaved': 'Ungespeicherte Änderungen', 'ws.run': 'Ausführen', 'ws.running': 'Läuft...', 'ws.stdin': 'Eingabe (stdin)', 'ws.args': 'Argumente', 'ws.output': 'Ausgabe', 'ws.clear': 'Leeren', 'ws.noFile': 'Wähle links eine Datei oder erstelle eine neue.', 'ws.rename': 'Umbenennen', 'ws.delete': 'Löschen', 'ws.duplicate': 'Duplizieren', 'ws.download': 'Herunterladen', 'ws.exportZip': 'Als .zip exportieren', 'ws.importZip': '.zip importieren',
  'tab.code': 'Code', 'tab.endpoints': 'Endpunkte', 'tab.test': 'Testen', 'tab.integrate': 'Einbinden', 'tab.extensions': 'Erweiterungen', 'tab.sharing': 'Teilen', 'tab.logs': 'Protokolle', 'tab.data': 'Daten', 'tab.versions': 'Versionen', 'tab.settings': 'Einstellungen',
  'ep.add': 'Endpunkt hinzufügen', 'ep.method': 'Methode', 'ep.route': 'Pfad', 'ep.file': 'Datei', 'ep.public': 'Öffentlich (ohne Schlüssel)', 'ep.enabled': 'Aktiv',
  'keys.title': 'API-Schlüssel', 'keys.create': 'Schlüssel erstellen', 'keys.copyNow': 'Kopiere diesen Schlüssel jetzt – er wird nie wieder angezeigt.', 'keys.revoke': 'Widerrufen', 'keys.none': 'Noch keine Schlüssel.',
  'friends.title': 'Freunde', 'friends.add': 'Freund hinzufügen', 'friends.accept': 'Annehmen', 'friends.decline': 'Ablehnen', 'friends.remove': 'Entfernen', 'friends.incoming': 'Anfragen an dich', 'friends.outgoing': 'Gesendete Anfragen',
  'share.add': 'Mit einem Freund teilen', 'share.editor': 'Darf bearbeiten', 'share.viewer': 'Darf ansehen',
  'ext.title': 'Erweiterungen', 'ext.install': 'Aktivieren', 'ext.uninstall': 'Deaktivieren', 'ext.configure': 'Konfigurieren',
  'settings.title': 'Einstellungen', 'settings.account': 'Konto', 'settings.appearance': 'Darstellung', 'settings.accessibility': 'Barrierefreiheit', 'settings.language': 'Sprache', 'settings.security': 'Sicherheit', 'settings.data': 'Deine Daten',
  'common.cancel': 'Abbrechen', 'common.close': 'Schließen', 'common.copy': 'Kopieren', 'common.copied': 'Kopiert!', 'common.save': 'Speichern', 'common.delete': 'Löschen', 'common.loading': 'Lädt...', 'common.search': 'Suchen', 'common.confirm': 'Bist du sicher?', 'common.retry': 'Erneut versuchen', 'common.error': 'Etwas ist schiefgelaufen',
}

const pt: Dict = {
  'nav.dashboard': 'Painel', 'nav.keys': 'Chaves de API', 'nav.friends': 'Amigos', 'nav.extensions': 'Extensões', 'nav.docs': 'Guias e docs', 'nav.settings': 'Configurações', 'nav.signout': 'Sair', 'nav.skip': 'Pular para o conteúdo', 'nav.search': 'Pesquisar ou executar um comando',
  'landing.tagline': 'Crie APIs em qualquer linguagem. Mantenha-as online para sempre.',
  'landing.sub': 'Escreva endpoints em JavaScript, Python, Rust, Batch, Java, C# e mais de 50 linguagens, teste-os em um sandbox integrado e conecte-os a agentes de IA, Unity, Unreal, Godot, Roblox e qualquer engine.',
  'landing.start': 'Criar conta grátis', 'landing.signin': 'Já tenho uma conta',
  'auth.signin': 'Entrar', 'auth.signup': 'Criar conta', 'auth.username': 'Usuário', 'auth.password': 'Senha', 'auth.confirm': 'Confirmar senha', 'auth.noEmail': 'Sem e-mail: só usuário e senha.', 'auth.mismatch': 'As senhas não coincidem',
  'dash.title': 'Suas APIs', 'dash.new': 'Nova API', 'dash.shared': 'Compartilhadas com você', 'dash.live': 'Online', 'dash.paused': 'Pausada',
  'ws.files': 'Arquivos', 'ws.newFile': 'Novo arquivo', 'ws.newFolder': 'Nova pasta', 'ws.save': 'Salvar', 'ws.saved': 'Salvo', 'ws.run': 'Executar', 'ws.output': 'Saída', 'ws.rename': 'Renomear', 'ws.delete': 'Excluir',
  'tab.code': 'Código', 'tab.test': 'Testar', 'tab.integrate': 'Integrar', 'tab.sharing': 'Compartilhar', 'tab.data': 'Dados', 'tab.versions': 'Versões', 'tab.settings': 'Configurações',
  'keys.create': 'Criar chave', 'keys.revoke': 'Revogar', 'friends.add': 'Adicionar amigo', 'friends.accept': 'Aceitar',
  'settings.title': 'Configurações', 'settings.accessibility': 'Acessibilidade', 'settings.language': 'Idioma',
  'common.cancel': 'Cancelar', 'common.close': 'Fechar', 'common.copy': 'Copiar', 'common.copied': 'Copiado!', 'common.save': 'Salvar', 'common.delete': 'Excluir', 'common.loading': 'Carregando...',
}

const it: Dict = {
  'nav.dashboard': 'Dashboard', 'nav.keys': 'Chiavi API', 'nav.friends': 'Amici', 'nav.extensions': 'Estensioni', 'nav.docs': 'Guide e documentazione', 'nav.settings': 'Impostazioni', 'nav.signout': 'Esci', 'nav.skip': 'Vai al contenuto',
  'landing.tagline': 'Crea API in qualsiasi linguaggio. Online per sempre.',
  'landing.start': 'Crea un account gratuito', 'landing.signin': 'Ho già un account',
  'auth.signin': 'Accedi', 'auth.signup': 'Crea account', 'auth.username': 'Nome utente', 'auth.password': 'Password', 'auth.confirm': 'Conferma password', 'auth.noEmail': 'Nessuna email: solo nome utente e password.',
  'dash.title': 'Le tue API', 'dash.new': 'Nuova API', 'ws.files': 'File', 'ws.newFile': 'Nuovo file', 'ws.newFolder': 'Nuova cartella', 'ws.save': 'Salva', 'ws.run': 'Esegui', 'ws.output': 'Output',
  'settings.title': 'Impostazioni', 'settings.accessibility': 'Accessibilità', 'settings.language': 'Lingua',
  'common.cancel': 'Annulla', 'common.close': 'Chiudi', 'common.copy': 'Copia', 'common.save': 'Salva', 'common.delete': 'Elimina', 'common.loading': 'Caricamento...',
}

const ru: Dict = {
  'nav.dashboard': 'Панель', 'nav.keys': 'API-ключи', 'nav.friends': 'Друзья', 'nav.extensions': 'Расширения', 'nav.docs': 'Руководства', 'nav.settings': 'Настройки', 'nav.signout': 'Выйти', 'nav.skip': 'Перейти к содержимому', 'nav.search': 'Поиск или команда',
  'landing.tagline': 'Создавайте API на любом языке. Они работают всегда.',
  'landing.sub': 'Пишите эндпоинты на JavaScript, Python, Rust, Batch, Java, C# и ещё 50+ языках, тестируйте во встроенной песочнице и подключайте к ИИ-агентам, Unity, Unreal, Godot, Roblox и любым движкам.',
  'landing.start': 'Создать бесплатный аккаунт', 'landing.signin': 'У меня уже есть аккаунт',
  'auth.signin': 'Войти', 'auth.signup': 'Создать аккаунт', 'auth.username': 'Имя пользователя', 'auth.password': 'Пароль', 'auth.confirm': 'Повторите пароль', 'auth.noEmail': 'Почта не нужна — только имя и пароль.', 'auth.mismatch': 'Пароли не совпадают',
  'dash.title': 'Ваши API', 'dash.new': 'Новый API', 'dash.shared': 'Доступные вам', 'dash.live': 'Работает', 'dash.paused': 'На паузе',
  'ws.files': 'Файлы', 'ws.newFile': 'Новый файл', 'ws.newFolder': 'Новая папка', 'ws.save': 'Сохранить', 'ws.saved': 'Сохранено', 'ws.run': 'Запустить', 'ws.output': 'Вывод', 'ws.rename': 'Переименовать', 'ws.delete': 'Удалить',
  'tab.code': 'Код', 'tab.test': 'Тест', 'tab.integrate': 'Интеграция', 'tab.sharing': 'Доступ', 'tab.logs': 'Логи', 'tab.data': 'Данные', 'tab.versions': 'Версии', 'tab.settings': 'Настройки',
  'keys.create': 'Создать ключ', 'keys.revoke': 'Отозвать', 'friends.add': 'Добавить друга', 'friends.accept': 'Принять', 'friends.decline': 'Отклонить',
  'settings.title': 'Настройки', 'settings.accessibility': 'Доступность', 'settings.language': 'Язык', 'settings.appearance': 'Оформление',
  'common.cancel': 'Отмена', 'common.close': 'Закрыть', 'common.copy': 'Копировать', 'common.copied': 'Скопировано!', 'common.save': 'Сохранить', 'common.delete': 'Удалить', 'common.loading': 'Загрузка...',
}

const ar: Dict = {
  'nav.dashboard': 'لوحة التحكم', 'nav.keys': 'مفاتيح API', 'nav.friends': 'الأصدقاء', 'nav.extensions': 'الإضافات', 'nav.docs': 'الأدلة والتوثيق', 'nav.settings': 'الإعدادات', 'nav.signout': 'تسجيل الخروج', 'nav.skip': 'انتقل إلى المحتوى',
  'landing.tagline': 'أنشئ واجهات API بأي لغة. واجعلها متصلة دائمًا.',
  'landing.start': 'أنشئ حسابًا مجانيًا', 'landing.signin': 'لدي حساب بالفعل',
  'auth.signin': 'تسجيل الدخول', 'auth.signup': 'إنشاء حساب', 'auth.username': 'اسم المستخدم', 'auth.password': 'كلمة المرور', 'auth.confirm': 'تأكيد كلمة المرور', 'auth.noEmail': 'لا حاجة لبريد إلكتروني: اسم مستخدم وكلمة مرور فقط.', 'auth.mismatch': 'كلمتا المرور غير متطابقتين',
  'dash.title': 'واجهاتك', 'dash.new': 'واجهة جديدة', 'dash.live': 'متصل', 'dash.paused': 'متوقف',
  'ws.files': 'الملفات', 'ws.newFile': 'ملف جديد', 'ws.newFolder': 'مجلد جديد', 'ws.save': 'حفظ', 'ws.run': 'تشغيل', 'ws.output': 'المخرجات',
  'settings.title': 'الإعدادات', 'settings.accessibility': 'إمكانية الوصول', 'settings.language': 'اللغة',
  'common.cancel': 'إلغاء', 'common.close': 'إغلاق', 'common.copy': 'نسخ', 'common.copied': 'تم النسخ!', 'common.save': 'حفظ', 'common.delete': 'حذف', 'common.loading': 'جارٍ التحميل...',
}

const hi: Dict = {
  'nav.dashboard': 'डैशबोर्ड', 'nav.keys': 'API कुंजियाँ', 'nav.friends': 'दोस्त', 'nav.extensions': 'एक्सटेंशन', 'nav.docs': 'गाइड और डॉक्स', 'nav.settings': 'सेटिंग्स', 'nav.signout': 'साइन आउट', 'nav.skip': 'मुख्य सामग्री पर जाएँ',
  'landing.tagline': 'किसी भी भाषा में API बनाएँ। उन्हें हमेशा ऑनलाइन रखें।',
  'landing.start': 'मुफ़्त खाता बनाएँ', 'landing.signin': 'मेरा पहले से खाता है',
  'auth.signin': 'साइन इन', 'auth.signup': 'खाता बनाएँ', 'auth.username': 'यूज़रनेम', 'auth.password': 'पासवर्ड', 'auth.confirm': 'पासवर्ड की पुष्टि करें', 'auth.noEmail': 'ईमेल की ज़रूरत नहीं — बस यूज़रनेम और पासवर्ड।',
  'dash.title': 'आपके API', 'dash.new': 'नया API', 'ws.files': 'फ़ाइलें', 'ws.save': 'सहेजें', 'ws.run': 'चलाएँ', 'ws.output': 'आउटपुट',
  'settings.title': 'सेटिंग्स', 'settings.accessibility': 'सुलभता', 'settings.language': 'भाषा',
  'common.cancel': 'रद्द करें', 'common.close': 'बंद करें', 'common.copy': 'कॉपी करें', 'common.save': 'सहेजें', 'common.delete': 'हटाएँ', 'common.loading': 'लोड हो रहा है...',
}

const ja: Dict = {
  'nav.dashboard': 'ダッシュボード', 'nav.keys': 'APIキー', 'nav.friends': 'フレンド', 'nav.extensions': '拡張機能', 'nav.docs': 'ガイドとドキュメント', 'nav.settings': '設定', 'nav.signout': 'サインアウト', 'nav.skip': 'メインコンテンツへ移動', 'nav.search': '検索またはコマンド実行',
  'landing.tagline': 'どんな言語でもAPIを作成。ずっとオンライン。',
  'landing.sub': 'JavaScript、Python、Rust、Batch、Java、C# など50以上の言語でエンドポイントを書き、内蔵サンドボックスでテストし、AIエージェントやUnity、Unreal、Godot、Robloxにつなげましょう。',
  'landing.start': '無料アカウントを作成', 'landing.signin': 'アカウントをお持ちの方',
  'auth.signin': 'サインイン', 'auth.signup': 'アカウント作成', 'auth.username': 'ユーザー名', 'auth.password': 'パスワード', 'auth.confirm': 'パスワード（確認）', 'auth.noEmail': 'メール不要。ユーザー名とパスワードだけ。', 'auth.mismatch': 'パスワードが一致しません',
  'dash.title': 'あなたのAPI', 'dash.new': '新しいAPI', 'dash.shared': '共有されたAPI', 'dash.live': '稼働中', 'dash.paused': '停止中',
  'ws.files': 'ファイル', 'ws.newFile': '新しいファイル', 'ws.newFolder': '新しいフォルダー', 'ws.save': '保存', 'ws.saved': '保存しました', 'ws.run': '実行', 'ws.running': '実行中...', 'ws.output': '出力', 'ws.rename': '名前を変更', 'ws.delete': '削除',
  'tab.code': 'コード', 'tab.endpoints': 'エンドポイント', 'tab.test': 'テスト', 'tab.integrate': '連携', 'tab.extensions': '拡張機能', 'tab.sharing': '共有', 'tab.logs': 'ログ', 'tab.data': 'データ', 'tab.versions': 'バージョン', 'tab.settings': '設定',
  'keys.create': 'キーを作成', 'keys.revoke': '無効化', 'friends.add': 'フレンドを追加', 'friends.accept': '承認',
  'settings.title': '設定', 'settings.accessibility': 'アクセシビリティ', 'settings.language': '言語', 'settings.appearance': '外観',
  'common.cancel': 'キャンセル', 'common.close': '閉じる', 'common.copy': 'コピー', 'common.copied': 'コピーしました', 'common.save': '保存', 'common.delete': '削除', 'common.loading': '読み込み中...',
}

const ko: Dict = {
  'nav.dashboard': '대시보드', 'nav.keys': 'API 키', 'nav.friends': '친구', 'nav.extensions': '확장 기능', 'nav.docs': '가이드 및 문서', 'nav.settings': '설정', 'nav.signout': '로그아웃', 'nav.skip': '본문으로 건너뛰기',
  'landing.tagline': '어떤 언어로든 API를 만들고 항상 온라인으로 유지하세요.',
  'landing.start': '무료 계정 만들기', 'landing.signin': '이미 계정이 있어요',
  'auth.signin': '로그인', 'auth.signup': '계정 만들기', 'auth.username': '사용자 이름', 'auth.password': '비밀번호', 'auth.confirm': '비밀번호 확인', 'auth.noEmail': '이메일 없이 사용자 이름과 비밀번호만 있으면 됩니다.',
  'dash.title': '내 API', 'dash.new': '새 API', 'ws.files': '파일', 'ws.newFile': '새 파일', 'ws.newFolder': '새 폴더', 'ws.save': '저장', 'ws.run': '실행', 'ws.output': '출력',
  'settings.title': '설정', 'settings.accessibility': '접근성', 'settings.language': '언어',
  'common.cancel': '취소', 'common.close': '닫기', 'common.copy': '복사', 'common.save': '저장', 'common.delete': '삭제', 'common.loading': '불러오는 중...',
}

const zh: Dict = {
  'nav.dashboard': '控制台', 'nav.keys': 'API 密钥', 'nav.friends': '好友', 'nav.extensions': '扩展', 'nav.docs': '指南与文档', 'nav.settings': '设置', 'nav.signout': '退出登录', 'nav.skip': '跳到主要内容', 'nav.search': '搜索或运行命令',
  'landing.tagline': '用任何语言构建 API，让它永远在线。',
  'landing.sub': '使用 JavaScript、Python、Rust、Batch、Java、C# 等 50 多种语言编写接口，在内置沙盒中测试，并接入 AI 智能体、Unity、Unreal、Godot、Roblox 等任何引擎。',
  'landing.start': '免费注册', 'landing.signin': '我已有账号',
  'auth.signin': '登录', 'auth.signup': '注册', 'auth.username': '用户名', 'auth.password': '密码', 'auth.confirm': '确认密码', 'auth.noEmail': '无需邮箱，只要用户名和密码。', 'auth.mismatch': '两次输入的密码不一致',
  'dash.title': '我的 API', 'dash.new': '新建 API', 'dash.shared': '与我共享', 'dash.live': '运行中', 'dash.paused': '已暂停',
  'ws.files': '文件', 'ws.newFile': '新建文件', 'ws.newFolder': '新建文件夹', 'ws.save': '保存', 'ws.saved': '已保存', 'ws.run': '运行', 'ws.running': '运行中...', 'ws.output': '输出', 'ws.rename': '重命名', 'ws.delete': '删除',
  'tab.code': '代码', 'tab.endpoints': '接口', 'tab.test': '测试', 'tab.integrate': '集成', 'tab.extensions': '扩展', 'tab.sharing': '共享', 'tab.logs': '日志', 'tab.data': '数据', 'tab.versions': '版本', 'tab.settings': '设置',
  'keys.create': '创建密钥', 'keys.revoke': '撤销', 'friends.add': '添加好友', 'friends.accept': '接受',
  'settings.title': '设置', 'settings.accessibility': '无障碍', 'settings.language': '语言', 'settings.appearance': '外观',
  'common.cancel': '取消', 'common.close': '关闭', 'common.copy': '复制', 'common.copied': '已复制！', 'common.save': '保存', 'common.delete': '删除', 'common.loading': '加载中...',
}

export const UI_LANGUAGES: { code: string; name: string; dir?: 'rtl' }[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' },
  { code: 'it', name: 'Italiano' },
  { code: 'ru', name: 'Русский' },
  { code: 'ar', name: 'العربية', dir: 'rtl' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'zh', name: '中文' },
]

const DICTS: Record<string, Dict> = { en, es, fr, de, pt, it, ru, ar, hi, ja, ko, zh }

let current = 'en'

export function setLanguage(code: string) {
  current = DICTS[code] ? code : 'en'
  const meta = UI_LANGUAGES.find((l) => l.code === current)
  document.documentElement.lang = current
  document.documentElement.dir = meta?.dir || 'ltr'
}

export function detectLanguage(): string {
  const nav = (navigator.languages || [navigator.language || 'en']).map((l) => l.slice(0, 2).toLowerCase())
  return nav.find((l) => DICTS[l]) || 'en'
}

export function t(key: I18nKey): string {
  return DICTS[current]?.[key] ?? en[key]
}
