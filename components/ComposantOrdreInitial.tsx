import React, { useState, useEffect, useRef } from 'react';
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
  FlatList,
  Switch,
  ActivityIndicator,
  Share
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';

// --- PROPS ---
interface OIViewProps {
    onClose?: () => void; // Prop pour fermer le composant
}

// --- CONSTANTES & CONFIGURATION ---

const MEMBER_CONFIG = {
  options: {
    fonctions: ["Chef inter", "Chef dispo", "Chef Oscar", "DE", "Cyno", "Inter", "Effrac", "AO", "Sans"],
    cellules: ["AO1", "AO2", "AO3", "AO4", "AO5", "AO6", "AO7", "AO8", "India 1", "India 2", "India 3", "India 4", "India 5", "Effrac", "Sans"],
    principales: ["UMP9", "G36", "FAP", "Sans"],
    afis: ["PIE", "LBD40", "LBD44", "Sans"],
    secondaires: ["PSA", "Sans"],
    grenades: ["GENL", "MP7", "Sans"],
    equipements: ["Sans", "BBAL", "Belier", "Lacry", "IL", "Lot 5.11", "Lot Oscar", "Pince"],
    equipements2: ["Sans", "Échelle", "Stop stick", "Lacry", "Cale", "IL", "Pass"],
    tenues: ["UBAS", "4S", "Bleu", "Civile", "Ghillie", "Treillis"],
    gpbs: ["GPBL", "GPBPD", "Sans"],
    vehicules_types: ["Sharan", "Kodiaq", "5008", "Scénic", "BT", "Blindé"]
  },
  members: [
    { trigramme: "PRC", fonction: "Inter", cellule: "AO1", tenue: "UBAS" },
    { trigramme: "RTI", fonction: "Sans", cellule: "India 1", tenue: "UBAS" },
    // ... (Liste extensible)
  ]
};

const COLORS = {
  bg: '#050505',
  surface: '#161619',
  surfaceLight: '#2a2a2a',
  primary: '#3b82f6', // Accent Blue
  secondary: '#94a3b8',
  text: '#e0e0e0',
  textMuted: '#64748b',
  danger: '#ef4444',
  success: '#22c55e',
  border: 'rgba(255, 255, 255, 0.08)',
  inputBg: 'rgba(0, 0, 0, 0.4)'
};

// --- TYPES COMPLETS ---

interface IOIState {
  // 1. Situation
  date_op: string;
  situation_generale: string;
  situation_particuliere: string;

  // 2. Adversaire 1
  nom_adversaire: string;
  domicile_adversaire: string;
  date_naissance: string;
  lieu_naissance: string;
  stature_adversaire: string;
  ethnie_adversaire: string;
  signes_particuliers: string;
  profession_adversaire: string;
  antecedents_adversaire: string;
  etat_esprit_list: string[]; // Chips
  attitude_adversaire: string;
  volume_list: string[]; // Chips
  substances_adversaire: string;
  vehicules_list: string[]; // Dynamic inputs
  armes_connues: string;
  me_list: string[]; // ME1, ME2...

  // 2b. Adversaire 2
  nom_adversaire_2: string;
  domicile_adversaire_2: string;
  date_naissance_2: string;
  lieu_naissance_2: string;
  stature_adversaire_2: string;
  ethnie_adversaire_2: string;
  signes_particuliers_2: string;
  profession_adversaire_2: string;
  antecedents_adversaire_2: string;
  etat_esprit_list_2: string[];
  attitude_adversaire_2: string;
  volume_list_2: string[];
  substances_adversaire_2: string;
  vehicules_list_2: string[];
  armes_connues_2: string;
  me_list_2: string[];

  // 3. Environnement
  amies: string;
  terrain_info: string;
  population: string;
  cadre_juridique: string;

  // 4. Mission
  missions_psig: string;

  // 5. Exécution
  date_execution: string;
  heure_execution: string;
  action_body_text: string;
  time_events: { type: string; hour: string; description: string }[];
  hypothese_h1: string;
  hypothese_h2: string;
  hypothese_h3: string;

  // 6. Articulation
  place_chef: string;
  // India
  india_mission: string;
  india_objectif: string;
  india_itineraire: string;
  india_points_particuliers: string;
  india_cat: string;
  // AO
  ao_zone_installation: string;
  ao_mission: string;
  ao_secteur_surveillance: string;
  ao_points_particuliers: string;
  ao_place_chef: string;
  ao_cat: string;

  // 9. Divers
  cat_generales: string;
  no_go: string;
  cat_liaison: string;
}

interface IMember {
  id: string;
  trigramme: string;
  fonction: string;
  cellule: string;
  principales: string;
  secondaires: string;
  afis: string;
  grenades: string;
  equipement: string;
  equipement2: string;
  tenue: string;
  gpb: string;
}

interface IVehicle {
  id: string;
  name: string;
  type: string;
  members: IMember[];
}

interface IPhotoAnnotation {
  x: number; // %
  y: number; // %
  text?: string;
  type: 'marker';
}

interface IPhoto {
  id: string;
  uri: string;
  category: string; // ID du container HTML original (ex: 'adversary_photo_preview_container')
  annotations: IPhotoAnnotation[];
}

const INITIAL_STATE: IOIState = {
  date_op: new Date().toISOString().split('T')[0],
  situation_generale: "", situation_particuliere: "",
  
  nom_adversaire: "", domicile_adversaire: "", date_naissance: "", lieu_naissance: "",
  stature_adversaire: "", ethnie_adversaire: "Caucasien", signes_particuliers: "",
  profession_adversaire: "", antecedents_adversaire: "",
  etat_esprit_list: [], attitude_adversaire: "", volume_list: [],
  substances_adversaire: "", vehicules_list: [], armes_connues: "", me_list: [],

  nom_adversaire_2: "", domicile_adversaire_2: "", date_naissance_2: "", lieu_naissance_2: "",
  stature_adversaire_2: "", ethnie_adversaire_2: "Caucasien", signes_particuliers_2: "",
  profession_adversaire_2: "", antecedents_adversaire_2: "",
  etat_esprit_list_2: [], attitude_adversaire_2: "", volume_list_2: [],
  substances_adversaire_2: "", vehicules_list_2: [], armes_connues_2: "", me_list_2: [],

  amies: "", terrain_info: "", population: "", cadre_juridique: "",
  missions_psig: "INTERPELLER L'OBJECTIF.\nASSISTER LORS DE LA PERQUISITION.\nCONDUITE AU LIEU DE GAV.",
  
  date_execution: "", heure_execution: "06:00",
  action_body_text: "En vue d'appréhender le(s) mis en cause et empêcher la déperdition des preuves,\nJe veux, le (date) à partir de (heure), pour une action (type d'action) investir le domicile...",
  time_events: [
    { type: 'T0', hour: '', description: 'Rasso PSIG' },
    { type: 'T1', hour: '', description: 'Départ PR' },
    { type: 'T2', hour: '', description: 'Départ LE' },
    { type: 'T3', hour: '', description: 'MEP TERMINÉ' },
    { type: 'T4', hour: '', description: 'TOP ACTION' },
  ],
  hypothese_h1: "Target présente LE1", hypothese_h2: "Target présente LE2", hypothese_h3: "Target absente",

  place_chef: "",
  india_mission: "RECONNAÎTRE LE DOMICILE EN VUE D'APPRÉHENDER L'OBJECTIF", india_objectif: "", india_itineraire: "", india_points_particuliers: "", india_cat: "",
  ao_zone_installation: "", ao_mission: "BOUCLER - SURVEILLER - INTERDIRE TOUTE FUITE", ao_secteur_surveillance: "", ao_points_particuliers: "", ao_place_chef: "", ao_cat: "",

  cat_generales: "- Si rébellion, user du strict niveau de force nécessaire\n- Si retranché, alerter en mesure de se ré-articuler",
  no_go: "", cat_liaison: "TOM: \nDIR: \nGestuelle et visuelle entre les éléments INDIA"
};

// --- COMPONENT PRINCIPAL ---

export default function OIView({ onClose }: OIViewProps) {
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<IOIState>(INITIAL_STATE);
  const [vehicles, setVehicles] = useState<IVehicle[]>([]);
  const [poolMembers, setPoolMembers] = useState<IMember[]>([]);
  const [photos, setPhotos] = useState<IPhoto[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null); // Pour PATRACDVR
  
  // Annotation Modal State
  const [isAnnotationVisible, setIsAnnotationVisible] = useState(false);
  const [currentPhotoToAnnotate, setCurrentPhotoToAnnotate] = useState<string | null>(null);

  // Quick Edit Modal State
  const [isQuickEditVisible, setIsQuickEditVisible] = useState(false);
  const [memberToEdit, setMemberToEdit] = useState<IMember | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  // --- PERSISTENCE ---
  const saveData = async () => {
    try {
      const data = { formData, vehicles, poolMembers, photos };
      await AsyncStorage.setItem('OI_SESSION', JSON.stringify(data));
    } catch (e) {
      console.error("Save error", e);
    }
  };

  const loadData = async () => {
    try {
      const json = await AsyncStorage.getItem('OI_SESSION');
      if (json) {
        const data = JSON.parse(json);
        if (data.formData) setFormData(data.formData);
        if (data.vehicles) setVehicles(data.vehicles);
        if (data.poolMembers) setPoolMembers(data.poolMembers);
        if (data.photos) setPhotos(data.photos);
      } else {
        // Load default members if no session
        const initialPool = MEMBER_CONFIG.members.map((m, i) => ({
          ...m,
          id: `m_${Date.now()}_${i}`,
          principales: "Sans", secondaires: "PSA", afis: "Sans", grenades: "Sans",
          equipement: "Sans", equipement2: "Sans", gpb: "GPBL"
        }));
        setPoolMembers(initialPool);
      }
    } catch (e) {
      console.error("Load error", e);
    }
  };

  // --- IMPORT / EXPORT JSON ---

  const exportSessionToJson = async () => {
    try {
      const data = { formData, vehicles, poolMembers, photos };
      const jsonString = JSON.stringify(data, null, 2);
      const fileName = `OI_Session_${new Date().toISOString().split('T')[0]}.json`;
      const fileUri = FileSystem.documentDirectory + fileName;

      await FileSystem.writeAsStringAsync(fileUri, jsonString);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert("Succès", `Fichier sauvegardé: ${fileUri}`);
      }
    } catch (e) {
      console.error("Export error", e);
      Alert.alert("Erreur", "Impossible d'exporter la session.");
    }
  };

  const importSessionFromJson = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true
      });

      if (result.canceled) return;

      const fileUri = result.assets[0].uri;
      const jsonString = await FileSystem.readAsStringAsync(fileUri);
      const data = JSON.parse(jsonString);

      if (data.formData) setFormData(data.formData);
      if (data.vehicles) setVehicles(data.vehicles);
      if (data.poolMembers) setPoolMembers(data.poolMembers);
      
      if (data.photos && data.photos.length > 0) {
        Alert.alert("Attention", "Les photos importées peuvent ne pas s'afficher si elles proviennent d'un autre appareil.");
        setPhotos(data.photos);
      } else {
        setPhotos([]);
      }

      await saveData(); // Sauvegarde locale immédiate
      Alert.alert("Succès", "Session importée avec succès.");

    } catch (e) {
      console.error("Import error", e);
      Alert.alert("Erreur", "Fichier invalide ou corrompu.");
    }
  };

  // --- HELPERS FORM ---
  const updateField = (field: keyof IOIState, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const addChip = (field: keyof IOIState, value: string) => {
    const list = (formData[field] as string[]) || [];
    if (!list.includes(value)) updateField(field, [...list, value]);
  };

  const removeChip = (field: keyof IOIState, value: string) => {
    const list = (formData[field] as string[]) || [];
    updateField(field, list.filter(v => v !== value));
  };

  const addDynamicItem = (field: keyof IOIState, value: string) => {
    const list = (formData[field] as string[]) || [];
    updateField(field, [...list, value]);
  };

  // --- PATRACDVR LOGIC (Tap to select) ---
  const handleMemberTap = (member: IMember) => {
    if (selectedMemberId === member.id) {
      setSelectedMemberId(null); // Deselect
      setIsQuickEditVisible(false);
    } else {
      setSelectedMemberId(member.id);
      setMemberToEdit(member);
    }
  };

  const assignSelectedMemberToVehicle = (vehicleId: string) => {
    if (!selectedMemberId) return;
    
    let member = poolMembers.find(m => m.id === selectedMemberId);
    let source = 'pool';
    
    if (!member) {
      vehicles.forEach(v => {
        const found = v.members.find(m => m.id === selectedMemberId);
        if (found) { member = found; source = v.id; }
      });
    }

    if (member) {
      if (source === 'pool') {
        setPoolMembers(prev => prev.filter(m => m.id !== selectedMemberId));
      } else {
        setVehicles(prev => prev.map(v => v.id === source ? { ...v, members: v.members.filter(m => m.id !== selectedMemberId) } : v));
      }
      setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, members: [...v.members, member!] } : v));
      setSelectedMemberId(null);
    }
  };

  const returnMemberToPool = (memberId: string) => {
    let member: IMember | undefined;
    vehicles.forEach(v => {
      const found = v.members.find(m => m.id === memberId);
      if (found) member = found;
    });

    if (member) {
      setVehicles(prev => prev.map(v => ({ ...v, members: v.members.filter(m => m.id !== memberId) })));
      setPoolMembers(prev => [...prev, { ...member!, cellule: 'Sans', fonction: 'Sans' }]);
    }
  };

  const addVehicle = (type: string) => {
    const newVeh: IVehicle = {
      id: `v_${Date.now()}`,
      name: `${type} ${vehicles.length + 1}`,
      type,
      members: []
    };
    setVehicles([...vehicles, newVeh]);
  };

  // --- PHOTO LOGIC ---
  const pickImage = async (category: string) => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.7,
      base64: true
    });

    if (!result.canceled) {
      const newPhoto: IPhoto = {
        id: Date.now().toString(),
        uri: result.assets[0].uri,
        category,
        annotations: []
      };
      setPhotos([...photos, newPhoto]);
    }
  };

  const addAnnotation = (x: number, y: number) => {
    if (!currentPhotoToAnnotate) return;
    setPhotos(prev => prev.map(p => {
      if (p.id === currentPhotoToAnnotate) {
        return {
          ...p,
          annotations: [...p.annotations, { x, y, type: 'marker', text: (p.annotations.length + 1).toString() }]
        };
      }
      return p;
    }));
  };

  // --- HTML GENERATOR FOR PDF ---
  const generateHTML = () => {
    const { date_op, nom_adversaire } = formData;
    const wrap = (tag: string, content: string, style = "") => `<${tag} style="${style}">${content}</${tag}>`;
    const title = (t: string) => wrap('h2', t, `color: ${COLORS.primary}; border-bottom: 2px solid ${COLORS.primary}; margin-top: 20px; font-family: 'Oswald';`);
    const sub = (t: string) => wrap('h3', t, `color: ${COLORS.primary}; margin-top: 15px; font-family: 'Oswald'; font-size: 14px;`);
    const row = (l: string, v: string) => `<tr><td style="padding: 5px; border: 1px solid #444; width: 30%; font-weight:bold;">${l}</td><td style="padding: 5px; border: 1px solid #444;">${v || '-'}</td></tr>`;
    
    const renderComposition = (prefix: string) => {
        const allMembers = vehicles.flatMap(v => v.members).concat(poolMembers);
        const relevant = allMembers.filter(m => m.cellule.toLowerCase().startsWith(prefix.toLowerCase()));
        const grouped: {[key:string]: string[]} = {};
        relevant.forEach(m => {
            if (!grouped[m.cellule]) grouped[m.cellule] = [];
            grouped[m.cellule].push(`${m.trigramme}${m.fonction !== 'Sans' ? ` (${m.fonction})` : ''}`);
        });
        return Object.keys(grouped).sort().map(k => 
            `<div style="margin-bottom:5px;"><strong style="color:${COLORS.danger}">${k}</strong> : ${grouped[k].join(' - ')}</div>`
        ).join('');
    };

    const renderImages = (cat: string, title: string) => {
        const catPhotos = photos.filter(p => p.category === cat);
        if (catPhotos.length === 0) return '';
        return catPhotos.map(p => `
            <div style="page-break-inside: avoid; margin: 10px 0; text-align: center; border: 1px solid ${COLORS.primary}; padding: 5px;">
                <h4 style="color:${COLORS.primary}; margin:0;">${title}</h4>
                <div style="position: relative; display: inline-block;">
                    <img src="${p.uri}" style="max-width: 100%; max-height: 300px;" />
                    ${p.annotations.map(a => `
                        <div style="position: absolute; left: ${a.x}%; top: ${a.y}%; width: 20px; height: 20px; background: rgba(255,0,0,0.7); color: white; border-radius: 50%; text-align: center; line-height: 20px; font-size: 10px; transform: translate(-50%, -50%); border: 1px solid white;">
                            ${a.text}
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    };

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Oswald:wght@500&display=swap');
          body { font-family: 'JetBrains Mono', sans-serif; background: #fff; color: #000; padding: 20px; font-size: 12px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
          .banner { text-align: center; margin-bottom: 20px; border: 2px solid #000; padding: 10px; }
          .page-break { page-break-before: always; }
        </style>
      </head>
      <body>
        <div class="banner">
            <h1 style="font-family:'Oswald'; margin:0; font-size: 24px;">ORDRE INITIAL</h1>
            <div>${formData.nom_adversaire} // ${date_op}</div>
        </div>

        ${title('1. SITUATION')}
        ${sub('1.1 Générale')}${wrap('p', formData.situation_generale)}
        ${sub('1.2 Particulière')}${wrap('p', formData.situation_particuliere)}

        ${title('2. ADVERSAIRE(S)')}
        <table>
            ${row('Nom', formData.nom_adversaire)}
            ${row('Domicile', formData.domicile_adversaire)}
            ${row('Description', `${formData.stature_adversaire} / ${formData.ethnie_adversaire}`)}
            ${row('Véhicules', formData.vehicules_list.join(', '))}
            ${row('Armes', formData.armes_connues)}
        </table>
        ${renderImages('adversary_photo_preview_container', 'Photo Cible 1')}
        
        ${formData.nom_adversaire_2 ? `
            ${sub('Cible Secondaire')}
            <table>
                ${row('Nom', formData.nom_adversaire_2)}
                ${row('Domicile', formData.domicile_adversaire_2)}
            </table>
            ${renderImages('adversary_photo_preview_container_2', 'Photo Cible 2')}
        ` : ''}

        ${title('3. MISSION')}
        <div style="font-size: 16px; font-weight: bold; border: 2px solid ${COLORS.danger}; padding: 10px; text-align: center;">
            ${formData.missions_psig.replace(/\n/g, '<br>')}
        </div>

        ${title('4. EXÉCUTION')}
        ${wrap('p', formData.action_body_text.replace(/\n/g, '<br>'))}
        
        ${sub('Chronologie')}
        <table>
            <tr style="background:#eee;"><th>Type</th><th>Heure</th><th>Action</th></tr>
            ${formData.time_events.map(e => `<tr><td style="border:1px solid #ccc; padding:4px;">${e.type}</td><td style="border:1px solid #ccc;">${e.hour}</td><td style="border:1px solid #ccc;">${e.description}</td></tr>`).join('')}
        </table>

        ${title('5. ARTICULATION')}
        ${sub('Place du Chef')} ${wrap('div', formData.place_chef)}
        
        ${sub('INDIA (Inter)')}
        ${renderComposition('India')}
        ${wrap('div', `<strong>Mission:</strong> ${formData.india_mission}`)}
        ${wrap('div', `<strong>CAT:</strong> ${formData.india_cat.replace(/\n/g, '<br>')}`)}
        
        ${renderImages('photo_container_itineraire_exterieur_preview_container', 'Itinéraire Ext')}

        ${sub('AO (Appui/Obs)')}
        ${renderComposition('AO')}
        ${wrap('div', `<strong>Mission:</strong> ${formData.ao_mission}`)}
        
        ${renderImages('photo_container_emplacement_ao_preview_container', 'Vue AO')}

        ${title('6. PATRACDVR')}
        ${vehicles.map(v => `
            <div style="margin-bottom: 10px; border: 1px solid #ccc; padding: 5px;">
                <strong>${v.name} (${v.type})</strong>: 
                ${v.members.map(m => `${m.trigramme} (${m.principales}/${m.tenue})`).join(', ')}
            </div>
        `).join('')}

        ${title('7. DIVERS & SÉCURITÉ')}
        ${sub('Conduites à tenir')}
        ${wrap('div', formData.cat_generales.replace(/\n/g, '<br>'))}
        ${formData.no_go ? `<div style="color:red; font-weight:bold; margin-top:10px;">NO GO: ${formData.no_go}</div>` : ''}

        <div style="margin-top: 50px; text-align: center; font-size: 10px; color: #666;">
            Généré par G-TAK // ${new Date().toLocaleString()}
        </div>
      </body>
      </html>
    `;
  };

  const handleGeneratePDF = async () => {
    try {
      const html = generateHTML();
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
    } catch (e) {
      Alert.alert("Erreur PDF", "Impossible de générer le document.");
    }
  };

  // --- RENDERING WIZARD ---

  const renderInput = (label: string, field: keyof IOIState, multiline = false) => (
    <View style={styles.inputGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { height: 80, textAlignVertical: 'top' }]}
        value={formData[field] as string}
        onChangeText={(t) => updateField(field, t)}
        multiline={multiline}
        placeholderTextColor={COLORS.textMuted}
      />
    </View>
  );

  const renderChips = (field: keyof IOIState, options: string[]) => (
    <View style={styles.inputGroup}>
      <Text style={styles.label}>{field.toString().replace(/_/g, ' ').toUpperCase()}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map(opt => {
          const selected = (formData[field] as string[]).includes(opt);
          return (
            <TouchableOpacity
              key={opt}
              style={[styles.chip, selected && styles.chipSelected]}
              onPress={() => selected ? removeChip(field, opt) : addChip(field, opt)}
            >
              <Text style={{ color: selected ? '#fff' : COLORS.secondary }}>{opt}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const renderStepContent = () => {
    switch (step) {
      case 0: // SITUATION
        return (
          <View>
            {renderInput("Date Opération", "date_op")}
            {renderInput("Situation Générale", "situation_generale", true)}
            {renderInput("Situation Particulière", "situation_particuliere", true)}
          </View>
        );
      case 1: // ADVERSAIRE 1
        return (
          <View>
            <Text style={styles.sectionTitle}>CIBLE PRINCIPALE</Text>
            {renderInput("Nom", "nom_adversaire")}
            {renderInput("Domicile", "domicile_adversaire", true)}
            <View style={styles.row}>
                <View style={{flex:1}}>{renderInput("Stature", "stature_adversaire")}</View>
                <View style={{width:10}}/>
                <View style={{flex:1}}>{renderInput("Ethnie", "ethnie_adversaire")}</View>
            </View>
            {renderChips("etat_esprit_list", ["Calme", "Hostile", "Armé", "Déterminé", "Inconnu"])}
            {renderInput("Armes Connues", "armes_connues")}
            {renderInput("Véhicules (Liste séparée par virgules)", "vehicules_list")}
            <TouchableOpacity style={styles.photoBtn} onPress={() => pickImage('adversary_photo_preview_container')}>
                <Text style={styles.btnText}>+ PHOTO CIBLE</Text>
            </TouchableOpacity>
          </View>
        );
      case 2: // ADVERSAIRE 2 (Optionnel)
        return (
          <View>
            <Text style={styles.sectionTitle}>CIBLE SECONDAIRE (Optionnel)</Text>
            {renderInput("Nom", "nom_adversaire_2")}
            {renderInput("Domicile", "domicile_adversaire_2", true)}
            <TouchableOpacity style={styles.photoBtn} onPress={() => pickImage('adversary_photo_preview_container_2')}>
                <Text style={styles.btnText}>+ PHOTO CIBLE 2</Text>
            </TouchableOpacity>
          </View>
        );
      case 3: // ENVIRONNEMENT
        return (
          <View>
            {renderInput("Amis / Soutien", "amies")}
            {renderInput("Terrain / Météo", "terrain_info")}
            {renderInput("Population", "population")}
            {renderInput("Cadre Juridique", "cadre_juridique")}
          </View>
        );
      case 4: // MISSION & EXECUTION
        return (
          <View>
            {renderInput("Missions PSIG", "missions_psig", true)}
            <View style={styles.separator} />
            {renderInput("Phrase d'Exécution", "action_body_text", true)}
            <Text style={styles.label}>CHRONOLOGIE</Text>
            {formData.time_events.map((evt, idx) => (
                <View key={idx} style={{flexDirection:'row', gap:5, marginBottom:5}}>
                    <Text style={{color:COLORS.primary, width:30, paddingTop:10}}>{evt.type}</Text>
                    <TextInput 
                        style={[styles.input, {width:60}]} 
                        value={evt.hour} 
                        onChangeText={t => {
                            const newEvents = [...formData.time_events];
                            newEvents[idx].hour = t;
                            updateField('time_events', newEvents);
                        }}
                        placeholder="H"
                        placeholderTextColor="#555"
                    />
                    <TextInput 
                        style={[styles.input, {flex:1}]} 
                        value={evt.description} 
                        onChangeText={t => {
                            const newEvents = [...formData.time_events];
                            newEvents[idx].description = t;
                            updateField('time_events', newEvents);
                        }} 
                        placeholder="Action"
                        placeholderTextColor="#555"
                    />
                </View>
            ))}
          </View>
        );
      case 5: // ARTICULATION
        return (
          <View>
            {renderInput("Place du Chef", "place_chef")}
            <Text style={styles.sectionTitle}>INDIA (INTER)</Text>
            {renderInput("Mission India", "india_mission", true)}
            {renderInput("Itinéraire", "india_itineraire", true)}
            {renderInput("CAT Spécifique", "india_cat", true)}
            <TouchableOpacity style={styles.photoBtn} onPress={() => pickImage('photo_container_itineraire_exterieur_preview_container')}>
                <Text style={styles.btnText}>+ PHOTO ITINÉRAIRE</Text>
            </TouchableOpacity>
            
            <View style={styles.separator} />
            
            <Text style={styles.sectionTitle}>AO (APPUI)</Text>
            {renderInput("Mission AO", "ao_mission", true)}
            {renderInput("Zone Installation", "ao_zone_installation", true)}
            <TouchableOpacity style={styles.photoBtn} onPress={() => pickImage('photo_container_emplacement_ao_preview_container')}>
                <Text style={styles.btnText}>+ PHOTO VUE AO</Text>
            </TouchableOpacity>
          </View>
        );
      case 6: // PATRACDVR
        return (
          <View>
            <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:10}}>
                <Text style={styles.helper}>Tapez un membre puis un véhicule pour assigner.</Text>
                <TouchableOpacity onPress={() => addVehicle('Kodiaq')}><Text style={{color:COLORS.success}}>+ VEHICULE</Text></TouchableOpacity>
            </View>

            {/* VEHICULES */}
            {vehicles.map(v => (
                <TouchableOpacity 
                    key={v.id} 
                    style={[styles.vehCard, {borderColor: COLORS.border}]}
                    onPress={() => assignSelectedMemberToVehicle(v.id)}
                >
                    <View style={{flexDirection:'row', justifyContent:'space-between'}}>
                        <Text style={styles.vehTitle}>{v.name} ({v.type})</Text>
                        <Text style={{color:COLORS.danger}} onPress={() => setVehicles(vehicles.filter(x => x.id !== v.id))}>X</Text>
                    </View>
                    <View style={{flexDirection:'row', flexWrap:'wrap', gap:5, marginTop:5}}>
                        {v.members.map(m => (
                            <TouchableOpacity key={m.id} onPress={() => returnMemberToPool(m.id)} style={styles.memberBadge}>
                                <Text style={styles.memberText}>{m.trigramme}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </TouchableOpacity>
            ))}

            <Text style={[styles.label, {marginTop:20}]}>POOL (NON ASSIGNÉS)</Text>
            <View style={{flexDirection:'row', flexWrap:'wrap', gap:5}}>
                {poolMembers.map(m => (
                    <TouchableOpacity 
                        key={m.id} 
                        style={[
                            styles.memberPoolBadge, 
                            selectedMemberId === m.id && { borderColor: COLORS.primary, backgroundColor: '#1e3a8a' }
                        ]}
                        onPress={() => handleMemberTap(m)}
                    >
                        <Text style={{color:'#fff', fontWeight:'bold'}}>{m.trigramme}</Text>
                        <Text style={{color:'#aaa', fontSize:9}}>{m.fonction}</Text>
                    </TouchableOpacity>
                ))}
            </View>
          </View>
        );
      case 7: // PHOTOS & ANNOTATIONS
        return (
            <ScrollView>
                <Text style={styles.helper}>Tapez sur une photo pour l'annoter.</Text>
                <View style={{flexDirection:'row', flexWrap:'wrap'}}>
                    {photos.map(p => (
                        <TouchableOpacity 
                            key={p.id} 
                            style={styles.photoThumb} 
                            onPress={() => {
                                setCurrentPhotoToAnnotate(p.id);
                                setIsAnnotationVisible(true);
                            }}
                        >
                            <Image source={{ uri: p.uri }} style={{width:'100%', height:100, borderRadius:4}} />
                            <Text style={styles.photoCat}>{p.category.split('_')[0]}</Text>
                            {p.annotations.length > 0 && <View style={styles.annotBadge} />}
                        </TouchableOpacity>
                    ))}
                </View>
            </ScrollView>
        );
      case 8: // DIVERS
        return (
            <View>
                {renderInput("CAT Générales", "cat_generales", true)}
                {renderInput("NO GO", "no_go", true)}
                {renderInput("Liaison", "cat_liaison", true)}
                
                <View style={styles.separator} />
                <Text style={styles.label}>GESTION DE SESSION</Text>
                <View style={{flexDirection:'row', gap:10}}>
                    <TouchableOpacity style={[styles.navBtn, {backgroundColor: COLORS.surfaceLight}]} onPress={exportSessionToJson}>
                        <Text style={styles.navBtnText}>EXPORTER JSON</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.navBtn, {backgroundColor: COLORS.surfaceLight}]} onPress={importSessionFromJson}>
                        <Text style={styles.navBtnText}>IMPORTER JSON</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
      default: return null;
    }
  };

  // --- RENDER MAIN ---
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {/* BOUTON RETOUR AJOUTÉ ICI */}
        <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Text style={styles.backButtonText}>{"<"}</Text>
        </TouchableOpacity>
        
        <Text style={styles.headerTitle}>G-TAK OI GENERATOR</Text>
        <View style={{width: 40}} /> {/* Spacer pour équilibre */}
      </View>

      {/* Progress Bar */}
      <View style={{height:50}}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.progressScroll}>
            {["SITUATION", "CIBLE 1", "CIBLE 2", "ENVIRON.", "MISSION", "ARTICUL.", "PATRAC", "PHOTOS", "DIVERS"].map((s, i) => (
                <TouchableOpacity key={i} onPress={() => setStep(i)} style={[styles.stepItem, step === i && styles.stepItemActive]}>
                    <Text style={[styles.stepText, step === i && styles.stepTextActive]}>{i+1}. {s}</Text>
                </TouchableOpacity>
            ))}
        </ScrollView>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{flex:1}}>
        <ScrollView style={styles.content} contentContainerStyle={{paddingBottom: 50}}>
            {renderStepContent()}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.navBtn} onPress={() => step > 0 && setStep(step - 1)}>
            <Text style={styles.navBtnText}>PREC.</Text>
        </TouchableOpacity>
        
        {step < 8 ? (
            <TouchableOpacity style={[styles.navBtn, {backgroundColor: COLORS.primary}]} onPress={() => { setStep(step + 1); saveData(); }}>
                <Text style={[styles.navBtnText, {color:'#fff'}]}>SUIV.</Text>
            </TouchableOpacity>
        ) : (
            <TouchableOpacity style={[styles.navBtn, {backgroundColor: COLORS.success}]} onPress={handleGeneratePDF}>
                <Text style={[styles.navBtnText, {color:'#000'}]}>GÉNÉRER PDF</Text>
            </TouchableOpacity>
        )}
      </View>

      {/* ANNOTATION MODAL */}
      <Modal visible={isAnnotationVisible} animationType="slide" onRequestClose={() => setIsAnnotationVisible(false)}>
        <SafeAreaView style={{flex:1, backgroundColor:'#000'}}>
            <View style={{padding:10, flexDirection:'row', justifyContent:'space-between'}}>
                <Text style={{color:COLORS.text}}>Touchez pour placer un marqueur</Text>
                <TouchableOpacity onPress={() => setIsAnnotationVisible(false)}><Text style={{color:COLORS.primary, fontWeight:'bold'}}>FERMER</Text></TouchableOpacity>
            </View>
            <TouchableOpacity 
                activeOpacity={1} 
                style={{flex:1, justifyContent:'center'}} 
                onPress={(e) => {
                    const { locationX, locationY } = e.nativeEvent;
                    const width = Dimensions.get('window').width;
                    const height = 400; 
                    addAnnotation((locationX / width) * 100, (locationY / height) * 100);
                }}
            >
                {currentPhotoToAnnotate && (
                    <View>
                        <Image 
                            source={{ uri: photos.find(p => p.id === currentPhotoToAnnotate)?.uri }} 
                            style={{width: '100%', height: 400, resizeMode: 'contain'}} 
                        />
                        {photos.find(p => p.id === currentPhotoToAnnotate)?.annotations.map((a, i) => (
                            <View 
                                key={i} 
                                style={{
                                    position:'absolute', 
                                    left:`${a.x}%`, top:`${a.y}%`, 
                                    width:24, height:24, borderRadius:12, 
                                    backgroundColor:'rgba(255,0,0,0.8)', 
                                    justifyContent:'center', alignItems:'center',
                                    borderWidth:2, borderColor:'#fff',
                                    transform: [{translateX: -12}, {translateY: -12}]
                                }}
                            >
                                <Text style={{color:'#fff', fontWeight:'bold', fontSize:10}}>{a.text}</Text>
                            </View>
                        ))}
                    </View>
                )}
            </TouchableOpacity>
        </SafeAreaView>
      </Modal>

    </SafeAreaView>
  );
}

// --- STYLES ---

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: { padding: 15, borderBottomWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: COLORS.primary, fontSize: 18, fontWeight: 'bold', letterSpacing: 2 },
  backButton: { padding: 5, width: 40 },
  backButtonText: { color: COLORS.text, fontSize: 24, fontWeight: 'bold' },
  progressScroll: { backgroundColor: COLORS.surface },
  stepItem: { padding: 12, marginRight: 2 },
  stepItemActive: { borderBottomWidth: 2, borderColor: COLORS.primary },
  stepText: { color: COLORS.textMuted, fontSize: 12, fontWeight: 'bold' },
  stepTextActive: { color: COLORS.text },
  content: { padding: 15 },
  inputGroup: { marginBottom: 15 },
  label: { color: COLORS.text, fontSize: 11, marginBottom: 5, fontWeight: 'bold', textTransform: 'uppercase' },
  input: { backgroundColor: COLORS.inputBg, borderWidth: 1, borderColor: COLORS.border, borderRadius: 4, padding: 10, color: COLORS.text, fontSize: 14 },
  sectionTitle: { color: COLORS.primary, fontSize: 16, fontWeight: 'bold', marginTop: 20, marginBottom: 10, borderLeftWidth: 3, borderLeftColor: COLORS.primary, paddingLeft: 10 },
  separator: { height: 1, backgroundColor: COLORS.border, marginVertical: 20 },
  row: { flexDirection: 'row' },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surfaceLight },
  chipSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  footer: { flexDirection: 'row', padding: 15, borderTopWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface },
  navBtn: { flex: 1, padding: 15, alignItems: 'center', borderRadius: 4, marginHorizontal: 5, borderWidth: 1, borderColor: COLORS.border },
  navBtnText: { color: COLORS.textMuted, fontWeight: 'bold' },
  photoBtn: { backgroundColor: COLORS.surfaceLight, padding: 12, alignItems: 'center', borderRadius: 4, marginTop: 10, borderWidth: 1, borderColor: COLORS.textMuted, borderStyle: 'dashed' },
  btnText: { color: COLORS.text, fontSize: 12 },
  
  // PATRACDVR
  vehCard: { backgroundColor: COLORS.surfaceLight, padding: 10, marginBottom: 10, borderRadius: 4, borderWidth: 1, borderLeftWidth: 4 },
  vehTitle: { color: '#fff', fontWeight: 'bold' },
  memberBadge: { backgroundColor: COLORS.surface, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: COLORS.border },
  memberPoolBadge: { backgroundColor: COLORS.surfaceLight, padding: 8, borderRadius: 4, minWidth: 60, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  memberText: { color: COLORS.text, fontSize: 10 },
  helper: { color: COLORS.textMuted, fontStyle: 'italic', marginBottom: 10, fontSize: 11 },

  // PHOTOS
  photoThumb: { width: '48%', margin: '1%', height: 100, backgroundColor: '#222', borderRadius: 4, overflow: 'hidden' },
  photoCat: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 10, padding: 2, textAlign: 'center' },
  annotBadge: { position: 'absolute', top: 5, right: 5, width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.danger }
});
