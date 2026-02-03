import React, { useRef, useEffect } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface Props {
  message: string;
  type: 'alert' | 'info' | 'success' | 'warning';
  isNightOps: boolean;
  onDismiss: () => void;
}

export const NotificationToast: React.FC<Props> = ({ message, type, isNightOps, onDismiss }) => {
  const pan = useRef(new Animated.ValueXY()).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: Animated.event([null, { dx: pan.x }], { useNativeDriver: false }),
      onPanResponderRelease: (e, gestureState) => {
        if (Math.abs(gestureState.dx) > 100) {
          // Swiped away
          // CORRECTION: useNativeDriver passe à false pour éviter le conflit avec le PanResponder
          Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: false }).start(onDismiss);
        } else {
          // Reset
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    pan.setValue({x:0, y:0});
    // CORRECTION: useNativeDriver passe à false
    Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: false }).start();
    
    // Auto dismiss unless alert
    if (type !== 'alert') {
      const timer = setTimeout(() => {
        // CORRECTION: useNativeDriver passe à false
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: false }).start(onDismiss);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [message, type]);

  const getColors = () => {
      if (isNightOps) return { bg: '#000', border: '#7f1d1d', text: '#ef4444', icon: '#ef4444' };
      switch(type) {
          case 'alert': return { bg: '#450a0a', border: '#ef4444', text: '#fff', icon: '#ef4444' };
          case 'success': return { bg: '#052e16', border: '#22c55e', text: '#fff', icon: '#22c55e' };
          case 'warning': return { bg: '#422006', border: '#eab308', text: '#fff', icon: '#eab308' };
          default: return { bg: '#18181b', border: '#3b82f6', text: '#fff', icon: '#3b82f6' };
      }
  };
  const colors = getColors();

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateX: pan.x }],
          opacity: opacity,
          backgroundColor: colors.bg,
          borderColor: colors.border
        }
      ]}
      {...panResponder.panHandlers}
    >
      <MaterialIcons name={type === 'alert' ? "warning" : type === 'success' ? "check-circle" : type === 'warning' ? "wifi-off" : "info"} size={28} color={colors.icon} />
      <Text style={[styles.text, {color: colors.text}]} numberOfLines={2}>{message}</Text>
      <MaterialIcons name="drag-handle" size={20} color={colors.text} style={{opacity: 0.3}} />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    borderRadius: 12,
    borderWidth: 1,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    zIndex: 10000,
    elevation: 10000,
  },
  text: {
    flex: 1,
    fontWeight: 'bold',
    fontSize: 14,
  }
});
