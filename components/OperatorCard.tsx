import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { UserData } from '../types';
import { STATUS_COLORS } from '../constants';

interface Props {
  user: UserData;
  isMe?: boolean;
  me?: UserData;
  style?: any;
  isNightOps?: boolean;
}

const OperatorCard: React.FC<Props> = ({ user, isMe, me, style, isNightOps }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (user.status === 'CONTACT') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(scaleAnim, { toValue: 1.05, duration: 500, useNativeDriver: true }),
          Animated.timing(scaleAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      ).start();
    } else {
      scaleAnim.setValue(1);
    }
  }, [user.status]);

  const getDistance = () => {
    if (!me || !user.lat || !me.lat) return '';
    const R = 6371e3;
    const φ1 = me.lat * Math.PI / 180;
    const φ2 = user.lat * Math.PI / 180;
    const Δφ = (user.lat - me.lat) * Math.PI / 180;
    const Δλ = (user.lng - me.lng) * Math.PI / 180;
    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const d = Math.round(R * c);
    return d > 1000 ? `${(d / 1000).toFixed(1)}km` : `${d}m`;
  };

  const statusColor = isNightOps ? '#ef4444' : STATUS_COLORS[user.status] || '#71717a';
  const borderColor = isNightOps ? '#7f1d1d' : statusColor;
  const bgColor = isNightOps ? '#000000' : '#18181b';
  const textColor = isNightOps ? '#ef4444' : '#f4f4f5';
  const metaColor = isNightOps ? '#7f1d1d' : '#71717a';

  return (
    <Animated.View style={[
      styles.card,
      { borderColor, backgroundColor: bgColor, transform: [{ scale: scaleAnim }] },
      style
    ]}>
      <View style={styles.header}>
        <View style={[styles.roleTag, { backgroundColor: isNightOps ? '#7f1d1d' : '#27272a' }]}>
          <Text style={[styles.roleText, { color: isNightOps ? '#000' : '#71717a' }]}>
            {user.role}
          </Text>
        </View>
        <Text style={[styles.callsign, { color: textColor }]}>
          {user.callsign} {isMe ? '(MOI)' : ''}
        </Text>
        <View style={styles.battery}>
          <Text style={[styles.batText, { color: user.bat < 20 ? '#ef4444' : metaColor }]}>
            {user.bat}%
          </Text>
          <MaterialIcons
            name="battery-std"
            size={16}
            color={user.bat < 20 ? '#ef4444' : metaColor}
          />
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.infoRow}>
          <MaterialIcons name="lens" size={12} color={statusColor} />
          <Text style={[styles.statusText, { color: statusColor }]}>{user.status}</Text>
        </View>

        {!isMe && (
          <View style={styles.infoRow}>
            <MaterialIcons name="near-me" size={12} color={metaColor} />
            <Text style={[styles.distText, { color: metaColor }]}>{getDistance()}</Text>
          </View>
        )}
      </View>

      {user.lastMsg ? (
        <View style={[styles.messageBox, isNightOps && { backgroundColor: '#7f1d1d' }]}>
          <MaterialIcons
            name="chat-bubble"
            size={14}
            color={isNightOps ? '#000' : '#000'}
            style={{ marginRight: 5 }}
          />
          <Text style={[styles.messageText, isNightOps && { color: '#000' }]}>
            {user.lastMsg}
          </Text>
        </View>
      ) : null}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#18181b',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    marginBottom: 8,
    minHeight: 80,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  roleTag: {
    backgroundColor: '#27272a',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  roleText: {
    color: '#71717a',
    fontSize: 10,
    fontWeight: 'bold',
  },
  callsign: {
    color: '#f4f4f5',
    fontWeight: 'bold',
    fontSize: 16,
    flex: 1,
    textAlign: 'center',
  },
  battery: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  batText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  body: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  distText: {
    color: '#a1a1aa',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  messageBox: {
    marginTop: 10,
    backgroundColor: '#fbbf24',
    padding: 8,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 12,
  },
});

export default OperatorCard;
