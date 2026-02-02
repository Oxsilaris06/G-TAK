import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Dimensions,
  PanResponder,
  Animated,
  Share,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialIcons } from '@expo/vector-icons';

// --- THEME TACTICAL GLASS (from patracdvr.html) ---
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

// --- TYPES ---
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
  vehicle_assigned?: string | null;
}

interface IVehicle {
  id: string;
  name: string;
  type: string;
  members: IMember[];
}

interface IMemberConfig {
  fonctions: string[];
  cellules: string[];
  principales: string[];
  secondaires: string[];
  afis: string[];
  grenades: string[];
  equipements: string[];
  equipements2: string[];
  tenues: string[];
  gpbs: string[];
  vehicules_types: string[];
}

interface IPatracData {
  options: IMemberConfig;
  members: IMember[];
  vehicles: IVehicle[];
  mission_info: {
    title: string;
    rally: string;
  };
}

interface PatracProps {
  onClose: () => void;
  onApplyToOI?: (data: { vehicles: IVehicle[]; poolMembers: IMember[] }) => void;
}

// --- DEFAULT CONFIGURATION ---
const DEFAULT_MEMBER_CONFIG: IMemberConfig = {
  fonctions: ["Chef inter", "Chef dispo", "Chef Oscar", "Conducteur", "Chef de bord", "DE", "Cyno", "Inter", "Effrac", "AO", "Sans"],
  cellules: ["AO1", "AO2", "AO3", "AO4", "AO5", "AO6", "AO7", "AO8", "India 1", "India 2", "India 3", "India 4", "India 5", "Effrac", "Sans"],
  principales: ["UMP9", "G36", "FAP", "MP5", "Sans"],
  afis: ["PIE", "LBD40", "LBD44", "Sans"],
  secondaires: ["SIG 2022", "G26", "Sans"],
  grenades: ["GENL", "MP7", "FAR", "Sans"],
  equipements: ["Sans", "BBAL", "Belier", "Lacry", "IL", "Lot 5.11", "Lot Oscar", "Pince", "Drone", "Cam pieton"],
  equipements2: ["Sans", "Échelle", "Stop stick", "Lacry", "Cale", "IL", "Pass", "Cam pieton", "TPH700"],
  tenues: ["UBAS", "4S", "Bleu", "Civile", "Ghillie", "Treillis", "MO"],
  gpbs: ["GPBL", "GPBPD", "Casque Mo", "Casque Lourd", "Sans"],
  vehicules_types: ["Sharan", "Kodiaq", "5008", "Scénic", "Kodiaq Bana"]
};

const ATTRIBUTE_MAPPING: Record<string, { key: keyof IMemberConfig; attribute: keyof IMember }> = {
  'Fonction': { key: 'fonctions', attribute: 'fonction' },
  'Cellule': { key: 'cellules', attribute: 'cellule' },
  'Arme P.': { key: 'principales', attribute: 'principales' },
  'Arme S.': { key: 'secondaires', attribute: 'secondaires' },
  'A.F.I.': { key: 'afis', attribute: 'afis' },
  'Grenades': { key: 'grenades', attribute: 'grenades' },
  'Équip. 1': { key: 'equipements', attribute: 'equipement' },
  'Équip. 2': { key: 'equipements2', attribute: 'equipement2' },
  'Tenue': { key: 'tenues', attribute: 'tenue' },
  'GPB': { key: 'gpbs', attribute: 'gpb' }
};

const MULTI_SELECT_ATTRIBUTES = ['fonction', 'equipement', 'equipement2', 'afis'];

// --- PRESET NAMES ---
const PRESET_KEYS = [
  'PATRAC_PRESET_1',
  'PATRAC_PRESET_2', 
  'PATRAC_PRESET_3',
  'PATRAC_PRESET_4'
];

export default function Patrac({ onClose, onApplyToOI }: PatracProps) {
  // --- STATE ---
  const [memberConfig, setMemberConfig] = useState<IMemberConfig>(JSON.parse(JSON.stringify(DEFAULT_MEMBER_CONFIG)));
  const [vehicles, setVehicles] = useState<IVehicle[]>([]);
  const [poolMembers, setPoolMembers] = useState<IMember[]>([]);
  const [missionTitle, setMissionTitle] = useState('');
  const [rallyTime, setRallyTime] = useState('');
  
  const [activeMemberId, setActiveMemberId] = useState<string | null>(null);
  const [isQuickEditVisible, setIsQuickEditVisible] = useState(false);
  
  const [isNewMemberModalVisible, setIsNewMemberModalVisible] = useState(false);
  const [newMemberTrigramme, setNewMemberTrigramme] = useState('');
  const [newMemberData, setNewMemberData] = useState<Partial<IMember>>({});
  
  const [isConfigVisible, setIsConfigVisible] = useState(false);
  const [configInputs, setConfigInputs] = useState<Record<string, string>>({});

  const [isPresetsVisible, setIsPresetsVisible] = useState(false);
  const [presetNames, setPresetNames] = useState<string[]>(['Preset 1', 'Preset 2', 'Preset 3', 'Preset 4']);

  // Drag & Drop state
  const [draggedMember, setDraggedMember] = useState<IMember | null>(null);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
  const dragAnimatedValue = useRef(new Animated.ValueXY()).current;

  // --- PERSISTENCE ---
  const STORAGE_KEY = 'patracdvr_standalone_data';
  const PRESET_NAMES_KEY = 'patracdvr_preset_names';

  useEffect(() => {
    loadData();
    loadPresetNames();
  }, []);

  useEffect(() => {
    if (!isConfigVisible) {
      saveData();
    }
  }, [vehicles, poolMembers, memberConfig, missionTitle, rallyTime]);

  const loadData = async () => {
    try {
      const json = await AsyncStorage.getItem(STORAGE_KEY);
      if (json) {
        const data: IPatracData = JSON.parse(json);
        restoreData(data);
      } else {
        // Initialize with default vehicle buttons
        populateConfigInputs();
      }
    } catch (e) {
      console.error('Load error:', e);
    }
  };

  const loadPresetNames = async () => {
    try {
      const names = await AsyncStorage.getItem(PRESET_NAMES_KEY);
      if (names) {
        setPresetNames(JSON.parse(names));
      }
    } catch (e) {
      console.error('Load preset names error:', e);
    }
  };

  const savePresetNames = async (names: string[]) => {
    try {
      await AsyncStorage.setItem(PRESET_NAMES_KEY, JSON.stringify(names));
    } catch (e) {
      console.error('Save preset names error:', e);
    }
  };

  const saveData = async () => {
    try {
      const allMembers: IMember[] = [];
      
      // Pool members
      poolMembers.forEach(m => {
        allMembers.push({ ...m, vehicle_assigned: null });
      });
      
      // Vehicle members
      vehicles.forEach(v => {
        v.members.forEach(m => {
          allMembers.push({ ...m, vehicle_assigned: v.name });
        });
      });

      const data: IPatracData = {
        options: memberConfig,
        members: allMembers,
        vehicles,
        mission_info: {
          title: missionTitle,
          rally: rallyTime
        }
      };
      
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Save error:', e);
    }
  };

  const restoreData = (data: IPatracData) => {
    // Restore config
    if (data.options) {
      const mergedConfig = { ...DEFAULT_MEMBER_CONFIG };
      Object.keys(data.options).forEach(key => {
        const k = key as keyof IMemberConfig;
        if (Array.isArray(data.options[k])) {
          const combined = [...(mergedConfig[k] as string[]), ...(data.options[k] as string[])];
          (mergedConfig[k] as string[]) = [...new Set(combined)];
        }
      });
      setMemberConfig(mergedConfig);
    }

    // Restore mission info
    if (data.mission_info) {
      setMissionTitle(data.mission_info.title || '');
      setRallyTime(data.mission_info.rally || '');
    }

    // Restore vehicles and members
    if (data.vehicles && data.vehicles.length > 0) {
      setVehicles(data.vehicles);
      const pool = data.members?.filter(m => !m.vehicle_assigned) || [];
      setPoolMembers(pool);
    } else if (data.members && Array.isArray(data.members)) {
      // Legacy format
      const newVehicles: IVehicle[] = [];
      const vehicleNames = [...new Set(data.members.filter(m => m.vehicle_assigned).map(m => m.vehicle_assigned))];
      
      vehicleNames.forEach(vName => {
        if (vName) {
          newVehicles.push({
            id: `v_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            name: vName,
            type: '',
            members: data.members.filter(m => m.vehicle_assigned === vName)
          });
        }
      });
      
      setVehicles(newVehicles);
      setPoolMembers(data.members.filter(m => !m.vehicle_assigned));
    }

    populateConfigInputs();
  };

  const populateConfigInputs = () => {
    const inputs: Record<string, string> = {};
    Object.keys(memberConfig).forEach(key => {
      const k = key as keyof IMemberConfig;
      inputs[key] = (memberConfig[k] as string[]).join(', ');
    });
    setConfigInputs(inputs);
  };

  // --- VEHICLE MANAGEMENT ---
  const addVehicle = (name?: string) => {
    const vehicleName = name || `Véhicule ${vehicles.length + 1}`;
    
    // Check for duplicates
    if (vehicles.some(v => v.name === vehicleName)) {
      Alert.alert('Erreur', 'Ce véhicule existe déjà');
      return;
    }

    const newVehicle: IVehicle = {
      id: `v_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      name: vehicleName,
      type: '',
      members: []
    };
    setVehicles([...vehicles, newVehicle]);
  };

  const removeVehicle = (vehicleId: string) => {
    const vehicle = vehicles.find(v => v.id === vehicleId);
    if (!vehicle) return;

    Alert.alert(
      'Confirmer',
      `Supprimer ${vehicle.name} et désattribuer les membres ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            // Return members to pool
            const membersToReturn = vehicle.members.map(m => ({
              ...m,
              cellule: 'Sans',
              fonction: 'Sans'
            }));
            setPoolMembers(prev => [...prev, ...membersToReturn]);
            setVehicles(prev => prev.filter(v => v.id !== vehicleId));
          }
        }
      ]
    );
  };

  const renameVehicle = (vehicleId: string, newName: string) => {
    setVehicles(prev => prev.map(v => 
      v.id === vehicleId ? { ...v, name: newName } : v
    ));
  };

  // --- MEMBER MANAGEMENT ---
  const createMember = () => {
    if (!newMemberTrigramme.trim()) {
      Alert.alert('Erreur', 'Le trigramme est obligatoire');
      return;
    }

    const newMember: IMember = {
      id: `m_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      trigramme: newMemberTrigramme.trim().toUpperCase(),
      fonction: newMemberData.fonction || 'Sans',
      cellule: newMemberData.cellule || 'Sans',
      principales: newMemberData.principales || 'Sans',
      secondaires: newMemberData.secondaires || 'PSA',
      afis: newMemberData.afis || 'Sans',
      grenades: newMemberData.grenades || 'Sans',
      equipement: newMemberData.equipement || 'Sans',
      equipement2: newMemberData.equipement2 || 'Sans',
      tenue: newMemberData.tenue || 'UBAS',
      gpb: newMemberData.gpb || 'GPBL'
    };

    // Auto-assign logic
    if (newMember.cellule === 'Sans') {
      newMember.fonction = 'Sans';
    }
    if (newMember.fonction !== 'Sans' && newMember.cellule === 'Sans') {
      newMember.cellule = 'India 1';
    }

    setPoolMembers(prev => [...prev, newMember]);
    setIsNewMemberModalVisible(false);
    setNewMemberTrigramme('');
    setNewMemberData({});
  };

  const deleteMember = (memberId: string) => {
    Alert.alert(
      'Confirmer',
      'Supprimer cet opérateur ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            setPoolMembers(prev => prev.filter(m => m.id !== memberId));
            setVehicles(prev => prev.map(v => ({
              ...v,
              members: v.members.filter(m => m.id !== memberId)
            })));
            if (activeMemberId === memberId) {
              setActiveMemberId(null);
              setIsQuickEditVisible(false);
            }
          }
        }
      ]
    );
  };

  const updateMember = (memberId: string, updates: Partial<IMember>) => {
    // Update in pool
    setPoolMembers(prev => prev.map(m => 
      m.id === memberId ? { ...m, ...updates } : m
    ));
    
    // Update in vehicles
    setVehicles(prev => prev.map(v => ({
      ...v,
      members: v.members.map(m => 
        m.id === memberId ? { ...m, ...updates } : m
      )
    })));
  };

  // --- DRAG & DROP (TOUCH) ---
  const handleMemberPress = (member: IMember) => {
    if (activeMemberId === member.id) {
      setActiveMemberId(null);
      setIsQuickEditVisible(false);
    } else {
      setActiveMemberId(member.id);
      setIsQuickEditVisible(true);
    }
  };

  const handleMemberLongPress = (member: IMember) => {
    // Start drag
    setDraggedMember(member);
  };

  const assignMemberToVehicle = (memberId: string, vehicleId: string) => {
    // Find member
    let member: IMember | undefined;
    let source: 'pool' | string = 'pool';

    member = poolMembers.find(m => m.id === memberId);
    if (!member) {
      vehicles.forEach(v => {
        const found = v.members.find(m => m.id === memberId);
        if (found) {
          member = found;
          source = v.id;
        }
      });
    }

    if (!member) return;

    // Auto-assign cellule if needed
    const updatedMember = { ...member };
    if (updatedMember.cellule === 'Sans') {
      updatedMember.cellule = 'India 1';
    }

    // Remove from source
    if (source === 'pool') {
      setPoolMembers(prev => prev.filter(m => m.id !== memberId));
    } else {
      setVehicles(prev => prev.map(v => 
        v.id === source 
          ? { ...v, members: v.members.filter(m => m.id !== memberId) }
          : v
      ));
    }

    // Add to vehicle
    setVehicles(prev => prev.map(v => 
      v.id === vehicleId 
        ? { ...v, members: [...v.members, updatedMember] }
        : v
    ));

    setActiveMemberId(null);
  };

  const returnMemberToPool = (memberId: string) => {
    let member: IMember | undefined;
    
    vehicles.forEach(v => {
      const found = v.members.find(m => m.id === memberId);
      if (found) member = found;
    });

    if (member) {
      const updatedMember = { 
        ...member, 
        cellule: 'Sans',
        fonction: 'Sans'
      };
      
      setVehicles(prev => prev.map(v => ({
        ...v,
        members: v.members.filter(m => m.id !== memberId)
      })));
      
      setPoolMembers(prev => [...prev, updatedMember]);
    }
  };

  // --- QUICK EDIT ---
  const getActiveMember = (): IMember | undefined => {
    if (!activeMemberId) return undefined;
    
    let member = poolMembers.find(m => m.id === activeMemberId);
    if (!member) {
      vehicles.forEach(v => {
        const found = v.members.find(m => m.id === activeMemberId);
        if (found) member = found;
      });
    }
    return member;
  };

  const handleQuickEditToggle = (attribute: string, value: string) => {
    const member = getActiveMember();
    if (!member) return;

    const isMulti = MULTI_SELECT_ATTRIBUTES.includes(attribute);
    
    if (isMulti) {
      let current = member[attribute as keyof IMember] as string || 'Sans';
      let values = current === 'Sans' ? [] : current.split(', ').filter(Boolean);
      
      if (value === 'Sans') {
        values = ['Sans'];
      } else {
        if (values.includes('Sans')) values = [];
        if (values.includes(value)) {
          values = values.filter(v => v !== value);
        } else {
          values.push(value);
        }
      }
      
      if (values.length === 0) values = ['Sans'];
      updateMember(member.id, { [attribute]: values.join(', ') });
    } else {
      // Single select with auto-assign logic
      const updates: Partial<IMember> = { [attribute]: value };
      
      if (attribute === 'cellule' && value === 'Sans') {
        updates.fonction = 'Sans';
      }
      if (attribute === 'fonction' && value !== 'Sans' && member.cellule === 'Sans') {
        updates.cellule = 'India 1';
      }
      
      updateMember(member.id, updates);
    }
  };

  const isQuickEditSelected = (attribute: string, value: string): boolean => {
    const member = getActiveMember();
    if (!member) return false;

    const current = member[attribute as keyof IMember] as string || 'Sans';
    
    if (MULTI_SELECT_ATTRIBUTES.includes(attribute)) {
      const values = current === 'Sans' ? [] : current.split(', ').filter(Boolean);
      return values.includes(value);
    }
    
    return current === value;
  };

  // --- RAZ (RESET) ---
  const resetAll = () => {
    Alert.alert(
      'Tout effacer ?',
      'Cette action est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Effacer',
          style: 'destructive',
          onPress: async () => {
            await AsyncStorage.removeItem(STORAGE_KEY);
            setVehicles([]);
            setPoolMembers([]);
            setMissionTitle('');
            setRallyTime('');
            setMemberConfig(JSON.parse(JSON.stringify(DEFAULT_MEMBER_CONFIG)));
            populateConfigInputs();
          }
        }
      ]
    );
  };

  // --- IMPORT / EXPORT ---
  const exportData = async () => {
    try {
      const allMembers: IMember[] = [];
      poolMembers.forEach(m => allMembers.push({ ...m, vehicle_assigned: null }));
      vehicles.forEach(v => {
        v.members.forEach(m => allMembers.push({ ...m, vehicle_assigned: v.name }));
      });

      const data: IPatracData = {
        options: memberConfig,
        members: allMembers,
        vehicles,
        mission_info: { title: missionTitle, rally: rallyTime }
      };

      const jsonString = JSON.stringify(data, null, 2);
      const dateStr = new Date().toISOString().slice(0, 10);
      const fileName = `PATRACDVR-${dateStr}.json`;
      const fileUri = FileSystem.documentDirectory + fileName;
      
      await FileSystem.writeAsStringAsync(fileUri, jsonString);
      
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert('Succès', `Fichier sauvegardé: ${fileUri}`);
      }
    } catch (e) {
      Alert.alert('Erreur', 'Impossible d\'exporter les données');
    }
  };

  const importData = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true
      });
      
      if (result.canceled) return;
      
      const fileUri = result.assets[0].uri;
      const jsonString = await FileSystem.readAsStringAsync(fileUri);
      const data: IPatracData = JSON.parse(jsonString);
      
      Alert.alert(
        'Importer',
        'Cela écrasera la session actuelle. Continuer ?',
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Importer',
            onPress: () => {
              restoreData(data);
              saveData();
              Alert.alert('Succès', 'Importation réussie !');
            }
          }
        ]
      );
    } catch (e) {
      Alert.alert('Erreur', 'Fichier invalide');
    }
  };

  // --- PDF GENERATION ---
  const generatePDF = async () => {
    try {
      const html = generatePDFHTML();
      const { uri } = await Print.printToFileAsync({
        html,
        width: 842,
        height: 595
      });
      
      await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
    } catch (e) {
      Alert.alert('Erreur', 'Impossible de générer le PDF');
    }
  };

  const generatePDFHTML = (): string => {
    const mainTitle = missionTitle ? `PATRACDVR - Mission : ${missionTitle}` : 'FICHE PATRACDVR';
    
    const headers = ['PAX', 'Fct', 'Cel.', 'Arme P.', 'Arme S.', 'AFI', 'Gren.', 'Equip 1', 'Equip 2', 'Tenue', 'GPB'];
    const colWidths = [50, 70, 60, 70, 50, 60, 60, 80, 80, 60, 60];

    let tableHTML = '';
    vehicles.forEach(v => {
      tableHTML += `
        <tr style="background-color: #dbeafe;">
          <td colspan="11" style="padding: 8px; font-weight: bold; color: #1e40af;">VÉHICULE : ${v.name}</td>
        </tr>
      `;
      
      v.members.forEach(m => {
        tableHTML += `
          <tr>
            <td style="padding: 6px; border: 1px solid #ccc; font-weight: bold;">${m.trigramme}</td>
            <td style="padding: 6px; border: 1px solid #ccc;">${m.fonction === 'Sans' ? '-' : m.fonction}</td>
            <td style="padding: 6px; border: 1px solid #ccc;">${m.cellule === 'Sans' ? '-' : m.cellule}</td>
            <td style="padding: 6px; border: 1px solid #ccc;">${m.principales === 'Sans' ? '-' : m.principales}</td>
            <td style="padding: 6px; border: 1px solid #ccc;">${m.secondaires === 'Sans' ? '-' : m.secondaires}</td>
            <td style="padding: 6px; border: 1px solid #ccc;">${m.afis === 'Sans' ? '-' : m.afis}</td>
            <td style="padding: 6px; border: 1px solid #ccc;">${m.grenades === 'Sans' ? '-' : m.grenades}</td>
            <td style="padding: 6px; border: 1px solid #ccc;">${m.equipement === 'Sans' ? '-' : m.equipement}</td>
            <td style="padding: 6px; border: 1px solid #ccc;">${m.equipement2 === 'Sans' ? '-' : m.equipement2}</td>
            <td style="padding: 6px; border: 1px solid #ccc;">${m.tenue}</td>
            <td style="padding: 6px; border: 1px solid #ccc;">${m.gpb}</td>
          </tr>
        `;
      });
      
      tableHTML += `<tr><td colspan="11" style="height: 10px;"></td></tr>`;
    });

    const rallyFooter = rallyTime ? `<div style="margin-top: 20px; font-size: 14px; font-weight: bold;">Heure de rassemblement : ${rallyTime}</div>` : '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          @page { size: A4 landscape; margin: 20px; }
          body { font-family: Helvetica, Arial, sans-serif; font-size: 10px; }
          h1 { color: #0033a0; font-size: 24px; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; }
          th { background-color: #f3f4f6; padding: 8px; border: 1px solid #ccc; font-weight: bold; text-align: left; }
        </style>
      </head>
      <body>
        <h1>${mainTitle}</h1>
        <table>
          <thead>
            <tr>
              ${headers.map(h => `<th>${h}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${tableHTML}
          </tbody>
        </table>
        ${rallyFooter}
      </body>
      </html>
    `;
  };

  // --- CONFIGURATION ---
  const updateConfigFromInputs = () => {
    const newConfig = { ...memberConfig };
    
    Object.keys(configInputs).forEach(key => {
      const k = key as keyof IMemberConfig;
      const items = configInputs[key]
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
      (newConfig[k] as string[]) = [...new Set(items)];
    });
    
    setMemberConfig(newConfig);
    Alert.alert('Succès', 'Configuration mise à jour');
  };

  // --- PRESETS ---
  const savePreset = async (index: number) => {
    try {
      const allMembers: IMember[] = [];
      poolMembers.forEach(m => allMembers.push({ ...m, vehicle_assigned: null }));
      vehicles.forEach(v => {
        v.members.forEach(m => allMembers.push({ ...m, vehicle_assigned: v.name }));
      });

      const data: IPatracData = {
        options: memberConfig,
        members: allMembers,
        vehicles,
        mission_info: { title: missionTitle, rally: rallyTime }
      };

      await AsyncStorage.setItem(PRESET_KEYS[index], JSON.stringify(data));
      Alert.alert('Succès', `Preset ${index + 1} sauvegardé`);
    } catch (e) {
      Alert.alert('Erreur', 'Impossible de sauvegarder le preset');
    }
  };

  const loadPreset = async (index: number) => {
    try {
      const json = await AsyncStorage.getItem(PRESET_KEYS[index]);
      if (!json) {
        Alert.alert('Info', `Preset ${index + 1} est vide`);
        return;
      }

      Alert.alert(
        'Charger Preset',
        `Cela écrasera la session actuelle. Continuer ?`,
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Charger',
            onPress: () => {
              const data: IPatracData = JSON.parse(json);
              restoreData(data);
              saveData();
              Alert.alert('Succès', `Preset ${index + 1} chargé`);
            }
          }
        ]
      );
    } catch (e) {
      Alert.alert('Erreur', 'Impossible de charger le preset');
    }
  };

  const renamePreset = (index: number) => {
    Alert.prompt(
      'Renommer Preset',
      'Nouveau nom :',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'OK',
          onPress: (name) => {
            if (name) {
              const newNames = [...presetNames];
              newNames[index] = name;
              setPresetNames(newNames);
              savePresetNames(newNames);
            }
          }
        }
      ],
      'plain-text',
      presetNames[index]
    );
  };

  // --- APPLY TO OI ---
  const handleApplyToOI = () => {
    if (!onApplyToOI) {
      Alert.alert('Erreur', 'Fonction non disponible');
      return;
    }

    Alert.alert(
      'Appliquer à OI',
      'Cela remplacera la configuration PATRACDVR dans l\'Ordre Initial. Continuer ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Appliquer',
          onPress: () => {
            onApplyToOI({ vehicles, poolMembers });
            Alert.alert('Succès', 'Configuration appliquée à l\'Ordre Initial');
          }
        }
      ]
    );
  };

  // --- RENDER HELPERS ---
  const renderQuickEditPanel = () => {
    if (!isQuickEditVisible || !activeMemberId) return null;

    const member = getActiveMember();
    if (!member) return null;

    return (
      <View style={styles.quickEditPanel}>
        <View style={styles.quickEditHeader}>
          <Text style={styles.quickEditTitle}>Édition : <Text style={styles.quickEditTrigramme}>{member.trigramme}</Text></Text>
          <TouchableOpacity onPress={() => { setIsQuickEditVisible(false); setActiveMemberId(null); }}>
            <MaterialIcons name="close" size={24} color={THEME.textSecondary} />
          </TouchableOpacity>
        </View>
        
        <View style={styles.quickEditContent}>
          {Object.entries(ATTRIBUTE_MAPPING).map(([label, conf]) => (
            <View key={label} style={styles.quickEditCategory}>
              <Text style={styles.quickEditCategoryTitle}>{label}</Text>
              <View style={styles.quickEditOptions}>
                {(memberConfig[conf.key] || []).map(opt => {
                  const isSelected = isQuickEditSelected(conf.attribute, opt);
                  return (
                    <TouchableOpacity
                      key={opt}
                      style={[styles.quickEditBtn, isSelected && styles.quickEditBtnSelected]}
                      onPress={() => handleQuickEditToggle(conf.attribute, opt)}
                    >
                      <Text style={[styles.quickEditBtnText, isSelected && styles.quickEditBtnTextSelected]}>
                        {opt}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity 
          style={styles.deleteMemberBtn}
          onPress={() => member && deleteMember(member.id)}
        >
          <MaterialIcons name="delete" size={20} color={THEME.dangerRed} />
          <Text style={styles.deleteMemberBtnText}>Supprimer l'opérateur</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderNewMemberModal = () => {
    if (!isNewMemberModalVisible) return null;

    return (
      <Modal visible={isNewMemberModalVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Nouveau Membre</Text>
            
            <Text style={styles.label}>Trigramme</Text>
            <TextInput
              style={styles.input}
              value={newMemberTrigramme}
              onChangeText={setNewMemberTrigramme}
              placeholder="Ex: T1, CDG..."
              placeholderTextColor={THEME.textSecondary}
              autoCapitalize="characters"
              maxLength={5}
            />

            <ScrollView style={{ maxHeight: 300 }}>
              {Object.entries(ATTRIBUTE_MAPPING).map(([label, conf]) => (
                <View key={label} style={{ marginBottom: 10 }}>
                  <Text style={styles.label}>{label}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {(memberConfig[conf.key] || []).map(opt => {
                        const isSelected = (newMemberData[conf.attribute] || (conf.attribute === 'tenue' ? 'UBAS' : conf.attribute === 'gpb' ? 'GPBL' : 'Sans')) === opt;
                        return (
                          <TouchableOpacity
                            key={opt}
                            style={[styles.chip, isSelected && styles.chipSelected]}
                            onPress={() => setNewMemberData({ ...newMemberData, [conf.attribute]: opt })}
                          >
                            <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{opt}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </ScrollView>
                </View>
              ))}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 15 }}>
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: 'transparent', borderColor: THEME.textSecondary, borderWidth: 1 }]}
                onPress={() => { setIsNewMemberModalVisible(false); setNewMemberTrigramme(''); setNewMemberData({}); }}
              >
                <Text style={{ color: THEME.textSecondary }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: THEME.successGreen }]}
                onPress={createMember}
              >
                <Text style={{ color: '#000', fontWeight: 'bold' }}>Ajouter</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  };

  const renderConfigModal = () => {
    if (!isConfigVisible) return null;

    return (
      <Modal visible={isConfigVisible} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxHeight: '80%' }]}>
            <Text style={styles.modalTitle}>Configuration Unité</Text>
            <Text style={styles.helpText}>Séparez chaque valeur par une virgule</Text>
            
            <ScrollView>
              {Object.keys(DEFAULT_MEMBER_CONFIG).filter(k => k !== 'vehicules_types').map(key => (
                <View key={key} style={{ marginBottom: 12 }}>
                  <Text style={styles.label}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
                  <TextInput
                    style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
                    value={configInputs[key] || ''}
                    onChangeText={text => setConfigInputs({ ...configInputs, [key]: text })}
                    multiline
                    placeholderTextColor={THEME.textSecondary}
                  />
                </View>
              ))}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 15 }}>
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: 'transparent', borderColor: THEME.textSecondary, borderWidth: 1 }]}
                onPress={() => setIsConfigVisible(false)}
              >
                <Text style={{ color: THEME.textSecondary }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalBtn, { backgroundColor: THEME.accentBlue }]}
                onPress={() => { updateConfigFromInputs(); setIsConfigVisible(false); }}
              >
                <Text style={{ color: '#fff', fontWeight: 'bold' }}>Sauvegarder</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    );
  };

  const renderPresetsModal = () => {
    if (!isPresetsVisible) return null;

    return (
      <Modal visible={isPresetsVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Gestion des Presets</Text>
            
            {PRESET_KEYS.map((_, index) => (
              <View key={index} style={styles.presetRow}>
                <TouchableOpacity 
                  style={styles.presetNameBtn}
                  onPress={() => renamePreset(index)}
                >
                  <Text style={styles.presetName}>{presetNames[index]}</Text>
                  <MaterialIcons name="edit" size={16} color={THEME.textSecondary} />
                </TouchableOpacity>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity 
                    style={[styles.presetActionBtn, { backgroundColor: THEME.accentBlue }]}
                    onPress={() => savePreset(index)}
                  >
                    <MaterialIcons name="save" size={18} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.presetActionBtn, { backgroundColor: THEME.successGreen }]}
                    onPress={() => loadPreset(index)}
                  >
                    <MaterialIcons name="folder-open" size={18} color="#000" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <TouchableOpacity 
              style={[styles.modalBtn, { backgroundColor: 'transparent', borderColor: THEME.textSecondary, borderWidth: 1, marginTop: 15 }]}
              onPress={() => setIsPresetsVisible(false)}
            >
              <Text style={{ color: THEME.textSecondary }}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.backButton}>
          <MaterialIcons name="arrow-back" size={24} color={THEME.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>PATRACDVR</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView style={styles.content} contentContainerStyle={{ paddingBottom: 150 }}>
          
          {/* ACTION BAR */}
          <View style={styles.actionBar}>
            <TouchableOpacity style={styles.actionBtn} onPress={resetAll}>
              <MaterialIcons name="delete-forever" size={20} color={THEME.trashColor} />
              <Text style={[styles.actionBtnText, { color: THEME.trashColor }]}>RAZ</Text>
            </TouchableOpacity>
            
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => setIsPresetsVisible(true)}>
                <MaterialIcons name="bookmark" size={20} color={THEME.accentBlue} />
                <Text style={styles.actionBtnText}>Presets</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.actionBtn} onPress={importData}>
                <MaterialIcons name="upload-file" size={20} color={THEME.textSecondary} />
                <Text style={styles.actionBtnText}>Importer</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.actionBtn} onPress={exportData}>
                <MaterialIcons name="save" size={20} color={THEME.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* MISSION INFO */}
          <View style={styles.missionInputs}>
            <View style={styles.missionInputGroup}>
              <Text style={styles.label}>Titre de la mission</Text>
              <TextInput
                style={styles.input}
                value={missionTitle}
                onChangeText={setMissionTitle}
                placeholder="Ex: OP JUD X"
                placeholderTextColor={THEME.textSecondary}
              />
            </View>
            <View style={styles.missionInputGroup}>
              <Text style={styles.label}>Heure de rassemblement</Text>
              <TextInput
                style={styles.input}
                value={rallyTime}
                onChangeText={setRallyTime}
                placeholder="Ex: 06:00"
                placeholderTextColor={THEME.textSecondary}
              />
            </View>
          </View>

          {/* QUICK EDIT PANEL */}
          {renderQuickEditPanel()}

          {/* VEHICLE CREATION */}
          <Text style={styles.sectionTitle}>1. Gestion des Véhicules</Text>
          <View style={styles.vehicleCreationButtons}>
            {memberConfig.vehicules_types.map(type => (
              <TouchableOpacity 
                key={type} 
                style={styles.addBtn}
                onPress={() => addVehicle(type)}
              >
                <Text style={styles.addBtnText}>+ {type}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity 
              style={[styles.addBtn, { borderColor: THEME.accentBlue }]}
              onPress={() => {
                Alert.prompt(
                  'Nouveau Véhicule',
                  'Nom du véhicule :',
                  [
                    { text: 'Annuler', style: 'cancel' },
                    { text: 'Créer', onPress: name => name && addVehicle(name) }
                  ],
                  'plain-text'
                );
              }}
            >
              <Text style={[styles.addBtnText, { color: THEME.accentBlue }]}>+ Créer Véhicule</Text>
            </TouchableOpacity>
          </View>

          {/* VEHICLES */}
          <Text style={styles.sectionTitle}>2. Composition des Véhicules</Text>
          <View style={styles.vehiclesContainer}>
            {vehicles.map(v => (
              <View key={v.id} style={styles.vehicleRow}>
                <View style={styles.vehicleHeader}>
                  <TouchableOpacity 
                    style={{ flex: 1 }}
                    onLongPress={() => {
                      Alert.prompt(
                        'Renommer',
                        'Nouveau nom :',
                        [
                          { text: 'Annuler', style: 'cancel' },
                          { text: 'OK', onPress: name => name && renameVehicle(v.id, name) }
                        ],
                        'plain-text',
                        v.name
                      );
                    }}
                    delayLongPress={600}
                  >
                    <Text style={styles.vehicleName}>{v.name}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => removeVehicle(v.id)}>
                    <MaterialIcons name="close" size={20} color={THEME.dangerRed} />
                  </TouchableOpacity>
                </View>
                
                <TouchableOpacity 
                  style={styles.membersContainer}
                  onPress={() => {
                    if (activeMemberId) {
                      assignMemberToVehicle(activeMemberId, v.id);
                    }
                  }}
                >
                  {v.members.map(m => (
                    <TouchableOpacity
                      key={m.id}
                      style={[
                        styles.memberBtn,
                        activeMemberId === m.id && styles.memberBtnActive
                      ]}
                      onPress={(e) => {
                        e.stopPropagation();
                        handleMemberPress(m);
                      }}
                      onLongPress={() => handleMemberLongPress(m)}
                    >
                      <Text style={styles.memberTrigramme}>{m.trigramme}</Text>
                      <Text style={styles.memberSubtext}>{m.cellule !== 'Sans' ? m.cellule : ''}</Text>
                    </TouchableOpacity>
                  ))}
                  {v.members.length === 0 && (
                    <Text style={styles.emptyText}>Appuyez pour assigner</Text>
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </View>

          {/* POOL */}
          <View style={styles.poolHeader}>
            <Text style={styles.sectionTitle}>3. Personnel non attribué</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setIsConfigVisible(true)}>
                <MaterialIcons name="settings" size={20} color={THEME.accentBlue} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setIsNewMemberModalVisible(true)}>
                <MaterialIcons name="person-add" size={20} color={THEME.accentBlue} />
              </TouchableOpacity>
            </View>
          </View>
          
          <View style={styles.poolContainer}>
            {poolMembers.map(m => (
              <TouchableOpacity
                key={m.id}
                style={[
                  styles.memberBtn,
                  activeMemberId === m.id && styles.memberBtnActive
                ]}
                onPress={() => handleMemberPress(m)}
                onLongPress={() => handleMemberLongPress(m)}
              >
                <Text style={styles.memberTrigramme}>{m.trigramme}</Text>
                <Text style={styles.memberSubtext}>{m.fonction !== 'Sans' ? m.fonction : ''}</Text>
              </TouchableOpacity>
            ))}
            {poolMembers.length === 0 && (
              <Text style={styles.emptyText}>Aucun membre - Appuyez sur + pour ajouter</Text>
            )}
          </View>

          {/* TRASH */}
          <TouchableOpacity 
            style={styles.trashCan}
            onPress={() => {
              if (activeMemberId) {
                deleteMember(activeMemberId);
              }
            }}
          >
            <MaterialIcons name="auto-delete" size={32} color={THEME.trashColor} />
            <Text style={styles.trashText}>Appuyez pour supprimer</Text>
          </TouchableOpacity>

          {/* GENERATE PDF BUTTON */}
          <TouchableOpacity style={styles.generatePdfBtn} onPress={generatePDF}>
            <MaterialIcons name="picture-as-pdf" size={24} color="#fff" />
            <Text style={styles.generatePdfBtnText}>Générer le PATRACDVR</Text>
          </TouchableOpacity>

          {/* APPLY TO OI BUTTON */}
          {onApplyToOI && (
            <TouchableOpacity style={styles.applyToOIBtn} onPress={handleApplyToOI}>
              <MaterialIcons name="check-circle" size={24} color="#fff" />
              <Text style={styles.generatePdfBtnText}>Appliquer à l'Ordre Initial</Text>
            </TouchableOpacity>
          )}

        </ScrollView>
      </KeyboardAvoidingView>

      {/* MODALS */}
      {renderNewMemberModal()}
      {renderConfigModal()}
      {renderPresetsModal()}
    </SafeAreaView>
  );
}

// --- STYLES ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  header: {
    backgroundColor: 'rgba(9, 9, 11, 0.95)',
    borderBottomWidth: 1,
    borderBottomColor: THEME.borderGlass,
    paddingTop: Platform.OS === 'android' ? 40 : 15,
    paddingBottom: 15,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    color: THEME.accentBlue,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 2,
    textShadowColor: THEME.accentGlow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
  },
  backButton: {
    padding: 5,
  },
  content: {
    padding: 20,
  },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    padding: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: THEME.borderGlass,
    borderRadius: 8,
    backgroundColor: THEME.bgElement,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: 6,
  },
  actionBtnText: {
    color: THEME.textPrimary,
    fontSize: 12,
    fontWeight: 'bold',
  },
  missionInputs: {
    flexDirection: 'row',
    gap: 15,
    marginBottom: 20,
    padding: 15,
    backgroundColor: THEME.bgElement,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: THEME.borderGlass,
  },
  missionInputGroup: {
    flex: 1,
  },
  label: {
    color: THEME.textSecondary,
    fontSize: 11,
    marginBottom: 6,
    textTransform: 'uppercase',
    fontWeight: 'bold',
  },
  input: {
    backgroundColor: THEME.bgInput,
    borderWidth: 1,
    borderColor: THEME.borderGlass,
    borderRadius: 6,
    padding: 10,
    color: THEME.textPrimary,
    fontSize: 14,
  },
  sectionTitle: {
    color: THEME.textSecondary,
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 15,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.borderGlass,
    paddingBottom: 5,
  },
  vehicleCreationButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 15,
    padding: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: THEME.borderGlass,
    borderRadius: 8,
  },
  addBtn: {
    backgroundColor: THEME.bgElement,
    borderWidth: 1,
    borderColor: THEME.borderGlass,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  addBtnText: {
    color: THEME.textPrimary,
    fontSize: 12,
  },
  vehiclesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 15,
  },
  vehicleRow: {
    backgroundColor: THEME.bgElement,
    borderWidth: 1,
    borderColor: THEME.borderGlass,
    borderRadius: 8,
    padding: 10,
    minWidth: 160,
    flex: 1,
  },
  vehicleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 6,
    borderRadius: 4,
    marginBottom: 8,
  },
  vehicleName: {
    color: THEME.accentBlue,
    fontWeight: 'bold',
    fontSize: 13,
    textTransform: 'uppercase',
  },
  membersContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    minHeight: 50,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: THEME.borderGlass,
    borderRadius: 4,
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  memberBtn: {
    backgroundColor: THEME.bgGlassHeavy,
    borderWidth: 1,
    borderColor: THEME.borderGlass,
    borderRadius: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minWidth: 70,
    alignItems: 'center',
  },
  memberBtnActive: {
    borderColor: THEME.accentBlue,
    shadowColor: THEME.accentBlue,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 5,
  },
  memberTrigramme: {
    color: THEME.textPrimary,
    fontWeight: 'bold',
    fontSize: 14,
    letterSpacing: 1,
  },
  memberSubtext: {
    color: THEME.textSecondary,
    fontSize: 10,
    marginTop: 2,
  },
  poolHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  poolContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: THEME.borderGlass,
    borderRadius: 8,
    minHeight: 70,
    backgroundColor: THEME.bgElement,
  },
  emptyText: {
    color: THEME.textSecondary,
    fontSize: 12,
    fontStyle: 'italic',
  },
  trashCan: {
    marginTop: 20,
    padding: 20,
    borderWidth: 3,
    borderStyle: 'dashed',
    borderColor: THEME.trashColor,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.bgElement,
  },
  trashText: {
    color: THEME.trashColor,
    fontWeight: 'bold',
    marginTop: 5,
  },
  generatePdfBtn: {
    backgroundColor: THEME.accentBlue,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 8,
    marginTop: 20,
    shadowColor: THEME.accentBlue,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 5,
  },
  applyToOIBtn: {
    backgroundColor: THEME.successGreen,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 8,
    marginTop: 15,
  },
  generatePdfBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
    marginLeft: 10,
  },
  // Quick Edit Panel
  quickEditPanel: {
    backgroundColor: THEME.bgElement,
    borderWidth: 1,
    borderColor: THEME.borderGlass,
    borderRadius: 8,
    padding: 15,
    marginBottom: 20,
  },
  quickEditHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.borderGlass,
  },
  quickEditTitle: {
    color: THEME.textSecondary,
    fontSize: 14,
  },
  quickEditTrigramme: {
    color: THEME.accentBlue,
    fontWeight: 'bold',
  },
  quickEditContent: {
    gap: 12,
  },
  quickEditCategory: {
    marginBottom: 8,
  },
  quickEditCategoryTitle: {
    color: THEME.textSecondary,
    fontSize: 11,
    textTransform: 'uppercase',
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: THEME.borderGlass,
    paddingBottom: 4,
  },
  quickEditOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  quickEditBtn: {
    backgroundColor: THEME.bgInput,
    borderWidth: 1,
    borderColor: THEME.borderGlass,
    borderRadius: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  quickEditBtnSelected: {
    backgroundColor: THEME.accentBlue,
    borderColor: THEME.accentBlue,
  },
  quickEditBtnText: {
    color: THEME.textSecondary,
    fontSize: 12,
  },
  quickEditBtnTextSelected: {
    color: '#fff',
  },
  deleteMemberBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 15,
    padding: 10,
    borderWidth: 1,
    borderColor: THEME.dangerRed,
    borderRadius: 6,
  },
  deleteMemberBtnText: {
    color: THEME.dangerRed,
    marginLeft: 8,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: THEME.bgGlassHeavy,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: THEME.borderGlass,
    maxHeight: '90%',
  },
  modalTitle: {
    color: THEME.accentBlue,
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
    textTransform: 'uppercase',
  },
  modalBtn: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: THEME.borderGlass,
    backgroundColor: THEME.bgElement,
    marginRight: 6,
  },
  chipSelected: {
    backgroundColor: THEME.accentBlue,
    borderColor: THEME.accentBlue,
  },
  chipText: {
    color: THEME.textSecondary,
    fontSize: 12,
  },
  chipTextSelected: {
    color: '#fff',
  },
  helpText: {
    color: THEME.textSecondary,
    fontSize: 11,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  // Presets
  presetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: THEME.borderGlass,
  },
  presetNameBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  presetName: {
    color: THEME.textPrimary,
    fontSize: 14,
  },
  presetActionBtn: {
    padding: 8,
    borderRadius: 6,
  },
});
