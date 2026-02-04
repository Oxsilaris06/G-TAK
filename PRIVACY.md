Politique de Confidentialité de Praxis
Dernière mise à jour : 17 Janvier 2026
Praxis est conçue selon un principe de "Privacy by Design". Nous ne collectons, ne stockons et ne vendons aucune donnée personnelle. L'application fonctionne sur un modèle Peer-to-Peer (P2P) éphémère.
 * Aucune Collecte de Données Serveur
   Praxis n'utilise aucun serveur central pour stocker vos données.
 * Il n'y a pas de base de données utilisateurs.
 * Il n'y a pas de compte à créer (pas d'email, pas de mot de passe).
 * Toutes les données (positions, messages, pings) transitent directement d'un appareil à l'autre via des canaux WebRTC sécurisés.
 * Dès que vous fermez l'application ou quittez la session, toutes les données tactiques sont effacées de la mémoire vive de l'appareil.
 * Permissions Android Requises
   Pour fonctionner, Praxis nécessite les permissions suivantes sur votre appareil. Ces permissions sont utilisées uniquement pour les fonctionnalités locales de l'application :
 * Localisation (GPS) :
   * Usage : Afficher votre position sur la carte et la partager avec les membres de votre groupe connectés à la même session.
   * Confidentialité : Vos coordonnées GPS ne sont partagées qu'avec les pairs connectés à votre session temporaire. Elles ne sont jamais envoyées à un serveur tiers.
 * Caméra :
   * Usage : Scanner les QR Codes de connexion et capturer des photos pour les Pings (Hostile/Intel).
   * Confidentialité : Les images sont compressées localement et transmises uniquement aux pairs de la session. Aucune sauvegarde cloud.
 * Galerie :
   * Usage : Joindre des images existantes aux Pings.
   * Confidentialité : Accès uniquement aux images sélectionnées.
 * Notifications :
   * Usage : Vous alerter (son/vibration) lorsqu'un équipier signale un danger (Ping Hostile) ou envoie un message prioritaire, même si l'écran est éteint.
 * Services Tiers
   L'application utilise les services techniques suivants pour établir la connexion P2P :
 * Serveurs STUN (Google) : Utilisés uniquement lors de la phase d'initialisation pour permettre à votre téléphone de trouver son adresse IP publique et se connecter aux autres. Aucune donnée de contenu (positions, messages) ne passe par ces serveurs.
 * Cartographie (Tuiles) : Les fonds de carte (images) sont téléchargés depuis des serveurs publics (CartoDB, ArcGIS) en fonction de votre zone géographique affichée.
 * Consentement
   En utilisant Praxis, vous acceptez que votre position géographique et votre pseudonyme (Trigramme) soient partagés en temps réel avec les autres utilisateurs que vous avez volontairement rejoints dans une session.
 * Contact
   Pour toute question technique ou relative à la confidentialité, veuillez ouvrir une "Issue" sur le dépôt GitHub du projet.
