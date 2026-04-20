# 🚀 VOCAL JOINER PRO - UNDETECT VERSION

Version avancée avec support des proxies résidentiels et résolution automatique de captcha via 2Captcha.

## 📋 Fonctionnalités

### ⚡ Actions Standards (SANS proxies)
- ✅ Connexion rapide des tokens
- ✅ Join/Leave vocal
- ✅ Mode boucle (join/leave automatique)
- ✅ Suivi d'utilisateur
- ✅ Soundboard MP3
- ✅ Réactions sur messages
- ✅ Support Stream/Vidéo

### 🔒 Nouvelles Actions (AVEC proxies + 2Captcha)
- 🌐 **Join Server** - Rejoindre des serveurs avec captcha auto-résolu
- 💬 **Spam DM** - Envoi de messages privés
- 👤 **Change Profile** - Modification de bio
- 📝 **Change Username** - Changement de pseudo
- 📛 **Change Display Name** - Nom d'affichage / surnom serveur
- 🖼️ **Change Avatar** - Upload de nouvelle photo de profil

## 🛠️ Installation

1. **Installer Node.js** (version 16 ou supérieure)
   - Télécharger sur https://nodejs.org/

2. **Installer les dépendances**
   ```bash
   npm install
   ```

3. **Lancer le serveur**
   ```bash
   npm start
   ```

4. **Ouvrir l'interface**
   - Ouvrir votre navigateur
   - Aller sur `http://localhost:3000`

5. **Configuration dans l'interface (TAB SETUP)**

   **a) Tokens Discord :**
   - Charger depuis fichier `.txt` (un token par ligne)
   - Ou préparer un fichier `tokens.txt` à la racine

   **b) Proxies Résidentiels (optionnel) :**
   - Charger depuis fichier `.txt` 
   - OU copier-coller directement dans la zone de texte
   - Format : `host:port:username:password`
   - Exemple :
     ```
     p.webshare.io:80:user-1:password123
     p.webshare.io:80:user-2:password123
     ```

   **c) Clé 2Captcha (optionnel) :**
   - Charger depuis fichier `.txt`
   - OU copier-coller directement dans le champ
   - Exemple : `f902ed69ca5711a946ce68b6df2a5bb9`

   ⚠️ Les proxies et 2Captcha sont **optionnels** mais **recommandés** pour les actions du TAB "ACTIONS"

6. **Connecter les tokens**
   - Cliquer sur "CONNECTER LES TOKENS"
   - Attendre la fin de la connexion

## 🎯 Utilisation

### TAB 0 - SETUP (Configuration)
1. **Charger les tokens :**
   - Via fichier : Cliquer sur "select tokens"
   - Un token Discord par ligne
   
2. **Charger les proxies (optionnel) :**
   - Via fichier : Cliquer sur "select proxies"
   - OU copier-coller dans la zone de texte
   - Format : `host:port:username:password`
   - Cliquer sur "CHARGER PROXIES"

3. **Charger clé 2Captcha (optionnel) :**
   - Via fichier : Cliquer sur "select key file"
   - OU copier-coller dans le champ texte
   - Cliquer sur "CHARGER CLÉ CAPTCHA"

4. **Vérifier le statut :**
   - Section "📊 statut configuration" affiche tout en temps réel
   - Tokens : Nombre chargés
   - Proxies : Nombre chargés
   - 2Captcha : Configuré ✓ ou Non configuré

5. **Connecter les tokens :**
   - Définir le nombre de tokens à utiliser (0 = tous)
   - Cliquer sur "CONNECTER LES TOKENS"
   - Attendre la fin des connexions

### TAB 1 - VOCAL (Sans proxies)
1. Configurer le serveur et le canal vocal
2. Utiliser les boutons REJ VOC / LEAVE VOC / BOUCLE

### TAB 2 - ACTIONS (Avec proxies + captcha)
Toutes ces actions utilisent automatiquement :
- ✅ Rotation de proxies résidentiels
- ✅ Résolution automatique de captcha (si nécessaire)
- ✅ Délais anti-ratelimit configurables

**Join Server :**
- Code d'invitation Discord
- Résout automatiquement les captcha
- Délai recommandé : 2000ms

**Spam DM :**
- ID de l'utilisateur cible
- Message à envoyer
- Nombre de messages par compte
- Délai recommandé : 1500ms

**Change Profile :**
- Nouvelle bio (max 190 caractères)
- Délai recommandé : 2000ms

**Change Username :**
- Nouveau pseudo (+ nombre aléatoire ajouté)
- Délai recommandé : 3000ms (strict ratelimit Discord)

**Change Display Name :**
- Nom d'affichage global ou surnom serveur
- ID serveur optionnel
- Délai recommandé : 2000ms

**Change Avatar :**
- Sélectionner une image (PNG, JPG, GIF)
- Délai recommandé : 3000ms

### TAB 3 - REACTIONS (Sans proxies)
- ID du message à réagir
- Position de la réaction (1, 2, etc.)

## ⚙️ Configuration Recommandée

### Délais Anti-Ratelimit
| Action | Délai min | Délai recommandé |
|--------|-----------|------------------|
| Join Vocal | 50ms | 50ms |
| Join Server | 1000ms | 2000ms |
| Spam DM | 500ms | 1500ms |
| Change Bio | 1000ms | 2000ms |
| Change Username | 2000ms | 3000ms |
| Change Avatar | 2000ms | 3000ms |

### Nombre de tokens
- **0** = Utiliser tous les tokens chargés
- **N** = Limiter aux N premiers tokens

## 🔐 Proxies

Le système utilise **automatiquement** les proxies pour :
- Join Server
- Spam DM
- Change Profile/Username/Avatar

Les proxies sont **rotés** en fonction de l'index du token :
- Token 1 → Proxy 1
- Token 2 → Proxy 2
- Token 98 → Proxy 1 (rotation)

**Format attendu :** `host:port:username:password`

## 🧩 2Captcha

La clé 2Captcha est utilisée pour :
- **Join Server** (si captcha détecté)
- **Spam DM** (si captcha requis pour créer le DM ou envoyer le message)

### Comment ça marche :
1. Le système détecte automatiquement quand Discord demande un captcha
2. Il extrait le `captcha_sitekey` de la réponse Discord
3. Il envoie le captcha à 2Captcha pour résolution (prend 10-30 secondes)
4. Il réessaie l'action avec la solution du captcha
5. Continue avec les autres tokens

### Logs captcha :
```
[🔐 CAPTCHA] nightmareseverynite - Résolution du captcha...
[✅ CAPTCHA] nightmareseverynite - Message envoyé avec captcha
```

### Coûts 2Captcha :
- **hCaptcha** : ~$2.99 pour 1000 résolutions
- **Temps moyen** : 15-30 secondes par captcha
- **Taux de succès** : ~95%

### Vérifier votre solde :
1. Aller sur https://2captcha.com
2. Se connecter avec votre compte
3. Voir le solde en haut à droite
4. Recharger si nécessaire

⚠️ **Important** : Si vous voyez `CAPTCHA_SOLVER_NOT_IMPLEMENTED` ou des erreurs captcha, vérifiez :
- Que votre clé est bien chargée (TAB SETUP > statut)
- Que vous avez du crédit sur votre compte 2Captcha
- Que vous utilisez la bonne clé API (pas la clé de test)

## ⚠️ Avertissements

- Les actions avec proxies ont des délais **plus longs** pour éviter les ratelimits
- Ne **jamais** descendre en dessous des délais recommandés
- Les tokens peuvent être **bannis** si vous abusez du spam
- Utilisez des **proxies résidentiels** de qualité (pas de datacenter)
- Vérifiez que votre solde 2Captcha est suffisant

## 📊 Logs

Tous les événements sont affichés en temps réel :
- ✅ Vert = Succès
- ❌ Rouge = Erreur
- ⚠️ Orange = Avertissement
- ℹ️ Bleu = Information

## 🐛 Dépannage

**Tokens ne se connectent pas :**
- Vérifier que les tokens sont valides
- Vérifier votre connexion internet

**Captcha non résolus :**
- Vérifier votre clé 2Captcha dans `2capcha.txt`
- Vérifier votre solde sur 2captcha.com

**Proxies ne fonctionnent pas :**
- Vérifier le format `host:port:user:pass`
- Tester vos proxies sur un site comme ipinfo.io
- Vérifier qu'ils sont bien chargés dans le statut (TAB SETUP)

**Ratelimit constant :**
- Augmenter les délais
- Réduire le nombre de tokens simultanés

## 📝 Support

Créé par **ahki & hexec**

Pour toute question, vérifier :
1. Que tous les fichiers sont configurés
2. Que Node.js est à jour
3. Que les dépendances sont installées (`npm install`)

## ⚖️ Légal

Cet outil est fourni à des fins éducatives uniquement. L'utilisation de selfbots Discord viole les Terms of Service de Discord. Utilisez à vos risques et périls.