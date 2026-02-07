# 🚨 URGENCE : Rollback EAS Update

## Situation
L'app crashe (écran blanc) après une mise à jour EAS. Le code a été corrigé localement mais l'update cassée est déjà déployée sur les appareils.

## Solution 1 : Rollback vers version précédente (RAPIDE)

```bash
# 1. Voir l'historique des updates
eas update:list --branch production

# 2. Identifier l'ID de la dernière version FONCTIONNELLE
# (celle juste avant le crash)

# 3. Republier cette version
eas update:republish --group <ID-VERSION-FONCTIONNELLE> --branch production
```

## Solution 2 : Publier version corrigée (RECOMMANDÉ)

```bash
# 1. Commit et push les corrections
git add .
git commit -m "fix: Revert breaking changes causing white screen crash"
git push

# 2. Publier immédiatement une nouvelle update
eas update --branch production --message "HOTFIX: Revert breaking photo notifications"
```

## Solution 3 : Reset local (Sur le téléphone)

Si les solutions ci-dessus ne fonctionnent pas immédiatement:

1. **Désinstaller complètement l'app** du téléphone
2. **Réinstaller depuis le store** (ou rebuild)
3. L'app téléchargera la nouvelle update corrigée

## Modifications annulées dans ce commit

- ❌ Notifications système pour photos tactiques
- ❌ Synchronisation automatique images après reconnexion
- ❌ Tous les appels `triggerTacticalNotification` dans les handlers de photos

## Modifications conservées

- ✅ Correction boussole paysage (180° shift)
- ✅ Reconnexions silencieuses
- ✅ Protection AppState

## Commandes à exécuter MAINTENANT

```bash
# Commit les corrections
git add App.tsx app.config.js components/TacticalMap.tsx services/connectivityService.ts
git commit -m "fix: Emergency rollback - remove photo notifications causing crash"
git push

# Publier l'update de correction
eas update --branch production --message "HOTFIX: Emergency rollback"
```
