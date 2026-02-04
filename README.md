Praxis & Stratégica - Suite Tactique P2P

Praxis est une suite d'outils tactiques open-source conçue pour les opérations de groupe en environnement dégradé (MilSim, Secours, Randonnée, Opérations). Elle fonctionne sur une architecture Peer-to-Peer (P2P) sécurisée, sans aucun serveur central de stockage.

L'application se divise en deux modules principaux :

Praxis : Blue Force Tracking (BFT), Cartographie et Communication temps réel.

Stratégica : Outil de rédaction d'Ordres Initiaux (O.I.) et gestion de mission (SMEPP).

🚀 Fonctionnalités Clés

1. Module PRAXIS (Opérations Temps Réel)

Le cœur du système pour le suivi et la coordination sur le terrain.

Réseau Mesh Hybride Optimisé :

Utilise WebRTC pour une connexion directe entre appareils.

Nouvelle configuration réseau : Utilise les ports UDP 53 (DNS) et 443 (HTTPS) pour traverser les pare-feux stricts (4G/5G, Réseaux d'entreprise).

Optimisation batterie : Ping "Heartbeat" espacé (15s) pour maintenir le tunnel NAT sans vider la batterie.

Cartographie Tactique :

Fonds de carte multiples : Sombre, Clair, Satellite.

Support Custom : Possibilité de charger des tuiles personnalisées (URL ou fichiers locaux MBTiles).

Mode Night Ops : Interface basculant intégralement en Rouge/Noir pour préserver la vision nocturne et réduire la signature lumineuse (écrans OLED).

 Mode Paysage : Interface optimisée avec boussole déportée pour ne pas gêner la vue.

Blue Force Tracking (BFT) :

Position GPS et orientation (Compas) de tous les équipiers en temps réel (Visibilité Immédiate dès connexion).

 Mode Heading-Up : La carte s'oriente automatiquement selon votre cap (Cône et Boussole synchronisés).

Codes couleurs personnalisables par opérateur (Cyan, Rose, Violet, Orange) pour identifier les chefs d'équipe.

Statuts opérationnels (CLEAR, CONTACT, PROGRESSION, BUSY).
 
 Animation 'Heartbeat' : Pulsation rouge sur la carte et le tableau de bord en cas de statut CONTACT.

Système de Pings & Alertes :

🔴 Hostile : Caneva PNAVAS complet (Position, Nature, Volume, Attitude, Armement). Support Drag & Drop (Appui long pour déplacer) et édition (Tap).

 📷 Support Photos : Ajout de photos (Caméra/Galerie) aux pings Hostile et Intel.

🟢 Ami : Points de ralliement, positions alliées.

🟡 Rens : Observations diverses.

Système de Ralliement : Navigation assistée (Distance/Azimut) vers un coéquipier.

Main Courante Collaborative : Journal des événements partagé en temps réel avec l'Hôte, exportable en PDF.

2. Module STRATÉGICA (Planification)

Outil complet de génération d'ordres (SMEPP) et gestion d'effectifs.

Rédaction d'Ordre Initial (O.I.) : Assistant étape par étape (Situation, Mission, Exécution, Articulation, etc.).

Gestion "Patrac" :

Création de pool d'opérateurs avec spécialités (Armement, Cellule, Fonctions).

Affectation aux véhicules (V1, V2...).

Import/Export des configurations d'équipe en JSON.

Intégration Photos : Ajout de photos de cibles, itinéraires ou lieux directement dans le dossier, avec annotation tactique.

Génération PDF : Création automatique d'un dossier de mission PDF complet, prêt à être partagé ou imprimé.

🔒 Confidentialité & Sécurité (Privacy by Design)

Praxis est conçu selon un principe strict de "Zero Knowledge" :

Aucun Serveur de Données : Il n'y a pas de base de données. Pas de compte utilisateur. Pas de mot de passe.

Données Éphémères : Toutes les données tactiques (positions, messages, logs) résident uniquement dans la mémoire vive (RAM) de l'appareil.

Arrêt d'Urgence : Quitter la session ou fermer l'application efface instantanément toutes les données locales.

Chiffrement : Les communications transitent via des canaux WebRTC sécurisés (DTLS/SRTP).

📖 Guide Rapide

Installation

Téléchargez le fichier .apk depuis les Releases.

Autorisez l'installation depuis des sources inconnues.

Au premier lancement, acceptez les permissions (Localisation Haute Précision, Caméra pour QR, Notifications).

Démarrer une Session (Hôte)

Choisissez PRAXIS sur l'écran d'accueil.

Cliquez sur CRÉER SESSION.

Votre ID (ex: X9J2K) et un QR Code sont générés.

Vous devenez le "Serveur" temporaire du groupe.

Rejoindre une Session (Opérateur)

Choisissez PRAXIS.

Entrez votre Trigramme.

Entrez l'ID de l'hôte ou cliquez sur SCANNER pour flasher le QR Code du chef d'équipe.

Cliquez sur REJOINDRE.

Utiliser Stratégica

Sur l'écran d'accueil, choisissez STRATÉGICA.

Suivez les onglets pour remplir les informations de la mission.

Dans l'onglet "PATRAC", créez vos véhicules et glissez-y vos opérateurs.

À la fin, cliquez sur GÉNÉRER PDF pour exporter le dossier.

⚙️ Configuration Avancée

Dans le menu Paramètres (roue dentée), vous pouvez :

Identité : Changer votre Trigramme et votre couleur de flèche (pour la carte).

GPS : Ajuster la fréquence d'actualisation (par défaut 2000ms). Réduire pour économiser la batterie, augmenter pour plus de précision.

Carte : Charger un fichier MBTiles local ou entrer une URL de serveur de tuiles custom pour une utilisation hors-ligne.

Messages Rapides : Éditer la liste des messages prédéfinis ("Contact", "RAS", etc.).

🛠️ Architecture Technique

Frontend : React Native (Expo SDK 51).

Langage : TypeScript.

Cartographie : MapLibre GL (Vecteur & Raster).

Réseau : PeerJS (WebRTC Data Channels) avec configuration STUN Google & Twilio.

Build : Android (APK).

Compilation (Dev)

# Cloner le dépôt
git clone [https://github.com/oxsilaris06/g-tak.git](https://github.com/oxsilaris06/g-tak.git)
cd g-tak

# Installer les dépendances
npm install

# Lancer en mode dev
npx expo start


Avertissement : Praxis est un outil d'aide à la coordination. Il dépend de la connectivité réseau de l'appareil et ne doit pas se substituer aux moyens de communication primaires dans des situations critiques.
