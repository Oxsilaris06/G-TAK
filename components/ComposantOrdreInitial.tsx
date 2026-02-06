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

// Import du module PATRACDVR
import Patrac from './Patrac';

// --- THEME TACTICAL GLASS (cohérent avec Patrac.tsx) ---
const THEME = {
    bg: '#050505',
    bgGlass: 'rgba(22, 22, 25, 0.7)',
    bgGlassHeavy: 'rgba(15, 15, 20, 0.95)',
    bgElement: 'rgba(255, 255, 255, 0.03)',
    bgInput: 'rgba(0, 0, 0, 0.4)',
    borderGlass: 'rgba(255, 255, 255, 0.08)',
    accentBlue: '#3b82f6',
    accentHover: '#2563eb',
    accentGlow: 'rgba(59, 130, 246, 0.3)',
    textPrimary: '#e0e0e0',
    textSecondary: '#94a3b8',
    dangerRed: '#ef4444',
    successGreen: '#22c55e',
    warningYellow: '#eab308',
    trashColor: '#6c757d',
};

// --- PROPS ---
interface OIViewProps {
    onClose?: () => void;
}

// --- CONSTANTES & CONFIGURATION ---

const MEMBER_CONFIG = {
    options: {
        fonctions: ["Chef inter", "Chef dispo", "Chef Oscar", "Conducteur", "Chef de Bord", "DE", "Cyno", "Inter", "Effrac", "AO", "Sans"],
        cellules: ["AO1", "AO2", "AO3", "AO4", "AO5", "AO6", "AO7", "AO8", "India 1", "India 2", "India 3", "India 4", "India 5", "Effrac", "Commandement", "Sans"],
        principales: ["G36", "UMP9", "FAP", "MP5", "Sans"],
        afis: ["PIE", "LBD40", "LBD44", "Sans"],
        secondaires: ["SIG 2022", "G26", "Sans"],
        grenades: ["GENL", "MP7", "FAR", "Sans"],
        equipements: ["Sans", "BBAL", "Belier", "Lacry", "IL", "Lot 5.11", "Lot Oscar", "Pince", "Drone", "Cam pieton",],
        equipements2: ["Sans", "Échelle", "Stop stick", "Lacry", "Cale", "IL", "Pass", "Cam pieton", "TPH700"],
        tenues: ["UBAS", "4S", "Bleu", "Civile", "Ghillie", "Treillis", "MO"],
        gpbs: ["GPBL", "GPBPD", "Casque Mo", "Casque Lourd", "Sans"],
        vehicules_types: ["Sharan", "Kodiaq", "5008", "Scénic", "Kodiaq Bana"]
    },
    members: [
        { trigramme: "XX", fonction: "Inter", cellule: "AO1", tenue: "UBAS" },
        { trigramme: "YY", fonction: "Sans", cellule: "India 1", tenue: "UBAS" },
    ]
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
    trigramme_redacteur: string;
    unite_redacteur: string;
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
    logo_mode: 'background' | 'included';
    pdf_theme: 'light' | 'dark';
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
    base64?: string;
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
    unite_redacteur: "",
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
    cat_liaison: "TOM: \nDIR: \nGestuelle et visuelle entre les éléments INDIA",
    logo_mode: 'included',
    pdf_theme: 'light'
};

// --- SOUS-COMPOSANTS ---

const DynamicListInput = ({ label, list, onChange, placeholder = "Ajouter..." }: { label: string, list: string[], onChange: (l: string[]) => void, placeholder?: string }) => {
    const [txt, setTxt] = useState("");
    return (
        <View style={styles.inputGroup}>
            <Text style={styles.label}>{label}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 5 }}>
                {list.map((item, i) => (
                    <TouchableOpacity key={i} onPress={() => onChange(list.filter((_, idx) => idx !== i))} style={styles.chip}>
                        <Text style={{ color: THEME.textPrimary }}>{item} X</Text>
                    </TouchableOpacity>
                ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 5 }}>
                <TextInput
                    style={[styles.input, { flex: 1 }]}
                    value={txt} onChangeText={setTxt}
                    placeholder={placeholder} placeholderTextColor={THEME.textSecondary}
                />
                <TouchableOpacity
                    style={{ backgroundColor: THEME.bgElement, justifyContent: 'center', padding: 10, borderRadius: 8, borderWidth: 1, borderColor: THEME.borderGlass }}
                    onPress={() => { if (txt) { onChange([...list, txt]); setTxt(""); } }}
                >
                    <MaterialIcons name="add" size={20} color="white" />
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
                            <Text style={{ color: isSel ? '#fff' : THEME.textSecondary, fontWeight: isSel ? 'bold' : 'normal' }}>{opt}</Text>
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

    const [isAnnotationVisible, setIsAnnotationVisible] = useState(false);
    const [currentPhotoToAnnotate, setCurrentPhotoToAnnotate] = useState<string | null>(null);

    const [isMemberEditModalVisible, setIsMemberEditModalVisible] = useState(false);
    const [tempMember, setTempMember] = useState<IMember | null>(null);

    const [isVehicleRenameVisible, setIsVehicleRenameVisible] = useState(false);
    const [vehicleToRename, setVehicleToRename] = useState<IVehicle | null>(null);
    const [newVehicleName, setNewVehicleName] = useState("");

    // État pour afficher/masquer le module Patrac
    const [isPatracVisible, setIsPatracVisible] = useState(false);

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

    // --- GESTION DU RETOUR DE PATRAC ---
    const handleApplyFromPatrac = (data: { vehicles: IVehicle[]; poolMembers: IMember[] }) => {
        setVehicles(data.vehicles);
        setPoolMembers(data.poolMembers);
        saveData();
        setIsPatracVisible(false);
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
        setTempMember({ ...member });
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
            {
                text: "Supprimer", style: 'destructive', onPress: () => {
                    setPoolMembers(prev => prev.filter(m => m.id !== tempMember.id));
                    setVehicles(prev => prev.map(v => ({ ...v, members: v.members.filter(m => m.id !== tempMember.id) })));
                    setIsMemberEditModalVisible(false);
                }
            }
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
        const type = "";
        const newVeh: IVehicle = { id: `v_${Date.now()}`, name: `Vehicule ${vehicles.length + 1}`, type, members: [] };
        setVehicles([...vehicles, newVeh]);
    };

    const removeVehicle = (vehicle: IVehicle) => {
        const membersToReturn = vehicle.members;
        setVehicles(prev => prev.filter(v => v.id !== vehicle.id));
        setPoolMembers(prev => [...prev, ...membersToReturn]);
    };

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
            quality: 0.5,
            base64: true
        });
        if (!result.canceled && result.assets && result.assets.length > 0) {
            const asset = result.assets[0];
            const newPhoto: IPhoto = {
                id: Date.now().toString(),
                uri: asset.uri,
                base64: asset.base64 || undefined,
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
        const { date_op, trigramme_redacteur, unite_redacteur, logo_mode, pdf_theme } = formData;

        // Récupération du Logo
        const logoPhoto = photos.find(p => p.category === 'photo_logo_unite');
        // On force un type mime qui fonctionne généralement bien avec le base64 générique
        const logoSrc = logoPhoto?.base64 ? `data:image/jpeg;base64,${logoPhoto.base64}` : null;

        const isBg = logo_mode === 'background';

        // COULEURS DYNAMIQUES (Basées sur la logique fournie)
        const isDark = pdf_theme === 'dark';
        const colors = isDark ? {
            bg: '#000000', // rgb(0,0,0)
            text: '#ffffff',
            accent: '#5b9bd5', // rgb(91,155,213)
            danger: '#c0392b',
            border: '#ffffff'
        } : {
            bg: '#ffffff',
            text: '#000000',
            accent: '#0033a0', // rgb(0,51,160)
            danger: '#c0392b',
            border: '#000000'
        };

        const page1TextColor = isBg ? '#FFFFFF' : colors.text;
        const page1BorderColor = isBg ? '#FFFFFF' : colors.accent;

        const bgOpacity = isDark ? 0.6 : 0.9;

        // CONFIGURATION CSS DE LA PAGE 1
        // A4 Paysage : 297mm x 210mm. Marges CSS : 1cm.
        // Pour le fond d'écran, on utilise absolute avec marges négatives pour couvrir toute la page, marges incluses.

        let logoHtml = '';
        let page1ContainerStyle = '';

        if (logoSrc) {
            if (isBg) {
                // MODE FOND D'ÉCRAN
                // Image en arrière plan absolu (et non fixed) pour rester uniquement sur la page 1
                // Couvre tout le A4 (29.7cm x 21cm) en compensant les marges de 1cm
                logoHtml = `
                <div style="position: absolute; top: -1cm; left: -1cm; width: 297mm; height: 210mm; z-index: -10; overflow: hidden; display: flex; justify-content: center; align-items: center; background-color: ${colors.bg};">
                    <img src="${logoSrc}" style="width: 100%; height: 100%; object-fit: contain; opacity: ${bgOpacity};" />
                </div>
            `;
                // Centrage vertical du contenu
                page1ContainerStyle = `display: flex; flex-direction: column; height: 180mm; justify-content: center; position: relative;`;
            } else {
                // MODE INCLUE
                // Image affichée normalement dans le flux
                logoHtml = `
                <div style="margin-top: 10px; flex: 1; min-height: 0; display: flex; justify-content: center; align-items: flex-start; width: 100%;">
                    <img src="${logoSrc}" style="max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain;" />
                </div>
            `;
                // Alignement haut avec padding
                page1ContainerStyle = `display: flex; flex-direction: column; height: 180mm; justify-content: flex-start; padding-top: 40px; align-items: center;`;
            }
        } else {
            // Pas de logo
            page1ContainerStyle = `display: flex; flex-direction: column; height: 180mm; justify-content: center; align-items: center;`;
        }

        // Styles dynamiques pour le titre et la cible (couleur blanche si fond d'écran)
        const h1Style = `font-family: 'Oswald'; text-align: center; font-size: 36px; border: 4px solid ${page1BorderColor}; padding: 20px; margin-bottom: 20px; text-transform: uppercase; letter-spacing: 2px; color: ${isBg ? '#FFFFFF' : colors.accent}; width: 80%;`;
        const cibleStyle = `text-align: center; font-size: 20px; font-weight: bold; margin-top: 15px; color: ${isBg ? '#FFFFFF' : colors.text};`;

        // Génération conditionnelle du titre "Cible"
        let cibleTitleHtml = '';
        if (formData.adversaire_1.nom && formData.adversaire_2.nom) {
            cibleTitleHtml = `<div style="${cibleStyle}">CIBLES : ${formData.adversaire_1.nom} & ${formData.adversaire_2.nom}</div>`;
        } else if (formData.adversaire_1.nom) {
            cibleTitleHtml = `<div style="${cibleStyle}">CIBLE : ${formData.adversaire_1.nom}</div>`;
        }

        // HELPERS GRAPHIQUES
        const getPhotosHtml = (category: string, label: string, pageBreakBefore = false) => {
            const catPhotos = photos.filter(p => p.category === category);
            if (catPhotos.length === 0) return '';

            let html = '';
            if (pageBreakBefore) html += `<div class="page-break"></div>`;

            html += `<h2 style="margin-top:20px; height: 10%; box-sizing: border-box;">${label}</h2>`;

            html += `<div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 2%; height: 85%; align-content: flex-start;">`;

            const itemWidth = catPhotos.length === 1 ? '90%' : '45%';
            const maxHeight = catPhotos.length === 1 ? '600px' : '400px';

            catPhotos.forEach(photo => {
                const imageSrc = photo.base64 ? `data:image/jpeg;base64,${photo.base64}` : photo.uri;

                html += `
            <div style="border: 2px solid ${colors.accent}; padding: 0; margin-bottom: 10px; background: transparent; width: ${itemWidth}; height: ${maxHeight}; page-break-inside: avoid; box-sizing: border-box; overflow: hidden;">
                <div style="position: relative; display: block; width: 100%; height: 100%; margin: 0 auto;">
                    <img src="${imageSrc}" style="width: 100%; height: 100%; object-fit: cover; display: block; margin: 0 auto;" />
                    ${photo.annotations.map(a => `
                        <div style="position: absolute; left: ${a.x}%; top: ${a.y}%; width: 20px; height: 20px; background: ${colors.danger}; color: white; border-radius: 50%; text-align: center; line-height: 20px; font-size: 12px; font-weight:bold; transform: translate(-50%, -50%); border: 2px solid white;">
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
            <div style="border: 2px solid ${colors.accent}; padding: 2px; margin-bottom: 5px; background: transparent;">
                <div style="position: relative;">
                    <img src="${imageSrc}" style="width: 100%; height: 300px; object-fit:cover; display: block;" />
                    ${photo.annotations.map(a => `
                        <div style="position: absolute; left: ${a.x}%; top: ${a.y}%; width: 15px; height: 15px; background: ${colors.danger}; color: white; border-radius: 50%; text-align: center; line-height: 15px; font-size: 10px; font-weight:bold; transform: translate(-50%, -50%); border: 1px solid white;">
                            ${a.text}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
            }).join('');
        };

        const formatCelluleMembers = (prefix: string) => {
            const allMembers = vehicles.flatMap(v => v.members).concat(poolMembers);
            const relevantMembers = allMembers.filter(m => m.cellule && m.cellule.toLowerCase().includes(prefix.toLowerCase()));

            if (relevantMembers.length === 0) return '';

            const grouped: { [key: string]: string[] } = {};
            relevantMembers.forEach(m => {
                const cellName = m.cellule;
                if (!grouped[cellName]) grouped[cellName] = [];
                grouped[cellName].push(m.trigramme);
            });

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
        <div style="margin-bottom: 20px; border: 2px solid ${colors.accent};">
            <div style="background:${colors.accent}; color:#fff; padding:5px; font-weight:bold; font-size:14px;">${title}: ${adv.nom}</div>
            <table style="width:100%; border-collapse:collapse; font-size:10px;">
                <tr style="background:${isDark ? '#333' : '#ddd'}; color:${colors.text};"><th style="border:1px solid ${colors.border}; width:30%;">INFORMATION</th><th style="border:1px solid ${colors.border};">DÉTAIL</th></tr>
                <tr><td style="border:1px solid ${colors.border}; font-weight:bold;">Domicile</td><td style="border:1px solid ${colors.border};">${adv.domicile}</td></tr>
                <tr><td style="border:1px solid ${colors.border}; font-weight:bold;">Naissance</td><td style="border:1px solid ${colors.border};">${adv.date_naissance} à ${adv.lieu_naissance}</td></tr>
                <tr><td style="border:1px solid ${colors.border}; font-weight:bold;">Physique</td><td style="border:1px solid ${colors.border};">${adv.stature} / ${adv.ethnie} / ${adv.signes}</td></tr>
                <tr><td style="border:1px solid ${colors.border}; font-weight:bold;">Profession</td><td style="border:1px solid ${colors.border};">${adv.profession}</td></tr>
                <tr><td style="border:1px solid ${colors.border}; font-weight:bold;">Antécédents</td><td style="border:1px solid ${colors.border};">${adv.antecedents}</td></tr>
                <tr><td style="border:1px solid ${colors.border}; font-weight:bold;">État d'esprit</td><td style="border:1px solid ${colors.border};">${adv.etat_esprit.join(', ')} / ${adv.attitude}</td></tr>
                <tr><td style="border:1px solid ${colors.border}; font-weight:bold;">Véhicules</td><td style="border:1px solid ${colors.border};">${adv.vehicules_list.join(', ')}</td></tr>
                <tr><td style="border:1px solid ${colors.border}; font-weight:bold;">Armes / ME</td><td style="border:1px solid ${colors.border};">${adv.armes} / ${adv.me_list.join(', ')}</td></tr>
            </table>
        </div>
        `;
        };

        const drawPatrac = () => {
            return vehicles.map(v => `
            <div style="margin-bottom: 15px; page-break-inside: avoid;">
                <div style="background:${isDark ? '#333' : '#ccc'}; color:${colors.text}; border:1px solid ${colors.border}; padding:4px; font-weight:bold;">VÉHICULE: ${v.name}${v.type ? ` (${v.type})` : ''}</div>
                <table style="width:100%; border-collapse:collapse; font-size:9px; text-align:center;">
                    <thead style="background:${isDark ? '#444' : '#eee'}; color:${colors.text};">
                        <tr>
                            <th style="border:1px solid ${colors.border};">TRIG.</th>
                            <th style="border:1px solid ${colors.border};">FCT</th>
                            <th style="border:1px solid ${colors.border};">CELLULE</th>
                            <th style="border:1px solid ${colors.border};">PRINC.</th>
                            <th style="border:1px solid ${colors.border};">SEC.</th>
                            <th style="border:1px solid ${colors.border};">AFI</th>
                            <th style="border:1px solid ${colors.border};">GREN.</th>
                            <th style="border:1px solid ${colors.border};">EQUIP 1</th>
                            <th style="border:1px solid ${colors.border};">EQUIP 2</th>
                            <th style="border:1px solid ${colors.border};">TENUE</th>
                            <th style="border:1px solid ${colors.border};">GPB</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${v.members.map(m => `
                        <tr>
                            <td style="border:1px solid ${colors.border}; font-weight:bold;">${m.trigramme}</td>
                            <td style="border:1px solid ${colors.border};">${m.fonction}</td>
                            <td style="border:1px solid ${colors.border};">${m.cellule}</td>
                            <td style="border:1px solid ${colors.border};">${m.principales}</td>
                            <td style="border:1px solid ${colors.border};">${m.secondaires}</td>
                            <td style="border:1px solid ${colors.border};">${m.afis}</td>
                            <td style="border:1px solid ${colors.border};">${m.grenades}</td>
                            <td style="border:1px solid ${colors.border};">${m.equipement}</td>
                            <td style="border:1px solid ${colors.border};">${m.equipement2}</td>
                            <td style="border:1px solid ${colors.border};">${m.tenue}</td>
                            <td style="border:1px solid ${colors.border};">${m.gpb}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `).join('');
        };

        // STYLES PDF AUGMENTÉS
        const enlargedStyle = `font-size: 14px;`;
        const enlargedTableStyle = `font-size: 12px;`;

        return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Oswald:wght@500&display=swap');
          @page { size: A4 landscape; margin: 0; }
          body { font-family: 'JetBrains Mono', sans-serif; background: ${colors.bg}; color: ${colors.text}; padding: 1cm; margin: 0; font-size: 11px; box-sizing: border-box; }
          .page-break { page-break-before: always; }
          h1 { font-family: 'Oswald'; }
          h2 { font-family: 'Oswald'; font-size: 16px; border-bottom: 2px solid ${colors.accent}; color: ${colors.accent}; margin-top: 20px; margin-bottom: 10px; padding-bottom: 2px; text-transform: uppercase; }
          h3 { font-size: 12px; font-weight: bold; margin-top: 10px; margin-bottom: 5px; text-decoration: underline; color: ${colors.accent}; }
          p { margin: 2px 0; text-align: justify; }
          .row { display: flex; flex-direction: row; gap: 20px; }
          .col { flex: 1; }
          .box { border: 1px solid ${colors.border}; padding: 10px; margin-bottom: 10px; }
          table { width: 100%; border-collapse: collapse; }
          td, th { border: 1px solid ${colors.border}; padding: 4px; }
          .highlight { background-color: ${isDark ? '#333' : '#eee'}; font-weight: bold; }
        </style>
      </head>
      <body>

        <!-- PAGE 1: COUVERTURE -->
        <!-- Conteneur avec style dynamique selon le mode logo -->
        <div style="${page1ContainerStyle}">
            
            ${isBg ? logoHtml : ''}
            
            <!-- Bloc Titre et Cibles -->
            <div style="width: 100%; display: flex; flex-direction: column; align-items: center; z-index: 10;">
                <h1 style="${h1Style}">
                    OPÉRATION DE POLICE JUDICIAIRE<br/>DU<br/>${date_op}<br/>${unite_redacteur ? unite_redacteur : ''}
                </h1>
                ${cibleTitleHtml}
            </div>

            ${!isBg ? logoHtml : ''}
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
                    <strong style="color:${colors.danger}">AMIS:</strong> ${formData.amis}<br/>
                    <strong style="color:${colors.danger}">TERRAIN:</strong> ${formData.terrain_info}<br/>
                    <strong style="color:${colors.danger}">POPULATION:</strong> ${formData.population}<br/>
                    <strong style="color:${colors.danger}">JURIDIQUE:</strong> ${formData.cadre_juridique}
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
            <!-- Cible 1 Photo Container (40% approx) -->
            <div class="col" style="flex: 0 0 40%;">
                ${getSingleSidePhotoHtml('photo_adv_1')}
            </div>
        </div>
        ${formData.adversaire_2.nom ? `
        <div class="row">
            <div class="col">
                ${drawTableAdv(formData.adversaire_2, 'CIBLE 2')}
            </div>
            <!-- Cible 2 Photo Container (40% approx) -->
            <div class="col" style="flex: 0 0 40%;">
                ${getSingleSidePhotoHtml('photo_adv_2')}
            </div>
        </div>` : ''}
        
        <!-- RENFORTS: PAGE DÉDIÉE -->
        ${getPhotosHtml('photo_renforts', 'RENFORTS / ENVIRONNEMENT', true)}

        <div class="page-break"></div>

        <!-- PAGE 4: MISSION & EXECUTION -->
        <div class="row">
            <div class="col">
                 <h2>4. MISSION </h2>
                 <div class="box" style="text-align:center; font-weight:bold; ${enlargedStyle} background:${isDark ? '#333' : '#f0f0f0'}; color:${colors.danger};">
                    ${formData.missions_psig.replace(/\n/g, '<br>')}
                 </div>

                 <h2>5. EXÉCUTION</h2>
                 <div class="box" style="${enlargedStyle}">
                    <strong style="color:${colors.danger}">POUR LE:</strong> ${formData.date_execution} à ${formData.heure_execution}<br/><br/>
                    ${formData.action_body_text.replace(/\n/g, '<br>')}
                 </div>
            </div>
            <div class="col">
                <h3>CHRONOLOGIE</h3>
                <table style="${enlargedTableStyle}">
                    <tr class="highlight"><th>H</th><th>PHASE</th></tr>
                    ${formData.chronologie.map(c => `<tr><td style="text-align:center;">${c.hour}</td><td>${c.type} - ${c.label}</td></tr>`).join('')}
                </table>
                <h3>HYPOTHÈSES</h3>
                <ul style="${enlargedStyle}">
                    <li><strong style="color:${colors.danger}">H1:</strong> ${formData.hypothese_h1}</li>
                    <li><strong style="color:${colors.danger}">H2:</strong> ${formData.hypothese_h2}</li>
                    <li><strong style="color:${colors.danger}">H3:</strong> ${formData.hypothese_h3}</li>
                </ul>
            </div>
        </div>

        <div class="page-break"></div>

        <!-- PAGE 5: ARTICULATION -->
        <h2>6. ARTICULATION</h2>
        <div style="border:1px solid ${colors.border}; padding:5px; margin-bottom:10px; background:${isDark ? '#333' : '#ddd'}; font-weight:bold; text-align:center; ${enlargedStyle}">
            PLACE DU CHEF: ${formData.place_chef_gen}
        </div>

        <div class="row">
            <div class="col" style="border-right: 2px dashed ${colors.border}; padding-right: 10px;">
                <div style="background:${colors.accent}; color:#fff; padding:5px; font-weight:bold; text-align:center; ${enlargedStyle}">INDIA (INTER)</div>
                <div class="box" style="${enlargedStyle}">
                    <strong style="color:${colors.danger}">MISSION:</strong> ${formData.india_mission}<br/>
                    <strong style="color:${colors.danger}">OBJECTIF:</strong> ${formData.india_objectif}<br/>
                    <strong style="color:${colors.danger}">ITINÉRAIRE:</strong> ${formData.india_itineraire}<br/>
                </div>
                <div class="box" style="font-size:12px;">
                    <strong style="color:${colors.danger}">CAT SPÉCIFIQUE:</strong><br/>
                    ${formData.india_cat.replace(/\n/g, '<br>')}
                </div>
                <!-- AJOUT LIGNE CELLULE -->
                ${formatCelluleMembers("India")}
            </div>
            <div class="col" style="padding-left: 10px;">
                <div style="background:${colors.accent}; color:#fff; padding:5px; font-weight:bold; text-align:center; ${enlargedStyle}">AO (APPUI)</div>
                <div class="box" style="${enlargedStyle}">
                    <strong>MISSION:</strong> ${formData.ao_mission}<br/>
                    <strong>ZONE:</strong> ${formData.ao_zone}<br/>
                    <strong>SECTEUR:</strong> ${formData.ao_secteur}<br/>
                    <strong>CHEF AO:</strong> ${formData.ao_chef}
                </div>
                <div class="box" style="font-size:12px;">
                    <strong style="color:${colors.danger}">CAT SPÉCIFIQUE:</strong><br/>
                    ${formData.ao_cat.replace(/\n/g, '<br>')}
                </div>
                 <!-- AJOUT LIGNE CELLULE -->
                ${formatCelluleMembers("AO")}
            </div>
        </div>

        <!-- PAGES DÉDIÉES PHOTOS (ORDRE DEMANDÉ) -->
        ${getPhotosHtml('photo_logistique', 'LOGISTIQUE', true)}
        ${getPhotosHtml('photo_ao_vue', 'VUE EMPLACEMENT AO', true)}
        ${getPhotosHtml('photo_india_iti', 'ITINÉRAIRE INDIA', true)}
        ${getPhotosHtml('photo_effrac', 'DÉTAILS EFFRACTION', true)}

        <div class="page-break"></div>

        <!-- PAGE X: PATRACDVR -->
        <h2>7. PATRACDVR</h2>
        ${drawPatrac()}

        <div class="page-break"></div>

        <!-- PAGE Y: CAT & LOGISTIQUE -->
        <h2>9. CAT & LOGISTIQUE</h2>
        <div class="row">
            <div class="col">
                <h3>CONDUITES À TENIR GÉNÉRALES</h3>
                <div class="box" style="${enlargedStyle}">
                    ${formData.cat_generales.replace(/\n/g, '<br>')}
                </div>
                ${formData.no_go ? `<div class="box" style="border:2px solid ${colors.danger}; color:${colors.danger}; font-weight:bold; ${enlargedStyle}">NO GO: ${formData.no_go}</div>` : ''}
            </div>
            <div class="col">
                <h3>LIAISON</h3>
                <div class="box" style="${enlargedStyle}">
                    ${formData.cat_liaison.replace(/\n/g, '<br>')}
                </div>
            </div>
        </div>

        <div class="page-break"></div>
        
        <!-- LAST PAGE: QUESTIONS -->
        <div style="${page1ContainerStyle}">
             ${isBg ? logoHtml : ''}
             <div style="width: 100%; display: flex; flex-direction: column; align-items: center; z-index: 10;">
                <h1 style="font-family: 'Oswald'; text-align: center; font-size: 48px; color: ${isBg ? '#FFFFFF' : colors.accent};">
                    AVEZ-VOUS DES QUESTIONS ?
                </h1>
            </div>
             ${!isBg ? logoHtml : ''}
        </div>

        <div style="margin-top: 50px; text-align: center; font-size: 8px; color: ${colors.text};">
            DOCUMENT GÉNÉRÉ PAR ${trigramme_redacteur || 'G-TAK'} // ${new Date().toLocaleString()}
        </div>

      </body>
      </html>
    `;
    };

    const handleGeneratePDF = async () => {
        try {
            const html = generateHTML();
            const { uri } = await Print.printToFileAsync({
                html,
                width: 842,
                height: 595,
                compress: true // Compression activée
            });
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
                placeholderTextColor={THEME.textSecondary}
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
                    <View style={{ flex: 1 }}>{renderInput("Né le (Date)", adv.date_naissance, t => updateAdversaire(advKey, 'date_naissance', t), false, "JJ/MM/AAAA")}</View>
                    <View style={{ width: 10 }} />
                    <View style={{ flex: 1 }}>{renderInput("Lieu Naissance", adv.lieu_naissance, t => updateAdversaire(advKey, 'lieu_naissance', t), false, "Lieu de naissance")}</View>
                </View>
                <View style={styles.row}>
                    <View style={{ flex: 1 }}>{renderInput("Stature", adv.stature, t => updateAdversaire(advKey, 'stature', t), false, "Stature")}</View>
                    <View style={{ width: 10 }} />
                    <View style={{ flex: 1 }}>
                        <Text style={styles.label}>ETHNIE</Text>
                        {["Caucasien", "Nord africain", "Afro-antillais", "Asiatique"].map(opt => (
                            <TouchableOpacity key={opt} onPress={() => updateAdversaire(advKey, 'ethnie', opt)} style={{ marginBottom: 5 }}>
                                <Text style={{ color: adv.ethnie === opt ? THEME.accentBlue : THEME.textSecondary }}>{adv.ethnie === opt ? "[x]" : "[ ]"} {opt}</Text>
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
        const renderSelect = (label: string, field: keyof IMember, options: string[], multiple = false) => {
            const currentVal = tempMember[field] || "";
            const selectedValues = multiple ? currentVal.split(" / ").filter(Boolean) : [currentVal];

            const toggleValue = (opt: string) => {
                if (!multiple) {
                    setTempMember({ ...tempMember, [field]: opt });
                    return;
                }

                let newValues;
                if (selectedValues.includes(opt)) {
                    newValues = selectedValues.filter(v => v !== opt);
                } else {
                    newValues = [...selectedValues, opt];
                }
                setTempMember({ ...tempMember, [field]: newValues.join(" / ") });
            };

            return (
                <View style={{ marginBottom: 15 }}>
                    <Text style={styles.label}>{label}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                        {options.map(opt => {
                            const isSelected = selectedValues.includes(opt);
                            return (
                                <TouchableOpacity key={opt} style={[styles.chip, isSelected && styles.chipSelected]}
                                    onPress={() => toggleValue(opt)}>
                                    <Text style={{ color: isSelected ? 'white' : THEME.textSecondary }}>{opt}</Text>
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                </View>
            );
        };
        return (
            <Modal visible={isMemberEditModalVisible} animationType="slide" transparent>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContainer}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>ÉDITION OPÉRATEUR</Text>
                            <TouchableOpacity onPress={() => setIsMemberEditModalVisible(false)}><MaterialIcons name="close" size={24} color={THEME.dangerRed} /></TouchableOpacity>
                        </View>
                        <ScrollView style={{ maxHeight: '80%' }}>
                            <View style={styles.inputGroup}>
                                <Text style={styles.label}>TRIGRAMME</Text>
                                <TextInput style={styles.input} value={tempMember.trigramme} onChangeText={t => setTempMember({ ...tempMember, trigramme: t.toUpperCase() })} maxLength={5} />
                            </View>
                            {renderSelect("FONCTION", "fonction", MEMBER_CONFIG.options.fonctions, true)}
                            {renderSelect("CELLULE", "cellule", MEMBER_CONFIG.options.cellules, true)}
                            {renderSelect("TENUE", "tenue", MEMBER_CONFIG.options.tenues)}
                            {renderSelect("ARMEMENT PRINCIPAL", "principales", MEMBER_CONFIG.options.principales)}
                            {renderSelect("ARMEMENT SECONDAIRE", "secondaires", MEMBER_CONFIG.options.secondaires)}
                            {/* AJOUT CATÉGORIE AFI ET EQUIPEMENT 2 */}
                            {renderSelect("A.F.I.", "afis", MEMBER_CONFIG.options.afis, true)}
                            {renderSelect("GRENADES", "grenades", MEMBER_CONFIG.options.grenades, true)}
                            {renderSelect("EQUIPEMENT", "equipement", MEMBER_CONFIG.options.equipements, true)}
                            {renderSelect("ÉQUIPEMENT 2", "equipement2", MEMBER_CONFIG.options.equipements2, true)}
                            {renderSelect("PROTECTION", "gpb", MEMBER_CONFIG.options.gpbs, true)}
                        </ScrollView>
                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                            <TouchableOpacity onPress={deleteMember} style={[styles.navBtn, { borderColor: THEME.dangerRed, borderWidth: 1, backgroundColor: 'transparent' }]}><Text style={{ color: THEME.dangerRed }}>SUPPRIMER</Text></TouchableOpacity>
                            <TouchableOpacity onPress={saveMemberChanges} style={[styles.navBtn, { backgroundColor: THEME.successGreen }]}><Text style={{ color: '#000', fontWeight: 'bold' }}>SAUVEGARDER</Text></TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        );
    };

    const renderVehicleRenameModal = () => {
        if (!isVehicleRenameVisible || !vehicleToRename) return null;
        return (
            <Modal visible={isVehicleRenameVisible} animationType="fade" transparent>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalContainer}>
                    <View style={[styles.modalContent, { maxHeight: 200 }]}>
                        <Text style={[styles.modalTitle, { marginBottom: 20 }]}>MODIFIER VÉHICULE</Text>
                        <TextInput
                            style={styles.input}
                            value={newVehicleName}
                            onChangeText={setNewVehicleName}
                            autoFocus
                        />
                        <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
                            <TouchableOpacity onPress={() => setIsVehicleRenameVisible(false)} style={[styles.navBtn, { borderColor: THEME.dangerRed, borderWidth: 1 }]}><Text style={{ color: THEME.dangerRed }}>ANNULER</Text></TouchableOpacity>
                            <TouchableOpacity onPress={confirmRenameVehicle} style={[styles.navBtn, { backgroundColor: THEME.successGreen }]}><Text style={{ color: '#000', fontWeight: 'bold' }}>VALIDER</Text></TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        );
    };

    // --- STEPS RENDER ---
    const renderStepContent = () => {
        switch (step) {
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
                            <View style={{ flex: 1 }}>{renderInput("Date", formData.date_execution, t => updateField('date_execution', t))}</View>
                            <View style={{ width: 10 }} />
                            <View style={{ flex: 1 }}>{renderInput("Heure (H)", formData.heure_execution, t => updateField('heure_execution', t))}</View>
                        </View>
                        {renderInput("Corps de la mission", formData.action_body_text, t => updateField('action_body_text', t), true)}

                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, marginBottom: 5 }}>
                            <Text style={styles.label}>CHRONOLOGIE</Text>
                            <View style={{ flexDirection: 'row', gap: 10 }}>
                                <TouchableOpacity onPress={() => {
                                    const newChrono = [...formData.chronologie];
                                    if (newChrono.length > 0) newChrono.pop();
                                    updateField('chronologie', newChrono);
                                }}>
                                    <MaterialIcons name="remove-circle" size={24} color={THEME.dangerRed} />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => {
                                    const newChrono = [...formData.chronologie];
                                    const nextIndex = newChrono.length;
                                    newChrono.push({ type: `T${nextIndex}`, label: 'Phase...', hour: '' });
                                    updateField('chronologie', newChrono);
                                }}>
                                    <MaterialIcons name="add-circle" size={24} color={THEME.successGreen} />
                                </TouchableOpacity>
                            </View>
                        </View>

                        {formData.chronologie.map((item, i) => (
                            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                                <Text style={{ color: THEME.accentBlue, width: 30, fontWeight: 'bold' }}>{item.type}</Text>
                                <TextInput style={[styles.input, { flex: 2, marginRight: 5 }]} value={item.label} onChangeText={t => {
                                    const nu = [...formData.chronologie]; nu[i].label = t; updateField('chronologie', nu);
                                }} />
                                <TextInput style={[styles.input, { width: 60 }]} value={item.hour} placeholder="H" placeholderTextColor={THEME.textSecondary} onChangeText={t => {
                                    const nu = [...formData.chronologie]; nu[i].hour = t; updateField('chronologie', nu);
                                }} />
                            </View>
                        ))}

                        <Text style={[styles.label, { marginTop: 15 }]}>HYPOTHÈSES</Text>
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
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                            <Text style={styles.helper}>Tapez pour sélectionner. Maintenir pour éditer.</Text>
                            <TouchableOpacity onPress={addVehicle} style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <MaterialIcons name="add-circle" size={32} color={THEME.successGreen} />
                            </TouchableOpacity>
                        </View>
                        {vehicles.map(v => (
                            <TouchableOpacity
                                key={v.id}
                                style={styles.vehCard}
                                onPress={() => assignSelectedMemberToVehicle(v.id)}
                                onLongPress={() => openRenameVehicle(v)}
                                delayLongPress={600}
                            >
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <MaterialIcons name="directions-car" size={20} color={THEME.textPrimary} style={{ marginRight: 8 }} />
                                        <Text style={styles.vehTitle}>{v.name}{v.type ? ` (${v.type})` : ''}</Text>
                                    </View>
                                    <TouchableOpacity onPress={() => removeVehicle(v)}>
                                        <MaterialIcons name="delete" size={20} color={THEME.dangerRed} />
                                    </TouchableOpacity>
                                </View>
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 10 }}>
                                    {v.members.map(m => (
                                        <TouchableOpacity key={m.id} onPress={() => returnMemberToPool(m.id)} onLongPress={() => openMemberEditor(m)} style={styles.memberBadge}>
                                            <Text style={styles.memberText}>{m.trigramme}</Text>
                                        </TouchableOpacity>
                                    ))}
                                </View>
                            </TouchableOpacity>
                        ))}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }}>
                            <Text style={styles.label}>POOL (NON ASSIGNÉS)</Text>
                            <View style={{ flexDirection: 'row', gap: 10 }}>
                                <TouchableOpacity onPress={importMemberConfig} style={{ flexDirection: 'row', alignItems: 'center' }}><MaterialIcons name="file-upload" size={16} color={THEME.warningYellow} /><Text style={{ color: THEME.warningYellow, fontSize: 12, marginLeft: 4 }}>IMPORT JSON</Text></TouchableOpacity>
                                <TouchableOpacity onPress={createNewMember} style={{ flexDirection: 'row', alignItems: 'center' }}><MaterialIcons name="person-add" size={16} color={THEME.accentBlue} /><Text style={{ color: THEME.accentBlue, fontSize: 12, marginLeft: 4 }}>AJOUTER</Text></TouchableOpacity>
                            </View>
                        </View>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
                            {poolMembers.map(m => (
                                <TouchableOpacity key={m.id} style={[styles.memberPoolBadge, selectedMemberId === m.id && { backgroundColor: '#1e3a8a', borderColor: THEME.accentBlue }]}
                                    onPress={() => handleMemberTap(m)} onLongPress={() => openMemberEditor(m)}>
                                    <Text style={{ color: '#fff', fontWeight: 'bold' }}>{m.trigramme}</Text>
                                    <Text style={{ color: THEME.textSecondary, fontSize: 9 }}>{m.fonction}</Text>
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
                            { id: 'photo_logo_unite', label: 'Logo unité - Fond transparent requis.' }, // Ajout Logo
                            { id: 'photo_adv_1', label: 'Adversaire Principal' },
                            { id: 'photo_adv_2', label: 'Adversaire Secondaire' },
                            { id: 'photo_renforts', label: 'Renforts' },
                            { id: 'photo_logistique', label: 'Logistique' },
                            { id: 'photo_ao_vue', label: 'Vue Emplacement AO' },
                            { id: 'photo_india_iti', label: 'Itinéraire India' },
                            { id: 'photo_effrac', label: 'Effraction / Détails' }
                        ].map(item => {
                            const catPhotos = photos.filter(ph => ph.category === item.id);
                            return (
                                <View key={item.id} style={{ marginBottom: 15 }}>
                                    <TouchableOpacity style={styles.photoThumbLarge} onPress={() => pickImage(item.id)}>
                                        <MaterialIcons name="add-a-photo" size={24} color={THEME.textSecondary} />
                                        <Text style={{ color: THEME.textSecondary, marginTop: 5, fontSize: 12, fontWeight: 'bold' }}>
                                            {item.id === 'photo_logo_unite' ? (
                                                <>AJOUTER : Logo unité - <Text style={{ fontStyle: 'italic' }}>Fond transparent requis.</Text></>
                                            ) : (
                                                `AJOUTER: ${item.label}`
                                            )}
                                        </Text>
                                    </TouchableOpacity>

                                    {item.id === 'photo_logo_unite' && (
                                        <View style={{ flexDirection: 'row', justifyContent: 'center', marginVertical: 10, gap: 20 }}>
                                            <TouchableOpacity
                                                style={[styles.chip, formData.logo_mode === 'background' && styles.chipSelected]}
                                                onPress={() => updateField('logo_mode', 'background')}
                                            >
                                                <Text style={{ color: formData.logo_mode === 'background' ? 'white' : THEME.textSecondary }}>Fond d'écran</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[styles.chip, formData.logo_mode === 'included' && styles.chipSelected]}
                                                onPress={() => updateField('logo_mode', 'included')}
                                            >
                                                <Text style={{ color: formData.logo_mode === 'included' ? 'white' : THEME.textSecondary }}>Inclue</Text>
                                            </TouchableOpacity>
                                        </View>
                                    )}

                                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                                        {catPhotos.map((p, idx) => (
                                            <TouchableOpacity key={p.id} onPress={() => { setCurrentPhotoToAnnotate(p.id); setIsAnnotationVisible(true); }}
                                                style={{ marginRight: 10, position: 'relative' }}>
                                                <Image source={{ uri: p.uri }} style={{ width: 100, height: 100, borderRadius: 8, borderWidth: 1, borderColor: THEME.borderGlass }} resizeMode="contain" />
                                                {p.annotations.length > 0 && <View style={styles.annotBadge} />}
                                                <TouchableOpacity style={{ position: 'absolute', top: 5, right: 5, backgroundColor: 'rgba(0,0,0,0.6)', width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}
                                                    onPress={() => deletePhoto(p.id)}>
                                                    <MaterialIcons name="close" size={16} color="white" />
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
                    <View style={{ alignItems: 'center', gap: 20, marginTop: 50 }}>
                        <Text style={{ color: THEME.textPrimary, textAlign: 'center', fontSize: 16, fontWeight: 'bold' }}>L'Ordre Initial est prêt.</Text>

                        {/* PDF THEME SELECTOR */}
                        <View style={styles.inputGroup}>
                            <Text style={styles.label}>THÈME PDF</Text>
                            <View style={{ flexDirection: 'row', gap: 20, justifyContent: 'center' }}>
                                <TouchableOpacity
                                    style={[styles.chip, formData.pdf_theme === 'light' && styles.chipSelected]}
                                    onPress={() => updateField('pdf_theme', 'light')}
                                >
                                    <Text style={{ color: formData.pdf_theme === 'light' ? 'white' : THEME.textSecondary }}>Clair (Impression)</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={[styles.chip, formData.pdf_theme === 'dark' && styles.chipSelected]}
                                    onPress={() => updateField('pdf_theme', 'dark')}
                                >
                                    <Text style={{ color: formData.pdf_theme === 'dark' ? 'white' : THEME.textSecondary }}>Sombre (Écran)</Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {renderInput("Trigramme Rédacteur (PDF)", formData.trigramme_redacteur, t => updateField('trigramme_redacteur', t), false, "Ex: MDL CHEF")}
                        {renderInput("Unité Rédacteur (PDF)", formData.unite_redacteur, t => updateField('unite_redacteur', t), false, "Ex: PSIG XX")}

                        <TouchableOpacity style={[styles.navBtn, { backgroundColor: THEME.successGreen, width: '100%', height: 60 }]} onPress={handleGeneratePDF}>
                            <MaterialIcons name="picture-as-pdf" size={24} color="black" style={{ marginRight: 10 }} />
                            <Text style={[styles.navBtnText, { color: '#000', fontSize: 18 }]}>GÉNÉRER PDF</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={[styles.navBtn, { backgroundColor: THEME.bgElement, width: '100%' }]} onPress={() => Linking.openURL("https://oxsilaris06.github.io/CET/retex")}>
                            <MaterialIcons name="public" size={20} color={THEME.textPrimary} style={{ marginRight: 10 }} />
                            <Text style={styles.navBtnText}>LIEN RETEX (WEB)</Text>
                        </TouchableOpacity>

                        <View style={styles.separator} />

                        <View style={{ flexDirection: 'row', gap: 10 }}>
                            <TouchableOpacity style={[styles.navBtn, { backgroundColor: THEME.bgElement }]} onPress={exportSessionToJson}>
                                <MaterialIcons name="save" size={20} color={THEME.textPrimary} style={{ marginRight: 5 }} />
                                <Text style={styles.navBtnText}>SAUVEGARDER JSON</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.navBtn, { backgroundColor: THEME.bgElement }]} onPress={importSessionFromJson}>
                                <MaterialIcons name="upload-file" size={20} color={THEME.textPrimary} style={{ marginRight: 5 }} />
                                <Text style={styles.navBtnText}>CHARGER JSON</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                );
            default: return null;
        }
    };

    const STEPS = ["SITUATION", "ADVERSAIRES", "ENVIRON.", "MISSION", "EXECUTION", "ARTICULATION", "PATRAC", "PHOTOS", "CAT", "FIN"];

    // Si le module Patrac est visible, l'afficher
    if (isPatracVisible) {
        return (
            <Patrac
                onClose={() => setIsPatracVisible(false)}
                onApplyToOI={handleApplyFromPatrac}
            />
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={onClose} style={styles.backButton}>
                    <MaterialIcons name="arrow-back" size={24} color={THEME.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Strategica - OI</Text>
                {/* BOUTON SETTINGS PATRACDVR */}
                <TouchableOpacity onPress={() => setIsPatracVisible(true)} style={styles.settingsButton}>
                    <MaterialIcons name="settings" size={24} color={THEME.textPrimary} />
                </TouchableOpacity>
            </View>

            <View style={{ height: 50, borderBottomWidth: 1, borderColor: THEME.borderGlass }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.progressScroll} contentContainerStyle={{ alignItems: 'center' }}>
                    {STEPS.map((s, i) => (
                        <TouchableOpacity key={i} onPress={() => setStep(i)} style={[styles.stepItem, step === i && styles.stepItemActive]}>
                            <Text style={[styles.stepText, step === i && styles.stepTextActive]}>{i + 1}. {s}</Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
                <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 150 }}>
                    {renderStepContent()}
                </ScrollView>
            </KeyboardAvoidingView>

            <View style={styles.footer}>
                <TouchableOpacity style={styles.navBtn} onPress={() => step > 0 && setStep(step - 1)}>
                    <Text style={styles.navBtnText}>PRÉCÉDENT</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.navBtn, { backgroundColor: THEME.accentBlue }]} onPress={() => {
                    if (step < 9) setStep(step + 1);
                    saveData();
                }}>
                    <Text style={[styles.navBtnText, { color: '#fff' }]}>{step === 9 ? "SAUVEGARDER" : "SUIVANT"}</Text>
                </TouchableOpacity>
            </View>

            {renderMemberEditModal()}
            {renderVehicleRenameModal()}

            <Modal visible={isAnnotationVisible} animationType="slide" onRequestClose={() => setIsAnnotationVisible(false)}>
                <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
                    <View style={{ padding: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderColor: THEME.borderGlass }}>
                        <Text style={{ color: THEME.textPrimary, fontWeight: 'bold' }}>Touchez pour placer un marqueur</Text>
                        <TouchableOpacity onPress={() => setIsAnnotationVisible(false)}><MaterialIcons name="close" size={24} color={THEME.textPrimary} /></TouchableOpacity>
                    </View>
                    <TouchableOpacity activeOpacity={1} style={{ flex: 1, justifyContent: 'center' }}
                        onPress={(e) => {
                            const { locationX, locationY } = e.nativeEvent;
                            const width = Dimensions.get('window').width;
                            const height = 400;
                            addAnnotation((locationX / width) * 100, (locationY / height) * 100);
                        }}>
                        {currentPhotoToAnnotate && (
                            <View>
                                <Image source={{ uri: photos.find(p => p.id === currentPhotoToAnnotate)?.uri }} style={{ width: '100%', height: 400, resizeMode: 'contain' }} />
                                {photos.find(p => p.id === currentPhotoToAnnotate)?.annotations.map((a, i) => (
                                    <View key={i} style={{
                                        position: 'absolute', left: `${a.x}%`, top: `${a.y}%`, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(255,0,0,0.8)',
                                        justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#fff', transform: [{ translateX: -12 }, { translateY: -12 }]
                                    }}>
                                        <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 10 }}>{a.text}</Text>
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

// --- STYLES REVISITÉS AVEC THEME TACTICAL GLASS ---

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: THEME.bg
    },
    header: {
        backgroundColor: 'rgba(9, 9, 11, 0.95)',
        borderBottomWidth: 1,
        borderBottomColor: THEME.borderGlass,
        paddingTop: Platform.OS === 'android' ? 55 : 30,
        paddingBottom: 15,
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        elevation: 4,
        zIndex: 10
    },
    headerTitle: {
        color: THEME.accentBlue,
        fontSize: 20,
        fontFamily: 'Saira Stencil One',
        letterSpacing: 2,
        textShadowColor: THEME.accentGlow,
        textShadowOffset: { width: 0, height: 0 },
        textShadowRadius: 20,
    },
    backButton: {
        padding: 5
    },
    settingsButton: {
        padding: 5,
    },
    progressScroll: {
        backgroundColor: 'rgba(9, 9, 11, 0.95)'
    },
    stepItem: {
        paddingVertical: 15,
        paddingHorizontal: 20,
        marginRight: 0
    },
    stepItemActive: {
        borderBottomWidth: 3,
        borderColor: THEME.accentBlue
    },
    stepText: {
        color: THEME.textSecondary,
        fontSize: 12,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: 1
    },
    stepTextActive: {
        color: 'white'
    },
    content: {
        padding: 24
    },
    inputGroup: {
        marginBottom: 20
    },
    label: {
        color: THEME.textSecondary,
        fontSize: 11,
        marginBottom: 8,
        fontWeight: 'bold',
        textTransform: 'uppercase',
        letterSpacing: 0.5
    },
    input: {
        backgroundColor: THEME.bgInput,
        borderWidth: 1,
        borderColor: THEME.borderGlass,
        borderRadius: 8,
        padding: 12,
        color: 'white',
        fontSize: 16
    },
    sectionTitle: {
        color: THEME.accentBlue,
        fontSize: 16,
        fontWeight: '900',
        marginTop: 10,
        marginBottom: 20,
        letterSpacing: 1
    },
    separator: {
        height: 1,
        backgroundColor: THEME.borderGlass,
        marginVertical: 30
    },
    row: {
        flexDirection: 'row'
    },
    chip: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: THEME.borderGlass,
        backgroundColor: THEME.bgElement,
        marginBottom: 5
    },
    chipSelected: {
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        borderColor: THEME.accentBlue
    },
    footer: {
        flexDirection: 'row',
        padding: 16,
        borderTopWidth: 1,
        borderColor: THEME.borderGlass,
        backgroundColor: 'rgba(9, 9, 11, 0.95)',
        gap: 12
    },
    navBtn: {
        flex: 1,
        padding: 16,
        alignItems: 'center',
        borderRadius: 12,
        backgroundColor: THEME.bgElement,
        borderWidth: 1,
        borderColor: THEME.borderGlass,
        flexDirection: 'row',
        justifyContent: 'center'
    },
    navBtnText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 14
    },
    // PATRACDVR Styles
    vehCard: {
        backgroundColor: THEME.bgElement,
        padding: 16,
        marginBottom: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: THEME.borderGlass
    },
    vehTitle: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16
    },
    memberBadge: {
        backgroundColor: 'rgba(255,255,255,0.05)',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: THEME.borderGlass
    },
    memberPoolBadge: {
        backgroundColor: THEME.bgElement,
        padding: 10,
        borderRadius: 8,
        minWidth: 70,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: THEME.borderGlass
    },
    memberText: {
        color: THEME.textPrimary,
        fontSize: 11,
        fontWeight: 'bold'
    },
    helper: {
        color: THEME.textSecondary,
        fontStyle: 'italic',
        marginBottom: 15,
        fontSize: 12
    },
    // PHOTOS
    photoThumbLarge: {
        width: '100%',
        height: 120,
        backgroundColor: THEME.bgElement,
        borderRadius: 12,
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
        borderColor: THEME.borderGlass,
        borderWidth: 1,
        borderStyle: 'dashed'
    },
    annotBadge: {
        position: 'absolute',
        top: 5,
        right: 5,
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: THEME.dangerRed
    },
    // MODAL
    modalContainer: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.9)',
        justifyContent: 'center',
        padding: 24
    },
    modalContent: {
        backgroundColor: THEME.bgGlassHeavy,
        borderRadius: 24,
        padding: 24,
        maxHeight: '90%',
        borderWidth: 1,
        borderColor: THEME.borderGlass
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24
    },
    modalTitle: {
        color: THEME.accentBlue,
        fontSize: 20,
        fontWeight: '900',
        textTransform: 'uppercase'
    }
});
