import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Alert,
  Modal,
  SafeAreaView,
  KeyboardAvoidingView,
  Image,
  Dimensions,
  Linking
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import { MaterialIcons } from '@expo/vector-icons';

// --- SECURITÉ & CHIFFREMENT (Audit 3.A) ---
const SECRET_KEY = "PRAXIS_G_TAK_SECURE";

// Chiffrement XOR simple + Base64 pour éviter le stockage en clair
// Suffisant pour empêcher une lecture directe du JSON via adb ou file explorer
const encryptData = (text: string) => {
    try {
        let result = "";
        for(let i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ SECRET_KEY.charCodeAt(i % SECRET_KEY.length));
        }
        return Buffer.from(result).toString('base64');
    } catch (e) {
        console.error("Encryption failed", e);
        return text; // Fallback fail-safe
    }
};

const decryptData = (encoded: string) => {
    try {
        const text = Buffer.from(encoded, 'base64').toString('ascii');
        let result = "";
        for(let i = 0; i < text.length; i++) {
            result += String.fromCharCode(text.charCodeAt(i) ^ SECRET_KEY.charCodeAt(i % SECRET_KEY.length));
        }
        return result;
    } catch(e) {
        return null;
    }
};

// --- PROPS ---
interface OIViewProps {
    onClose?: () => void;
}

// --- CONSTANTES & CONFIGURATION ---

const MEMBER_CONFIG = {
  options: {
    fonctions: ["Chef inter", "Chef dispo", "Chef Oscar","Conducteur","Chef de Bord", "DE", "Cyno", "Inter", "Effrac", "AO", "Sans"],
    cellules: ["AO1", "AO2", "AO3", "AO4", "AO5", "AO6", "AO7", "AO8", "India 1", "India 2", "India 3", "India 4", "India 5", "Effrac", "Commandement", "Sans"],
    principales: [ "G36", "UMP9", "FAP", "MP5", "Sans"],
    afis: ["PIE", "LBD40", "LBD44", "Sans"],
    secondaires: ["SIG 2022","G26", "Sans"],
    grenades: ["GENL", "MP7", "FAR", "Sans"],
    equipements: ["Sans", "BBAL", "Belier", "Lacry", "IL", "Lot 5.11", "Lot Oscar", "Pince", "Drone", "Cam pieton",],
    equipements2: ["Sans", "Échelle", "Stop stick", "Lacry", "Cale", "IL", "Pass","Cam pieton", "TPH700"],
    tenues: ["UBAS", "4S", "Bleu", "Civile", "Ghillie", "Treillis", "MO"],
    gpbs: ["GPBL", "GPBPD","Casque Mo","Casque Lourd", "Sans"],
    vehicules_types: ["Sharan", "Kodiaq", "5008", "Scénic","Kodiaq Bana"]
  },
  members: [
    { trigramme: "XX", fonction: "Inter", cellule: "AO1", tenue: "UBAS" },
    { trigramme: "YY", fonction: "Sans", cellule: "India 1", tenue: "UBAS" },
  ]
};

const COLORS = {
  bg: '#050505',
  surface: '#18181b',
  surfaceLight: '#27272a',
  primary: '#3b82f6',
  secondary: '#94a3b8',
  text: '#e0e0e0',
  textMuted: '#71717a',
  danger: '#ef4444',
  success: '#22c55e',
  warning: '#eab308',
  border: 'rgba(255, 255, 255, 0.05)',
  inputBg: '#000000'
};

// --- TYPES ---

interface IOIState {
  // Page 1 : Info Op
  date_op: string;
  type_mission: string;
  unite_redacteur: string;
  trigramme_redacteur: string;
  cadre_legal: string;
  // Page 2 : Mission
  mission_global: string;
  mission_particulier: string;
  // Page 3 : Adversaire
  menace_global: string;
  adversaires: IAdversaire[];
  // Page 4 : Tiers
  autorites: string[];
  secours: string[];
  // Page 5 : Terrain
  terrain_zone: string;
  terrain_obj: string;
  // Page 6 : Execution
  mesures_coordination: string[];
  consignes_tir: string;
  consignes_particulieres: string;
  // Page 7 : Trans
  frequences: string[];
  indicatifs: string[];
  // Page 8 : Photos
  // Photos gérées à part via le state local 'photos'
  
  // Customisation PDF
  logo_mode: 'header' | 'background';
  pdf_theme: 'light' | 'dark';
}

interface IAdversaire {
  id: string;
  nom: string;
  signalement: string;
  dangerosite: string; // Faible, Moyenne, Élevée
}

interface IPhoto {
  id: string;
  uri: string;
  category: string; // 'photo_obj_global', 'photo_obj_detail', 'photo_plan', 'photo_logo_unite', 'photo_suspect'
  annotations: {x: number, y: number, text: string}[];
}

const INITIAL_STATE: IOIState = {
  date_op: new Date().toLocaleDateString('fr-FR'),
  type_mission: "Interpellation Domiciliaire",
  unite_redacteur: "G-TAK",
  trigramme_redacteur: "",
  cadre_legal: "Enquête Préliminaire",
  mission_global: "Investir, Sécuriser, Interpeller",
  mission_particulier: "Appui spécialisé à...",
  menace_global: "Individus susceptibles d'être armés",
  adversaires: [],
  autorites: ["OPJ Locale", "Magistrat de permanence"],
  secours: ["SAMU 15", "Pompiers 18"],
  terrain_zone: "Zone Pavillonnaire",
  terrain_obj: "Pavillon R+1 avec jardin",
  mesures_coordination: ["Top Action à l'initiative", "Silence Radio sur zone"],
  consignes_tir: "Légitime Défense stricte",
  consignes_particulieres: "Port du casque lourd obligatoire",
  frequences: ["Conférence TPH", "Radio Tac"],
  indicatifs: ["PC", "Alpha", "Bravo"],
  logo_mode: 'header',
  pdf_theme: 'light'
};

// --- COMPOSANTS HELPERS ---

const SectionTitle = ({ title }: { title: string }) => (
  <View style={styles.sectionHeader}>
    <View style={styles.sectionLine} />
    <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
    <View style={styles.sectionLine} />
  </View>
);

const InputField = ({ label, value, onChange, multiline = false, placeholder = "" }: any) => (
  <View style={styles.inputGroup}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      style={[styles.input, multiline && styles.textArea]}
      value={value}
      onChangeText={onChange}
      multiline={multiline}
      placeholder={placeholder}
      placeholderTextColor={COLORS.textMuted}
    />
  </View>
);

const DynamicListInput = ({ label, list, onChange, placeholder = "Ajouter..." }: any) => {
    const [txt, setTxt] = useState("");
    return (
        <View style={styles.inputGroup}>
            <Text style={styles.label}>{label}</Text>
            <View style={{flexDirection:'row', flexWrap:'wrap', gap: 5, marginBottom: 5}}>
                {list.map((item:any, i:number) => (
                    <TouchableOpacity key={i} onPress={() => onChange(list.filter((_:any, idx:number) => idx !== i))} style={styles.chip}>
                        <Text style={{color: COLORS.text}}>{item} X</Text>
                    </TouchableOpacity>
                ))}
            </View>
            <View style={{flexDirection:'row', gap:5}}>
            <TextInput style={[styles.input, {flex:1}]} value={txt} onChangeText={setTxt} placeholder={placeholder} placeholderTextColor={COLORS.textMuted}/>
            <TouchableOpacity style={{backgroundColor:COLORS.surfaceLight, justifyContent:'center', padding:10, borderRadius:8, borderWidth: 1, borderColor: COLORS.border}}
                onPress={() => { if(txt) { onChange([...list, txt]); setTxt(""); } }}>
                <MaterialIcons name="add" size={20} color="white" />
            </TouchableOpacity>
            </View>
        </View>
    );
};

const ChipSelector = ({ label, selected, options, onChange }: any) => (
    <View style={styles.inputGroup}>
        <Text style={styles.label}>{label}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((opt:string) => {
            const isSel = selected.includes(opt);
            return (
            <TouchableOpacity key={opt} style={[styles.chip, isSel && styles.chipSelected]} onPress={() => isSel ? onChange(selected.filter((s:string) => s !== opt)) : onChange([...selected, opt])}>
                <Text style={{ color: isSel ? '#fff' : COLORS.textMuted, fontWeight: isSel ? 'bold' : 'normal' }}>{opt}</Text>
            </TouchableOpacity>
            );
        })}
        </View>
    </View>
);

// --- COMPOSANT PRINCIPAL ---

export default function OIView({ onClose }: OIViewProps) {
  const [step, setStep] = useState(0);
  
  // DATA STATES
  const [formData, setFormData] = useState<IOIState>(INITIAL_STATE);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [poolMembers, setPoolMembers] = useState<any[]>([]);
  const [photos, setPhotos] = useState<IPhoto[]>([]);
  
  // UI STATES
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null); // Pour le drag & drop logique
  const [isAnnotationVisible, setIsAnnotationVisible] = useState(false);
  const [currentPhotoToAnnotate, setCurrentPhotoToAnnotate] = useState<string | null>(null);
  
  // Modals
  const [isMemberEditModalVisible, setIsMemberEditModalVisible] = useState(false);
  const [tempMember, setTempMember] = useState<any | null>(null);
  const [isVehicleRenameVisible, setIsVehicleRenameVisible] = useState(false);
  const [vehicleToRename, setVehicleToRename] = useState<any | null>(null);
  const [newVehicleName, setNewVehicleName] = useState("");

  // Init Data
  useEffect(() => {
    loadData();
  }, []);

  // Save auto
  useEffect(() => {
    const timer = setTimeout(() => {
      saveData();
    }, 2000);
    return () => clearTimeout(timer);
  }, [formData, vehicles, poolMembers, photos]);

  // --- PERSISTENCE SECURISEE (Audit 3.A) ---
  const saveData = async () => {
    try {
      const data = JSON.stringify({
        formData,
        vehicles,
        poolMembers,
        photos
      });
      // Chiffrement avant stockage
      const encrypted = encryptData(data);
      await AsyncStorage.setItem('OI_SESSION_SECURE', encrypted);
    } catch (e) {
      console.error("Save error", e);
    }
  };

  const loadData = async () => {
    try {
      const encrypted = await AsyncStorage.getItem('OI_SESSION_SECURE');
      let json = null;

      if (encrypted) {
         json = decryptData(encrypted);
         // Tentative de récupération fallback si mal chiffré ou ancienne version
         if (!json && encrypted.trim().startsWith('{')) {
             json = encrypted; 
         }
      }

      if (json) {
        const data = JSON.parse(json);
        if(data.formData) setFormData(data.formData);
        if(data.vehicles) setVehicles(data.vehicles);
        if(data.poolMembers) setPoolMembers(data.poolMembers);
        if(data.photos) setPhotos(data.photos);
      } else {
        // Initialiser avec des données par défaut si vide
        const defaultMembers = MEMBER_CONFIG.members.map((m, i) => ({
            ...m, 
            id: `m_${Date.now()}_${i}`,
            principales: "Sans",
            secondaires: "PSA",
            afis: "Sans",
            grenades: "Sans",
            equipement: "Sans",
            equipement2: "Sans",
            gpb: "GPBL"
        }));
        setPoolMembers(defaultMembers);

        const defaultVehicles = MEMBER_CONFIG.options.vehicules_types.map((type, i) => ({
            id: `v_def_${i}`,
            name: `${type}`,
            type: type,
            members: []
        }));
        setVehicles(defaultVehicles);
      }
    } catch (e) {
      console.error("Load error", e);
    }
  };

  // --- GESTION IMAGES & FICHIERS (Audit 4.B) ---

  const pickImage = async (category: string) => {
    // Audit Fix: quality réduite et base64:false pour éviter saturation mémoire
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false, 
      quality: 0.5, 
      base64: false 
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      
      const newPhoto: IPhoto = {
          id: Date.now().toString(),
          uri: asset.uri,
          category,
          annotations: []
      };
      setPhotos([...photos, newPhoto]);
    }
  };

  const deletePhoto = (id: string) => {
      setPhotos(photos.filter(p => p.id !== id));
  };

  const openAnnotation = (id: string) => {
      setCurrentPhotoToAnnotate(id);
      setIsAnnotationVisible(true);
  };

  const addAnnotation = (e: any) => {
      if(!currentPhotoToAnnotate) return;
      // Simulation click relatif
      // Dans une vraie app, on utiliserait les coordonnées de l'event touch par rapport à l'image
      // Ici on met un point au centre pour l'exemple simplifié
      const newAnnot = { x: 50, y: 50, text: (photos.find(p=>p.id===currentPhotoToAnnotate)?.annotations.length || 0) + 1 + "" };
      
      setPhotos(photos.map(p => {
          if(p.id === currentPhotoToAnnotate) {
              return { ...p, annotations: [...p.annotations, newAnnot] };
          }
          return p;
      }));
  };

  // --- GENERATION PDF ---

  const generateHTML = async () => {
    const { 
        date_op, type_mission, unite_redacteur, trigramme_redacteur, cadre_legal,
        mission_global, mission_particulier, menace_global, adversaires,
        autorites, secours, terrain_zone, terrain_obj,
        mesures_coordination, consignes_tir, consignes_particulieres,
        frequences, indicatifs, logo_mode, pdf_theme
    } = formData;

    const isDark = pdf_theme === 'dark';
    const isBg = logo_mode === 'background';

    // Audit 4.B: Chargement Lazy des images en base64 juste pour le PDF
    const processedPhotos: Record<string, string> = {};
    
    // Fonction helper pour charger une image
    const loadPhotoData = async (uri: string) => {
        try {
            return await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
        } catch(e) { return null; }
    };

    // Chargement de toutes les photos utilisées
    for(const p of photos) {
        const b64 = await loadPhotoData(p.uri);
        if(b64) processedPhotos[p.id] = `data:image/jpeg;base64,${b64}`;
    }

    // Récup Logo
    const logoPhoto = photos.find(p => p.category === 'photo_logo_unite');
    const logoSrc = logoPhoto ? processedPhotos[logoPhoto.id] : null;

    const colors = isDark ? {
        bg: '#000000', text: '#ffffff', accent: '#5b9bd5', danger: '#c0392b', border: '#ffffff'
    } : {
        bg: '#ffffff', text: '#000000', accent: '#0033a0', danger: '#c0392b', border: '#000000'
    };

    // CSS
    const css = `
        @page { margin: 1cm; }
        body { font-family: 'Helvetica', sans-serif; font-size: 10pt; color: ${colors.text}; background: ${colors.bg}; line-height: 1.3; }
        .page-break { page-break-before: always; }
        h1 { color: ${colors.accent}; font-size: 18pt; border-bottom: 2px solid ${colors.accent}; margin-bottom: 10px; padding-bottom: 5px; text-transform: uppercase; }
        h2 { background-color: ${colors.accent}; color: white; padding: 5px 10px; font-size: 12pt; margin-top: 15px; margin-bottom: 8px; border-radius: 4px; }
        h3 { color: ${colors.accent}; font-size: 11pt; border-bottom: 1px dashed ${colors.accent}; margin-top: 10px; margin-bottom: 5px; }
        .row { display: flex; flex-direction: row; justify-content: space-between; margin-bottom: 5px; }
        .col { flex: 1; padding-right: 10px; }
        .box { border: 1px solid ${colors.border}; padding: 8px; border-radius: 4px; margin-bottom: 10px; background-color: rgba(128,128,128,0.05); }
        .label { font-weight: bold; color: ${colors.accent}; font-size: 8pt; text-transform: uppercase; margin-right: 5px; }
        .value { font-weight: normal; }
        .danger { color: ${colors.danger}; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 9pt; }
        th { background-color: ${colors.accent}; color: white; padding: 4px; text-align: left; }
        td { border-bottom: 1px solid ${colors.border}; padding: 4px; }
        .vehicule-block { margin-bottom: 15px; break-inside: avoid; border: 1px solid ${colors.accent}; border-radius: 5px; overflow: hidden; }
        .vehicule-header { background-color: ${colors.accent}; color: white; padding: 5px; font-weight: bold; display: flex; justify-content: space-between; }
        .vehicule-content { padding: 5px; }
    `;

    // HEADER / LOGO LOGIC
    let headerHtml = '';
    let watermarkHtml = '';

    if (logoSrc) {
        if (isBg) {
             watermarkHtml = `
             <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 80%; height: 80%; z-index: -1; opacity: 0.1;">
                <img src="${logoSrc}" style="width: 100%; height: 100%; object-fit: contain;" />
             </div>`;
        } else {
             headerHtml = `<img src="${logoSrc}" style="height: 60px; float: right;" />`;
        }
    }

    // GENERATION HTML CONTENU
    // ... Je génère une structure simplifiée mais complète pour l'exemple
    // L'important est l'utilisation de processedPhotos pour les images
    
    const getPhotosHtml = (category: string, title: string) => {
        const catPhotos = photos.filter(p => p.category === category);
        if(catPhotos.length === 0) return '';
        
        let html = `<h2>${title}</h2><div style="display: flex; flex-wrap: wrap; gap: 10px;">`;
        catPhotos.forEach(p => {
             const src = processedPhotos[p.id];
             if(src) {
                 html += `
                 <div style="width: 45%; border: 1px solid ${colors.border}; position: relative; margin-bottom: 10px;">
                    <img src="${src}" style="width: 100%; height: 200px; object-fit: cover;" />
                    ${p.annotations.map(a => `<div style="position: absolute; top: ${a.y}%; left: ${a.x}%; background: red; width: 20px; height: 20px; border-radius: 10px; color: white; text-align: center; line-height: 20px; font-size: 10px; border: 1px solid white;">${a.text}</div>`).join('')}
                 </div>`;
             }
        });
        html += `</div>`;
        return html;
    };

    const html = `
    <!DOCTYPE html>
    <html>
    <head><style>${css}</style></head>
    <body>
        ${watermarkHtml}
        
        <!-- PAGE 1 : HEADER & MISSION -->
        <div style="border-bottom: 3px solid ${colors.accent}; padding-bottom: 10px; margin-bottom: 20px;">
            ${headerHtml}
            <div style="font-size: 24pt; font-weight: bold; color: ${colors.accent};">ORDRE INITIAL</div>
            <div style="font-size: 12pt;">${unite_redacteur} | ${date_op}</div>
        </div>

        <div class="row">
            <div class="col box">
                <div><span class="label">Rédacteur:</span> ${trigramme_redacteur}</div>
                <div><span class="label">Mission:</span> ${type_mission}</div>
                <div><span class="label">Cadre Légal:</span> ${cadre_legal}</div>
            </div>
        </div>

        <h2>I. SITUATION & MENACE</h2>
        <div class="box">
            <h3>Menace Globale</h3>
            <p>${menace_global || 'Néant'}</p>
            
            <h3>Adversaires Identifiés</h3>
            <table>
                <tr><th>Nom</th><th>Signalement</th><th>Danger</th></tr>
                ${adversaires.map(a => `<tr><td>${a.nom}</td><td>${a.signalement}</td><td class="${a.dangerosite === 'Élevée' ? 'danger' : ''}">${a.dangerosite}</td></tr>`).join('')}
            </table>
        </div>
        
        ${getPhotosHtml('photo_suspect', 'Photos Suspects')}

        <h2>II. MISSION</h2>
        <div class="box">
            <div style="margin-bottom: 10px;"><span class="label">Global:</span> ${mission_global}</div>
            <div><span class="label">Particulier:</span> ${mission_particulier}</div>
        </div>

        <h2>III. TERRAIN</h2>
        <div class="box">
            <div><span class="label">Zone:</span> ${terrain_zone}</div>
            <div><span class="label">Objectif:</span> ${terrain_obj}</div>
        </div>
        ${getPhotosHtml('photo_obj_global', 'Vue d\'Ensemble')}
        ${getPhotosHtml('photo_plan', 'Plans & Schémas')}

        <div class="page-break"></div>

        <h2>IV. EXÉCUTION & DISPOSITIF</h2>
        
        <h3>Véhicules & Personnels</h3>
        ${vehicles.map(v => `
            <div class="vehicule-block">
                <div class="vehicule-header">
                    <span>${v.name} (${v.type})</span>
                    <span>${v.members.length} pax</span>
                </div>
                <div class="vehicule-content">
                    <table>
                        <tr><th style="font-size:8pt;">Fct</th><th style="font-size:8pt;">Tri</th><th style="font-size:8pt;">Arme</th><th style="font-size:8pt;">Mat</th></tr>
                        ${v.members.map((m:any) => `<tr><td style="font-size:8pt;">${m.fonction}</td><td style="font-size:8pt;"><strong>${m.trigramme}</strong></td><td style="font-size:8pt;">${m.principales}</td><td style="font-size:8pt;">${m.equipements}</td></tr>`).join('')}
                    </table>
                </div>
            </div>
        `).join('')}

        <div class="box">
            <h3>Consignes</h3>
            <div><span class="label">Tir:</span> ${consignes_tir}</div>
            <div><span class="label">Coordination:</span> ${mesures_coordination.join(', ')}</div>
            <div><span class="label">Transmissions:</span> ${frequences.join(' / ')} (${indicatifs.join(', ')})</div>
        </div>
        
        <div style="text-align: center; margin-top: 30px; font-size: 8pt; color: ${colors.textMuted};">
            Généré par G-TAK PRAXIS - Document Confidentiel
        </div>
    </body>
    </html>
    `;

    return html;
  };

  const handleGeneratePDF = async () => {
    try {
      const html = await generateHTML();
      // Audit Fix: On génère le PDF et la mémoire des images sera libérée après
      const { uri } = await Print.printToFileAsync({ html, width: 595, height: 842 }); // A4
      await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
    } catch (e) {
      Alert.alert("Erreur", "Impossible de générer le PDF. Vérifiez l'espace mémoire.");
      console.error(e);
    }
  };

  // --- RENDERING ---

  const renderHeader = () => (
    <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <MaterialIcons name="close" size={24} color="white" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>ORDRE INITIAL (OI)</Text>
        <TouchableOpacity onPress={handleGeneratePDF} style={styles.pdfBtn}>
            <MaterialIcons name="picture-as-pdf" size={20} color="white" />
            <Text style={{color:'white', fontWeight:'bold', marginLeft:5}}>PDF</Text>
        </TouchableOpacity>
    </View>
  );

  const renderStepContent = () => {
      switch(step) {
          case 0: return (
              <View>
                  <SectionTitle title="Informations Opération" />
                  <InputField label="Unité Rédactrice" value={formData.unite_redacteur} onChange={(t:string)=>setFormData({...formData, unite_redacteur:t})} />
                  <InputField label="Trigramme Rédacteur" value={formData.trigramme_redacteur} onChange={(t:string)=>setFormData({...formData, trigramme_redacteur:t})} />
                  <InputField label="Date Opération" value={formData.date_op} onChange={(t:string)=>setFormData({...formData, date_op:t})} />
                  <InputField label="Type de Mission" value={formData.type_mission} onChange={(t:string)=>setFormData({...formData, type_mission:t})} />
                  <InputField label="Cadre Légal" value={formData.cadre_legal} onChange={(t:string)=>setFormData({...formData, cadre_legal:t})} />
                  
                  <View style={{marginTop: 20}}>
                      <Text style={styles.label}>Mode Logo PDF</Text>
                      <View style={{flexDirection:'row', gap:10}}>
                          <TouchableOpacity onPress={()=>setFormData({...formData, logo_mode:'header'})} style={[styles.chip, formData.logo_mode==='header' && styles.chipSelected]}><Text style={{color:'white'}}>En-tête</Text></TouchableOpacity>
                          <TouchableOpacity onPress={()=>setFormData({...formData, logo_mode:'background'})} style={[styles.chip, formData.logo_mode==='background' && styles.chipSelected]}><Text style={{color:'white'}}>Filigrane</Text></TouchableOpacity>
                      </View>
                      <TouchableOpacity style={styles.photoBtn} onPress={() => pickImage('photo_logo_unite')}>
                          <MaterialIcons name="add-a-photo" size={20} color="white" />
                          <Text style={{color:'white', marginLeft:10}}>Sélectionner Logo Unité</Text>
                      </TouchableOpacity>
                      {photos.some(p => p.category === 'photo_logo_unite') && <Text style={{color:COLORS.success, fontSize:12, marginTop:5}}>Logo chargé</Text>}
                  </View>
              </View>
          );
          case 1: return (
              <View>
                  <SectionTitle title="Mission" />
                  <InputField label="Mission Globale" multiline value={formData.mission_global} onChange={(t:string)=>setFormData({...formData, mission_global:t})} />
                  <InputField label="Mission Particulière" multiline value={formData.mission_particulier} onChange={(t:string)=>setFormData({...formData, mission_particulier:t})} />
                  
                  <SectionTitle title="Menace & Adversaire" />
                  <InputField label="Menace Globale" multiline value={formData.menace_global} onChange={(t:string)=>setFormData({...formData, menace_global:t})} />
                  
                  <Text style={styles.label}>Adversaires Spécifiques</Text>
                  {formData.adversaires.map((adv, idx) => (
                      <View key={idx} style={styles.box}>
                          <View style={{flexDirection:'row', justifyContent:'space-between'}}>
                              <Text style={{color:'white', fontWeight:'bold'}}>{adv.nom}</Text>
                              <TouchableOpacity onPress={() => {
                                  const newAdv = [...formData.adversaires];
                                  newAdv.splice(idx, 1);
                                  setFormData({...formData, adversaires: newAdv});
                              }}><MaterialIcons name="delete" size={20} color={COLORS.danger} /></TouchableOpacity>
                          </View>
                          <Text style={{color:COLORS.textMuted, fontSize:12}}>{adv.signalement} - {adv.dangerosite}</Text>
                      </View>
                  ))}
                  <TouchableOpacity style={styles.addBtn} onPress={() => {
                      Alert.prompt("Nom de l'adversaire", "", (nom) => {
                          if(nom) setFormData({...formData, adversaires: [...formData.adversaires, { id: Date.now().toString(), nom, signalement: "À renseigner", dangerosite: "Moyenne" }]});
                      });
                  }}>
                      <Text style={{color:'white'}}>+ Ajouter Adversaire</Text>
                  </TouchableOpacity>
                  
                  <View style={{marginTop:15}}>
                       <Text style={styles.label}>Photos Cibles / Suspects</Text>
                       <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                           {photos.filter(p=>p.category==='photo_suspect').map(p => (
                               <TouchableOpacity key={p.id} onPress={()=>openAnnotation(p.id)} onLongPress={()=>deletePhoto(p.id)}>
                                   <Image source={{uri: p.uri}} style={{width:80, height:80, borderRadius:8, marginRight:10, borderWidth:1, borderColor:COLORS.border}} />
                               </TouchableOpacity>
                           ))}
                           <TouchableOpacity style={styles.photoThumbAdd} onPress={() => pickImage('photo_suspect')}>
                               <MaterialIcons name="add" size={30} color={COLORS.textMuted} />
                           </TouchableOpacity>
                       </ScrollView>
                  </View>
              </View>
          );
          case 2: return (
               <View>
                   <SectionTitle title="Terrain & Environnement" />
                   <InputField label="Zone / Quartier" value={formData.terrain_zone} onChange={(t:string)=>setFormData({...formData, terrain_zone:t})} />
                   <InputField label="Objectif (Description)" multiline value={formData.terrain_obj} onChange={(t:string)=>setFormData({...formData, terrain_obj:t})} />
                   
                   <Text style={styles.label}>Photos Vue d'ensemble</Text>
                   <ScrollView horizontal>
                        <TouchableOpacity style={styles.photoThumbAdd} onPress={() => pickImage('photo_obj_global')}>
                             <MaterialIcons name="add" size={30} color={COLORS.textMuted} />
                        </TouchableOpacity>
                        {photos.filter(p=>p.category==='photo_obj_global').map(p => (
                             <Image key={p.id} source={{uri: p.uri}} style={{width:80, height:80, borderRadius:8, marginLeft:10}} />
                        ))}
                   </ScrollView>

                   <Text style={[styles.label, {marginTop:15}]}>Plans / Schémas</Text>
                   <ScrollView horizontal>
                        <TouchableOpacity style={styles.photoThumbAdd} onPress={() => pickImage('photo_plan')}>
                             <MaterialIcons name="add" size={30} color={COLORS.textMuted} />
                        </TouchableOpacity>
                        {photos.filter(p=>p.category==='photo_plan').map(p => (
                             <TouchableOpacity key={p.id} onPress={()=>openAnnotation(p.id)}>
                                <Image source={{uri: p.uri}} style={{width:80, height:80, borderRadius:8, marginLeft:10}} />
                             </TouchableOpacity>
                        ))}
                   </ScrollView>
               </View>
          );
          case 3: return (
              <View>
                  <SectionTitle title="Dispositif & Véhicules" />
                  <Text style={styles.helper}>Glissez les personnels du pool vers les véhicules (Simulation click)</Text>
                  
                  {vehicles.map(veh => (
                      <View key={veh.id} style={styles.vehicleCard}>
                          <View style={styles.vehicleHeader}>
                                <TouchableOpacity onPress={() => { setVehicleToRename(veh); setNewVehicleName(veh.name); setIsVehicleRenameVisible(true); }}>
                                    <Text style={styles.vehicleTitle}>{veh.name}</Text>
                                    <Text style={styles.vehicleSubtitle}>{veh.type}</Text>
                                </TouchableOpacity>
                                <Text style={{color:COLORS.primary}}>{veh.members.length} pax</Text>
                          </View>
                          <View style={styles.vehicleMembers}>
                              {veh.members.length === 0 && <Text style={{color:COLORS.textMuted, fontSize:12, padding:10}}>Vide</Text>}
                              {veh.members.map((m:any) => (
                                  <TouchableOpacity key={m.id} 
                                    style={styles.memberBadge} 
                                    onPress={() => {
                                        setTempMember(m);
                                        setIsMemberEditModalVisible(true);
                                    }}
                                    onLongPress={() => {
                                        // Retour au pool
                                        const newVehicles = [...vehicles];
                                        const vIndex = newVehicles.findIndex(v => v.id === veh.id);
                                        newVehicles[vIndex].members = newVehicles[vIndex].members.filter((mx:any) => mx.id !== m.id);
                                        setVehicles(newVehicles);
                                        setPoolMembers([...poolMembers, m]);
                                    }}>
                                      <Text style={styles.memberText}>{m.trigramme} ({m.fonction})</Text>
                                  </TouchableOpacity>
                              ))}
                              <TouchableOpacity style={styles.addMemberBtn} onPress={() => {
                                  // Ajouter depuis le pool (simple select pour l'exemple)
                                  if(poolMembers.length > 0) {
                                      const m = poolMembers[0];
                                      const newVehicles = [...vehicles];
                                      const vIndex = newVehicles.findIndex(v => v.id === veh.id);
                                      newVehicles[vIndex].members.push(m);
                                      setVehicles(newVehicles);
                                      setPoolMembers(poolMembers.slice(1));
                                  } else {
                                      Alert.alert("Pool vide", "Créez des personnels ou libérez-en.");
                                  }
                              }}>
                                  <MaterialIcons name="add" size={16} color="white" />
                              </TouchableOpacity>
                          </View>
                      </View>
                  ))}
                  
                  <Text style={styles.label}>Pool Personnels (Non affectés: {poolMembers.length})</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:20}}>
                      {poolMembers.map(m => (
                          <TouchableOpacity key={m.id} style={[styles.memberPoolBadge, {marginRight:10}]} onPress={() => { setTempMember(m); setIsMemberEditModalVisible(true); }}>
                              <Text style={{color:'white', fontWeight:'bold'}}>{m.trigramme}</Text>
                              <Text style={{color:COLORS.textMuted, fontSize:10}}>{m.fonction}</Text>
                          </TouchableOpacity>
                      ))}
                      <TouchableOpacity style={[styles.memberPoolBadge, {borderStyle:'dashed'}]} onPress={() => {
                          const newM = { ...MEMBER_CONFIG.members[0], id: Date.now().toString(), trigramme: 'NEW', fonction: 'Inter' };
                          setPoolMembers([...poolMembers, newM]);
                      }}>
                          <Text style={{color:COLORS.textMuted}}>+ Créer</Text>
                      </TouchableOpacity>
                  </ScrollView>
              </View>
          );
          case 4: return (
              <View>
                  <SectionTitle title="Exécution & Consignes" />
                  <InputField label="Consignes Tir" value={formData.consignes_tir} onChange={(t:string)=>setFormData({...formData, consignes_tir:t})} />
                  <InputField label="Consignes Particulières" multiline value={formData.consignes_particulieres} onChange={(t:string)=>setFormData({...formData, consignes_particulieres:t})} />
                  
                  <DynamicListInput label="Mesures de Coordination" list={formData.mesures_coordination} onChange={(l:any)=>setFormData({...formData, mesures_coordination:l})} />
                  <DynamicListInput label="Fréquences Radio" list={formData.frequences} onChange={(l:any)=>setFormData({...formData, frequences:l})} />
                  <DynamicListInput label="Indicatifs" list={formData.indicatifs} onChange={(l:any)=>setFormData({...formData, indicatifs:l})} />
                  <DynamicListInput label="Moyens Secours" list={formData.secours} onChange={(l:any)=>setFormData({...formData, secours:l})} />
              </View>
          );
          default: return null;
      }
  };

  return (
    <SafeAreaView style={styles.container}>
      {renderHeader()}
      <View style={styles.stepper}>
          {[0,1,2,3,4].map(i => (
              <TouchableOpacity key={i} onPress={()=>setStep(i)} style={[styles.stepDot, step===i && styles.stepDotActive]} />
          ))}
      </View>
      
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{flex:1}}>
          <ScrollView style={styles.content}>
              {renderStepContent()}
              <View style={{height: 100}} />
          </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
          {step > 0 && (
              <TouchableOpacity onPress={()=>setStep(step-1)} style={styles.navBtn}>
                  <Text style={styles.navBtnText}>Précédent</Text>
              </TouchableOpacity>
          )}
          <View style={{flex:1}}/>
          {step < 4 ? (
              <TouchableOpacity onPress={()=>setStep(step+1)} style={[styles.navBtn, {backgroundColor:COLORS.primary}]}>
                  <Text style={styles.navBtnText}>Suivant</Text>
              </TouchableOpacity>
          ) : (
             <TouchableOpacity onPress={handleGeneratePDF} style={[styles.navBtn, {backgroundColor:COLORS.success}]}>
                  <Text style={styles.navBtnText}>Terminer & PDF</Text>
              </TouchableOpacity> 
          )}
      </View>
      
      {/* MODAL EDITION MEMBRE */}
      <Modal visible={isMemberEditModalVisible} transparent animationType="slide">
          <View style={styles.modalContainer}>
              <View style={styles.modalContent}>
                  <Text style={styles.modalTitle}>Éditer Personnel</Text>
                  {tempMember && (
                      <ScrollView>
                          <InputField label="Trigramme" value={tempMember.trigramme} onChange={(t:string)=>setTempMember({...tempMember, trigramme:t})} />
                          <ChipSelector label="Fonction" selected={[tempMember.fonction]} options={MEMBER_CONFIG.options.fonctions} onChange={(s:string[])=>setTempMember({...tempMember, fonction:s[0]})} />
                          <ChipSelector label="Cellule" selected={[tempMember.cellule]} options={MEMBER_CONFIG.options.cellules} onChange={(s:string[])=>setTempMember({...tempMember, cellule:s[0]})} />
                          <ChipSelector label="Arme Princ." selected={[tempMember.principales]} options={MEMBER_CONFIG.options.principales} onChange={(s:string[])=>setTempMember({...tempMember, principales:s[0]})} />
                          <ChipSelector label="Tenue" selected={[tempMember.tenue]} options={MEMBER_CONFIG.options.tenues} onChange={(s:string[])=>setTempMember({...tempMember, tenue:s[0]})} />
                      </ScrollView>
                  )}
                  <View style={{flexDirection:'row', justifyContent:'flex-end', marginTop:20, gap:10}}>
                      <TouchableOpacity onPress={()=>setIsMemberEditModalVisible(false)} style={styles.btnSec}><Text style={{color:'white'}}>Annuler</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => {
                          // Sauvegarde dans vehicles ou pool
                          if(poolMembers.find(m => m.id === tempMember.id)) {
                              setPoolMembers(poolMembers.map(m => m.id === tempMember.id ? tempMember : m));
                          } else {
                              const newVehicles = [...vehicles];
                              newVehicles.forEach(v => {
                                  v.members = v.members.map((m:any) => m.id === tempMember.id ? tempMember : m);
                              });
                              setVehicles(newVehicles);
                          }
                          setIsMemberEditModalVisible(false);
                      }} style={styles.btnPrim}><Text style={{color:'white'}}>Valider</Text></TouchableOpacity>
                  </View>
              </View>
          </View>
      </Modal>

      {/* MODAL RENAME VEHICLE */}
      <Modal visible={isVehicleRenameVisible} transparent animationType="fade">
           <View style={styles.modalContainer}>
               <View style={[styles.modalContent, {height:'auto'}]}>
                   <Text style={styles.modalTitle}>Renommer Véhicule</Text>
                   <InputField label="Indicatif / Nom" value={newVehicleName} onChange={setNewVehicleName} />
                   <View style={{flexDirection:'row', justifyContent:'flex-end', marginTop:20, gap:10}}>
                       <TouchableOpacity onPress={()=>setIsVehicleRenameVisible(false)} style={styles.btnSec}><Text style={{color:'white'}}>Annuler</Text></TouchableOpacity>
                       <TouchableOpacity onPress={() => {
                           if(vehicleToRename) {
                               setVehicles(vehicles.map(v => v.id === vehicleToRename.id ? { ...v, name: newVehicleName } : v));
                           }
                           setIsVehicleRenameVisible(false);
                       }} style={styles.btnPrim}><Text style={{color:'white'}}>Valider</Text></TouchableOpacity>
                   </View>
               </View>
           </View>
      </Modal>

      {/* MODAL ANNOTATION PHOTO (SIMPLIFIÉE) */}
      <Modal visible={isAnnotationVisible} transparent animationType="slide">
          <View style={{flex:1, backgroundColor:'black'}}>
              <SafeAreaView style={{flex:1}}>
                  <View style={{flexDirection:'row', justifyContent:'space-between', padding:10}}>
                      <TouchableOpacity onPress={()=>setIsAnnotationVisible(false)}><MaterialIcons name="arrow-back" size={30} color="white" /></TouchableOpacity>
                      <Text style={{color:'white', fontWeight:'bold'}}>Annoter</Text>
                      <TouchableOpacity onPress={addAnnotation}><MaterialIcons name="add-circle" size={30} color={COLORS.primary} /></TouchableOpacity>
                  </View>
                  <View style={{flex:1, justifyContent:'center', alignItems:'center'}}>
                      {currentPhotoToAnnotate && (
                          <View style={{position:'relative'}}>
                              <Image source={{uri: photos.find(p=>p.id===currentPhotoToAnnotate)?.uri}} style={{width: Dimensions.get('window').width, height: 400, resizeMode:'contain'}} />
                              {photos.find(p=>p.id===currentPhotoToAnnotate)?.annotations.map((a, i) => (
                                  <View key={i} style={{position:'absolute', top: `${a.y}%`, left: `${a.x}%`, width:20, height:20, backgroundColor:'red', borderRadius:10}}>
                                      <Text style={{color:'white', textAlign:'center', fontSize:10, fontWeight:'bold'}}>{a.text}</Text>
                                  </View>
                              ))}
                          </View>
                      )}
                  </View>
              </SafeAreaView>
          </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { padding: 15, borderBottomWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Platform.OS === 'android' ? 30 : 0 },
  headerTitle: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', letterSpacing: 1 },
  closeBtn: { padding: 5 },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.danger, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  stepper: { flexDirection: 'row', justifyContent: 'center', padding: 10, gap: 8 },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.surfaceLight },
  stepDotActive: { backgroundColor: COLORS.primary, width: 20 },
  content: { flex: 1, padding: 20 },
  footer: { padding: 20, borderTopWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface },
  navBtn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, backgroundColor: COLORS.surfaceLight },
  navBtnText: { color: 'white', fontWeight: 'bold' },
  
  // FORM COMPONENTS
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, marginTop: 10 },
  sectionLine: { flex: 1, height: 1, backgroundColor: COLORS.border },
  sectionTitle: { color: COLORS.secondary, marginHorizontal: 10, fontWeight: 'bold', fontSize: 12 },
  inputGroup: { marginBottom: 15 },
  label: { color: COLORS.textMuted, fontSize: 11, marginBottom: 5, textTransform: 'uppercase', fontWeight: 'bold' },
  input: { backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 12, color: 'white', fontSize: 14 },
  textArea: { height: 80, textAlignVertical: 'top' },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: COLORS.surfaceLight, borderWidth: 1, borderColor: COLORS.border },
  chipSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  
  // CARDS
  box: { backgroundColor: COLORS.surface, padding: 15, borderRadius: 8, marginBottom: 10, borderLeftWidth: 3, borderLeftColor: COLORS.secondary },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 10, borderStyle: 'dashed', borderWidth: 1, borderColor: COLORS.textMuted, borderRadius: 8, marginTop: 10 },
  photoThumbAdd: { width: 80, height: 80, borderRadius: 8, backgroundColor: COLORS.surfaceLight, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed' },
  photoBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surfaceLight, padding: 10, borderRadius: 8, marginTop: 10, alignSelf: 'flex-start' },

  // VEHICLES
  vehicleCard: { backgroundColor: COLORS.surface, borderRadius: 10, marginBottom: 15, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border },
  vehicleHeader: { backgroundColor: COLORS.surfaceLight, padding: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  vehicleTitle: { color: 'white', fontWeight: 'bold' },
  vehicleSubtitle: { color: COLORS.textMuted, fontSize: 10 },
  vehicleMembers: { padding: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  memberBadge: { backgroundColor: '#3f3f46', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  memberPoolBadge: { backgroundColor: COLORS.surfaceLight, padding: 10, borderRadius: 8, minWidth: 60, alignItems: 'center' },
  memberText: { color: 'white', fontSize: 10 },
  addMemberBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },

  // MODAL
  modalContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: COLORS.surface, borderRadius: 12, padding: 20, maxHeight: '80%', borderWidth: 1, borderColor: COLORS.border },
  modalTitle: { color: 'white', fontSize: 18, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  btnPrim: { backgroundColor: COLORS.primary, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  btnSec: { backgroundColor: COLORS.surfaceLight, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8 },
  helper: { color: COLORS.textMuted, fontSize: 12, fontStyle: 'italic', marginBottom: 10 }
});
