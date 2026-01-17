Praxis - Suivi Tactique de Groupe
Praxis est une solution open-source de Situation Awareness (SA) et de suivi tactique sur réseau maillé décentralisé (Peer-to-Peer). Conçue pour les environnements dégradés ou les opérations de groupe (MilSim, Airsoft, Randonnée, Secours), elle permet de partager positions, statuts et alertes en temps réel sans serveur central.
Fonctionnalités Clés
 * Réseau Mesh Hybride : Utilise PeerJS (WebRTC Data Channels) pour créer un réseau P2P résilient entre terminaux via 4G/5G/Wi-Fi. Pas de serveur backend propriétaire requis.
 * Blue Force Tracking (BFT) : Affichage en temps réel des positions, orientations (compas) et statuts de tous les équipiers.
 * Main Courante Tactique (NOUVEAU) :
   * Journalisation : Enregistrement horodaté des événements, actions et observations (Log Book).
   * Collaboration : Partage automatique des entrées avec l'Hôte de session.
   * Export Data Gap : Génération de rapports PDF et export des données via QR Code dynamique pour extraire les logs sans connexion réseau (Air-gapped).
 * Cartographie Tactique :
   * Fonds de carte multiples (Sombre, Clair, Satellite).
   * Système de Pings Avancés :
     * Hostile (Rouge) : Caneva SALTA complet (Position, Nature, Volume, Attitude...).
     * Ami (Vert) : Points de ralliement, positions alliées.
     * Renseignement (Jaune) : Observations diverses.
   * Tracés historiques des mouvements (Trails).
 * Messagerie Flash : Envoi rapide de messages pré-configurés ("Contact", "Besoin Soutien", "RAS") visibles directement sur la tuile de l'opérateur.
 * Gestion de Groupe :
   * Création de session instantanée par QR Code.
   * Rôles Hôte / Opérateur.
   * Exclusion d'utilisateurs.
 * Sécurité & Discrétion :
   * Mode "Silence Radio" global piloté par l'hôte.
   * Données éphémères (rien n'est stocké sur un serveur, tout est en RAM).
   * Thème sombre "Night Ops" optimisé pour la nuit (OLED friendly).
Installation (.apk)
 * Téléchargez le fichier Praxis.apk depuis la section Releases.
 * Autorisez l'installation d'applications de sources inconnues sur votre appareil Android.
 * Installez l'APK.
 * Au premier lancement, acceptez les permissions (Localisation, Caméra pour QR, Notifications).
Guide Rapide
1. Démarrer une Mission (Hôte)
 * Sur l'écran d'accueil, cliquez sur "CRÉER SESSION".
 * Votre ID de session (ex: X9J2K) s'affiche en haut.
 * Partagez cet ID ou faites scanner votre QR Code (via le bouton QR en bas à droite) à vos équipiers.
2. Rejoindre une Mission (Opérateur)
 * Sur l'écran d'accueil, entrez l'ID de l'hôte ou cliquez sur "SCANNER" pour lire le QR Code de l'hôte.
 * Cliquez sur "REJOINDRE".
3. Interface Tactique
 * Carte : Affiche les positions. Double-cliquez n'importe où pour poser un marqueur (Ping).
 * Main Courante : Cliquez sur l'icône "Historique" (en haut à droite) pour ouvrir le journal des événements.
 * Menu Pings : Choisissez le type (Hostile/Ami/Rens). Remplissez les détails (SALTA pour Hostile).
 * Statuts : En bas, changez votre statut (CLEAR, CONTACT, PROGRESSION) pour informer l'équipe.
 * Messages : Cliquez sur "MSG" pour envoyer une info rapide.
Architecture Technique
 * Frontend : React Native (Expo)
 * Cartographie : Leaflet (via WebView)
 * Réseau : PeerJS (WebRTC Data)
 * État : Gestion locale React State + Context
Compilation (Développement)
# Cloner le dépôt
git clone [https://github.com/oxsilaris06/g-tak.git](https://github.com/oxsilaris06/g-tak.git)
cd g-tak

# Installer les dépendances
npm install

# Lancer en mode dev
npx expo start

Avertissement
Praxis est un outil d'aide à la coordination. Il ne doit pas être utilisé comme unique moyen de navigation ou de communication dans des situations critiques où la sécurité des personnes est en jeu. Le fonctionnement dépend de la connectivité réseau (Data/WiFi) de l'appareil.
