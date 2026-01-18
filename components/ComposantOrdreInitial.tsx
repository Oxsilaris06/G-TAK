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

// --- PROPS ---
interface OIViewProps {
    onClose?: () => void;
}

// --- CONSTANTES & CONFIGURATION ---

const MEMBER_CONFIG = {
  options: {
    fonctions: ["Chef inter", "Chef dispo", "Chef Oscar", "DE", "Cyno", "Inter", "Effrac", "AO", "Sans"],
    cellules: ["AO1", "AO2", "AO3", "AO4", "AO5", "AO6", "AO7", "AO8", "India 1", "India 2", "India 3", "India 4", "India 5", "Effrac", "Commandement", "Sans"],
    principales: [ "G36", "UMP9", "FAP", "MP5", "Sans"],
    afis: ["PIE", "LBD40", "LBD44", "PIE", "Sans"],
    secondaires: ["SIG 2022","G26", "Sans"],
    grenades: ["GENL", "MP7", "FAR", "Sans"],
    equipements: ["Sans", "BBAL", "Belier", "Lacry", "IL", "Lot 5.11", "Lot Oscar", "Pince", "Drone", "Cam pieton",],
    equipements2: ["Sans", "Échelle", "Stop stick", "Lacry", "Cale", "IL", "Pass","Cam pieton", "TPH700"],
    tenues: ["UBAS", "4S", "Bleu", "Civile", "Ghillie", "Treillis", "MO"],
    gpbs: ["GPBL", "GPBPD", "Sans"],
    vehicules_types: ["Sharan", "Kodiaq", "5008", "Scénic","Kodiaq Bana"]
  },
  members: [
    { trigramme: "XX", fonction: "Inter", cellule: "AO1", tenue: "UBAS" },
    { trigramme: "YY", fonction: "Sans", cellule: "India 1", tenue: "UBAS" },
  ]
};

const COLORS = {
  bg: '#050505',
  surface: '#161619',
  surfaceLight: '#2a2a2a',
  primary: '#3b82f6',
  secondary: '#94a3b8',
  text: '#e0e0e0',
  textMuted: '#64748b',
  danger: '#ef4444',
  success: '#22c55e',
  warning: '#eab308',
  border: 'rgba(255, 255, 255, 0.08)',
  inputBg: 'rgba(0, 0, 0, 0.4)'
};

// --- TYPES COMPLETS ---

interface IAdversaire {
    nom: string;
    domicile: string;
    me_list: string[];
    date_naissance: string;
    lieu_naissance: string;
    stature: string;
    ethnie: string;
    signes: string;
    profession: string;
    antecedents: string;
    etat_esprit: string[];
    attitude: string;
    volume: string[];
    substances: string;
    vehicules_list: string[];
    armes: string;
}

interface IOIState {
  date_op: string;
  trigramme_redacteur: string; // Ajouté pour le footer PDF
  situation_generale: string;
  situation_particuliere: string;
  adversaire_1: IAdversaire;
  adversaire_2: IAdversaire;
  amis: string;
  terrain_info: string;
  population: string;
  cadre_juridique: string;
  missions_psig: string;
  date_execution: string;
  heure_execution: string;
  action_body_text: string;
  chronologie: { type: string; label: string; hour: string }[];
  hypothese_h1: string;
  hypothese_h2: string;
  hypothese_h3: string;
  place_chef_gen: string;
  india_mission: string;
  india_objectif: string;
  india_itineraire: string;
  india_points: string;
  india_cat: string;
  ao_zone: string;
  ao_mission: string;
  ao_secteur: string;
  ao_points: string;
  ao_cat: string;
  ao_chef: string;
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
  x: number;
  y: number;
  text?: string;
  type: 'marker';
}

interface IPhoto {
  id: string;
  uri: string;
  base64?: string; // Indispensable pour PDF
  category: string;
  annotations: IPhotoAnnotation[];
}

const DEFAULT_ADVERSAIRE: IAdversaire = {
    nom: "", domicile: "", me_list: [], date_naissance: "", lieu_naissance: "",
    stature: "", ethnie: "Caucasien", signes: "", profession: "", antecedents: "",
    etat_esprit: [], attitude: "", volume: [], substances: "", vehicules_list: [], armes: ""
};

const INITIAL_STATE: IOIState = {
  date_op: "",
  trigramme_redacteur: "",
  situation_generale: "", situation_particuliere: "",
  adversaire_1: { ...DEFAULT_ADVERSAIRE },
  adversaire_2: { ...DEFAULT_ADVERSAIRE },
  amis: "", terrain_info: "", population: "", cadre_juridique: "",
  missions_psig: "INTERPELLER L'OBJECTIF.\n\nASSISTER LORS DE LA PERQUISITION.\n\nCONDUITE AU LIEU DE GAV.",
  date_execution: "", heure_execution: "06:00",
  action_body_text: "En vue d'appréhender le(s) mis en cause et empêcher la déperdition des preuves,\nJe veux, le (date) à partir de (heure), pour une action (type d'action) investir le domicile\nprésumé de (Nom Adversaire 1) et (Nom Adversaire 2) après avoir bouclé celui-ci.",
  chronologie: [
    { type: 'T0', label: 'Rasso PSIG', hour: '' },
    { type: 'T1', label: 'Départ PR', hour: '' },
    { type: 'T2', label: 'Départ LE', hour: '' },
    { type: 'T3', label: 'MEP TERMINÉ', hour: '' },
    { type: 'T4', label: 'TOP ACTION', hour: '' },
  ],
  hypothese_h1: "Target présente LE1", hypothese_h2: "Target présente LE2", hypothese_h3: "Target absente LE 1 et 2",
  place_chef_gen: "",
  india_mission: "RECONNAÎTRE LE DOMICILE EN VUE D'APPRÉHENDER L'OBJECTIF", 
  india_objectif: "", india_itineraire: "", india_points: "", 
  india_cat: "- Si décelé, dynamiser jusqu'au domicile.\n- Si présence tierce personne lors de la progression, contrôler.\n- Si fuite, CR direction fuite + interpellation.\n- Si rébellion, usage du strict niveau de force nécessaire.\n- Si retranchement, CR + réarticulation pour fixer l'adversaire.",
  ao_zone: "", 
  ao_mission: "BOUCLER - SURVEILLER - INTERDIRE TOUTE FUITE", 
  ao_secteur: "", ao_points: "", ao_chef: "",
  ao_cat: "- Compte rendu de mise en place.\n- Renseigner régulièrement.\n- Si décelé, CR.\n- Si fuite, CR direction fuite + interpellation si rapport de force favorable.\n- Si rébellion, usage du strict minimum de force nécessaire.\n- Si retranchement, CR + réarticulation pour fixer l'adversaire.",
  cat_generales: "- Si rébellion, user du strict niveau de force nécessaire\n- Si retranché, alerter en mesure de se ré-articuler\n- Si tente de fuir, alerter en mesure de jalonner/interpeller\n- UDA : Article L435-1 du CSI + légitime défense",
  no_go: "", 
  cat_liaison: "TOM: \nDIR: \nGestuelle et visuelle entre les éléments INDIA"
};

// --- SOUS-COMPOSANTS ---

const DynamicListInput = ({ label, list, onChange, placeholder = "Ajouter..." }: { label: string, list: string[], onChange: (l: string[]) => void, placeholder?: string }) => {
    const [txt, setTxt] = useState("");
    return (
        <View style={styles.inputGroup}>
            <Text style={styles.label}>{label}</Text>
            <View style={{flexDirection:'row', flexWrap:'wrap', gap: 5, marginBottom: 5}}>
                {list.map((item, i) => (
                    <TouchableOpacity key={i} onPress={() => onChange(list.filter((_, idx) => idx !== i))} style={styles.chip}>
                        <Text style={{color: COLORS.text}}>{item} X</Text>
                    </TouchableOpacity>
                ))}
            </View>
            <View style={{flexDirection:'row', gap:5}}>
            <TextInput 
                style={[styles.input, {flex:1}]} 
                value={txt} onChangeText={setTxt} 
                placeholder={placeholder} placeholderTextColor={COLORS.textMuted}
            />
            <TouchableOpacity 
                style={{backgroundColor:COLORS.primary, justifyContent:'center', padding:10, borderRadius:4}}
                onPress={() => { if(txt) { onChange([...list, txt]); setTxt(""); } }}
            >
                <Text style={{color:'white'}}>+</Text>
            </TouchableOpacity>
            </View>
        </View>
    );
};

const ChipSelector = ({ label, selected, options, onChange }: { label: string, selected: string[], options: string[], onChange: (l: string[]) => void }) => {
    return (
        <View style={styles.inputGroup}>
            <Text style={styles.label}>{label}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {options.map(opt => {
                const isSel = selected.includes(opt);
                return (
                <TouchableOpacity
                    key={opt}
                    style={[styles.chip, isSel && styles.chipSelected]}
                    onPress={() => isSel ? onChange(selected.filter(s => s !== opt)) : onChange([...selected, opt])}
                >
                    <Text style={{ color: isSel ? '#fff' : COLORS.secondary }}>{opt}</Text>
                </TouchableOpacity>
                );
            })}
            </View>
        </View>
    );
};

// --- COMPOSANT PRINCIPAL ---

export default function OIView({ onClose }: OIViewProps) {
  const [step, setStep] = useState(0);
  const [formData, setFormData] = useState<IOIState>(INITIAL_STATE);
  const [vehicles, setVehicles] = useState<IVehicle[]>([]);
  const [poolMembers, setPoolMembers] = useState<IMember[]>([]);
  const [photos, setPhotos] = useState<IPhoto[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  
  // Annotation Modal State
  const [isAnnotationVisible, setIsAnnotationVisible] = useState(false);
  const [currentPhotoToAnnotate, setCurrentPhotoToAnnotate] = useState<string | null>(null);

  // Member Edit State
  const [isMemberEditModalVisible, setIsMemberEditModalVisible] = useState(false);
  const [tempMember, setTempMember] = useState<IMember | null>(null);

  // Vehicle Rename State
  const [isVehicleRenameVisible, setIsVehicleRenameVisible] = useState(false);
  const [vehicleToRename, setVehicleToRename] = useState<IVehicle | null>(null);
  const [newVehicleName, setNewVehicleName] = useState("");

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
        const initialPool = MEMBER_CONFIG.members.map((m, i) => ({
          ...m,
          id: `m_${Date.now()}_${i}`,
          principales: "Sans", secondaires: "PSA", afis: "Sans", grenades: "Sans",
          equipement: "Sans", equipement2: "Sans", gpb: "GPBL"
        }));
        setPoolMembers(initialPool);
        
        const defaultVehs = MEMBER_CONFIG.options.vehicules_types.map((type, i) => ({
            id: `v_def_${i}`,
            name: `${type}`,
            type: type,
            members: []
        }));
        setVehicles(defaultVehs);
      }
    } catch (e) {
      console.error("Load error", e);
    }
  };

  // --- EXPORT/IMPORT ---
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
      Alert.alert("Erreur", "Impossible d'exporter la session.");
    }
  };

  const importSessionFromJson = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      if (result.canceled) return;
      const fileUri = result.assets[0].uri;
      const jsonString = await FileSystem.readAsStringAsync(fileUri);
      const data = JSON.parse(jsonString);
      if (data.formData) setFormData(data.formData);
      if (data.vehicles) setVehicles(data.vehicles);
      if (data.poolMembers) setPoolMembers(data.poolMembers);
      if (data.photos) setPhotos(data.photos);
      await saveData();
      Alert.alert("Succès", "Session importée avec succès.");
    } catch (e) {
      Alert.alert("Erreur", "Fichier invalide.");
    }
  };

  const importMemberConfig = async () => {
      try {
          const result = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
          if (result.canceled) return;
          const fileUri = result.assets[0].uri;
          const jsonString = await FileSystem.readAsStringAsync(fileUri);
          const data = JSON.parse(jsonString);

          let newMembers: IMember[] = [];
          if (Array.isArray(data)) {
              newMembers = data;
          } else if (data.members && Array.isArray(data.members)) {
              newMembers = data.members;
          } else {
              Alert.alert("Erreur", "Format de fichier non reconnu. Attendu: Tableau de membres.");
              return;
          }

          const processedMembers = newMembers.map((m, i) => ({
              ...m,
              id: m.id || `m_imp_${Date.now()}_${i}`,
              principales: m.principales || "Sans",
              secondaires: m.secondaires || "PSA",
              tenue: m.tenue || "UBAS",
              fonction: m.fonction || "Inter",
              cellule: m.cellule || "India 1",
              gpb: m.gpb || "GPBL",
              afis: m.afis || "Sans",
              grenades: m.grenades || "Sans",
              equipement: m.equipement || "Sans",
              equipement2: m.equipement2 || "Sans"
          }));

          setPoolMembers(prev => [...prev, ...processedMembers]);
          Alert.alert("Succès", `${processedMembers.length} opérateurs importés dans le Pool.`);

      } catch (e) {
          console.error(e);
          Alert.alert("Erreur", "Impossible de lire le fichier de configuration.");
      }
  };

  // --- HELPERS FORM ---
  const updateField = (field: keyof IOIState, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const updateAdversaire = (advKey: 'adversaire_1' | 'adversaire_2', field: keyof IAdversaire, value: any) => {
      setFormData(prev => ({
          ...prev,
          [advKey]: {
              ...prev[advKey],
              [field]: value
          }
      }));
  };

  // --- PATRACDVR LOGIC ---
  const handleMemberTap = (member: IMember) => {
    if (selectedMemberId === member.id) setSelectedMemberId(null);
    else setSelectedMemberId(member.id);
  };

  const openMemberEditor = (member: IMember) => {
      setTempMember({...member});
      setIsMemberEditModalVisible(true);
  };

  const saveMemberChanges = () => {
      if (!tempMember) return;
      let foundInPool = false;
      const newPool = poolMembers.map(m => {
          if (m.id === tempMember.id) { foundInPool = true; return tempMember; }
          return m;
      });
      if (foundInPool) setPoolMembers(newPool);
      else {
          const newVehicles = vehicles.map(v => ({
              ...v, members: v.members.map(m => m.id === tempMember.id ? tempMember : m)
          }));
          setVehicles(newVehicles);
      }
      setIsMemberEditModalVisible(false);
      setTempMember(null);
  };

  const createNewMember = () => {
    const newM: IMember = {
        id: `m_${Date.now()}`, trigramme: "NOUVEAU", fonction: "Inter", cellule: "India 1",
        tenue: "UBAS", principales: "HK 416", secondaires: "PSA", afis: "Sans", grenades: "Sans",
        equipement: "Sans", equipement2: "Sans", gpb: "GPBL"
    };
    setPoolMembers(prev => [...prev, newM]);
    openMemberEditor(newM);
  };

  const deleteMember = () => {
      if (!tempMember) return;
      Alert.alert("Confirmer", "Supprimer cet opérateur ?", [
          { text: "Annuler", style: "cancel" },
          { text: "Supprimer", style: 'destructive', onPress: () => {
                setPoolMembers(prev => prev.filter(m => m.id !== tempMember.id));
                setVehicles(prev => prev.map(v => ({ ...v, members: v.members.filter(m => m.id !== tempMember.id) })));
                setIsMemberEditModalVisible(false);
          }}
      ]);
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
      if (source === 'pool') setPoolMembers(prev => prev.filter(m => m.id !== selectedMemberId));
      else setVehicles(prev => prev.map(v => v.id === source ? { ...v, members: v.members.filter(m => m.id !== selectedMemberId) } : v));
      setVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, members: [...v.members, member!] } : v));
      setSelectedMemberId(null);
    }
  };

  const returnMemberToPool = (memberId: string) => {
    let member: IMember | undefined;
    vehicles.forEach(v => { const found = v.members.find(m => m.id === memberId); if (found) member = found; });
    if (member) {
      setVehicles(prev => prev.map(v => ({ ...v, members: v.members.filter(m => m.id !== memberId) })));
      setPoolMembers(prev => [...prev, member!]);
    }
  };

  const addVehicle = () => {
    const type = "Nouveau";
    const newVeh: IVehicle = { id: `v_${Date.now()}`, name: `Vehicule ${vehicles.length + 1}`, type, members: [] };
    setVehicles([...vehicles, newVeh]);
  };

  // NOUVEAU: Logique de suppression de véhicule avec retour des membres
  const removeVehicle = (vehicle: IVehicle) => {
      // D'abord on récupère les membres pour les remettre dans le pool
      const membersToReturn = vehicle.members;
      
      // On met à jour les états
      setVehicles(prev => prev.filter(v => v.id !== vehicle.id));
      setPoolMembers(prev => [...prev, ...membersToReturn]);
  };

  // NOUVEAU: Logique de renommage de véhicule
  const openRenameVehicle = (vehicle: IVehicle) => {
      setVehicleToRename(vehicle);
      setNewVehicleName(vehicle.name);
      setIsVehicleRenameVisible(true);
  };

  const confirmRenameVehicle = () => {
      if (vehicleToRename && newVehicleName.trim()) {
          setVehicles(prev => prev.map(v => v.id === vehicleToRename.id ? { ...v, name: newVehicleName.trim() } : v));
      }
      setIsVehicleRenameVisible(false);
      setVehicleToRename(null);
  };


  // --- PHOTO LOGIC ---
  const pickImage = async (category: string) => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false, 
      quality: 0.7, 
      base64: true // IMPORTANT: Base64 requis pour PDF
    });
    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      const newPhoto: IPhoto = { 
          id: Date.now().toString(), 
          uri: asset.uri, 
          base64: asset.base64 || undefined, // Stockage explicite
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
        return { ...p, annotations: [...p.annotations, { x, y, type: 'marker', text: (p.annotations.length + 1).toString() }] };
      }
      return p;
    }));
  };

  const deletePhoto = (photoId: string) => {
      Alert.alert("Supprimer", "Supprimer cette photo ?", [
          { text: "Annuler" },
          { text: "Supprimer", style: 'destructive', onPress: () => setPhotos(prev => prev.filter(p => p.id !== photoId)) }
      ]);
  };

  // --- HTML GENERATOR FOR PDF ---
  const generateHTML = () => {
    const { date_op, trigramme_redacteur } = formData;
    
    // HELPERS GRAPHIQUES
    const getPhotosHtml = (category: string, label: string, width = "100%", maxHeight = "300px", pageBreakBefore = false) => {
        const catPhotos = photos.filter(p => p.category === category);
        if (catPhotos.length === 0) return '';
        
        let html = '';
        if (pageBreakBefore) html += `<div class="page-break"></div>`;
        
        html += `<h2 style="margin-top:20px;">${label}</h2>`;
        html += `<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 10px;">`;
        
        catPhotos.forEach(photo => {
            // CORRECTION: Utilisation du Base64 pour garantir l'affichage
            const imageSrc = photo.base64 ? `data:image/jpeg;base64,${photo.base64}` : photo.uri;

            html += `
            <div style="border: 2px solid #000; padding: 5px; margin-bottom: 10px; background: #fff; width: ${width}; page-break-inside: avoid;">
                <div style="position: relative; display: block; width: 100%; margin: 0 auto;">
                    <img src="${imageSrc}" style="width: 100%; max-height: ${maxHeight}; object-fit:contain; display: block;" />
                    ${photo.annotations.map(a => `
                        <div style="position: absolute; left: ${a.x}%; top: ${a.y}%; width: 20px; height: 20px; background: red; color: white; border-radius: 50%; text-align: center; line-height: 20px; font-size: 12px; font-weight:bold; transform: translate(-50%, -50%); border: 2px solid white;">
                            ${a.text}
                        </div>
                    `).join('')}
                </div>
            </div>
            `;
        });
        
        html += `</div>`;
        return html;
    };

    const getSingleSidePhotoHtml = (category: string) => {
        const catPhotos = photos.filter(p => p.category === category);
        if (catPhotos.length === 0) return '';
        
        return catPhotos.map(photo => {
            const imageSrc = photo.base64 ? `data:image/jpeg;base64,${photo.base64}` : photo.uri;
            return `
            <div style="border: 2px solid #000; padding: 2px; margin-bottom: 5px; background: #fff;">
                <div style="position: relative;">
                    <img src="${imageSrc}" style="width: 100%; max-height: 200px; object-fit:contain; display: block;" />
                    ${photo.annotations.map(a => `
                        <div style="position: absolute; left: ${a.x}%; top: ${a.y}%; width: 15px; height: 15px; background: red; color: white; border-radius: 50%; text-align: center; line-height: 15px; font-size: 10px; font-weight:bold; transform: translate(-50%, -50%); border: 1px solid white;">
                            ${a.text}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;}).join('');
    };

    // CORRECTION ARTICULATION: Formatage "Cellule : XXX/NNN (India1)"
    const formatCelluleMembers = (prefix: string) => {
        const allMembers = vehicles.flatMap(v => v.members).concat(poolMembers);
        // Filtrer par préfixe (ex: membres contenant "India" ou "AO")
        const relevantMembers = allMembers.filter(m => m.cellule && m.cellule.toLowerCase().includes(prefix.toLowerCase()));
        
        if (relevantMembers.length === 0) return '';

        // Grouper par Nom de cellule EXACT (ex: "India 1", "India 2")
        const grouped: {[key:string]: string[]} = {};
        relevantMembers.forEach(m => {
            const cellName = m.cellule;
            if (!grouped[cellName]) grouped[cellName] = [];
            grouped[cellName].push(m.trigramme);
        });

        // Formater string
        const parts = Object.keys(grouped).sort().map(cellName => {
            const trigs = grouped[cellName].join('/');
            return `${trigs} (${cellName})`;
        });

        if (parts.length === 0) return '';

        return `<div style="margin-top:5px; border-top:1px solid #ccc; padding-top:2px; font-size:10px;"><strong>CELLULES :</strong> ${parts.join(' - ')}</div>`;
    };

    const drawTableAdv = (adv: IAdversaire, title: string) => {
        if (!adv.nom) return '';
        return `
        <div style="margin-bottom: 20px; border: 2px solid #000;">
            <div style="background:#000; color:#fff; padding:5px; font-weight:bold; font-size:14px;">${title}: ${adv.nom}</div>
            <table style="width:100%; border-collapse:collapse; font-size:10px;">
                <tr style="background:#ddd;"><th style="border:1px solid #000; width:30%;">INFORMATION</th><th style="border:1px solid #000;">DÉTAIL</th></tr>
                <tr><td style="border:1px solid #000; font-weight:bold;">Domicile</td><td style="border:1px solid #000;">${adv.domicile}</td></tr>
                <tr><td style="border:1px solid #000; font-weight:bold;">Naissance</td><td style="border:1px solid #000;">${adv.date_naissance} à ${adv.lieu_naissance}</td></tr>
                <tr><td style="border:1px solid #000; font-weight:bold;">Physique</td><td style="border:1px solid #000;">${adv.stature} / ${adv.ethnie} / ${adv.signes}</td></tr>
                <tr><td style="border:1px solid #000; font-weight:bold;">Profession</td><td style="border:1px solid #000;">${adv.profession}</td></tr>
                <tr><td style="border:1px solid #000; font-weight:bold;">Antécédents</td><td style="border:1px solid #000;">${adv.antecedents}</td></tr>
                <tr><td style="border:1px solid #000; font-weight:bold;">État d'esprit</td><td style="border:1px solid #000;">${adv.etat_esprit.join(', ')} / ${adv.attitude}</td></tr>
                <tr><td style="border:1px solid #000; font-weight:bold;">Véhicules</td><td style="border:1px solid #000;">${adv.vehicules_list.join(', ')}</td></tr>
                <tr><td style="border:1px solid #000; font-weight:bold;">Armes / ME</td><td style="border:1px solid #000;">${adv.armes} / ${adv.me_list.join(', ')}</td></tr>
            </table>
        </div>
        `;
    };

    const drawPatrac = () => {
        return vehicles.map(v => `
            <div style="margin-bottom: 15px; page-break-inside: avoid;">
                <div style="background:#ccc; border:1px solid #000; padding:4px; font-weight:bold;">VÉHICULE: ${v.name} (${v.type})</div>
                <table style="width:100%; border-collapse:collapse; font-size:9px; text-align:center;">
                    <thead style="background:#eee;">
                        <tr>
                            <th style="border:1px solid #000;">TRIG.</th>
                            <th style="border:1px solid #000;">FCT</th>
                            <th style="border:1px solid #000;">CELLULE</th>
                            <th style="border:1px solid #000;">PRINC.</th>
                            <th style="border:1px solid #000;">SEC.</th>
                            <th style="border:1px solid #000;">AFI</th>
                            <th style="border:1px solid #000;">GREN.</th>
                            <th style="border:1px solid #000;">EQUIP 1</th>
                            <th style="border:1px solid #000;">EQUIP 2</th>
                            <th style="border:1px solid #000;">TENUE</th>
                            <th style="border:1px solid #000;">GPB</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${v.members.map(m => `
                        <tr>
                            <td style="border:1px solid #000; font-weight:bold;">${m.trigramme}</td>
                            <td style="border:1px solid #000;">${m.fonction}</td>
                            <td style="border:1px solid #000;">${m.cellule}</td>
                            <td style="border:1px solid #000;">${m.principales}</td>
                            <td style="border:1px solid #000;">${m.secondaires}</td>
                            <td style="border:1px solid #000;">${m.afis}</td>
                            <td style="border:1px solid #000;">${m.grenades}</td>
                            <td style="border:1px solid #000;">${m.equipement}</td>
                            <td style="border:1px solid #000;">${m.equipement2}</td>
                            <td style="border:1px solid #000;">${m.tenue}</td>
                            <td style="border:1px solid #000;">${m.gpb}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
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
          @page { size: A4 landscape; margin: 1cm; }
          body { font-family: 'JetBrains Mono', sans-serif; background: #fff; color: #000; padding: 0; font-size: 11px; }
          .page-break { page-break-before: always; }
          h1 { font-family: 'Oswald'; text-align: center; font-size: 36px; border: 4px solid #000; padding: 20px; margin-bottom: 50px; text-transform: uppercase; letter-spacing: 2px; }
          h2 { font-family: 'Oswald'; font-size: 16px; border-bottom: 2px solid #000; margin-top: 20px; margin-bottom: 10px; padding-bottom: 2px; text-transform: uppercase; }
          h3 { font-size: 12px; font-weight: bold; margin-top: 10px; margin-bottom: 5px; text-decoration: underline; }
          p { margin: 2px 0; text-align: justify; }
          .row { display: flex; flex-direction: row; gap: 20px; }
          .col { flex: 1; }
          .box { border: 1px solid #000; padding: 10px; margin-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; }
          td, th { border: 1px solid #000; padding: 4px; }
          .highlight { background-color: #eee; font-weight: bold; }
        </style>
      </head>
      <body>

        <!-- PAGE 1: COUVERTURE -->
        <div style="display: flex; flex-direction: column; justify-content: center; height: 90vh;">
            <h1>OI PELOTON<br/>DU ${date_op}<br/><br/>SURVEILLANCE<br/>INTERVENTION</h1>
            <div style="text-align: center; font-size: 14px; font-weight: bold;">CIBLE: ${formData.adversaire_1.nom}</div>
        </div>

        <div class="page-break"></div>

        <!-- PAGE 2: SITUATION / ENVIRONNEMENT -->
        <div class="row">
            <div class="col">
                <h2>1. SITUATION</h2>
                <h3>1.1 Situation Générale</h3>
                <p>${formData.situation_generale.replace(/\n/g, '<br>')}</p>
                
                <h3>1.2 Situation Particulière</h3>
                <p>${formData.situation_particuliere.replace(/\n/g, '<br>')}</p>
            </div>
            <div class="col">
                <h2>3. ENVIRONNEMENT</h2>
                <div class="box">
                    <strong>AMIS:</strong> ${formData.amis}<br/>
                    <strong>TERRAIN:</strong> ${formData.terrain_info}<br/>
                    <strong>POPULATION:</strong> ${formData.population}<br/>
                    <strong>JURIDIQUE:</strong> ${formData.cadre_juridique}
                </div>
            </div>
        </div>

        <div class="page-break"></div>

        <!-- PAGE 3: ADVERSAIRES -->
        <h2>2. ADVERSAIRE(S)</h2>
        <div class="row">
            <div class="col">
                ${drawTableAdv(formData.adversaire_1, 'CIBLE 1')}
            </div>
            <div class="col" style="flex: 0 0 300px;">
                ${getSingleSidePhotoHtml('photo_adv_1')}
            </div>
        </div>
        ${formData.adversaire_2.nom ? `
        <div class="row">
            <div class="col">
                ${drawTableAdv(formData.adversaire_2, 'CIBLE 2')}
            </div>
            <div class="col" style="flex: 0 0 300px;">
                ${getSingleSidePhotoHtml('photo_adv_2')}
            </div>
        </div>` : ''}
        
        <!-- RENFORTS: PAGE DÉDIÉE -->
        ${getPhotosHtml('photo_renforts', 'RENFORTS / ENVIRONNEMENT', '48%', '400px', true)}

        <div class="page-break"></div>

        <!-- PAGE 4: MISSION & EXECUTION -->
        <div class="row">
            <div class="col">
                 <h2>4. MISSION PSIG</h2>
                 <div class="box" style="text-align:center; font-weight:bold; font-size:14px; background:#f0f0f0;">
                    ${formData.missions_psig.replace(/\n/g, '<br>')}
                 </div>

                 <h2>5. EXÉCUTION</h2>
                 <div class="box">
                    <strong>POUR LE:</strong> ${formData.date_execution} à ${formData.heure_execution}<br/><br/>
                    ${formData.action_body_text.replace(/\n/g, '<br>')}
                 </div>
            </div>
            <div class="col">
                <h3>CHRONOLOGIE</h3>
                <table>
                    <tr class="highlight"><th>H</th><th>PHASE</th></tr>
                    ${formData.chronologie.map(c => `<tr><td style="text-align:center;">${c.hour}</td><td>${c.type} - ${c.label}</td></tr>`).join('')}
                </table>
                <h3>HYPOTHÈSES</h3>
                <ul>
                    <li><strong>H1:</strong> ${formData.hypothese_h1}</li>
                    <li><strong>H2:</strong> ${formData.hypothese_h2}</li>
                    <li><strong>H3:</strong> ${formData.hypothese_h3}</li>
                </ul>
            </div>
        </div>

        <div class="page-break"></div>

        <!-- PAGE 5: ARTICULATION -->
        <h2>6. ARTICULATION</h2>
        <div style="border:1px solid #000; padding:5px; margin-bottom:10px; background:#ddd; font-weight:bold; text-align:center;">
            PLACE DU CHEF: ${formData.place_chef_gen}
        </div>

        <div class="row">
            <div class="col" style="border-right: 2px dashed #000; padding-right: 10px;">
                <div style="background:#000; color:#fff; padding:5px; font-weight:bold; text-align:center;">INDIA (INTER)</div>
                <div class="box">
                    <strong>MISSION:</strong> ${formData.india_mission}<br/>
                    <strong>OBJECTIF:</strong> ${formData.india_objectif}<br/>
                    <strong>ITINÉRAIRE:</strong> ${formData.india_itineraire}<br/>
                </div>
                <div class="box" style="font-size:9px;">
                    <strong>CAT SPÉCIFIQUE:</strong><br/>
                    ${formData.india_cat.replace(/\n/g, '<br>')}
                </div>
                <!-- AJOUT LIGNE CELLULE -->
                ${formatCelluleMembers("India")}
            </div>
            <div class="col" style="padding-left: 10px;">
                <div style="background:#000; color:#fff; padding:5px; font-weight:bold; text-align:center;">AO (APPUI)</div>
                <div class="box">
                    <strong>MISSION:</strong> ${formData.ao_mission}<br/>
                    <strong>ZONE:</strong> ${formData.ao_zone}<br/>
                    <strong>SECTEUR:</strong> ${formData.ao_secteur}<br/>
                    <strong>CHEF AO:</strong> ${formData.ao_chef}
                </div>
                <div class="box" style="font-size:9px;">
                    <strong>CAT SPÉCIFIQUE:</strong><br/>
                    ${formData.ao_cat.replace(/\n/g, '<br>')}
                </div>
                 <!-- AJOUT LIGNE CELLULE -->
                ${formatCelluleMembers("AO")}
            </div>
        </div>

        <!-- PAGES DÉDIÉES PHOTOS (ORDRE DEMANDÉ) -->
        ${getPhotosHtml('photo_logistique', 'LOGISTIQUE', '48%', '400px', true)}
        ${getPhotosHtml('photo_ao_vue', 'VUE EMPLACEMENT AO', '48%', '400px', true)}
        ${getPhotosHtml('photo_india_iti', 'ITINÉRAIRE INDIA', '48%', '400px', true)}
        ${getPhotosHtml('photo_effrac', 'DÉTAILS EFFRACTION', '48%', '400px', true)}

        <div class="page-break"></div>

        <!-- PAGE X: PATRACDVR -->
        <h2>7. PATRACDVR</h2>
        ${drawPatrac()}

        <div class="page-break"></div>

        <!-- PAGE Y: CAT & LOGISTIQUE -->
        <h2>9. DIVERS & SÉCURITÉ</h2>
        <div class="row">
            <div class="col">
                <h3>CONDUITES À TENIR GÉNÉRALES</h3>
                <div class="box">
                    ${formData.cat_generales.replace(/\n/g, '<br>')}
                </div>
                ${formData.no_go ? `<div class="box" style="border:2px solid red; color:red; font-weight:bold;">NO GO: ${formData.no_go}</div>` : ''}
            </div>
            <div class="col">
                <h3>LIAISON</h3>
                <div class="box">
                    ${formData.cat_liaison.replace(/\n/g, '<br>')}
                </div>
            </div>
        </div>

        <div style="margin-top: 50px; text-align: center; font-size: 8px;">
            DOCUMENT GÉNÉRÉ PAR ${trigramme_redacteur || 'G-TAK'} // ${new Date().toLocaleString()}
        </div>

      </body>
      </html>
    `;
  };

  const handleGeneratePDF = async () => {
    try {
      const html = generateHTML();
      const { uri } = await Print.printToFileAsync({ html, width: 842, height: 595 });
      await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
    } catch (e) {
      Alert.alert("Erreur", "Impossible de générer le PDF.");
    }
  };

  // --- RENDERING HELPERS ---

  const renderInput = (label: string, value: string, onChange: (t: string) => void, multiline = false, placeholder?: string) => (
    <View style={styles.inputGroup}>
        <Text style={styles.label}>{label}</Text>
        <TextInput
            style={[styles.input, multiline && { minHeight: 80, maxHeight: 150, textAlignVertical: 'top' }]}
            value={value}
            onChangeText={onChange}
            multiline={multiline}
            placeholder={placeholder}
            placeholderTextColor={COLORS.textMuted}
        />
    </View>
  );

  const renderAdversaireForm = (advKey: 'adversaire_1' | 'adversaire_2') => {
      const adv = formData[advKey];
      return (
          <View>
              {renderInput("Nom / Prénom", adv.nom, t => updateAdversaire(advKey, 'nom', t))}
              {renderInput("Domicile", adv.domicile, t => updateAdversaire(advKey, 'domicile', t), true)}
              <DynamicListInput label="Moyens Employés (ME)" list={adv.me_list} onChange={l => updateAdversaire(advKey, 'me_list', l)} />
              
              <View style={styles.row}>
                  <View style={{flex:1}}>{renderInput("Né le (Date)", adv.date_naissance, t => updateAdversaire(advKey, 'date_naissance', t), false, "JJ/MM/AAAA")}</View>
                  <View style={{width:10}}/>
                  <View style={{flex:1}}>{renderInput("Lieu Naissance", adv.lieu_naissance, t => updateAdversaire(advKey, 'lieu_naissance', t), false, "Lieu de naissance")}</View>
              </View>
              <View style={styles.row}>
                  <View style={{flex:1}}>{renderInput("Stature", adv.stature, t => updateAdversaire(advKey, 'stature', t), false, "Stature")}</View>
                  <View style={{width:10}}/>
                  <View style={{flex:1}}>
                      <Text style={styles.label}>ETHNIE</Text>
                      {["Caucasien", "Nord africain", "Afro-antillais", "Asiatique"].map(opt => (
                          <TouchableOpacity key={opt} onPress={() => updateAdversaire(advKey, 'ethnie', opt)} style={{marginBottom:5}}>
                              <Text style={{color: adv.ethnie === opt ? COLORS.primary : COLORS.textMuted}}>{adv.ethnie === opt ? "[x]" : "[ ]"} {opt}</Text>
                          </TouchableOpacity>
                      ))}
                  </View>
              </View>
              {renderInput("Signes Particuliers", adv.signes, t => updateAdversaire(advKey, 'signes', t))}
              {renderInput("Profession", adv.profession, t => updateAdversaire(advKey, 'profession', t))}
              {renderInput("Antécédents", adv.antecedents, t => updateAdversaire(advKey, 'antecedents', t), true)}
              <ChipSelector label="État d'esprit" selected={adv.etat_esprit} options={["Serein", "Hostile", "Conciliant", "Sur ses gardes"]} onChange={l => updateAdversaire(advKey, 'etat_esprit', l)} />
              {renderInput("Attitude connue", adv.attitude, t => updateAdversaire(advKey, 'attitude', t), true)}
              <ChipSelector label="Volume Renfort" selected={adv.volume} options={["Seul", "Famille", "BO", "Conjointe", "2-3", "4+"]} onChange={l => updateAdversaire(advKey, 'volume', l)} />
              {renderInput("Substances", adv.substances, t => updateAdversaire(advKey, 'substances', t))}
              <DynamicListInput label="Véhicules Adversaire" list={adv.vehicules_list} onChange={l => updateAdversaire(advKey, 'vehicules_list', l)} />
              {renderInput("Armes connues", adv.armes, t => updateAdversaire(advKey, 'armes', t))}
          </View>
      );
  };

  const renderMemberEditModal = () => {
    if (!isMemberEditModalVisible || !tempMember) return null;
    const renderSelect = (label: string, field: keyof IMember, options: string[]) => (
        <View style={{marginBottom: 15}}>
            <Text style={styles.label}>{label}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8}}>
                {options.map(opt => (
                    <TouchableOpacity key={opt} style={[styles.chip, tempMember[field] === opt && styles.chipSelected]}
                      onPress={() => setTempMember({...tempMember, [field]: opt})}>
                        <Text style={{color: tempMember[field] === opt ? 'white' : COLORS.textMuted}}>{opt}</Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>
        </View>
    );
    return (
        <Modal visible={isMemberEditModalVisible} animationType="slide" transparent>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContainer}>
                <View style={styles.modalContent}>
                    <View style={styles.modalHeader}>
                        <Text style={styles.modalTitle}>ÉDITION OPÉRATEUR</Text>
                        <TouchableOpacity onPress={() => setIsMemberEditModalVisible(false)}><Text style={{color:COLORS.danger}}>FERMER</Text></TouchableOpacity>
                    </View>
                    <ScrollView style={{maxHeight: '80%'}}>
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>TRIGRAMME</Text>
                            <TextInput style={styles.input} value={tempMember.trigramme} onChangeText={t => setTempMember({...tempMember, trigramme: t.toUpperCase()})} maxLength={5}/>
                        </View>
                        {renderSelect("FONCTION", "fonction", MEMBER_CONFIG.options.fonctions)}
                        {renderSelect("CELLULE", "cellule", MEMBER_CONFIG.options.cellules)}
                        {renderSelect("TENUE", "tenue", MEMBER_CONFIG.options.tenues)}
                        {renderSelect("ARMEMENT PRINCIPAL", "principales", MEMBER_CONFIG.options.principales)}
                        {renderSelect("ARMEMENT SECONDAIRE", "secondaires", MEMBER_CONFIG.options.secondaires)}
                        {renderSelect("GRENADES", "grenades", MEMBER_CONFIG.options.grenades)}
                        {renderSelect("EQUIPEMENT", "equipement", MEMBER_CONFIG.options.equipements)}
                        {renderSelect("PROTECTION", "gpb", MEMBER_CONFIG.options.gpbs)}
                    </ScrollView>
                    <View style={{flexDirection:'row', gap:10, marginTop:10}}>
                        <TouchableOpacity onPress={deleteMember} style={[styles.navBtn, {borderColor: COLORS.danger}]}><Text style={{color: COLORS.danger}}>SUPPRIMER</Text></TouchableOpacity>
                        <TouchableOpacity onPress={saveMemberChanges} style={[styles.navBtn, {backgroundColor: COLORS.success}]}><Text style={{color: '#000'}}>SAUVEGARDER</Text></TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
  };

  const renderVehicleRenameModal = () => {
      if(!isVehicleRenameVisible || !vehicleToRename) return null;
      return (
        <Modal visible={isVehicleRenameVisible} animationType="fade" transparent>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContainer}>
                <View style={[styles.modalContent, {maxHeight: 200}]}>
                    <Text style={[styles.modalTitle, {marginBottom:20}]}>RENOMMER VÉHICULE</Text>
                    <TextInput 
                        style={styles.input} 
                        value={newVehicleName} 
                        onChangeText={setNewVehicleName} 
                        autoFocus 
                    />
                    <View style={{flexDirection:'row', gap:10, marginTop:20}}>
                        <TouchableOpacity onPress={() => setIsVehicleRenameVisible(false)} style={[styles.navBtn, {borderColor: COLORS.danger}]}><Text style={{color: COLORS.danger}}>ANNULER</Text></TouchableOpacity>
                        <TouchableOpacity onPress={confirmRenameVehicle} style={[styles.navBtn, {backgroundColor: COLORS.success}]}><Text style={{color: '#000'}}>VALIDER</Text></TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
      );
  };

  // --- STEPS RENDER ---
  const renderStepContent = () => {
    switch(step) {
        case 0: // SITUATION
            return (
                <View>
                    {renderInput("Date Opération", formData.date_op, t => updateField('date_op', t), false, "YYYY-MM-DD")}
                    {renderInput("1.1 Générale", formData.situation_generale, t => updateField('situation_generale', t), true)}
                    {renderInput("1.2 Particulière", formData.situation_particuliere, t => updateField('situation_particuliere', t), true)}
                </View>
            );
        case 1: // ADVERSAIRES
            return (
                <View>
                    <Text style={styles.sectionTitle}>ADVERSAIRE PRINCIPAL</Text>
                    {renderAdversaireForm('adversaire_1')}
                    <View style={styles.separator} />
                    <Text style={styles.sectionTitle}>ADVERSAIRE SECONDAIRE</Text>
                    {renderAdversaireForm('adversaire_2')}
                </View>
            );
        case 2: // ENVIRONNEMENT
            return (
                <View>
                    {renderInput("Amis / Soutien", formData.amis, t => updateField('amis', t))}
                    {renderInput("Terrain / Météo", formData.terrain_info, t => updateField('terrain_info', t))}
                    {renderInput("Population", formData.population, t => updateField('population', t))}
                    {renderInput("Cadre Juridique", formData.cadre_juridique, t => updateField('cadre_juridique', t))}
                </View>
            );
        case 3: // MISSION PSIG
            return (
                <View>
                    {renderInput("Missions", formData.missions_psig, t => updateField('missions_psig', t), true)}
                </View>
            );
        case 4: // EXECUTION
            return (
                <View>
                    <View style={styles.row}>
                        <View style={{flex:1}}>{renderInput("Date", formData.date_execution, t => updateField('date_execution', t))}</View>
                        <View style={{width:10}}/>
                        <View style={{flex:1}}>{renderInput("Heure (H)", formData.heure_execution, t => updateField('heure_execution', t))}</View>
                    </View>
                    {renderInput("Corps de la mission", formData.action_body_text, t => updateField('action_body_text', t), true)}
                    
                    <Text style={styles.label}>CHRONOLOGIE</Text>
                    {formData.chronologie.map((item, i) => (
                        <View key={i} style={{flexDirection:'row', alignItems:'center', marginBottom:5}}>
                            <Text style={{color:COLORS.primary, width:30}}>{item.type}</Text>
                            <TextInput style={[styles.input, {flex:2, marginRight:5}]} value={item.label} onChangeText={t => {
                                const nu = [...formData.chronologie]; nu[i].label = t; updateField('chronologie', nu);
                            }} />
                            <TextInput style={[styles.input, {width:60}]} value={item.hour} placeholder="H" placeholderTextColor="#666" onChangeText={t => {
                                const nu = [...formData.chronologie]; nu[i].hour = t; updateField('chronologie', nu);
                            }} />
                        </View>
                    ))}

                    <Text style={[styles.label, {marginTop:15}]}>HYPOTHÈSES</Text>
                    {renderInput("H1", formData.hypothese_h1, t => updateField('hypothese_h1', t))}
                    {renderInput("H2", formData.hypothese_h2, t => updateField('hypothese_h2', t))}
                    {renderInput("H3", formData.hypothese_h3, t => updateField('hypothese_h3', t))}
                </View>
            );
        case 5: // ARTICULATION
            return (
                <View>
                    {renderInput("Place du Chef (Générale)", formData.place_chef_gen, t => updateField('place_chef_gen', t))}
                    
                    <Text style={styles.sectionTitle}>ÉQUIPE INDIA (INTER)</Text>
                    {renderInput("Mission", formData.india_mission, t => updateField('india_mission', t), true)}
                    {renderInput("Objectif", formData.india_objectif, t => updateField('india_objectif', t))}
                    {renderInput("Itinéraire", formData.india_itineraire, t => updateField('india_itineraire', t), true)}
                    {renderInput("Points Particuliers", formData.india_points, t => updateField('india_points', t), true)}
                    {renderInput("CAT INDIA", formData.india_cat, t => updateField('india_cat', t), true)}
                    
                    <View style={styles.separator} />

                    <Text style={styles.sectionTitle}>ÉQUIPE AO (APPUI)</Text>
                    {renderInput("Zone d'installation", formData.ao_zone, t => updateField('ao_zone', t), true)}
                    {renderInput("Mission", formData.ao_mission, t => updateField('ao_mission', t), true)}
                    {renderInput("Secteur Surveillance", formData.ao_secteur, t => updateField('ao_secteur', t), true)}
                    {renderInput("Points Particuliers", formData.ao_points, t => updateField('ao_points', t), true)}
                    {renderInput("Place du Chef (AO)", formData.ao_chef, t => updateField('ao_chef', t))}
                    {renderInput("CAT AO", formData.ao_cat, t => updateField('ao_cat', t), true)}
                </View>
            );
        case 6: // PATRACDVR
            return (
                <View>
                    <View style={{flexDirection:'row', justifyContent:'space-between', marginBottom:10}}>
                        <Text style={styles.helper}>Tapez pour sélectionner. Maintenir pour éditer.</Text>
                        <TouchableOpacity onPress={addVehicle}><Text style={{color:COLORS.success}}>+ VEHICULE</Text></TouchableOpacity>
                    </View>
                    {vehicles.map(v => (
                        <TouchableOpacity 
                            key={v.id} 
                            style={styles.vehCard} 
                            onPress={() => assignSelectedMemberToVehicle(v.id)}
                            onLongPress={() => openRenameVehicle(v)}
                            delayLongPress={600}
                        >
                            <View style={{flexDirection:'row', justifyContent:'space-between'}}>
                                <Text style={styles.vehTitle}>{v.name} ({v.type})</Text>
                                {/* CORRECTION: removeVehicle renvoie les membres dans le pool */}
                                <Text style={{color:COLORS.danger}} onPress={() => removeVehicle(v)}>X</Text>
                            </View>
                            <View style={{flexDirection:'row', flexWrap:'wrap', gap:5, marginTop:5}}>
                                {v.members.map(m => (
                                    <TouchableOpacity key={m.id} onPress={() => returnMemberToPool(m.id)} onLongPress={() => openMemberEditor(m)} style={styles.memberBadge}>
                                        <Text style={styles.memberText}>{m.trigramme}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                        </TouchableOpacity>
                    ))}
                    <View style={{flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginTop:20}}>
                        <Text style={styles.label}>POOL (NON ASSIGNÉS)</Text>
                        <View style={{flexDirection:'row', gap:10}}>
                             <TouchableOpacity onPress={importMemberConfig}><Text style={{color: COLORS.warning}}>IMPORTER CONFIG JSON</Text></TouchableOpacity>
                             <TouchableOpacity onPress={createNewMember}><Text style={{color: COLORS.primary}}>+ AJOUTER PAX</Text></TouchableOpacity>
                        </View>
                    </View>
                    <View style={{flexDirection:'row', flexWrap:'wrap', gap:5}}>
                        {poolMembers.map(m => (
                            <TouchableOpacity key={m.id} style={[styles.memberPoolBadge, selectedMemberId === m.id && {backgroundColor:'#1e3a8a', borderColor: COLORS.primary}]}
                                onPress={() => handleMemberTap(m)} onLongPress={() => openMemberEditor(m)}>
                                <Text style={{color:'#fff', fontWeight:'bold'}}>{m.trigramme}</Text>
                                <Text style={{color:'#aaa', fontSize:9}}>{m.fonction}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </View>
            );
        case 7: // PHOTOS
            return (
                <ScrollView>
                    <Text style={styles.helper}>Touchez une case pour ajouter une photo. Vous pouvez en ajouter plusieurs par catégorie.</Text>
                    {[
                        {id: 'photo_adv_1', label: 'Adversaire Principal'},
                        {id: 'photo_adv_2', label: 'Adversaire Secondaire'},
                        {id: 'photo_renforts', label: 'Renforts'},
                        {id: 'photo_logistique', label: 'Logistique'},
                        {id: 'photo_ao_vue', label: 'Vue Emplacement AO'},
                        {id: 'photo_india_iti', label: 'Itinéraire India'},
                        {id: 'photo_effrac', label: 'Effraction / Détails'}
                    ].map(item => {
                        const catPhotos = photos.filter(ph => ph.category === item.id);
                        return (
                            <View key={item.id} style={{marginBottom:15}}>
                                <TouchableOpacity style={styles.photoThumbLarge} onPress={() => pickImage(item.id)}>
                                    <Text style={{color:'#666', textAlign:'center', fontWeight:'bold'}}>+ AJOUTER: {item.label}</Text>
                                </TouchableOpacity>
                                
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginTop:5}}>
                                {catPhotos.map((p, idx) => (
                                    <TouchableOpacity key={p.id} onPress={() => { setCurrentPhotoToAnnotate(p.id); setIsAnnotationVisible(true); }}
                                        style={{marginRight: 10, position:'relative'}}>
                                        <Image source={{ uri: p.uri }} style={{width:100, height:100, borderRadius:4}} resizeMode="cover" />
                                        {p.annotations.length > 0 && <View style={styles.annotBadge} />}
                                        <TouchableOpacity style={{position:'absolute', top:0, right:0, backgroundColor:'red', width:20, height:20, borderRadius:10, alignItems:'center', justifyContent:'center'}}
                                            onPress={() => deletePhoto(p.id)}>
                                            <Text style={{color:'white', fontWeight:'bold', fontSize:10}}>X</Text>
                                        </TouchableOpacity>
                                    </TouchableOpacity>
                                ))}
                                </ScrollView>
                            </View>
                        );
                    })}
                </ScrollView>
            );
        case 8: // CAT
            return (
                <View>
                    {renderInput("Générales", formData.cat_generales, t => updateField('cat_generales', t), true)}
                    {renderInput("NO GO", formData.no_go, t => updateField('no_go', t), true, "Saisir les conditions de désengagement...")}
                    {renderInput("Liaison", formData.cat_liaison, t => updateField('cat_liaison', t), true)}
                </View>
            );
        case 9: // FINALISATION
            return (
                <View style={{alignItems:'center', gap: 20, marginTop: 50}}>
                    <Text style={{color:COLORS.text, textAlign:'center'}}>L'Ordre Initial est prêt.</Text>
                    
                    {renderInput("Trigramme Rédacteur (PDF)", formData.trigramme_redacteur, t => updateField('trigramme_redacteur', t), false, "Ex: MDL CHEF")}

                    <TouchableOpacity style={[styles.navBtn, {backgroundColor: COLORS.success, width:'100%', height: 60}]} onPress={handleGeneratePDF}>
                        <Text style={[styles.navBtnText, {color:'#000', fontSize:18}]}>GÉNÉRER PDF</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.navBtn, {backgroundColor: COLORS.surfaceLight, width:'100%'}]} onPress={() => Linking.openURL("https://oxsilaris06.github.io/CET/retex")}>
                        <Text style={styles.navBtnText}>LIEN RETEX (WEB)</Text>
                    </TouchableOpacity>
                    
                    <View style={styles.separator} />
                    
                    <View style={{flexDirection:'row', gap:10}}>
                         <TouchableOpacity style={[styles.navBtn, {backgroundColor: COLORS.surfaceLight}]} onPress={exportSessionToJson}>
                            <Text style={styles.navBtnText}>SAUVEGARDER JSON</Text>
                        </TouchableOpacity>
                         <TouchableOpacity style={[styles.navBtn, {backgroundColor: COLORS.surfaceLight}]} onPress={importSessionFromJson}>
                            <Text style={styles.navBtnText}>CHARGER JSON</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            );
        default: return null;
    }
  };

  const STEPS = ["SITUATION", "ADVERSAIRES", "ENVIRON.", "MISSION", "EXECUTION", "ARTICULATION", "PATRAC", "PHOTOS", "CAT", "FIN"];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backButton}><Text style={styles.backButtonText}>{"<"}</Text></TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>G-TAK OI WIZARD</Text>
        <View style={{width: 40}} />
      </View>

      <View style={{height:50}}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.progressScroll}>
            {STEPS.map((s, i) => (
                <TouchableOpacity key={i} onPress={() => setStep(i)} style={[styles.stepItem, step === i && styles.stepItemActive]}>
                    <Text style={[styles.stepText, step === i && styles.stepTextActive]}>{i+1}. {s}</Text>
                </TouchableOpacity>
            ))}
        </ScrollView>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{flex:1}}>
        <ScrollView style={styles.content} contentContainerStyle={{paddingBottom: 150}}>
            {renderStepContent()}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.navBtn} onPress={() => step > 0 && setStep(step - 1)}>
            <Text style={styles.navBtnText}>PREC.</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.navBtn, {backgroundColor: COLORS.primary}]} onPress={() => { 
            if (step < 9) setStep(step + 1); 
            saveData(); 
        }}>
            <Text style={[styles.navBtnText, {color:'#fff'}]}>{step === 9 ? "SAUVEGARDER" : "SUIV."}</Text>
        </TouchableOpacity>
      </View>

      {renderMemberEditModal()}
      {renderVehicleRenameModal()}

      <Modal visible={isAnnotationVisible} animationType="slide" onRequestClose={() => setIsAnnotationVisible(false)}>
        <SafeAreaView style={{flex:1, backgroundColor:'#000'}}>
            <View style={{padding:10, flexDirection:'row', justifyContent:'space-between'}}>
                <Text style={{color:COLORS.text}}>Touchez pour placer un marqueur</Text>
                <TouchableOpacity onPress={() => setIsAnnotationVisible(false)}><Text style={{color:COLORS.primary}}>FERMER</Text></TouchableOpacity>
            </View>
            <TouchableOpacity activeOpacity={1} style={{flex:1, justifyContent:'center'}} 
                onPress={(e) => {
                    const { locationX, locationY } = e.nativeEvent;
                    const width = Dimensions.get('window').width;
                    const height = 400; 
                    addAnnotation((locationX / width) * 100, (locationY / height) * 100);
                }}>
                {currentPhotoToAnnotate && (
                    <View>
                        <Image source={{ uri: photos.find(p => p.id === currentPhotoToAnnotate)?.uri }} style={{width: '100%', height: 400, resizeMode: 'contain'}} />
                        {photos.find(p => p.id === currentPhotoToAnnotate)?.annotations.map((a, i) => (
                            <View key={i} style={{
                                position:'absolute', left:`${a.x}%`, top:`${a.y}%`, width:24, height:24, borderRadius:12, backgroundColor:'rgba(255,0,0,0.8)', 
                                justifyContent:'center', alignItems:'center', borderWidth:2, borderColor:'#fff', transform: [{translateX: -12}, {translateY: -12}]
                            }}>
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
  // CORRECTION PADDING TOP HEADER
  header: { padding: 15, paddingTop: Platform.OS === 'android' ? 40 : 15, borderBottomWidth: 1, borderColor: COLORS.border, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { color: COLORS.primary, fontSize: 18, fontWeight: 'bold', letterSpacing: 2, flex: 1, textAlign: 'center' },
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
  navBtn: { flex: 1, padding: 15, alignItems: 'center', borderRadius: 4, marginHorizontal: 5, borderWidth: 1, borderColor: COLORS.border, justifyContent: 'center' },
  navBtnText: { color: COLORS.textMuted, fontWeight: 'bold' },
  
  // PATRACDVR
  vehCard: { backgroundColor: COLORS.surfaceLight, padding: 10, marginBottom: 10, borderRadius: 4, borderWidth: 1, borderLeftWidth: 4, borderColor: COLORS.border },
  vehTitle: { color: '#fff', fontWeight: 'bold' },
  memberBadge: { backgroundColor: COLORS.surface, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: COLORS.border },
  memberPoolBadge: { backgroundColor: COLORS.surfaceLight, padding: 8, borderRadius: 4, minWidth: 60, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  memberText: { color: COLORS.text, fontSize: 10 },
  helper: { color: COLORS.textMuted, fontStyle: 'italic', marginBottom: 10, fontSize: 11 },

  // PHOTOS
  photoThumbLarge: { width: '100%', height: 40, backgroundColor: COLORS.surfaceLight, borderRadius: 4, overflow: 'hidden', justifyContent: 'center', borderColor: COLORS.border, borderWidth:1 },
  annotBadge: { position: 'absolute', top: 5, right: 5, width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.danger },

  // MODAL
  modalContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#18181b', borderRadius: 12, padding: 20, maxHeight: '90%', borderWidth:1, borderColor: '#333' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  modalTitle: { color: 'white', fontSize: 18, fontWeight: 'bold' }
});
