import React from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { UserData, OperatorStatus } from '../types';
import { STATUS_COLORS } from '../constants';

interface Props {
    user: UserData;
    isMe?: boolean;
    me?: UserData; // Pour calculer la distance
    style?: any;
}

const OperatorCard: React.FC<Props> = ({ user, isMe, me, style }) => {
    // Calcul de distance simple (Haversine approximatif pour la performance UI)
    const getDistance = () => {
        if (!me || !user.lat || !me.lat) return '';
        const R = 6371e3; // metres
        const φ1 = me.lat * Math.PI/180;
        const φ2 = user.lat * Math.PI/180;
        const Δφ = (user.lat-me.lat) * Math.PI/180;
        const Δλ = (user.lng-me.lng) * Math.PI/180;
        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const d = Math.round(R * c);
        return d > 1000 ? `${(d/1000).toFixed(1)}km` : `${d}m`;
    };

    const statusColor = STATUS_COLORS[user.status] || '#71717a';

    return (
        <View style={[styles.card, { borderColor: statusColor }, style]}>
            <View style={styles.header}>
                <View style={styles.roleTag}>
                    <Text style={styles.roleText}>{user.role}</Text>
                </View>
                <Text style={styles.callsign}>{user.callsign} {isMe ? '(MOI)' : ''}</Text>
                <View style={styles.battery}>
                    <Text style={[styles.batText, { color: user.bat < 20 ? '#ef4444' : '#a1a1aa' }]}>{user.bat}%</Text>
                    <MaterialIcons name="battery-std" size={16} color={user.bat < 20 ? '#ef4444' : '#a1a1aa'} />
                </View>
            </View>

            <View style={styles.body}>
                <View style={styles.infoRow}>
                    <MaterialIcons name="lens" size={12} color={statusColor} />
                    <Text style={[styles.statusText, { color: statusColor }]}>{user.status}</Text>
                </View>
                
                {!isMe && (
                    <View style={styles.infoRow}>
                        <MaterialIcons name="near-me" size={12} color="#71717a" />
                        <Text style={styles.distText}>{getDistance()}</Text>
                    </View>
                )}
            </View>

            {/* Zonne de Message - S'affiche uniquement si un message existe */}
            {user.lastMsg ? (
                <View style={styles.messageBox}>
                    <MaterialIcons name="chat-bubble" size={14} color="#000" style={{marginRight: 5}} />
                    <Text style={styles.messageText}>{user.lastMsg}</Text>
                </View>
            ) : null}
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#18181b',
        borderRadius: 12,
        padding: 12,
        borderWidth: 1,
        marginBottom: 8,
        minHeight: 80
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8
    },
    roleTag: {
        backgroundColor: '#27272a',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4
    },
    roleText: {
        color: '#71717a',
        fontSize: 10,
        fontWeight: 'bold'
    },
    callsign: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
        flex: 1,
        textAlign: 'center'
    },
    battery: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2
    },
    batText: {
        fontSize: 10,
        fontWeight: 'bold'
    },
    body: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center'
    },
    infoRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5
    },
    statusText: {
        fontSize: 12,
        fontWeight: 'bold'
    },
    distText: {
        color: '#71717a',
        fontSize: 12,
        fontFamily: 'monospace'
    },
    messageBox: {
        marginTop: 10,
        backgroundColor: '#fbbf24', // Ambre / Jaune pour visibilité
        padding: 8,
        borderRadius: 6,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center'
    },
    messageText: {
        color: '#000',
        fontWeight: 'bold',
        fontSize: 12
    }
});

export default OperatorCard;
